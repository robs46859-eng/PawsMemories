import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("deployment is pinned to the supported Node 24 LTS line", () => {
  assert.equal(packageJson.engines.node, ">=24.15 <25");
  assert.equal(readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim(), "24.18.0");
  assert.equal(packageJson.dependencies.sharp, "^0.35.3");
  assert.equal(packageJson.overrides.sharp, "$sharp");
});

test("brand logo and product deep links remain part of the application shell", () => {
  assert.match(appSource, /\/brand\/pawsome-logo\.png/);
  for (const path of ["/home", "/furball3d", "/animator", "/pawprints", "/fidos-styles"]) {
    assert.ok(appSource.includes(path), `missing app path ${path}`);
  }
});

test("media-heavy JSON routes receive the scoped 50 MB parser", () => {
  assert.match(serverSource, /express\.json\(\{ limit: "50mb" \}\)/);
  for (const path of ["/api/avatars", "/api/image-to-3d", "/api/pawprints/generate", "/api/profile/photos"]) {
    assert.ok(serverSource.includes(path), `missing upload parser path ${path}`);
  }
});
