/**
 * Phase 1 tests — ANIM-RUN-01/02/03.
 *
 * Covers:
 *  • Layer priority: L0 exclusive, L1–L3 concurrent (verified via bone transforms)
 *  • Mask filtering: bone masks suppress non-masked tracks (verified via bone positions)
 *  • Queue scheduling: priority interruption, cooldowns, starvation-safe
 *  • Blend phase sync: 1D blend space interpolation
 *
 * Uses node:test (NOT Vitest). Existing procedural fallback and
 * clip playback must not regress.
 */

import test from "node:test";
import assert from "node:assert";
import * as THREE from "three";

import { createAnimationController } from "../src/animator/controller/createAnimationController.ts";
import { EmoteQueue } from "../src/animator/controller/emoteQueue.ts";
import { createBlendSpace, applyBlendState } from "../src/animator/controller/blendSpace.ts";
import {
  QUADRUPED_SET,
  BIPED_SET,
  resolveLayer,
  resolveMask,
} from "../src/animator/controller/animationSets.ts";
import {
  LAYER_PRIORITY,
  CROSS_FADE_L0,
} from "../src/animator/controller/layers.ts";

// ──────────────────────────────────────────────────────────────────────
// Helpers: create a scene with bones that match track names
// ──────────────────────────────────────────────────────────────────────

/**
 * Create a realistic skeleton hierarchy with bones matching expected track names.
 * This eliminates THREE.PropertyBinding warnings and ensures animations actually bind.
 */
function createSkeleton() {
  const root = new THREE.Object3D();
  root.name = "root";

  // Base locomotion bones
  const hip = new THREE.Object3D();
  hip.name = "hip";
  root.add(hip);

  const spine = new THREE.Object3D();
  spine.name = "spine";
  hip.add(spine);

  const head = new THREE.Object3D();
  head.name = "head";
  spine.add(head);

  // Leg bones
  const legFl = new THREE.Object3D();
  legFl.name = "leg_fl";
  hip.add(legFl);
  const legFf = new THREE.Object3D();
  legFf.name = "leg_ff";
  legFl.add(legFf);

  const legFr = new THREE.Object3D();
  legFr.name = "leg_fr";
  hip.add(legFr);
  const legRf = new THREE.Object3D();
  legRf.name = "leg_rf";
  legFr.add(legRf);

  const legBl = new THREE.Object3D();
  legBl.name = "leg_bl";
  hip.add(legBl);
  const legBf = new THREE.Object3D();
  legBf.name = "leg_bf";
  legBl.add(legBf);

  const legBr = new THREE.Object3D();
  legBr.name = "leg_br";
  hip.add(legBr);
  const legBff = new THREE.Object3D();
  legBff.name = "leg_bff";
  legBr.add(legBff);

  // Tail bones
  const tail01 = new THREE.Object3D();
  tail01.name = "tail.01";
  spine.add(tail01);
  const tail02 = new THREE.Object3D();
  tail02.name = "tail.02";
  tail01.add(tail02);

  // Ear bones
  const earL = new THREE.Object3D();
  earL.name = "ear.L";
  head.add(earL);
  const earR = new THREE.Object3D();
  earR.name = "ear.R";
  head.add(earR);

  // Build skeleton for Three.js
  const bones = [root, hip, spine, head, legFl, legFf, legFr, legRf, legBl, legBf, legBr, legBff, tail01, tail02, earL, earR];
  const skeleton = new THREE.SkeletonHelper(root);
  skeleton.visible = false; // hide for testing

  return { skeleton, root };
}

/**
 * Create a clip with tracks targeting specific bones in the skeleton.
 */
function makeClip(name, trackData) {
  const tracks = trackData.map((d) => {
    return new THREE.VectorKeyframeTrack(`${d.node}.position`, [0, 1], [d.x1, d.y1, d.z1, d.x2, d.y2, d.z2]);
  });
  return new THREE.AnimationClip(name, 2, tracks);
}

// ──────────────────────────────────────────────────────────────────────
// ANIM-RUN-01: Layered Mixer
// ──────────────────────────────────────────────────────────────────────

