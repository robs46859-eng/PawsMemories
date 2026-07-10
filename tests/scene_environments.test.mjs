import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { EnvironmentPresetSchema } from "../server/animator/environments.ts";
import { lightingFor } from "../src/animator/scenes/lightingRig.ts";
import { normalizeWeather } from "../src/animator/scenes/weather/normalize.ts";

test("Scene Environments - JSON validation and license constraints", () => {
  const envDir = path.join(process.cwd(), "server", "animator", "environments");
  if (!fs.existsSync(envDir)) return;
  
  const files = fs.readdirSync(envDir).filter(f => f.endsWith(".json"));
  for (const f of files) {
    const p = path.join(envDir, f);
    const content = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(content);
    
    // Zod throws if invalid
    const preset = EnvironmentPresetSchema.parse(parsed);
    
    // License must be CC0, owned, or generated
    assert.ok(["CC0", "owned", "generated"].includes(preset.license));
    
    if (preset.license === "CC0") {
      assert.ok(preset.source, "CC0 must have source");
      assert.ok(preset.sourceUrl, "CC0 must have sourceUrl");
    }
  }
});

test("Time of Day - lightingFor produces distinct sane profiles", () => {
  const mockPreset = { id: "outdoor", tier: "basic", backdrop: { kind: "procedural" }, allowedWeather: ["clear"] };
  
  const afternoon = lightingFor("afternoon", mockPreset);
  const night = lightingFor("night", mockPreset);
  
  assert.strictEqual(afternoon.showStars, false);
  assert.strictEqual(night.showStars, true);
  
  assert.ok(afternoon.exposure > night.exposure);
  assert.ok(afternoon.sunIntensity > night.sunIntensity);
  
  // High sun for afternoon
  assert.ok(afternoon.sunPosition[1] >= 5);
});

test("Weather - normalizeWeather falls back to clear", () => {
  const allowed = ["clear", "rain"];
  assert.strictEqual(normalizeWeather("rain", allowed), "rain");
  assert.strictEqual(normalizeWeather("clear", allowed), "clear");
  assert.strictEqual(normalizeWeather("snow", allowed), "clear");
  assert.strictEqual(normalizeWeather("fog", allowed), "clear");
});
