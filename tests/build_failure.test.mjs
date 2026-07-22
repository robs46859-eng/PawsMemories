import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_STAGES, runBuild } from "../scripts/build.mjs";

test("the production build orchestrator stops at the failed stage", () => {
  const called = [];
  assert.throws(
    () => runBuild({
      clean: false,
      runner(stage) {
        called.push(stage.name);
        if (stage.name === "server") throw new Error("intentional server build failure");
      },
    }),
    /intentional server build failure/,
  );
  assert.deepEqual(called, ["client", "server"]);
  assert.deepEqual(BUILD_STAGES.map((stage) => stage.name), ["client", "server", "manifest"]);
});
