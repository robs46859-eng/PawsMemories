import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const createScreenSource = await readFile(new URL("../src/components/CreateScreen.tsx", import.meta.url), "utf8");

test("create-reference image uploads use the large JSON parser", () => {
  const routesMatch = serverSource.match(/const largeJsonRoutes = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(routesMatch, "largeJsonRoutes must remain explicitly scoped");
  assert.match(routesMatch[1], /["']\/api\/create-pipeline\/generate-reference["']/);
});

test("create flow downscales reference photos before storing base64", () => {
  assert.match(createScreenSource, /downscaleReferenceImage/);
  assert.match(createScreenSource, /maxDimension\s*=\s*2048/);
  assert.match(createScreenSource, /canvas\.toDataURL\("image\/jpeg",\s*0\.88\)/);
  assert.match(createScreenSource, /await downscaleReferenceImage\(base64Url\)/);
});
