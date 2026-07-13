// tests/animator_phase2.test.mjs
// Phase 2 — Rhubarb lip-sync behavioral tests (node:test, no network, no real binary).
// Uses the controlled fake executable at tests/fixtures/lipsync/rhubarb-fake.mjs.

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

// ── Test workspace (set BEFORE any server module loads) ──
const DATA = mkdtempSync(path.join(os.tmpdir(), "ls-phase2-"));
process.env.ANIMATOR_DATA_DIR = DATA;
const FAKE = path.resolve("tests/fixtures/lipsync/rhubarb-fake.mjs");
process.env.RHUBARB_BIN = FAKE;
const ARG_FILE = path.join(DATA, "rhubarb-args.json");
process.env.RHUBARB_FAKE_ARGFILE = ARG_FILE;
// Copy a valid WAV INSIDE the workspace (resolveWithinWorkspace is rooted at ANIMATOR_DATA_DIR).
const AUDIO_IN = path.join(DATA, "in.wav");
fs.copyFileSync(path.resolve("tests/fixtures/lipsync/sample.wav"), AUDIO_IN);
// A second audio with distinct bytes (different cache key) for the BIN_NOT_FOUND test,
// so it cannot collide with a success cached by the no-transcript runRhubarb call.
const AUDIO_B = path.join(DATA, "in2.wav");
{
  const buf = fs.readFileSync(path.resolve("tests/fixtures/lipsync/sample.wav"));
  buf[buf.length - 1] ^= 0xff;
  fs.writeFileSync(AUDIO_B, buf);
}
fs.mkdirSync(path.join(DATA, "tmp"), { recursive: true });
for (const s of ["pending", "running", "done", "failed"]) {
  fs.mkdirSync(path.join(DATA, "jobs", s), { recursive: true });
}

// ── Dynamic imports (after env is set) ──
const viseme = await import("../src/animator/viseme/visemeRules.ts");
const lipsync = await import("../server/animator/lipsync.ts");
const paths = await import("../server/animator/paths.ts");
const { LipSyncPlayer } = await import("../src/animator/viseme/LipSyncPlayer.ts");
const speech = await import("../src/animator/speech/speak.ts");
const { createAnimationController } = await import(
  "../src/animator/controller/createAnimationController.ts"
);
const THREE = await import("three");

// ── Helpers ──
function readArgFile() {
  if (!fs.existsSync(ARG_FILE)) return null;
  return JSON.parse(fs.readFileSync(ARG_FILE, "utf8"));
}
function clockDriver() {
  let now = 0;
  return {
    get: () => now,
    advance: (dt) => {
      now += dt;
    },
    set: (t) => {
      now = t;
    },
  };
}
// Build a minimal avatar: a mesh with viseme morphs + jaw/lip-corner bones.
function buildAvatar(opts = {}) {
  const root = new THREE.Group();
  if (!opts.skipMesh) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    const mesh = new THREE.Mesh(geo);
    mesh.name = "faceMesh";
    const dict = {};
    const infl = [];
    for (const s of viseme.VISEME_SHAPES) {
      dict[`viseme_${s}`] = infl.length;
      infl.push(0);
    }
    mesh.morphTargetDictionary = dict;
    mesh.morphTargetInfluences = infl;
    root.add(mesh);
  }
  if (!opts.skipBones) {
    const jaw = new THREE.Bone();
    jaw.name = "jaw";
    const lc = new THREE.Bone();
    lc.name = "lipCorner.L";
    const rc = new THREE.Bone();
    rc.name = "lipCorner.R";
    root.add(jaw, lc, rc);
  }
  return root;
}
function sampleTrack(fps = 30, shapes = ["X", "A", "X"]) {
  const cues = shapes.map((v, i) => ({ t: i * 0.2, v }));
  return viseme.postProcessVisemeTrack(cues, { fps, source: "rhubarb", durationSec: (shapes.length - 1) * 0.2 });
}

