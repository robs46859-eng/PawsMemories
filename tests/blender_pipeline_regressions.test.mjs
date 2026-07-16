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
  assert.match(server, /app\.use\(\[[\s\S]*"\/agent\/build"[\s\S]*\], (requireWorkerAuth, )?requireBridge\)/);
  assert.match(server, /BLENDER_AUTOSTART_BRIDGE/);
});

test('Gemini agent nodes prefer Interactions API with generateContent fallback', () => {
  const gemini = read('agent/gemini.ts');
  const perceive = read('agent/graph/nodes/perceive.ts');
  const verify = read('agent/graph/nodes/verify.ts');
  const act = read('agent/graph/nodes/act.ts');
  assert.match(gemini, /interactions\?\.create/);
  assert.match(gemini, /store:\s*false/);
  assert.match(gemini, /models\.generateContent/);
  assert.match(perceive, /generateGeminiText/);
  assert.match(verify, /generateGeminiText/);
  assert.match(act, /generateGeminiText/);
});

test('core avatar rigging no longer depends on generated automatic-weight scripts', () => {
  const act = read('agent/graph/nodes/act.ts');
  const recover = read('agent/graph/nodes/recover.ts');
  assert.match(act, /deterministicCodeForAction/);
  assert.match(act, /Binding mesh to armature with explicit vertex groups/);
  assert.match(act, /PetArmature created/);
  assert.match(act, /Animation '\$\{name\}' created/);
  assert.match(recover, /Restored checkpoint instead of raw undo/);
  assert.doesNotMatch(recover, /Undo successful/);
});

test('avatar playpen does not go blank when sprite preview cannot load', () => {
  const playpen = read('src/components/Avatar3DPlaypen.tsx');
  assert.doesNotMatch(playpen, /\.crossOrigin\s*=/);
  assert.match(playpen, /setSpriteLoadFailed\(true\)/);
  assert.match(playpen, /showFallbackImage/);
  assert.match(playpen, /src=\{avatar\.image_url\}/);
});

test('newly built avatars have no unwanted default arm motion', () => {
  const humanClips = read('blender-worker/skeletal-clips-human.js');
  const avatarModel = read('src/three/AvatarModel.tsx');

  // 1. the default avatar has no automatic arm-action clip
  const idleMatch = humanClips.match(/def clip_idle\(\):[\s\S]*?(?=def clip_[a-z]+\(\):)/);
  assert.ok(idleMatch, 'clip_idle function found');
  const idleCode = idleMatch[0];
  assert.doesNotMatch(idleCode, /upperarm/, 'idle animation should not move arms');
  
  // 2. arm bones remain present and weighted
  assert.match(humanClips, /upperarm\.L/, 'upperarm.L must still exist for other animations');
  assert.match(humanClips, /upperarm\.R/, 'upperarm.R must still exist for other animations');
  
  // 3. unrelated idle breathing/head movement remains valid
  assert.match(idleCode, /key\("chest"/, 'chest breathing should remain in idle');
  assert.match(idleCode, /key\("head"/, 'head movement should remain in idle');

  // 4. reduced-motion mode contains no procedural arm movement (checking AvatarModel.tsx)
  const humanProcMatch = avatarModel.match(/export function applyHumanProcedural[\s\S]*?}\n/);
  assert.ok(humanProcMatch, 'applyHumanProcedural found');
  assert.doesNotMatch(humanProcMatch[0], /upperarm/, 'no procedural arm movement in AvatarModel');
});

test('Blender worker synthesizes a jaw bone if none exists', () => {
  const bakeLod = read('blender-worker/jobs/bake_lod.py');
  assert.match(bakeLod, /def synthesize_jaw/);
  assert.match(bakeLod, /jaw_b = ebones\.new\("jaw"\)/);
  assert.match(bakeLod, /vg\.add\(\[v\.index\], 1\.0, 'REPLACE'\)/);
  assert.match(bakeLod, /head_vg\.add\(\[v\.index\], 0\.0, 'REPLACE'\)/);
});

test('GLB validator builds facial rig map', () => {
  const gltf = read('server/animator/gltf.ts');
  assert.match(gltf, /export interface FacialRigMap/);
  assert.match(gltf, /validateRiggedGlb/);
  assert.match(gltf, /lipCornerLeftBone/);
  assert.match(gltf, /jawBone/);
});

test('LipSyncPlayer consumes facial rig map', () => {
  const player = read('src/animator/viseme/LipSyncPlayer.ts');
  assert.match(player, /facialRigMap\?: FacialRigMap/);
  assert.doesNotMatch(player, /morphPrefix\?: string/);
});
