import fs from "node:fs";
import path from "node:path";
import { CURRENT_SCHEMA_VERSION } from "../server/migrations/runner.ts";
import { RELEASE_MANIFEST_FILE, verifyReleaseDirectory } from "./release-manifest-lib.mjs";

const rootDir = path.resolve(process.argv[2] || ".");
const expectedCommit = process.env.EXPECTED_COMMIT;
const expectedBranch = process.env.EXPECTED_BRANCH;
const requireClean = process.env.REQUIRE_CLEAN !== "false";
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, RELEASE_MANIFEST_FILE), "utf8"));
const result = verifyReleaseDirectory(rootDir, manifest, {
  expectedCommit,
  expectedBranch,
  expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
  requireClean,
});

if (!result.valid) {
  console.error(result.error);
  process.exit(1);
}
console.log(`Verified ${result.fileCount} archived files against ${RELEASE_MANIFEST_FILE}.`);