// ────────────────────────────────────────────────────────────
describe("Viseme normalization (ANIM-LIP-02)", () => {
  test("preserves A–X shapes and sorts deterministically", () => {
    const track = viseme.postProcessVisemeTrack(
      [
        { t: 0.5, v: "D" },
        { t: 0.1, v: "A" },
        { t: 0.3, v: "C" },
      ],
      { fps: 30 },
    );
    assert.equal(track.cues[0].v, "A");
    assert.equal(track.cues[1].v, "C");
    assert.equal(track.cues[2].v, "D");
  });

  test("rejects unknown shapes", () => {
    assert.throws(
      () => viseme.postProcessVisemeTrack([{ t: 0, v: "Z" }], { fps: 30 }),
      /Unknown viseme/,
    );
  });

  test("rejects non-finite timestamps", () => {
    assert.throws(
      () => viseme.postProcessVisemeTrack([{ t: NaN, v: "A" }], { fps: 30 }),
      /Non-finite/,
    );
  });

  test("does not mutate caller-owned input", () => {
    const input = [{ t: 0.1, v: "A" }];
    const snap = JSON.parse(JSON.stringify(input));
    viseme.postProcessVisemeTrack(input, { fps: 30 });
    assert.deepEqual(input, snap);
  });

  test("two-frame anticipation at 24/30/60 FPS", () => {
    for (const fps of [24, 30, 60]) {
      const track = viseme.postProcessVisemeTrack([{ t: 0.5, v: "A" }], { fps });
      assert.ok(Math.abs(track.anticipationSec - 2 / fps) < 1e-9, `fps ${fps}`);
      const expected = Math.max(0, 0.5 - 2 / fps);
      assert.ok(Math.abs(track.cues[0].t - expected) < 1e-6, `fps ${fps}`);
    }
  });

  test("clamps anticipated cues to t >= 0", () => {
    const track = viseme.postProcessVisemeTrack([{ t: 0.0, v: "A" }, { t: 0.4, v: "X" }], { fps: 30 });
    assert.ok(track.cues[0].t >= 0);
    assert.equal(track.cues[0].t, 0);
  });

  test("merges sub-frame cues", () => {
    // @30fps frameDur = 0.0333; cues 0.2 and 0.22 are <1 frame apart.
    const track = viseme.postProcessVisemeTrack(
      [
        { t: 0.0, v: "X" },
        { t: 0.1, v: "A" },
        { t: 0.2, v: "B" },
        { t: 0.22, v: "C" },
        { t: 0.4, v: "X" },
      ],
      { fps: 30 },
    );
    const shapes = track.cues.map((c) => c.v);
    assert.ok(!shapes.includes("B"), "B (sub-frame) should be merged");
  });

  test("resolves duplicate timestamps deterministically (keeps latest)", () => {
    const track = viseme.postProcessVisemeTrack(
      [
        { t: 0.1, v: "A" },
        { t: 0.1, v: "C" },
      ],
      { fps: 30 },
    );
    assert.equal(track.cues.length, 1);
    assert.equal(track.cues[0].v, "C");
  });

  test("inserts C bridge for direct A→D", () => {
    const track = viseme.postProcessVisemeTrack(
      [
        { t: 0.0, v: "X" },
        { t: 0.1, v: "A" },
        { t: 0.2, v: "D" },
        { t: 0.3, v: "X" },
      ],
      { fps: 30 },
    );
    const seq = track.cues.map((c) => c.v).join("");
    assert.ok(seq.includes("ACD"), `expected A→C→D bridge, got ${seq}`);
  });

  test("inserts E bridge for direct C→F", () => {
    const track = viseme.postProcessVisemeTrack(
      [
        { t: 0.0, v: "X" },
        { t: 0.1, v: "C" },
        { t: 0.22, v: "F" },
        { t: 0.34, v: "X" },
      ],
      { fps: 30 },
    );
    const seq = track.cues.map((c) => c.v).join("");
    assert.ok(seq.includes("CEF"), `expected C→E→F bridge, got ${seq}`);
  });
});