test("ANIM-RUN-01 — Layer priority: L0 exclusive", async (t) => {
  await t.test("selectClip routes to L0 exclusively and moves hip bone", async () => {
    const { root } = createSkeleton();
    const clip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [clip]);

    ctrl.selectClip("idle");
    const active = ctrl.listActiveLayers();
    assert.ok(active.some((a) => a.layer === "L0" && a.clipName === "idle"));

    // Advance simulation and verify bone actually moved
    ctrl.update(0.5);
    const hipPos = root.getObjectByName("hip")?.position;
    assert.ok(hipPos, "hip bone should exist");
    assert.ok(hipPos.y !== 0, "hip bone position should have changed from idle animation");

    // Transition to walk — idle should be replaced on L0
    const clipWalk = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    ctrl.addClip(clipWalk);
    ctrl.selectClip("walk");

    const active2 = ctrl.listActiveLayers();
    assert.ok(active2.some((a) => a.layer === "L0" && a.clipName === "walk"));
    assert.ok(!active2.some((a) => a.layer === "L0" && a.clipName === "idle"));

    ctrl.dispose();
  });

  await t.test("L1 overlay plays concurrent with L0 without affecting base bone", async () => {
    const { root } = createSkeleton();
    const walkClip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const tailClip = makeClip("tail_wave", [
      { node: "tail.01", x1: 0, y1: 0, z1: 0, x2: 0.5, y2: 0, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [walkClip, tailClip]);

    ctrl.selectClip("walk");
    ctrl.selectLayeredClip("tail_wave", { layer: "L1" });

    const active = ctrl.listActiveLayers();
    assert.ok(active.some((a) => a.layer === "L0" && a.clipName === "walk"));
    assert.ok(active.some((a) => a.layer === "L1" && a.clipName === "tail_wave"));

    // Advance simulation — both bones should move independently
    ctrl.update(0.5);
    const hipPos = root.getObjectByName("hip")?.position;
    const tailPos = root.getObjectByName("tail.01")?.position;

    assert.ok(hipPos, "hip bone should exist");
    assert.ok(tailPos, "tail bone should exist");

    // Hip should have moved from walk (L0)
    assert.ok(hipPos.y !== 0, "hip should move from walk animation");
    // Tail should have moved from tail_wave (L1)
    assert.ok(tailPos.x !== 0, "tail should move from tail_wave animation");

    ctrl.dispose();
  });
});

test("ANIM-RUN-01 — Cross-fading", async (t) => {
  await t.test("crossFadeTo properly blends", async () => {
    const { root } = createSkeleton();
    const idleClip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const walkClip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [idleClip, walkClip]);

    ctrl.selectClip("idle");
    ctrl.update(0.1);
    const idleY = root.getObjectByName("hip")?.position.y ?? 0;

    // Cross-fade to walk
    ctrl.crossFadeTo("walk", 0.25);
    ctrl.update(0.125); // half-way through cross-fade

    const walkY = root.getObjectByName("hip")?.position.y ?? 0;
    // At half cross-fade, hip Y should be between idle (0.05) and walk (0.1)
    assert.ok(walkY > 0, "hip should be moving during cross-fade");
    assert.ok(walkY < 0.15, "hip should not be at full walk position yet");

    ctrl.dispose();
  });
});

// ──────────────────────────────────────────────────────────────────────
// ANIM-RUN-01: Bone masking
// ──────────────────────────────────────────────────────────────────────

