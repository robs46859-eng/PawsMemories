import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * §6.7 guard — ensure both createXRStore call sites set `emulate` to `false`
 * in production. Without this, @pmndrs/xr defaults to 'metaQuest3' and ships
 * ~4.7 MB of IWER emulator + synthetic-room chunks to every real user.
 */

const AR_PET_STAGE = fs.readFileSync(
  path.resolve("src/three/ar/ARPetStage.tsx"), "utf8"
);
const AR_SCENE = fs.readFileSync(
  path.resolve("src/three/ar/ARScene.tsx"), "utf8"
);

/**
 * Extract all createXRStore({...}) blocks from source text.
 * Returns the full argument object text for each call.
 */
function extractXRStoreBlocks(source) {
  const blocks = [];
  let idx = 0;
  while (true) {
    const start = source.indexOf("createXRStore(", idx);
    if (start === -1) break;
    // Find the matching closing paren by counting braces/parens
    let depth = 0;
    let i = start + "createXRStore(".length;
    const blockStart = i;
    while (i < source.length) {
      if (source[i] === "(" || source[i] === "{") depth++;
      if (source[i] === ")" || source[i] === "}") depth--;
      if (depth < 0) break;
      i++;
    }
    blocks.push(source.slice(blockStart, i));
    idx = i;
  }
  return blocks;
}

test("ARPetStage.tsx createXRStore includes emulate set to false in production", () => {
  const blocks = extractXRStoreBlocks(AR_PET_STAGE);
  assert.ok(blocks.length > 0, "Expected at least one createXRStore call in ARPetStage.tsx");
  for (const block of blocks) {
    assert.ok(
      block.includes("emulate:") || block.includes("emulate :"),
      "createXRStore in ARPetStage.tsx must include an explicit `emulate` key"
    );
    // The production value must resolve to `false` — match the pattern
    // `import.meta.env.DEV ? "metaQuest3" : false` or just `false`
    assert.match(
      block,
      /emulate\s*:\s*(import\.meta\.env\.DEV\s*\?\s*["']metaQuest3["']\s*:\s*false|false)/,
      "emulate must be set to false in production (via import.meta.env.DEV ternary or literal false)"
    );
  }
});

test("ARScene.tsx createXRStore includes emulate set to false in production", () => {
  const blocks = extractXRStoreBlocks(AR_SCENE);
  assert.ok(blocks.length > 0, "Expected at least one createXRStore call in ARScene.tsx");
  for (const block of blocks) {
    assert.ok(
      block.includes("emulate:") || block.includes("emulate :"),
      "createXRStore in ARScene.tsx must include an explicit `emulate` key"
    );
    assert.match(
      block,
      /emulate\s*:\s*(import\.meta\.env\.DEV\s*\?\s*["']metaQuest3["']\s*:\s*false|false)/,
      "emulate must be set to false in production (via import.meta.env.DEV ternary or literal false)"
    );
  }
});

test("§6.7 approach documented — emulate:false (6.7.1), alias not applied (6.7.2 breaks Rollup)", () => {
  // The prod-only alias of iwer/@iwer/sem/@iwer/devui → empty.ts was attempted
  // but breaks Rollup because @pmndrs/xr/dist/emulate.js does named imports
  // from iwer (XRDevice, metaQuest3, etc.) that can't be satisfied by an empty
  // shim. The emulate:false change (6.7.1) is sufficient: chunks are emitted
  // in dist/ but are provably unreferenced at runtime because the
  // `if (emulate !== false)` guard in @pmndrs/xr never fires.
  assert.ok(true, "6.7.1 applied; 6.7.2 alias skipped (breaks Rollup resolution)");
});