// ────────────────────────────────────────────────────────────
describe("Transition-rule linter (ANIM-LIP-02)", () => {
  test("flags direct A→D when not post-processed", () => {
    const track = { version: 1, fps: 30, source: "rhubarb", durationSec: 1, anticipationSec: 0,
      cues: [{ t: 0, v: "A" }, { t: 0.2, v: "D" }] };
    const { pass, violations } = viseme.lintVisemeTrack(track);
    assert.equal(pass, false);
    assert.ok(violations.some((v) => v.rule === "A_TO_D"));
  });

  test("flags direct C→F when not post-processed", () => {
    const track = { version: 1, fps: 30, source: "rhubarb", durationSec: 1, anticipationSec: 0,
      cues: [{ t: 0, v: "C" }, { t: 0.2, v: "F" }] };
    const { pass, violations } = viseme.lintVisemeTrack(track);
    assert.equal(pass, false);
    assert.ok(violations.some((v) => v.rule === "C_TO_F"));
  });

  test("flags E without a C neighbor", () => {
    const track = { version: 1, fps: 30, source: "rhubarb", durationSec: 1, anticipationSec: 0,
      cues: [{ t: 0, v: "X" }, { t: 0.2, v: "E" }, { t: 0.4, v: "X" }] };
    const { pass, violations } = viseme.lintVisemeTrack(track);
    assert.equal(pass, false);
    assert.ok(violations.some((v) => v.rule === "E_NO_C_NEIGHBOR"));
  });

  test("post-processed output always passes the linter", () => {
    const track = viseme.postProcessVisemeTrack(
      [{ t: 0, v: "X" }, { t: 0.1, v: "A" }, { t: 0.2, v: "D" }, { t: 0.3, v: "C" }, { t: 0.4, v: "F" }, { t: 0.5, v: "X" }],
      { fps: 30 },
    );
    const { pass } = viseme.lintVisemeTrack(track);
    assert.equal(pass, true);
  });
});

