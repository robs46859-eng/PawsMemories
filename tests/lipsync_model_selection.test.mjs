import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const screen = fs.readFileSync("src/components/VoiceFlowTest.tsx", "utf8");
const preview = fs.readFileSync("src/components/LipSyncModelPreview.tsx", "utf8");

test("voice and lip-sync module lets the user select a ready FurBin model", () => {
  assert.match(screen, /fetchModelLibrary/);
  assert.match(screen, /Select a 3D model/);
  assert.match(screen, /LipSyncModelPreview/);
});

test("selected model is driven by the production viseme player", () => {
  assert.match(preview, /new LipSyncPlayer/);
  assert.match(preview, /playerRef\.current\?\.update/);
  assert.match(preview, /audioRef\.current\?\.currentTime/);
});
