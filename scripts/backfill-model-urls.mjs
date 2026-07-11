import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const DRY_RUN = !process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find(arg => arg.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : 1000;
const TABLE_ARG = process.argv.find(arg => arg.startsWith("--table="));
const TARGET_TABLE = TABLE_ARG ? TABLE_ARG.split("=")[1] : "all";
const CONCURRENCY_CAP = 5;

// S3 Client setup
const bucketName = process.env.MEDIA_BUCKET_NAME;
const bucketEndpoint = process.env.MEDIA_BUCKET_URL;
const accessKeyId = process.env.MEDIA_BUCKET_KEY;
const secretAccessKey = process.env.MEDIA_BUCKET_SECRET;

if (!bucketName || !bucketEndpoint || !accessKeyId || !secretAccessKey) {
  console.error("Missing MEDIA_BUCKET_* env vars.");
  process.exit(1);
}

const s3Client = new S3Client({
  region: "us-east-1",
  endpoint: bucketEndpoint,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

// DB Setup
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || "3306", 10),
  ssl: { rejectUnauthorized: false },
});

// Stats
const stats = {
  scanned: 0,
  ok: 0,
  remirrored: 0,
  deadProvider: 0,
  deadDurable: 0,
  errors: 0,
  needsRegenIds: { creations: [], avatars: [], pets: [] },
};

async function checkUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const isDurable = url.hostname.includes(bucketName) || url.hostname.includes("backblazeb2.com");
    
    if (isDurable) {
      // It's in our bucket. HEAD it.
      // Expected path: /bucketName/folder/file or /folder/file depending on endpoint
      let key = url.pathname.substring(1); 
      if (key.startsWith(`${bucketName}/`)) key = key.substring(bucketName.length + 1);

      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
        return { status: "ok", type: "durable" };
      } catch (err) {
        if (err.name === "NotFound") return { status: "dead", type: "durable" };
        throw err;
      }
    } else {
      // It's a provider URL. HEAD it.
      const res = await fetch(urlStr, { method: "HEAD" });
      if (res.ok) {
        return { status: "live", type: "provider" };
      } else if (res.status === 404 || res.status === 403) {
        return { status: "dead", type: "provider" };
      }
      throw new Error(`Unexpected status ${res.status}`);
    }
  } catch (err) {
    return { status: "error", error: err.message };
  }
}

async function mirrorUrl(sourceUrl, mimeType = "model/gltf-binary") {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Failed to download ${sourceUrl}`);
  
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  const ext = mimeType === "model/gltf-binary" ? "glb" : "bin";
  const folder = mimeType.startsWith("model/") ? "models" : "creations";
  const fileName = `${folder}/${Date.now()}-${uuidv4()}.${ext}`;

  if (!DRY_RUN) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: buffer,
        ContentType: mimeType,
        ACL: "public-read",
      })
    );
  }
  
  const url = new URL(bucketEndpoint);
  return `${url.protocol}//${bucketName}.${url.host}/${fileName}`;
}

async function processCreations() {
  const [rows] = await pool.query(`
    SELECT id, model_url FROM creations 
    WHERE media_type='model' AND model_url IS NOT NULL 
    LIMIT ?
  `, [LIMIT]);

  console.log(`\nScanning ${rows.length} creations...`);
  
  for (const row of rows) {
    stats.scanned++;
    const res = await checkUrl(row.model_url);
    
    if (res.status === "ok") {
      stats.ok++;
    } else if (res.status === "dead") {
      if (res.type === "durable") stats.deadDurable++;
      else stats.deadProvider++;
      stats.needsRegenIds.creations.push(row.id);
      
      if (!DRY_RUN) {
        await pool.query("UPDATE creations SET generation_status='needs_regen' WHERE id=?", [row.id]);
      }
      console.log(`[Creation ${row.id}] Dead ${res.type} URL -> needs_regen`);
    } else if (res.status === "live" && res.type === "provider") {
      console.log(`[Creation ${row.id}] Live provider URL -> remirroring...`);
      try {
        const newUrl = await mirrorUrl(row.model_url);
        stats.remirrored++;
        if (!DRY_RUN) {
          await pool.query("UPDATE creations SET model_url=? WHERE id=?", [newUrl, row.id]);
        }
      } catch (err) {
        console.error(`[Creation ${row.id}] Mirror failed: ${err.message}`);
        stats.errors++;
      }
    } else {
      stats.errors++;
    }
  }
}