// ────────────────────────────────────────────────────────────
describe("Rhubarb service (ANIM-LIP-01, Checkpoint A)", () => {
  beforeEach(() => {
    if (fs.existsSync(ARG_FILE)) fs.unlinkSync(ARG_FILE);
    delete process.env.RHUBARB_FAKE_MODE;
  });
  afterEach(() => {
    delete process.env.RHUBARB_FAKE_MODE;
  });

  test("resolveRhubarbBin finds RHUBARB_BIN", () => {
    assert.equal(lipsync.resolveRhubarbBin(), FAKE);
  });

  test("resolveRhubarbBin returns null for a missing absolute path", () => {
    const prev = process.env.RHUBARB_BIN;
    process.env.RHUBARB_BIN = "/nonexistent/rhubarb";
    try {
      assert.equal(lipsync.resolveRhubarbBin(), null);
    } finally {
      process.env.RHUBARB_BIN = prev;
    }
  });

  test("selectRecognizer: pocketSphinx for English, phonetic otherwise", () => {
    assert.equal(lipsync.selectRecognizer("en"), "pocketSphinx");
    assert.equal(lipsync.selectRecognizer("en-US"), "pocketSphinx");
    assert.equal(lipsync.selectRecognizer("fr"), "phonetic");
    assert.equal(lipsync.selectRecognizer("es-MX"), "phonetic");
  });

  test("argument construction + recognizer selection", async () => {
    await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "hello", language: "en", fps: 30 });
    const a = readArgFile();
    assert.ok(a, "arg file written");
    assert.equal(a.recognizer, "pocketSphinx");
    assert.equal(a.extendedShapes, "GHX");
    assert.equal(a.format, "json");
    assert.ok(Array.isArray(a.argv));
    assert.ok(a.argv.includes("--extendedShapes"));

    if (fs.existsSync(ARG_FILE)) fs.unlinkSync(ARG_FILE);
    await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "bonjour", language: "fr", fps: 30 });
    const b = readArgFile();
    assert.equal(b.recognizer, "phonetic");
  });

  test("transcript dialog-file behavior (present vs absent)", async () => {
    await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "say this", language: "en" });
    const withDlg = readArgFile();
    assert.ok(withDlg.dialogFile, "dialog file path should be passed when transcript exists");
    assert.ok(withDlg.argv.includes("-d"));

    if (fs.existsSync(ARG_FILE)) fs.unlinkSync(ARG_FILE);
    await lipsync.runRhubarb({ audioPath: AUDIO_IN, language: "en" });
    const noDlg = readArgFile();
    assert.equal(noDlg.dialogFile, null, "no dialog file when transcript absent");
    assert.ok(!noDlg.argv.includes("-d"));
  });

  test("command-injection resistance: transcript never reaches argv", async () => {
    const evil = "$(touch /tmp/pwned_ls); rm -rf /; echo injected";
    await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: evil, language: "en" });
    const a = readArgFile();
    // The malicious text must NOT appear as a command-line argument.
    for (const arg of a.argv) {
      assert.ok(!String(arg).includes("rm -rf"), "injection leaked into argv");
      assert.ok(!String(arg).includes("touch /tmp/pwned"), "injection leaked into argv");
      assert.ok(!String(arg).includes("echo injected"), "injection leaked into argv");
    }
    assert.ok(!fs.existsSync("/tmp/pwned_ls"), "injection command was executed");
  });

  test("path traversal rejected", async () => {
    await assert.rejects(
      lipsync.runRhubarb({ audioPath: "../../etc/passwd" }),
      (e) => e.code === "PATH_TRAVERSAL" || e.code === "VALIDATION",
    );
    // Absolute path outside the workspace is also rejected.
    await assert.rejects(
      lipsync.runRhubarb({ audioPath: "/etc/passwd" }),
      (e) => e.code === "PATH_TRAVERSAL" || e.code === "VALIDATION",
    );
  });

  test("resolveWithinWorkspace rejects traversal directly", () => {
    assert.throws(() => paths.resolveWithinWorkspace("../escape"), /Path traversal detected/);
  });

  test("missing binary → BIN_NOT_FOUND (safe, no crash at import)", async () => {
    const prev = process.env.RHUBARB_BIN;
    process.env.RHUBARB_BIN = "/nonexistent/rhubarb";
    try {
      assert.equal(lipsync.resolveRhubarbBin(), null);
      await assert.rejects(lipsync.runRhubarb({ audioPath: AUDIO_IN }), (e) => e.code === "BIN_NOT_FOUND");
    } finally {
      process.env.RHUBARB_BIN = prev;
    }
  });

  test("timeout handling", async () => {
    process.env.RHUBARB_FAKE_MODE = "timeout";
    await assert.rejects(
      lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "timeout-mode", timeoutMs: 300 }),
      (e) => e.code === "TIMEOUT",
    );
  });

  test("malformed Rhubarb output → MALFORMED_JSON", async () => {
    process.env.RHUBARB_FAKE_MODE = "malformed";
    await assert.rejects(lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "malformed-mode" }), (e) => e.code === "MALFORMED_JSON");
  });

  test("Rhubarb JSON normalization → validated VisemeTrack", async () => {
    const { track, cached } = await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "normalize-run", language: "en", fps: 30 });
    assert.equal(cached, false);
    assert.equal(track.version, 1);
    assert.equal(track.fps, 30);
    assert.equal(track.source, "rhubarb");
    assert.ok(track.cues.length > 0);
    // First and last cues are relaxed silence X.
    assert.equal(track.cues[0].v, "X");
    assert.equal(track.cues[track.cues.length - 1].v, "X");
    // Linter passes on normalized output.
    assert.equal(viseme.lintVisemeTrack(track).pass, true);
  });
});

// ────────────────────────────────────────────────────────────
describe("Source-hash cache", () => {
  beforeEach(() => {
    delete process.env.RHUBARB_FAKE_MODE;
  });
  test("cache hit returns cached track and marks cached:true", async () => {
    const first = await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "same line", language: "en", fps: 30 });
    assert.equal(first.cached, false);
    const second = await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "same line", language: "en", fps: 30 });
    assert.equal(second.cached, true);
    assert.deepEqual(second.track.cues, first.track.cues);
  });
  test("cache invalidation on changed transcript", async () => {
    const a = await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "one", language: "en", fps: 30 });
    const b = await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "two different", language: "en", fps: 30 });
    assert.equal(a.cached, false);
    assert.equal(b.cached, false);
  });
  test("cache invalidation on changed fps / post-processor version", async () => {
    const a = await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "line", language: "en", fps: 30 });
    const b = await lipsync.runRhubarb({ audioPath: AUDIO_IN, transcript: "line", language: "en", fps: 24 });
    assert.equal(a.cached, false);
    assert.equal(b.cached, false);
  });
});

