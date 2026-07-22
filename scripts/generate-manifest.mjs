import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_SCHEMA_VERSION } from "../server/migrations/runner.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function getGitInfo(command, fallback, cwd = rootDir) {
  try {
    return execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function hashFileInDir(dir, relativePath) {
  const fullPath = path.join(dir, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function validateEngineVersion(versionStr = process.version) {
  const parts = versionStr.replace(/^v/, "").split(".").map(Number);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  return major === 24 && minor >= 15;
}

export function generateManifest(env = process.env, targetDir = rootDir) {
  const commit = env.APP_COMMIT_SHA || env.SOURCE_COMMIT || getGitInfo("git rev-parse HEAD", "unknown", targetDir);
  const branch = env.APP_BRANCH || getGitInfo("git branch --show-current", "unknown", targetDir);
  const builtAt = env.APP_BUILD_TIME || new Date().toISOString();
  const schemaVersion = CURRENT_SCHEMA_VERSION; // Authoritative schema version 17

  let npmVersion = "unknown";
  try {
    npmVersion = execSync("npm --version", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}

  const engineCompatible = validateEngineVersion(process.version);
  if (!engineCompatible && env.NODE_ENV === "production") {
    throw new Error(`Incompatible Node engine ${process.version}. Required: >=24.15 <25`);
  }

  const criticalFiles = [
    "package.json",
    "package-lock.json",
    "server.ts",
    "db.ts",
    "index.html",
    "vite.config.ts",
  ];

  const checksums = {};
  for (const file of criticalFiles) {
    const hash = hashFileInDir(targetDir, file);
    if (hash) checksums[file] = hash;
  }

  const dirty = Boolean(getGitInfo("git status --porcelain", "", targetDir));

  return {
    commit,
    branch,
    builtAt,
    schemaVersion,
    nodeVersion: process.version,
    npmVersion,
    engineCompatible,
    dirty,
    checksums,
  };
}

if (process.argv[1] === __filename) {
  const outArg = process.argv.find((a) => a.startsWith("--output="));
  const outputPath = outArg ? outArg.split("=")[1] : path.join(rootDir, "dist", "release-manifest.json");

  // Clean up stale root manifest if present
  const rootManifest = path.join(rootDir, "release-manifest.json");
  if (fs.existsSync(rootManifest) && outputPath !== rootManifest) {
    try { fs.unlinkSync(rootManifest); } catch {}
  }

  const manifest = generateManifest();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✅ Release manifest generated at ${outputPath}`);
}