async function processAvatars() {
  const [rows] = await pool.query(`
    SELECT id, model_url, rigged_model_url FROM avatars 
    WHERE model_url IS NOT NULL OR rigged_model_url IS NOT NULL
    LIMIT ?
  `, [LIMIT]);

  console.log(`\nScanning ${rows.length} avatars...`);
  
  for (const row of rows) {
    let needsRegen = false;
    const urls = { model_url: row.model_url, rigged_model_url: row.rigged_model_url };
    
    for (const [field, url] of Object.entries(urls)) {
      if (!url) continue;
      stats.scanned++;
      const res = await checkUrl(url);
      
      if (res.status === "ok") {
        stats.ok++;
      } else if (res.status === "dead") {
        if (res.type === "durable") stats.deadDurable++;
        else stats.deadProvider++;
        needsRegen = true;
        console.log(`[Avatar ${row.id}] Dead ${res.type} ${field} -> needs_regen`);
      } else if (res.status === "live" && res.type === "provider") {
        console.log(`[Avatar ${row.id}] Live provider ${field} -> remirroring...`);
        try {
          const newUrl = await mirrorUrl(url);
          stats.remirrored++;
          if (!DRY_RUN) {
            await pool.query(`UPDATE avatars SET ${field}=? WHERE id=?`, [newUrl, row.id]);
          }
        } catch (err) {
          console.error(`[Avatar ${row.id}] Mirror failed: ${err.message}`);
          stats.errors++;
        }
      } else {
        stats.errors++;
      }
    }
    
    if (needsRegen) {
      stats.needsRegenIds.avatars.push(row.id);
      if (!DRY_RUN) {
        await pool.query("UPDATE avatars SET generation_status='needs_regen' WHERE id=?", [row.id]);
      }
    }
  }
}

async function processPets() {
  const [rows] = await pool.query(`
    SELECT id, rigged_glb_url, lod_glb_url FROM pet_profiles 
    WHERE rigged_glb_url IS NOT NULL OR lod_glb_url IS NOT NULL
    LIMIT ?
  `, [LIMIT]);

  console.log(`\nScanning ${rows.length} pet profiles...`);
  // Similar to avatars, checking both rigged_glb_url and lod_glb_url
  for (const row of rows) {
    let needsRegen = false;
    const urls = { rigged_glb_url: row.rigged_glb_url, lod_glb_url: row.lod_glb_url };
    
    for (const [field, url] of Object.entries(urls)) {
      if (!url) continue;
      stats.scanned++;
      const res = await checkUrl(url);
      
      if (res.status === "ok") {
        stats.ok++;
      } else if (res.status === "dead") {
        if (res.type === "durable") stats.deadDurable++;
        else stats.deadProvider++;
        needsRegen = true;
        console.log(`[Pet ${row.id}] Dead ${res.type} ${field} -> needs_regen`);
      } else if (res.status === "live" && res.type === "provider") {
        console.log(`[Pet ${row.id}] Live provider ${field} -> remirroring...`);
        try {
          const newUrl = await mirrorUrl(url);
          stats.remirrored++;
          if (!DRY_RUN) {
            await pool.query(`UPDATE pet_profiles SET ${field}=? WHERE id=?`, [newUrl, row.id]);
          }
        } catch (err) {
          console.error(`[Pet ${row.id}] Mirror failed: ${err.message}`);
          stats.errors++;
        }
      } else {
        stats.errors++;
      }
    }
    
    if (needsRegen) {
      stats.needsRegenIds.pets.push(row.id);
      // No standard 'generation_status' on pets, they just rely on avatars/creations.
    }
  }
}

async function run() {
  console.log(`Starting backfill. DRY_RUN: ${DRY_RUN}, TARGET: ${TARGET_TABLE}, LIMIT: ${LIMIT}`);
  
  if (TARGET_TABLE === "all" || TARGET_TABLE === "creations") await processCreations();
  if (TARGET_TABLE === "all" || TARGET_TABLE === "avatars") await processAvatars();
  if (TARGET_TABLE === "all" || TARGET_TABLE === "pets") await processPets();
  
  console.log("\n=== Summary ===");
  console.log(JSON.stringify(stats, null, 2));
  
  const reportDir = path.resolve("docs", "reports");
  await fs.mkdir(reportDir, { recursive: true });
  const dateStr = new Date().toISOString().split("T")[0];
  const reportPath = path.join(reportDir, `model-url-backfill-${dateStr}${DRY_RUN ? "-dryrun" : ""}.json`);
  
  await fs.writeFile(reportPath, JSON.stringify(stats, null, 2));
  console.log(`\nReport written to ${reportPath}`);
  
  await pool.end();
  process.exit(0);
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
