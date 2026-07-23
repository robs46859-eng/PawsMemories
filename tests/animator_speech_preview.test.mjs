import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";

import { createSpeechPreview, synthesizeElevenLabsWav } from "../server/animator/speechPreview.ts";
import { ensureWorkspaceDirectory } from "../server/animator/paths.ts";
import { playLiveActorSpeech } from "../src/animator/speech/liveSpeech.ts";

test("speech preview creates a missing workspace tmp directory before writing", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pawsome3d-speech-"));
  const tmpDirectory = path.join(workspace, "tmp");

  try {
    assert.equal(fs.existsSync(tmpDirectory), false);
    const resolved = await ensureWorkspaceDirectory("tmp", workspace);
    assert.equal(resolved, tmpDirectory);
    assert.equal(fs.statSync(tmpDirectory).isDirectory(), true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("concurrent speech previews use unique temporary files and clean both", async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-key";
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pawsome3d-speech-concurrent-"));
  const observedPaths = [];
  const fakeFetch = async () => new Response(new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0]), { status: 200 });

  try {
    await Promise.all([
      createSpeechPreview({ text: "First", language: "en" }, fakeFetch, {
        workspaceRoot: workspace,
        runRhubarbImpl: async ({ audioPath }) => {
          observedPaths.push(audioPath);
          assert.equal(fs.existsSync(audioPath), true);
          return { track: null };
        },
      }),
      createSpeechPreview({ text: "Second", language: "en" }, fakeFetch, {
        workspaceRoot: workspace,
        runRhubarbImpl: async ({ audioPath }) => {
          observedPaths.push(audioPath);
          assert.equal(fs.existsSync(audioPath), true);
          return { track: null };
        },
      }),
    ]);

    assert.equal(new Set(observedPaths).size, 2);
    for (const audioPath of observedPaths) assert.equal(fs.existsSync(audioPath), false);
  } finally {
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("speech preview converts ElevenLabs PCM into a valid mono WAV", async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-key";
  let request = null;
  const fakeFetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0]), { status: 200 });
  };

  try {
    const wav = await synthesizeElevenLabsWav({ text: "Hello", language: "en" }, fakeFetch);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt32LE(24), 16_000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.match(request.url, /output_format=pcm_16000/);
    assert.equal(request.init.shell, undefined);
    assert.equal(request.init.headers["xi-api-key"], "test-key");
    assert.equal(JSON.parse(request.init.body).text, "Hello");
  } finally {
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
  }
});

test("speech preview rejects generated audio longer than its 30-second credit unit", async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-key";
  const overThirtySeconds = new Uint8Array(16_000 * 2 * 30 + 2);

  try {
    await assert.rejects(
      synthesizeElevenLabsWav(
        { text: "An unexpectedly long preview", language: "en" },
        async () => new Response(overThirtySeconds, { status: 200 }),
      ),
      /exceeds the 30-second limit/,
    );
  } finally {
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
  }
});

test("live actor speech uses the server track and authoritative audio clock", async () => {
  const previousFetch = globalThis.fetch;
  const previousAudio = globalThis.Audio;
  const track = {
    version: 1,
    fps: 30,
    source: "rhubarb",
    durationSec: 1,
    cues: [{ t: 0, v: "X" }, { t: 0.1, v: "D" }],
    anticipationSec: 2 / 30,
  };
  let audioInstance = null;

  class FakeAudio {
    currentTime = 0;
    listeners = new Map();
    constructor(src) {
      this.src = src;
      audioInstance = this;
    }
    play() { return Promise.resolve(); }
    pause() {}
    addEventListener(name, listener) { this.listeners.set(name, listener); }
  }

  globalThis.fetch = async (url) => {
    assert.equal(String(url), "/api/animator/speech-preview");
    return Response.json({ audioBase64: "AAAA", mimeType: "audio/wav", track, tier: "B" });
  };
  globalThis.Audio = FakeAudio;

  const root = new THREE.Group();
  const jaw = new THREE.Bone();
  jaw.name = "jaw";
  root.add(jaw);
  let registeredPlayer = null;
  let tier = null;

  try {
    const handle = await playLiveActorSpeech({
      root,
      text: "Hello",
      onPlayer: (player) => { registeredPlayer = player; },
      onTier: (value) => { tier = value; },
    });
    assert.equal(tier, "B");
    assert.ok(registeredPlayer, "production helper should register a LipSyncPlayer");
    audioInstance.currentTime = 0.25;
    registeredPlayer.update();
    assert.notEqual(jaw.rotation.x, 0, "audio-clock sampling should animate the jaw");
    handle.cancel();
    assert.equal(registeredPlayer, null, "cancel should unregister the player");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Audio = previousAudio;
  }
});

test("Animator production UI wires preview speech into the post-mixer L2 update", () => {
  const screen = fs.readFileSync("src/animator/components/AnimatorScreen.tsx", "utf8");
  const sceneController = fs.readFileSync("src/animator/controller/createSceneController.ts", "utf8");
  assert.match(screen, /playLiveActorSpeech/);
  assert.match(screen, /setActorLipSyncPlayer\(activeActorId, player\)/);

  const mixerUpdate = sceneController.indexOf("for (const ctrl of controllers.values()) ctrl.update(delta)");
  const lipUpdate = sceneController.indexOf("for (const player of lipSyncPlayers.values()) player.update()");
  assert.ok(mixerUpdate >= 0 && lipUpdate > mixerUpdate, "L2 face sampling must run after mixer updates");
});
