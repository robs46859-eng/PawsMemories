import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DRIVES,
  decayDrives,
  recoverDrives,
  criticalDrives,
  DECAY_PER_SEC,
} from "../src/brain/index.ts";

test("decay grows urgent drives and clamps to [0,100]", () => {
  const d = decayDrives({ ...DEFAULT_DRIVES }, 10);
  assert.ok(d.hunger > DEFAULT_DRIVES.hunger, "hunger should grow");
  assert.ok(d.thirst > DEFAULT_DRIVES.thirst, "thirst should grow");
  for (const v of Object.values(d)) {
    assert.ok(v >= 0 && v <= 100, `drive within bounds: ${v}`);
  }
});

test("decay matches the per-second rate over dt", () => {
  const start = { hunger: 0, thirst: 0, tiredness: 0, playfulness: 0, happiness: 50 };
  const d = decayDrives(start, 20); // 20s
  assert.equal(d.hunger, DECAY_PER_SEC.hunger * 20);
  assert.equal(d.thirst, DECAY_PER_SEC.thirst * 20);
});

test("breed decay multipliers scale the rate", () => {
  const start = { hunger: 0, thirst: 0, tiredness: 0, playfulness: 0, happiness: 50 };
  const plain = decayDrives(start, 10);
  const husky = decayDrives(start, 10, {
    decay: { hunger: 1.3 },
    exerciseNeed: 1.6,
    complianceBase: 0.5,
    scale: 1.15,
  });
  assert.ok(husky.hunger > plain.hunger, "husky hunger decays faster");
  assert.ok(Math.abs(husky.hunger - plain.hunger * 1.3) < 1e-9);
});

test("recovery reduces urgency and clamps at 0", () => {
  const start = { ...DEFAULT_DRIVES, hunger: 10 };
  const d = recoverDrives(start, { hunger: -20 }, 5); // -100 over 5s → clamp 0
  assert.equal(d.hunger, 0);
});

test("criticalDrives flags starving/thirsty/exhausted/sad", () => {
  const d = { hunger: 95, thirst: 95, tiredness: 95, playfulness: 0, happiness: 5 };
  const flags = criticalDrives(d);
  assert.deepEqual(flags.sort(), ["happiness", "hunger", "thirst", "tiredness"].sort());
});
