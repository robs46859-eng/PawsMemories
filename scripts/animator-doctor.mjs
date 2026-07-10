import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

async function check(message, testFn) {
  process.stdout.write(`- ${message}... `);
  try {
    await testFn();
    console.log(`${GREEN}✓${RESET}`);
    return true;
  } catch (e) {
    console.log(`${RED}✗${RESET}`);
    console.error(`  ${e.message}`);
    return false;
  }
}

async function run() {
  console.log(`${BOLD}Animator Subsystem Doctor${RESET}\n`);
  let allPass = true;

  // 1. Node version
  allPass = (await check("Node version", () => {
    const version = process.version;
    if (version < "v18.0.0") throw new Error(`Node >= v18 required, got ${version}`);
  })) && allPass;

  // 2. CLI
  allPass = (await check("@gltf-transform/cli is available", () => {
    execSync("npx gltf-transform --version", { stdio: "ignore" });
  })) && allPass;

  // 3. Imports
  allPass = (await check("@gltf-transform core/functions importable", async () => {
    await import("@gltf-transform/core");
    await import("@gltf-transform/functions");
  })) && allPass;

  // 3.5 Optional Dependencies
  try {
    await import("sharp");
    console.log(`- sharp is available... ${GREEN}✓${RESET}`);
  } catch (e) {
    console.log(`- sharp is available... ${RED}✗ (Warning: sharp is missing, image operations might be slower)${RESET}`);
  }

  // 4. Workspace
  const dataDir = process.env.ANIMATOR_DATA_DIR || path.join(process.cwd(), "data", "animator");
  allPass = (await check(`ANIMATOR_DATA_DIR (${dataDir}) exists & writable`, () => {
    const fix = process.argv.includes("--fix");
    if (fix && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (!fs.existsSync(dataDir)) {
      throw new Error(`Directory does not exist. Run with --fix to create it.`);
    }

    const testFile = path.join(dataDir, ".test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  })) && allPass;

  // 5. Directories
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
  allPass = (await check("Workspace subdirectories exist", () => {
    const fix = process.argv.includes("--fix");
    for (const d of dirs) {
      const p = path.join(dataDir, d);
      if (fix && !fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      if (!fs.existsSync(p)) throw new Error(`Missing ${d}. Run with --fix.`);
    }
  })) && allPass;

  console.log("");
  if (allPass) {
    console.log(`${GREEN}All server-side checks passed.${RESET}`);
    console.log(`\nNote: WebCodecs/H.264 support is validated client-side at runtime.`);
    console.log(`Check console snippets:`);
    console.log(`  await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 16000000, framerate: 60 })`);
    process.exit(0);
  } else {
    console.log(`${RED}Some checks failed.${RESET}`);
    process.exit(1);
  }
}

run();
