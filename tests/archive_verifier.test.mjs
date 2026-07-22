import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export function verifyArchiveChecksums(zipPath) {
  const extractDir = fs.mkdtempSync(path.join(rootDir, "temp_test_extract_"));

  try {
    execSync(`unzip -t "${zipPath}"`, { stdio: ["ignore", "pipe", "pipe"] });
    execSync(`unzip -q "${zipPath}" -d "${extractDir}"`, { stdio: ["ignore", "pipe", "pipe"] });

    const requiredFiles = [
      "package.json",
      "package-lock.json",
      "server.ts",
      "db.ts",
      "release-manifest.json",
    ];

    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(extractDir, file))) {
        return { valid: false, error: `Missing required file: ${file}` };
      }
    }

    const forbiddenFiles = [".env", ".env.local", ".env.production"];
    for (const file of forbiddenFiles) {
      if (fs.existsSync(path.join(extractDir, file))) {
        return { valid: false, error: `Forbidden secret file present: ${file}` };
      }
    }

    const forbiddenDirs = [".git", "node_modules", "coverage"];
    for (const dir of forbiddenDirs) {
      if (fs.existsSync(path.join(extractDir, dir))) {
        return { valid: false, error: `Forbidden directory present: ${dir}` };
      }
    }

    const manifestRaw = fs.readFileSync(path.join(extractDir, "release-manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    if (!manifest.commit || !manifest.checksums) {
      return { valid: false, error: "Malformed release manifest" };
    }
    if (manifest.schemaVersion !== 17) {
      return { valid: false, error: `Invalid schemaVersion ${manifest.schemaVersion}, expected 17` };
    }

    // Recalculate and verify SHA-256 for EVERY file in manifest
    for (const [file, expectedHash] of Object.entries(manifest.checksums)) {
      const fullPath = path.join(extractDir, file);
      if (!fs.existsSync(fullPath)) {
        return { valid: false, error: `Manifest file missing in archive: ${file}` };
      }
      const actualHash = crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
      if (actualHash !== expectedHash) {
        return { valid: false, error: `Checksum mismatch for ${file}. Expected ${expectedHash}, got ${actualHash}` };
      }
    }

    return { valid: true, manifest };
  } catch (err) {
    return { valid: false, error: err.message };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

test("verifyArchiveChecksums succeeds on valid archive fixture with matching checksums", () => {
  const testZip = path.join(rootDir, "temp_test_valid_checksum.zip");
  const testStage = fs.mkdtempSync(path.join(rootDir, "temp_stage_cksum_"));

  try {
    const pkgContent = "{}";
    const serverContent = "// server";
    const dbContent = "// db";

    const hashPkg = crypto.createHash("sha256").update(pkgContent).digest("hex");
    const hashServer = crypto.createHash("sha256").update(serverContent).digest("hex");
    const hashDb = crypto.createHash("sha256").update(dbContent).digest("hex");

    fs.writeFileSync(path.join(testStage, "package.json"), pkgContent);
    fs.writeFileSync(path.join(testStage, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(testStage, "server.ts"), serverContent);
    fs.writeFileSync(path.join(testStage, "db.ts"), dbContent);
    fs.writeFileSync(path.join(testStage, ".env.example"), "KEY=VAL");
    fs.writeFileSync(
      path.join(testStage, "release-manifest.json"),
      JSON.stringify({
        commit: "1234567",
        schemaVersion: 17,
        engineCompatible: true,
        checksums: {
          "package.json": hashPkg,
          "server.ts": hashServer,
          "db.ts": hashDb,
        },
      }),
    );

    execSync(`cd "${testStage}" && zip -q "${testZip}" -r .`, { stdio: "ignore" });

    const result = verifyArchiveChecksums(testZip);
    assert.equal(result.valid, true, `Verification failed: ${result.error}`);
  } finally {
    fs.rmSync(testStage, { recursive: true, force: true });
    if (fs.existsSync(testZip)) fs.unlinkSync(testZip);
  }
});

test("verifyArchiveChecksums fails when a file has been tampered with or corrupted", () => {
  const testZip = path.join(rootDir, "temp_test_tampered.zip");
  const testStage = fs.mkdtempSync(path.join(rootDir, "temp_stage_tamper_"));

  try {
    const pkgContent = "{}";
    const serverContent = "// server original";
    const dbContent = "// db";

    // Hash original serverContent, but write tampered content
    const hashServerOriginal = crypto.createHash("sha256").update(serverContent).digest("hex");

    fs.writeFileSync(path.join(testStage, "package.json"), pkgContent);
    fs.writeFileSync(path.join(testStage, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(testStage, "server.ts"), "// server TAMPERED CONTENT");
    fs.writeFileSync(path.join(testStage, "db.ts"), dbContent);
    fs.writeFileSync(
      path.join(testStage, "release-manifest.json"),
      JSON.stringify({
        commit: "1234567",
        schemaVersion: 17,
        checksums: {
          "server.ts": hashServerOriginal,
        },
      }),
    );

    execSync(`cd "${testStage}" && zip -q "${testZip}" -r .`, { stdio: "ignore" });

    const result = verifyArchiveChecksums(testZip);
    assert.equal(result.valid, false);
    assert.match(result.error, /Checksum mismatch for server\.ts/);
  } finally {
    fs.rmSync(testStage, { recursive: true, force: true });
    if (fs.existsSync(testZip)) fs.unlinkSync(testZip);
  }
});
