import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("print repair contract passes its geometry fixtures", () => {
  const result = spawnSync(
    "python3",
    [path.join(repoRoot, "blender-worker/bridge/tests/test_print_mesh_contract.py")],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 8 tests/);
});

test("Blender print preparation repairs then validates the exported artifact", () => {
  const bridge = readFileSync(path.join(repoRoot, "blender-worker/bridge/tcp_server.py"), "utf8");
  const handler = bridge.slice(
    bridge.indexOf("def handle_prepare_print_stl"),
    bridge.indexOf("def handle_import_glb"),
  );

  assert.match(handler, /_repair_print_mesh_with_bmesh/);
  assert.match(handler, /_repair_print_mesh_with_voxels/);
  assert.match(handler, /"ascii_format": False/);
  assert.match(handler, /inspect_binary_stl\(stl_bytes, target_height_mm\)/);
  assert.match(handler, /if not exported_validation\["passed"\]/);
  assert.match(handler, /"printable": True/);
  assert.doesNotMatch(handler, /"printable":\s*non_manifold_edges\s*==/);
});

test("worker and checkout boundaries preserve fail-closed repair diagnostics", () => {
  const worker = readFileSync(path.join(repoRoot, "blender-worker/server.js"), "utf8");
  const workerRoute = worker.slice(
    worker.indexOf('app.post("/prepare-print"'),
    worker.indexOf('app.post("/physics-validate"'),
  );
  const server = readFileSync(path.join(repoRoot, "server.ts"), "utf8");

  assert.match(workerRoute, /res\.status\(result\?\.success \? 200 : 422\)\.json\(result\)/);
  assert.match(server, /if \(!preparedResponse\.ok \|\| !prepared\?\.success\)/);
  assert.match(server, /prepared\?\.error \|\| "The model could not be prepared for printing\."/);
  assert.match(server, /if \(!prepared\.printable\)/);
});