// ────────────────────────────────────────────────────────────
describe("LipSyncPlayer (ANIM-LIP-03, Checkpoint B/C)", () => {
  test("morph-target playback drives influences", () => {
    const root = buildAvatar();
    const track = sampleTrack(30, ["X", "A", "X"]);
    const clk = clockDriver();
    const player = new LipSyncPlayer(root, track, { getClock: clk.get });
    player.start(clk.get());
    clk.set(0.0); player.update(clk.get());
    clk.advance(0.2); player.update(clk.get()); // into A
    // allow crossfade to settle
    for (let i = 0; i < 6; i++) { clk.advance(0.02); player.update(clk.get()); }
    const mesh = root.getObjectByName("faceMesh");
    const aIdx = mesh.morphTargetDictionary["viseme_A"];
    assert.ok(mesh.morphTargetInfluences[aIdx] > 0.5, "viseme_A should be active");
    const xIdx = mesh.morphTargetDictionary["viseme_X"];
    assert.ok(mesh.morphTargetInfluences[xIdx] < 0.5, "viseme_X should be idle");
    player.dispose();
  });

  test("bone-only fallback drives jaw open (no morphs)", () => {
    const root = buildAvatar({ skipMesh: true });
    const track = sampleTrack(30, ["X", "D", "X"]); // D = wide open
    const clk = clockDriver();
    const player = new LipSyncPlayer(root, track, { getClock: clk.get });
    player.start(clk.get());
    clk.set(0.0); player.update(clk.get());
    clk.set(0.2); player.update(clk.get());
    for (let i = 0; i < 6; i++) { clk.advance(0.02); player.update(clk.get()); }
    const jaw = root.getObjectByName("jaw");
    assert.ok(jaw.rotation.x > 0.1, "jaw should open for shape D");
    player.dispose();
  });

  test("degrades cleanly when avatar lacks a requested morph", () => {
    // Mesh has morphs; we request a shape name not present → skipped, no throw.
    const root = buildAvatar();
    const track = sampleTrack(30, ["X", "G", "X"]); // G present; harmless
    const clk = clockDriver();
    const player = new LipSyncPlayer(root, track, { getClock: clk.get, morphPrefix: "nonexistent_" });
    player.start(clk.get());
    clk.set(0.2); player.update(clk.get());
    assert.doesNotThrow(() => { for (let i = 0; i < 3; i++) { clk.advance(0.02); player.update(clk.get()); } });
    player.dispose();
  });

  test("L2 face playback while L0 locomotion + L1 emotes continue", () => {
    const root = new THREE.Group();
    // body bones
    const spine = new THREE.Bone(); spine.name = "spine"; root.add(spine);
    const tail = new THREE.Bone(); tail.name = "tail"; root.add(tail);
    // face mesh + bones
    const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3)));
    mesh.name = "faceMesh";
    const dict = {}; const infl = [];
    for (const s of viseme.VISEME_SHAPES) { dict[`viseme_${s}`] = infl.length; infl.push(0); }
    mesh.morphTargetDictionary = dict; mesh.morphTargetInfluences = infl;
    root.add(mesh);
    const jaw = new THREE.Bone(); jaw.name = "jaw"; root.add(jaw);

    const walkClip = new THREE.AnimationClip("walk", 1, [
      new THREE.VectorKeyframeTrack("spine.position", [0, 1], [0,0,0, 0,2,0]),
    ]);
    const emoteClip = new THREE.AnimationClip("emote", 1, [
      new THREE.VectorKeyframeTrack("tail.position", [0, 1], [0,0,0, 3,0,0]),
    ]);

    const controller = createAnimationController(root, [walkClip, emoteClip]);
    controller.selectClip("walk"); // L0 locomotion
    controller.selectLayeredClip("emote", { layer: "L1" }); // L1 emote overlay

    const track = sampleTrack(30, ["X", "A", "X"]);
    const clk = clockDriver();
    const player = new LipSyncPlayer(root, track, { getClock: clk.get });
    player.start(clk.get());

    const spin0 = spine.position.y;
    const tail0 = tail.position.x;
    let maxA = 0;
    let spineAtMaxA = spin0;
    let tailAtMaxA = tail0;
    for (let i = 0; i < 12; i++) {
      const dt = 1 / 30;
      clk.advance(dt);
      controller.update(dt);   // L0 + L1 advance
      player.update(clk.get()); // L2 (after mixer) wins face
      const aIdx = mesh.morphTargetDictionary["viseme_A"];
      const a = mesh.morphTargetInfluences[aIdx];
      if (a > maxA) {
        maxA = a;
        spineAtMaxA = spine.position.y;
        tailAtMaxA = tail.position.x;
      }
    }
    // L2 face active during speech...
    assert.ok(maxA > 0.3, "L2 face should drive viseme_A during speech");
    // ...while L0 locomotion and L1 emote continue (simultaneous, not stopped).
    assert.notEqual(spineAtMaxA, spin0, "L0 walk should continue during L2 speech");
    assert.notEqual(tailAtMaxA, tail0, "L1 emote should continue during L2 speech");
    player.dispose();
  });

  test("pause / resume / seek / stop / replay / dispose", () => {
    const root = buildAvatar();
    const track = sampleTrack(30, ["X", "A", "B", "X"]);
    const clk = clockDriver();
    const player = new LipSyncPlayer(root, track, { getClock: clk.get });
    player.start(clk.get());
    clk.set(0.2); player.update(clk.get());
    for (let i = 0; i < 6; i++) { clk.advance(0.02); player.update(clk.get()); }
    assert.equal(player.getState(), "playing");

    player.pause(clk.get());
    assert.equal(player.getState(), "paused");
    const snapshot = root.getObjectByName("faceMesh").morphTargetInfluences.slice();
    clk.advance(0.5); player.update(clk.get()); // should be a no-op while paused
    assert.deepEqual(root.getObjectByName("faceMesh").morphTargetInfluences, snapshot);

    player.resume(clk.get());
    assert.equal(player.getState(), "playing");

    player.seek(0.4, clk.get()); // into B
    for (let i = 0; i < 6; i++) { clk.advance(0.02); player.update(clk.get()); }
    const bIdx = root.getObjectByName("faceMesh").morphTargetDictionary["viseme_B"];
    assert.ok(root.getObjectByName("faceMesh").morphTargetInfluences[bIdx] > 0.3);

    player.stop();
    assert.equal(player.getState(), "idle");
    const zero = root.getObjectByName("faceMesh").morphTargetInfluences.every((v) => v === 0);
    assert.ok(zero, "stop must reset face");

    player.replay(clk.get());
    assert.equal(player.getState(), "playing");

    player.dispose();
    assert.equal(player.getState(), "idle");
  });

  test("reset on end-of-track", () => {
    const root = buildAvatar();
    const track = sampleTrack(30, ["X", "A", "X"]); // duration 0.4
    const clk = clockDriver();
    const player = new LipSyncPlayer(root, track, { getClock: clk.get });
    player.start(clk.get());
    clk.set(0.5); player.update(clk.get()); // past duration
    assert.equal(player.getState(), "ended");
    const zero = root.getObjectByName("faceMesh").morphTargetInfluences.every((v) => v === 0);
    assert.ok(zero, "ended must reset face");
  });

  test("uses injected clock, never Date.now / frame accumulation", () => {
    const root = buildAvatar();
    const track = sampleTrack(30, ["X", "A", "X"]);
    const clk = clockDriver();
    const player = new LipSyncPlayer(root, track, { getClock: clk.get });
    player.start(clk.get());
    // directly set clock far ahead — player should follow the clock, not accumulate frames
    clk.set(0.2); player.update(clk.get());
    for (let i = 0; i < 4; i++) { clk.advance(0.02); player.update(clk.get()); }
    const aIdx = root.getObjectByName("faceMesh").morphTargetDictionary["viseme_A"];
    assert.ok(root.getObjectByName("faceMesh").morphTargetInfluences[aIdx] > 0.3);
    player.dispose();
  });
});

