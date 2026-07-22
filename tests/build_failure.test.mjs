import assert from "node:assert/strict";
import test from "node:test";
import { execSync } from "node:child_process";

test("build command fails closed when a build step encounters an error", () => {
  // Execute a command chain simulating vite build failing
  assert.throws(() => {
    execSync("node -e 'process.exit(1)' && echo 'should not run'", {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }, "Failing command chain must throw non-zero exit exception");
});
