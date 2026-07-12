import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarGenerationCost, CREDIT_PACKS, CREDIT_PRICES } from "../src/pricing.ts";

test("authoritative credit prices match the published catalog", () => {
  assert.equal(CREDIT_PRICES.PAWPRINT, 75);
  assert.equal(CREDIT_PRICES.HD_IMAGE, 10);
  assert.equal(CREDIT_PRICES.ANIMATED_VIDEO, 100);
  assert.equal(CREDIT_PRICES.VOICE_CLONE, 100);
  assert.equal(CREDIT_PRICES.STORAGE_GB_MONTH, 4);
});

test("avatar pricing is fixed by product type", () => {
  assert.equal(avatarGenerationCost("dog", "image"), 80);
  assert.equal(avatarGenerationCost("human", "text"), 80);
  assert.equal(avatarGenerationCost("object", "text"), 40);
  assert.equal(avatarGenerationCost("object", "image"), 45);
});

test("credit packs match the published wallet packages", () => {
  assert.deepEqual(
    CREDIT_PACKS.filter((pack) => !pack.comingSoon).map(({ credits, price, bonusPercent }) => [credits, price, bonusPercent]),
    [[100, 10, 0], [275, 25, 10], [600, 50, 20], [1300, 100, 30], [3500, 250, 40]],
  );
});