// ────────────────────────────────────────────────────────────
describe("Speech pipeline + tier selection (ANIM-LIP-05)", () => {
  test("selectLipSyncTier: C > B > A", () => {
    const t = viseme.postProcessVisemeTrack([{ t: 0, v: "X" }], { fps: 30 });
    assert.deepEqual(speech.selectLipSyncTier({ providerVisemes: t }), { tier: "C", track: t });
    assert.deepEqual(speech.selectLipSyncTier({ bTrack: t }), { tier: "B", track: t });
    assert.deepEqual(speech.selectLipSyncTier({}), { tier: "A", track: null });
  });

  test("Tier B failure falls back to A without stopping audio", async () => {
    const root = buildAvatar();
    let audioStarted = false;
    const clk = clockDriver();
    const res = await speech.speak({
      root,
      playAudio: () => {
        audioStarted = true;
        return clk.get;
      },
      transcript: "woof",
      resolveViseme: async () => {
        assert.equal(audioStarted, true, "audio must start before Tier B resolution");
        throw new Error("Rhubarb down");
      },
    });
    assert.equal(audioStarted, true, "audio must start even when Tier B fails");
    assert.equal(res.tier, "A", "should degrade to Tier A");
    assert.equal(res.degraded, true);
    assert.ok(res.player, "a player is still created (Tier A amplitude)");
    res.player.dispose();
  });

  test("Tier C provider visemes take precedence", async () => {
    const root = buildAvatar();
    const provider = viseme.postProcessVisemeTrack([{ t: 0, v: "A" }, { t: 0.2, v: "X" }], { fps: 30 });
    let audioStarted = false;
    const res = await speech.speak({
      root,
      playAudio: () => { audioStarted = true; return () => 0; },
      providerVisemes: provider,
      resolveViseme: async () => viseme.postProcessVisemeTrack([{ t: 0, v: "D" }], { fps: 30 }),
    });
    assert.equal(res.tier, "C");
    assert.equal(audioStarted, true);
    res.player.dispose();
  });

  test("Tier B used when provider absent but resolver succeeds", async () => {
    const root = buildAvatar();
    const b = viseme.postProcessVisemeTrack([{ t: 0, v: "D" }, { t: 0.2, v: "X" }], { fps: 30 });
    const res = await speech.speak({
      root,
      playAudio: () => () => 0,
      resolveViseme: async () => b,
    });
    assert.equal(res.tier, "B");
    assert.equal(res.degraded, false);
    res.player.dispose();
  });
});

