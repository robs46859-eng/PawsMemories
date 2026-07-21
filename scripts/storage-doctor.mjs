#!/usr/bin/env node
/**
 * scripts/storage-doctor.mjs
 *
 * Proves the private media bucket actually works, end to end, instead of
 * guessing from config. Runs a real round-trip through the app's OWN functions
 * in storage.private.ts — not a reimplementation — so a pass here means the
 * marketplace download path works.
 *
 * What each step proves:
 *
 *   1. config assertion  → names differ, credentials present  (catches typos)
 *   2. PutObject         → endpoint reachable + writeFiles     (catches bad URL / scope)
 *   3. HeadObject        → readFiles + key landed in the right bucket
 *   4. presign GET       → shareFiles capability               (the one you can't see in the UI)
 *   5. fetch presigned   → the URL works from OUTSIDE the SDK  (what a buyer's browser does)
 *   6. byte comparison   → round-trip integrity
 *   7. server-side read  → getPrivateObjectBuffer path
 *
 * Step 5 is the important one. A key missing `shareFiles` will pass steps 1-4
 * and fail only here, with a 401/403 — which is exactly the failure that would
 * otherwise show up the first time a customer paid for a model.
 *
 * Usage (from the repo root, with .env present or the vars exported):
 *   node --experimental-strip-types scripts/storage-doctor.mjs
 *   npx tsx scripts/storage-doctor.mjs          # if the above complains
 *
 * Writes one ~40-byte object under marketplace/<uuid>/ and leaves it there
 * (storage.private.ts intentionally exposes no delete). Harmless, but you can
 * remove it from the B2 console afterwards if you like.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ── Load .env so this behaves like the server does ───────────────────────────
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const pass = (m) => console.log(`   \x1b[32m✔\x1b[0m ${m}`);
const fail = (m) => console.log(`   \x1b[31m✖\x1b[0m ${m}`);
const info = (m) => console.log(`     \x1b[2m${m}\x1b[0m`);
const step = (n, m) => console.log(`\n\x1b[1m${n}. ${m}\x1b[0m`);

// Surface which credentials are in play WITHOUT printing secrets.
function fingerprint(v) {
  if (!v) return "(unset)";
  return v.length <= 8 ? `${v.slice(0, 2)}…` : `${v.slice(0, 6)}…${v.slice(-2)} (${v.length} chars)`;
}

async function main() {
  console.log("\n\x1b[1mPrivate storage doctor\x1b[0m\n" + "─".repeat(62));

  step(0, "Configuration");
  info(`MEDIA_BUCKET_NAME          ${process.env.MEDIA_BUCKET_NAME || "(unset)"}`);
  info(`MEDIA_PRIVATE_BUCKET_NAME  ${process.env.MEDIA_PRIVATE_BUCKET_NAME || "(unset)"}`);
  info(`MEDIA_BUCKET_URL           ${process.env.MEDIA_BUCKET_URL || "(unset)"}`);
  info(`MEDIA_PRIVATE_BUCKET_KEY   ${fingerprint(process.env.MEDIA_PRIVATE_BUCKET_KEY)}`);
  info(`MEDIA_PRIVATE_BUCKET_SECRET${fingerprint(process.env.MEDIA_PRIVATE_BUCKET_SECRET)}`);
  if (!process.env.MEDIA_PRIVATE_BUCKET_KEY) {
    info("note: no private key set — will fall back to MEDIA_BUCKET_KEY, which is");
    info("      scoped to the PUBLIC bucket and will fail at step 2 or 4.");
  }
  // These are read by nothing. Flag them so they get cleaned up.
  const dead = Object.keys(process.env).filter((k) => k.startsWith("PRIVATE_MEDIA_BUCKET"));
  if (dead.length) {
    console.log(`   \x1b[33m⚠\x1b[0m ${dead.length} dead var(s) set — nothing reads these: ${dead.join(", ")}`);
  }

  const storage = await import("../storage.private.ts");

  step(1, "Config assertion (assertPrivateStorageConfig)");
  try {
    storage.assertPrivateStorageConfig();
    pass("names differ, endpoint and credentials present");
  } catch (e) {
    fail(e.message);
    process.exit(1);
  }

  // A valid-looking listing UUID; mintObjectKey enforces the shape.
  const objectKey = storage.mintObjectKey(randomUUID(), "model/gltf-binary");
  const body = Buffer.from(`storage-doctor ${new Date().toISOString()}\n`);
  info(`test object: ${objectKey}`);

  step(2, "Upload (PutObject → proves endpoint reachable + writeFiles)");
  let put;
  try {
    put = await storage.putPrivateObject(objectKey, body, "model/gltf-binary");
    pass(`wrote ${put.sizeBytes} bytes`);
  } catch (e) {
    fail(e.message);
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(e.message)) {
      info("→ MEDIA_BUCKET_URL is not reachable. Check the endpoint host/region.");
    } else if (/AccessDenied|Forbidden|403/i.test(e.message)) {
      info("→ Reached B2 but the key cannot write to this bucket.");
      info("  The key is probably scoped to pawsmemories-media, not -private.");
    } else if (/NoSuchBucket|404/i.test(e.message)) {
      info("→ MEDIA_PRIVATE_BUCKET_NAME does not match a real bucket.");
    }
    process.exit(1);
  }

  step(3, "Head (HeadObject → proves readFiles + object landed)");
  try {
    const head = await storage.headPrivateObject(objectKey);
    pass(`found, ${head?.sizeBytes ?? head?.ContentLength ?? "?"} bytes`);
  } catch (e) {
    fail(e.message);
    info("→ Write succeeded but read failed: key likely lacks readFiles.");
    process.exit(1);
  }

  step(4, "Presign GET (proves shareFiles is granted)");
  let signed;
  try {
    signed = await storage.getPrivateSignedUrl(objectKey, 300);
    pass(`signed, expires ${signed.expiresAt} (ttl ${signed.ttlSeconds}s)`);
    info(signed.url.split("?")[0]);
  } catch (e) {
    fail(e.message);
    info("→ Could not sign. Without shareFiles, presigning may fail here or at step 5.");
    process.exit(1);
  }

  step(5, "Fetch the presigned URL (what a buyer's browser does) ⇦ THE REAL TEST");
  let fetched;
  try {
    const res = await fetch(signed.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      fail(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text().catch(() => "");
      if (text) info(text.slice(0, 400));
      if (res.status === 401 || res.status === 403) {
        console.log(`
   \x1b[33mThis is the shareFiles failure.\x1b[0m The key can read and write via the
   SDK but cannot authorise presigned downloads. B2 cannot add capabilities to
   an existing key — create a new Application Key and make sure the listed
   capabilities include \x1b[1mshareFiles\x1b[0m, then update
   MEDIA_PRIVATE_BUCKET_KEY / _SECRET.
`);
      }
      process.exit(1);
    }
    fetched = Buffer.from(await res.arrayBuffer());
    pass(`HTTP ${res.status}, ${fetched.byteLength} bytes`);
  } catch (e) {
    fail(e.message);
    process.exit(1);
  }

  step(6, "Round-trip integrity");
  if (fetched.equals(body)) pass("bytes match what was uploaded");
  else {
    fail(`mismatch: sent ${body.byteLength}, got ${fetched.byteLength}`);
    process.exit(1);
  }

  step(7, "Server-side read (getPrivateObjectBuffer)");
  try {
    const buf = await storage.getPrivateObjectBuffer(objectKey);
    if (buf.equals(body)) pass("server-side fetch matches");
    else { fail("server-side bytes differ"); process.exit(1); }
  } catch (e) {
    fail(e.message);
    process.exit(1);
  }

  console.log(`
${"─".repeat(62)}
\x1b[32m\x1b[1mAll checks passed.\x1b[0m Private storage is correctly configured:
endpoint reachable, credentials scoped to the right bucket, shareFiles
granted, and presigned downloads work from outside the SDK.

Leftover test object (safe to delete from the B2 console):
  ${objectKey}
`);
}

main().catch((e) => {
  console.error(`\n\x1b[31mUnexpected failure:\x1b[0m ${e?.stack || e?.message || e}\n`);
  process.exit(1);
});
