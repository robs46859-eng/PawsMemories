import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), 'utf8');

test('tcp bridge dispatches Blender handlers on the main thread', () => {
  const bridge = read('blender-worker/bridge/tcp_server.py');
  assert.match(bridge, /REQUEST_QUEUE/);
  assert.match(bridge, /dispatch_request/);
  assert.match(bridge, /process_request_queue/);
  assert.doesNotMatch(bridge, /response = dispatch_request\(request\)/);
});

test('Blender 5.1 GLB export filters unsupported operator kwargs', () => {
  const bridge = read('blender-worker/bridge/tcp_server.py');
  assert.match(bridge, /filter_operator_kwargs/);
  assert.match(bridge, /export_animations/);
  assert.doesNotMatch(bridge, /export_animation=True/);
});

test('orchestrator imports the provided GLB before LLM planning begins', () => {
  const orchestrator = read('agent/graph/orchestrator.ts');
  assert.match(orchestrator, /import_glb/);
  assert.match(orchestrator, /glbBase64/);
  assert.doesNotMatch(orchestrator, /Scene cleared, ready for import/);
});

test('generated Blender code guidance avoids fragile file imports and background context shortcuts', () => {
  const act = read('agent/graph/nodes/act.ts');
  assert.match(act, /Do not import GLB files/);
  assert.match(act, /bpy\.context\.scene\.objects/);
  assert.match(act, /selected_objects[\s\S]+unavailable in Render\/worker background contexts/);
  assert.match(act, /selected_objects\/g/);
  assert.match(act, /"bpy.context.scene.objects"/);
  assert.match(act, /import_scene\.gltf removed: pipeline already imported the GLB/);
});

test('successful bpy bridge executions are not counted as failed steps', () => {
  const mcp = read('agent/tools/blender_mcp.ts');
  const act = read('agent/graph/nodes/act.ts');
  assert.match(mcp, /success:\s*result\.success,\n\s*stdout:/);
  assert.match(act, /execResult\.success\s*&&\s*\(execResult\.data\?\.success\s*\?\?\s*true\)/);
  assert.doesNotMatch(act, /execResult\.success\s*&&\s*execResult\.data\?\.success,/);
});

test('GLB export failures are propagated to finalization logs', () => {
  const mcp = read('agent/tools/blender_mcp.ts');
  const finalize = read('agent/graph/nodes/finalize.ts');
  assert.match(mcp, /error:\s*result\.error/);
  assert.match(finalize, /worker returned no GLB data/);
});

test('blender worker autostarts the TCP bridge for agent routes', () => {
  const server = read('blender-worker/server.js');
  assert.match(server, /function ensureBridgeReady/);
  assert.match(server, /spawn\(blenderCommand, \["--background", "--python", BRIDGE_SCRIPT_PATH\]/);
  assert.match(server, /app\.use\(\[[\s\S]*"\/agent\/build"[\s\S]*\], requireBridge\)/);
  assert.match(server, /BLENDER_AUTOSTART_BRIDGE/);
});
