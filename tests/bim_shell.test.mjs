import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAndVerifyShell } from "../server/bim/shell.ts";

test("Shell build is parsed and dimension-verified after construction", async () => {
  const model = {
    name: "Shell acceptance", siteName: "Site", buildingName: "Building",
    levels: [{ id: "l0", name: "Ground", elevation: 0 }],
    elements: [
      { id: "slab", type: "slab", name: "Slab", levelId: "l0", position: [0, 0, 0], width: 4, depth: 3, height: 0.2 },
      { id: "wall", type: "wall", name: "Wall", levelId: "l0", position: [0, 0, 0.2], end: [4, 0], thickness: 0.2, height: 3 },
    ],
  };
  const result = await buildAndVerifyShell(model);
  assert.equal(result.verification.stage, "post-build");
  assert.equal(result.verification.passed, true);
  assert.equal(result.verification.dimensionsPreserved, true);
  assert.equal(result.verification.meshCount, 2);
  assert.ok(Buffer.from(result.glbBase64, "base64").length > 100);
});