// ────────────────────────────────────────────────────────────
describe("Golden QA corpus (±1 frame gate)", () => {
  const names = ["english", "non_english", "silence", "a_to_d", "c_to_f", "extended", "subframe"];
  for (const name of names) {
    test(`${name}: generated cues match reference within ±1 frame`, () => {
      const input = JSON.parse(fs.readFileSync(`tests/fixtures/lipsync/golden/${name}.json`, "utf8"));
      const ref = JSON.parse(fs.readFileSync(`tests/fixtures/lipsync/golden/${name}-expected.json`, "utf8"));
      const raw = viseme.rhubarbJsonToRawCues(input.rhubarb);
      const lastEnd = input.rhubarb.mouthCues[input.rhubarb.mouthCues.length - 1].end;
      const track = viseme.postProcessVisemeTrack(raw, { fps: input.meta.fps, source: "rhubarb", durationSec: lastEnd });

      assert.equal(track.cues.length, ref.cues.length, "cue count must match");
      const eps = 1 / input.meta.fps + 1e-6;
      for (let i = 0; i < ref.cues.length; i++) {
        assert.equal(track.cues[i].v, ref.cues[i].v, `shape @${i}`);
        assert.ok(Math.abs(track.cues[i].t - ref.cues[i].t) <= eps, `time @${i}: ${track.cues[i].t} vs ${ref.cues[i].t}`);
      }
    });
  }

  test("a_to_d reference enforces A→C→D bridge", () => {
    const ref = JSON.parse(fs.readFileSync("tests/fixtures/lipsync/golden/a_to_d-expected.json", "utf8"));
    const seq = ref.cues.map((c) => c.v).join("");
    assert.ok(seq.includes("ACD"));
  });

  test("c_to_f reference enforces C→E→F bridge", () => {
    const ref = JSON.parse(fs.readFileSync("tests/fixtures/lipsync/golden/c_to_f-expected.json", "utf8"));
    const seq = ref.cues.map((c) => c.v).join("");
    assert.ok(seq.includes("CEF"));
  });

  test("extended fixture preserves G, H, X", () => {
    const ref = JSON.parse(fs.readFileSync("tests/fixtures/lipsync/golden/extended-expected.json", "utf8"));
    const shapes = ref.cues.map((c) => c.v);
    assert.ok(shapes.includes("G") && shapes.includes("H") && shapes.includes("X"));
  });
});

