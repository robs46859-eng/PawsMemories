import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("FurBin exposes retry, soft-remove, removed-model, and restore controls", () => {
  const source = fs.readFileSync("src/components/FurBinScreen.tsx", "utf8");
  for (const api of ["retryAvatarGeneration", "removeModelFromLibrary", "fetchHiddenModels", "restoreModelToLibrary"]) {
    assert.match(source, new RegExp(api));
  }
  for (const label of ["Retry build", "Remove", "Removed models", "Restore"]) {
    assert.match(source, new RegExp(label));
  }
});

test("model library includes failed jobs but excludes every soft-removed model source", () => {
  const source = fs.readFileSync("server.ts", "utf8");
  const start = source.indexOf('app.get("/api/models/library"');
  const body = source.slice(start, start + 2200);
  assert.match(body, /hidden_at IS NULL/);
  assert.match(body, /media_type = 'model' AND hidden_at IS NULL/);
  assert.doesNotMatch(body, /model_url IS NOT NULL OR rigged_model_url IS NOT NULL/);
});
