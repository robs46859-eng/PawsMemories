import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const reasonSource = await readFile(new URL("../agent/graph/nodes/reason.ts", import.meta.url), "utf8");
const actSource = await readFile(new URL("../agent/graph/nodes/act.ts", import.meta.url), "utf8");
const finalizeSource = await readFile(new URL("../agent/graph/nodes/finalize.ts", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.ts", import.meta.url), "utf8");

test("model build plan is static and contains no motion or sprite render stages", () => {
  const planStart = reasonSource.indexOf("export function generateBuildPlan");
  const planEnd = reasonSource.indexOf("export async function reasonNode", planStart);
  const plan = reasonSource.slice(planStart, planEnd);
  assert.match(plan, /Clear inherited animation and restore neutral pose/);
  assert.match(plan, /animations disabled/);
  assert.doesNotMatch(plan, /Create eating animation|Render sprite sheet \(6 animations/);
});

test("static cleanup deterministically removes inherited actions", () => {
  assert.match(actSource, /description\.includes\("clear inherited animation"\)/);
  assert.match(actSource, /bpy\.data\.actions\.remove\(action\)/);
  assert.match(actSource, /bone\.matrix_basis = Matrix\.Identity\(4\)/);
});

test("model completion cannot upload or persist a movement contact sheet", () => {
  assert.match(finalizeSource, /spriteSheetBase64: null/);
  const completionStart = serverSource.indexOf('if \(buildState\.status === "completed"\)');
  const completionEnd = serverSource.indexOf("// Skeletal clip baking", completionStart);
  const completion = serverSource.slice(completionStart, completionEnd);
  assert.doesNotMatch(completion, /uploadBase64Image\(buildState\.spriteSheetBase64\)/);
  assert.match(completion, /updateAvatarModel\(avatarId, avatarPhone, finalModelUrl, "", modelMetadata\)/);
});