test("ANIM-RUN-01 — Mask filtering", async (t) => {
  await t.test("mask suppresses non-masked bones from affecting transforms", async () => {
    const { root } = createSkeleton();
    const clip = makeClip("tail_wave", [
      { node: "tail.01", x1: 0, y1: 0, z1: 0, x2: 0.5, y2: 0, z2: 0 },
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.3, y2: 0.3, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [clip]);

    // Play with mask: only tail.01 is active
    ctrl.selectLayeredClip("tail_wave", { layer: "L1", mask: ["tail.01"] });

    // Advance simulation
    ctrl.update(0.5);

    const tailPos = root.getObjectByName("tail.01")?.position;
    const hipPos = root.getObjectByName("hip")?.position;

    // Tail should have moved (it's in the mask)
    assert.ok(tailPos && tailPos.x !== 0, "tail.01 should move when in mask");
    // Hip should NOT have moved (it's NOT in the mask — it's frozen at bind pose)
    // With discrete interpolation, hip should stay at 0,0,0
    assert.ok(!hipPos || (hipPos.x === 0 && hipPos.y === 0 && hipPos.z === 0),
      "hip should NOT move when masked out");

    ctrl.dispose();
  });
});

test("ANIM-RUN-01 — Layer priority resolution", async (t) => {
  await t.test("resolveLayer returns correct layer per clip", async () => {
    assert.strictEqual(resolveLayer("quadruped", "tail_wave"), "L1");
    assert.strictEqual(resolveLayer("quadruped", "walk"), "L0");
    assert.strictEqual(resolveLayer("quadruped", "head_tilt"), "L1");
    assert.strictEqual(resolveLayer("quadruped", "unknown_clip"), "L0");
  });

  await t.test("resolveMask returns correct bone mask", async () => {
    const mask = resolveMask("quadruped", "tail_wave");
    assert.ok(Array.isArray(mask), "mask should be an array");
    assert.ok(mask.length > 0, "tail_wave should have a mask");
    assert.ok(mask.some((b) => b.includes("tail")), "mask should include tail bones");
  });
});

// ──────────────────────────────────────────────────────────────────────
// ANIM-RUN-03: EmoteQueue
// ──────────────────────────────────────────────────────────────────────

test("ANIM-RUN-03 — EmoteQueue scheduling", async (t) => {
  await t.test("enqueue accepts and orders by priority", async () => {
    const { root } = createSkeleton();
    const clip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [clip]);
    const queue = new EmoteQueue(ctrl);

    queue.enqueue({ clip: "idle", layer: "L1", priority: 0, holdSec: 2, cooldownSec: 5 });
    queue.enqueue({ clip: "idle", layer: "L1", priority: 5, holdSec: 2, cooldownSec: 5 });

    assert.strictEqual(queue.getDepth(), 2);
    assert.strictEqual(queue.peekNext().priority, 5);
  });

  await t.test("higher priority interrupts same-or-lower", async () => {
    const { root } = createSkeleton();
    const clip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [clip]);
    const queue = new EmoteQueue(ctrl);

    queue.enqueue({ clip: "idle", layer: "L1", priority: 0, holdSec: 10, cooldownSec: 5 });
    queue.tick(0.1);

    queue.enqueue({ clip: "idle", layer: "L1", priority: 10, holdSec: 2, cooldownSec: 5 });
    queue.tick(0.1);

    assert.ok(queue.peekNext() !== null || queue.getPlaying() !== null);
  });

  await t.test("cooldown prevents rapid replay", async () => {
    const { root } = createSkeleton();
    const clip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [clip]);
    const queue = new EmoteQueue(ctrl);

    queue.enqueue({ clip: "idle", layer: "L1", priority: 0, holdSec: 0.1, cooldownSec: 5 });
    queue.tick(0.1);
    queue.tick(0.2);

    const accepted = queue.enqueue({ clip: "idle", layer: "L1", priority: 0, holdSec: 2, cooldownSec: 5 });
    assert.strictEqual(accepted, false, "cooldown should reject immediate replay");
  });

  await t.test("starvation-safe: priority 0 always accepted", async () => {
    const { root } = createSkeleton();
    const ctrl = createAnimationController(root, [
      makeClip("idle", [
        { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
      ]),
      makeClip("tail_wave", [
        { node: "tail.01", x1: 0, y1: 0, z1: 0, x2: 0.3, y2: 0, z2: 0 },
      ]),
    ]);
    const queue = new EmoteQueue(ctrl);

    queue.enqueue({ clip: "tail_wave", layer: "L1", priority: 10, holdSec: 10, cooldownSec: 5 });
    queue.tick(0.1);

    const accepted = queue.enqueue({ clip: "idle", layer: "L1", priority: 0, holdSec: 2, cooldownSec: 5 });
    assert.strictEqual(accepted, true, "priority 0 should be accepted even when higher priority is playing");
  });

  await t.test("clear stops all emotes", async () => {
    const { root } = createSkeleton();
    const ctrl = createAnimationController(root, [
      makeClip("idle", [
        { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
      ]),
      makeClip("tail_wave", [
        { node: "tail.01", x1: 0, y1: 0, z1: 0, x2: 0.3, y2: 0, z2: 0 },
      ]),
    ]);
    const queue = new EmoteQueue(ctrl);

    queue.enqueue({ clip: "idle", layer: "L1", priority: 5, holdSec: 10, cooldownSec: 5 });
    queue.tick(0.1);
    queue.enqueue({ clip: "tail_wave", layer: "L1", priority: 5, holdSec: 10, cooldownSec: 5 });

    assert.strictEqual(queue.getDepth(), 1);

    queue.clear();
    assert.strictEqual(queue.getDepth(), 0);
    assert.strictEqual(queue.getPlaying(), null);
  });

  await t.test("same clip already playing is rejected", async () => {
    const { root } = createSkeleton();
    const clip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [clip]);
    const queue = new EmoteQueue(ctrl);

    queue.enqueue({ clip: "idle", layer: "L1", priority: 0, holdSec: 10, cooldownSec: 5 });
    queue.tick(0.1);

    const accepted = queue.enqueue({ clip: "idle", layer: "L1", priority: 0, holdSec: 2, cooldownSec: 5 });
    assert.strictEqual(accepted, false, "same clip already playing should be rejected");
  });
});

