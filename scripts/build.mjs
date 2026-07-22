import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

export const BUILD_STAGES = [
  { name: "client", command: "vite", args: ["build"] },
  {
    name: "server",
    command: "esbuild",
    args: [
      "server.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--packages=external",
      "--sourcemap",
      "--outfile=dist/server.cjs",
    ],
  },
  {
    name: "manifest",
    command: process.execPath,
    args: ["scripts/generate-manifest.mjs", "--target-dir=dist", "--output=dist/release-manifest.json"],
  },
];

function runCommand(stage) {
  const executable = stage.command === process.execPath
    ? process.execPath
    : path.join(rootDir, "node_modules", ".bin", stage.command);
  const result = spawnSync(executable, stage.args, { cwd: rootDir, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Build stage '${stage.name}' failed with exit code ${result.status ?? "unknown"}.`);
  }
}

export function runBuild({ runner = runCommand, clean = true } = {}) {
  if (clean) fs.rmSync(path.join(rootDir, "dist"), { recursive: true, force: true });
  for (const stage of BUILD_STAGES) runner(stage);
}

if (process.argv[1] === __filename) {
  try {
    runBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
