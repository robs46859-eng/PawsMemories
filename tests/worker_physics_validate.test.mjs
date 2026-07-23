import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// P2 contract: the rig-quality gate exists in the worker, runs at 9.8 m/s^2,
// and covers every known bug class from PAWSOME3D_REDRESS_PLAN.md §5.4.
// (Behavioral broken-fixture tests run in worker CI where Blender is available.)

const bridge = fs.readFileSync("blender-worker/bridge/tcp_server.py", "utf8");
const server = fs.readFileSync("blender-worker/server.js", "utf8");

test("physics_validate is registered as a bridge method", () => {
  assert.match(bridge, /def handle_physics_validate\(params: dict\) -> dict:/);
  assert.match(bridge, /"physics_validate": handle_physics_validate,/);
});

test("gravity is 9.8 m/s^2 downward", () => {
  assert.match(bridge, /PHYSICS_GRAVITY_MS2 = 9\.8/);
  assert.match(bridge, /scene\.gravity = \(0\.0, 0\.0, -PHYSICS_GRAVITY_MS2\)/);
});

test("every known rig bug has a named guard", () => {
  for (const check of [
    "rig_present",
    "weights_complete",
    "weights_influences",
    "weights_distance",
    "limb_symmetry",
    "hinge_axes",
    "neck_weight_isolation",
    "face_weight_lock",
    "viseme_containment",
    "foot_contact",
    "twist_volume",
    "gravity_drop_settle",
  ]) {
    assert.ok(bridge.includes(`"${check}"`), `guard '${check}' must exist in physics_validate`);
  }
});

test("guard thresholds match the redress plan", () => {
  assert.match(bridge, /NECK_TORSO_BLEED_MAX = 0\.05/);
  assert.match(bridge, /SYMMETRY_CHAIN_DELTA_MAX = 0\.02/);
  assert.match(bridge, /TWIST_AREA_LOSS_MAX = 0\.30/);
  assert.match(bridge, /MAX_INFLUENCES = 4/);
});

test("unrigged models fail closed", () => {
  // A model with no armature must return pass:false, never a crash or a pass.
  assert.match(bridge, /"detail": "No armature bound to a mesh — model is unrigged\."/);
});

test("worker HTTP exposes /physics-validate behind the bridge", () => {
  assert.match(server, /app\.post\("\/physics-validate"/);
  assert.match(server, /physicsValidate\(profile, facial\)/);
  assert.match(server, /"\/physics-validate",[\s\S]{0,200}\], requireWorkerAuth, requireBridge\)/);
});