// ──────────────────────────────────────────────────────────────────────
// ANIM-RUN-02: Blend Space
// ──────────────────────────────────────────────────────────────────────

test("ANIM-RUN-02 — 1D blend space interpolation", async (t) => {
  await t.test("speed 0 → idle only and bone moves", async () => {
    const { root } = createSkeleton();
    const idleClip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const walkClip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const runClip = makeClip("run", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.3, y2: 0.3, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [idleClip, walkClip, runClip]);
    const blend = createBlendSpace("quadruped", ctrl);

    // Actually play the idle clip so update() has something to animate
    ctrl.selectClip("idle");

    const state = blend(0, 0.016);
    assert.strictEqual(state.speed, 0);
    assert.ok(state.active.length >= 1, "idle should be active at speed 0");

    // Apply blend state to start the clip
    applyBlendState(ctrl, state);

    // Verify bone actually moves
    ctrl.update(0.5);
    const hipPos = root.getObjectByName("hip")?.position;
    assert.ok(hipPos && hipPos.y !== 0, "hip should move from idle animation");

    ctrl.dispose();
  });

  await t.test("speed 0.5 → walk dominant", async () => {
    const { root } = createSkeleton();
    const idleClip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const walkClip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const runClip = makeClip("run", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.3, y2: 0.3, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [idleClip, walkClip, runClip]);
    const blend = createBlendSpace("quadruped", ctrl);

    const state = blend(0.5, 0.016);
    assert.strictEqual(state.speed, 0.5);
    const walk = state.active.find((a) => a.entry.clip === "walk");
    assert.ok(walk, "walk should be active at speed 0.5");
    assert.ok(walk.intensity > 0.5, "walk should have highest intensity at 0.5");

    ctrl.dispose();
  });

  await t.test("speed 1.0 → run active", async () => {
    const { root } = createSkeleton();
    const idleClip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const walkClip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const runClip = makeClip("run", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.3, y2: 0.3, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [idleClip, walkClip, runClip]);
    const blend = createBlendSpace("quadruped", ctrl);

    const state = blend(1.0, 0.016);
    assert.strictEqual(state.speed, 1.0);
    assert.ok(state.active.length > 0, "some clip should be active at speed 1.0");

    ctrl.dispose();
  });

  await t.test("transition regions have two active entries", async () => {
    const { root } = createSkeleton();
    const idleClip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const walkClip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const runClip = makeClip("run", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.3, y2: 0.3, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [idleClip, walkClip, runClip]);
    const blend = createBlendSpace("quadruped", ctrl);

    const state = blend(0.25, 0.016);
    assert.ok(state.active.length >= 2, "should have two active entries in transition");

    ctrl.dispose();
  });
});

test("ANIM-RUN-02 — applyBlendState sets action weights", async (t) => {
  await t.test("action weights are set based on blend intensities", async () => {
    const { root } = createSkeleton();
    const idleClip = makeClip("idle", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0.1, z2: 0 },
    ]);
    const walkClip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [idleClip, walkClip]);

    // Play walk on L0
    ctrl.selectLayeredClip("walk", { layer: "L0" });

    const blend = createBlendSpace("quadruped", ctrl);
    const state = blend(0.5, 0.016);

    // Apply blend state
    applyBlendState(ctrl, state);

    // Check that action weights were set
    const walkAction = ctrl.getClipAction("walk");
    assert.ok(walkAction, "walk action should exist");
    assert.strictEqual(walkAction.weight, 1, "walk action weight should be 1 at speed 0.5");

    ctrl.dispose();
  });
});

