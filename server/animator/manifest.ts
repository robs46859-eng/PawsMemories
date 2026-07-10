import crypto from "crypto";
import fs from "fs";
import type { ConversionManifest } from "../../src/animator/types.ts";
import { resolveWithinWorkspace, ANIMATOR_DATA_DIR } from "./paths.ts";

export function sha256File(absPath: string): string {
  const fileBuffer = fs.readFileSync(absPath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

export function buildManifest(args: {
  jobId: string;
  assetId: string;
  preset: "safe" | "optimize";
  inputs: { path: string }[];
  outputs: { path: string; op: string; bucketUrl?: string }[];
  operations: string[];
}): ConversionManifest {
  const inputs = args.inputs.map((input) => {
    return {
      path: input.path,
      sha256: sha256File(input.path),
      bytes: fs.statSync(input.path).size,
      preserved: true as const
    };
  });

  const outputs = args.outputs.map((output) => {
    return {
      path: output.path,
      op: output.op,
      bucketUrl: output.bucketUrl,
      sha256: sha256File(output.path),
      bytes: fs.statSync(output.path).size
    };
  });

  return {
    jobId: args.jobId,
    assetId: args.assetId,
    preset: args.preset,
    inputs,
    outputs,
    operations: args.operations,
    lossless: args.preset === "safe",
    createdAt: new Date().toISOString()
  };
}

export function writeManifest(m: ConversionManifest, workspaceRoot: string = ANIMATOR_DATA_DIR): string {
  const manifestPath = resolveWithinWorkspace(`manifests/${m.jobId}.json`, workspaceRoot);
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2), "utf8");
  return manifestPath;
}

export function readManifest(jobId: string, workspaceRoot: string = ANIMATOR_DATA_DIR): ConversionManifest {
  const manifestPath = resolveWithinWorkspace(`manifests/${jobId}.json`, workspaceRoot);
  const content = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(content) as ConversionManifest;
}
