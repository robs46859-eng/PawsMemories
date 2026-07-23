import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_BROWSER_VOICE_PREFERENCE,
  chooseBrowserVoice,
  parseBrowserVoicePreference,
} from "../src/three/browserVoicePreferences.ts";

const voices = [
  { voiceURI: "voice-fr", name: "French", lang: "fr-FR", default: false },
  { voiceURI: "voice-basic", name: "Basic English", lang: "en-US", default: true },
  { voiceURI: "voice-warm", name: "Samantha", lang: "en-US", default: false },
];

test("Randy browser voice honors an exact saved voice URI", () => {
  const selected = chooseBrowserVoice(voices, { voiceURI: "voice-basic", rate: 1, pitch: 1 });
  assert.equal(selected?.voiceURI, "voice-basic");
});

test("Randy browser voice falls back to a preferred warm English voice", () => {
  const selected = chooseBrowserVoice(voices, { ...DEFAULT_BROWSER_VOICE_PREFERENCE, voiceURI: "missing" });
  assert.equal(selected?.voiceURI, "voice-warm");
});

test("Randy browser voice settings reject malformed local values", () => {
  assert.deepEqual(parseBrowserVoicePreference("{bad json"), DEFAULT_BROWSER_VOICE_PREFERENCE);
  assert.deepEqual(
    parseBrowserVoicePreference(JSON.stringify({ voiceURI: "voice-basic", rate: 9, pitch: -1 })),
    DEFAULT_BROWSER_VOICE_PREFERENCE,
  );
});

test("Randy exposes browser voice selection, preview, and reset controls", () => {
  const source = fs.readFileSync("src/components/RandyChat.tsx", "utf8");
  assert.match(source, /aria-label="Randy browser voice"/);
  assert.match(source, />\s*Preview\s*</);
  assert.match(source, />\s*Reset\s*</);
});