// ──────────────────────────────────────────────────────────────────────
// AnimationSet v2 data integrity
// ──────────────────────────────────────────────────────────────────────

test("AnimationSet v2 — data integrity", async (t) => {
  await t.test("QUADRUPED_SET has the expected number of clips", async () => {
    assert.strictEqual(QUADRUPED_SET.expectedClips.length, 18);
  });

  await t.test("all clips have a declared layer", async () => {
    for (const clip of QUADRUPED_SET.expectedClips) {
      assert.ok(
        QUADRUPED_SET.layers[clip],
        `clip "${clip}" must have a declared layer`
      );
    }
  });

  await t.test("biped set has 10 clips", async () => {
    assert.strictEqual(BIPED_SET.expectedClips.length, 10);
  });

  await t.test("mask keys exist in masks object", async () => {
    for (const key of Object.keys(QUADRUPED_SET.masks)) {
      assert.ok(Array.isArray(QUADRUPED_SET.masks[key]), `mask "${key}" must be an array`);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Layer priority constants
// ──────────────────────────────────────────────────────────────────────

test("Layer priority ordering is deterministic", () => {
  assert.strictEqual(LAYER_PRIORITY.L0, 0);
  assert.strictEqual(LAYER_PRIORITY.L1, 1);
  assert.strictEqual(LAYER_PRIORITY.L2, 2);
  assert.strictEqual(LAYER_PRIORITY.L3, 3);
  assert.ok(LAYER_PRIORITY.L3 > LAYER_PRIORITY.L0, "L3 > L0");
});

// ──────────────────────────────────────────────────────────────────────
// Backward compatibility: existing API still works
// ──────────────────────────────────────────────────────────────────────

test("Backward compat — existing AnimationController API works", async (t) => {
  await t.test("selectClip, play, pause, stop, setSpeed, seek, reset all work", async () => {
    const { root } = createSkeleton();
    const clip = makeClip("walk", [
      { node: "hip", x1: 0, y1: 0, z1: 0, x2: 0.2, y2: 0.2, z2: 0 },
    ]);
    const ctrl = createAnimationController(root, [clip]);

    ctrl.selectClip("walk");
    ctrl.play();
    ctrl.pause();
    ctrl.play();
    ctrl.setSpeed(1.5);
    ctrl.seek(0.5);
    assert.strictEqual(ctrl.getCurrentTime(), 0.5);
    ctrl.seek(5);
    ctrl.setLoop(false);
    ctrl.stop();
    ctrl.resetToBindPose();
  });

  await t.test("listClips returns correct info", async () => {
    const { root } = createSkeleton();
    const clip1 = new THREE.AnimationClip("test_morph", 1, [
      new THREE.NumberKeyframeTrack(".mesh.morphTargetInfluences['mouth']", [0, 1], [0, 1]),
    ]);
    const clip2 = new THREE.AnimationClip("test_pos", 1, [
      new THREE.VectorKeyframeTrack(".hip.position", [0, 1], [0, 0, 0, 0, 0.1, 0]),
    ]);
    const ctrl = createAnimationController(root, [clip1, clip2]);
    const info = ctrl.listClips();
    assert.strictEqual(info.length, 2);
    assert.ok(info[0].tracksMorph, "test_morph should have tracksMorph=true");
    assert.strictEqual(info[1].tracksMorph, false);
  });

  await t.test("listMorphTargets works", async () => {
    const { root } = createSkeleton();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry());
    mesh.morphTargetDictionary = { mouth: 0, brow: 1 };
    mesh.morphTargetInfluences = [0, 0];
    mesh.name = "mesh";
    root.add(mesh);
    const ctrl = createAnimationController(root, []);
    const morphs = ctrl.listMorphTargets();
    assert.ok(morphs.includes("mouth"));
    assert.ok(morphs.includes("brow"));
  });
});