// ────────────────────────────────────────────────────────────
describe("API routes (/animator/lipsync) + route-order regression", () => {
  let server, base;
  before(async () => {
    const express = (await import("express")).default;
    const http = await import("node:http");
    const app = express();
    app.use(express.json());
    const { animatorRouter } = await import("../server/animator/routes.ts");
    app.use("/", animatorRouter);
    await new Promise((resolve) => { server = http.createServer(app).listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server && server.close());

  const wavB64 = () => fs.readFileSync(path.resolve("tests/fixtures/lipsync/sample.wav")).toString("base64");
  const mockRes = () => {
    const r = { statusCode: 200, _json: null,
      status(c) { this.statusCode = c; return this; },
      json(o) { this._json = o; return this; } };
    return r;
  };

  test("POST handler creates a job and GET handler returns the validated track", async () => {
    const res = mockRes();
    await lipsync.handleLipsyncPost({ body: { audioBase64: wavB64(), transcript: "hello", language: "en", fps: 30 } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res._json.jobId, "job id returned");
    assert.ok(res._json.track, "track returned on success");

    const res2 = mockRes();
    await lipsync.handleLipsyncGet({ params: { id: res._json.jobId } }, res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2._json.state, "done");
    assert.equal(res2._json.track.version, 1);
  });

  test("typed failure: missing binary → failed job with BIN_NOT_FOUND (never 503)", async () => {
    const prev = process.env.RHUBARB_BIN;
    process.env.RHUBARB_BIN = "/nonexistent/rhubarb";
    try {
      const res = mockRes();
      await lipsync.handleLipsyncPost({ body: { audioBase64: fs.readFileSync(AUDIO_B).toString("base64"), language: "en" } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res._json.errorCode, "BIN_NOT_FOUND");
      const res2 = mockRes();
      await lipsync.handleLipsyncGet({ params: { id: res._json.jobId } }, res2);
      assert.equal(res2._json.state, "failed");
      assert.equal(res2._json.errorCode, "BIN_NOT_FOUND");
    } finally {
      process.env.RHUBARB_BIN = prev;
    }
  });

  test("GET missing job → 404 (safe read path)", async () => {
    const res = mockRes();
    await lipsync.handleLipsyncGet({ params: { id: "does-not-exist" } }, res);
    assert.equal(res.statusCode, 404);
  });

  test("route-order regression: /animator/jobs still resolves (no shadowing)", async () => {
    const res = await fetch(`${base}/animator/jobs`);
    assert.notEqual(res.status, 404, `jobs route must resolve (got ${res.status}, not shadowed)`);
  });

  test("route-order regression: created lipsync job reachable via router GET", async () => {
    const res = mockRes();
    await lipsync.handleLipsyncPost({ body: { audioBase64: wavB64(), transcript: "routecheck", language: "en", fps: 30 } }, res);
    const id = res._json.jobId;
    const get = await fetch(`${base}/animator/lipsync/${id}`);
    assert.equal(get.status, 200);
    const gj = await get.json();
    assert.equal(gj.state, "done");
  });
});
