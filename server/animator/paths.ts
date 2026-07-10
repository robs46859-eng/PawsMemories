import path from "path";
import crypto from "crypto";
import fs from "fs";

export const ANIMATOR_DATA_DIR = process.env.ANIMATOR_DATA_DIR || path.join(process.cwd(), "data", "animator");

const ALLOWED_EXTENSIONS = [".glb", ".gltf", ".mp4", ".png"];

export function resolveWithinWorkspace(candidate: string, workspaceRoot: string = ANIMATOR_DATA_DIR): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const normalized = path.resolve(resolvedRoot, candidate);
  
  if (!normalized.startsWith(resolvedRoot + path.sep) && normalized !== resolvedRoot) {
    throw new Error("Path traversal detected");
  }

  const ext = path.extname(normalized).toLowerCase();
  // If it has an extension and we have an allowlist, check it. (directories may not have extensions)
  if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Extension ${ext} not allowed`);
  }

  // Reject symlinks
  if (fs.existsSync(normalized)) {
    const stats = fs.lstatSync(normalized);
    if (stats.isSymbolicLink()) {
      throw new Error("Symlinks not allowed");
    }
  }

  return normalized;
}

export function buildOutputName(originalFilename: string, op: string, params: Record<string, unknown>, inputBytes: Buffer): string {
  const stem = originalFilename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "");
  
  const hashObj = crypto.createHash("sha256");
  hashObj.update(inputBytes);
  hashObj.update(JSON.stringify(params));
  const shortHash = hashObj.digest("hex").substring(0, 6);
  
  let outExt = ".glb";
  if (op === "unpack") outExt = ".gltf";
  
  return `${stem || "file"}.${op}.${shortHash}${outExt}`;
}

export function initializeWorkspace(workspaceRoot: string = ANIMATOR_DATA_DIR) {
  const dirs = [
    "originals",
    "outputs",
    "jobs/pending",
    "jobs/running",
    "jobs/done",
    "jobs/failed",
    "manifests",
    "projects",
    "recordings",
    "screenshots",
    "scenes/backgrounds",
    "tmp"
  ];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(workspaceRoot, dir), { recursive: true });
  }
}
