import assert from "node:assert/strict";
import { test } from "node:test";
import { Screen } from "../src/types.ts";
import { MOBILE_NAV, SIDEBAR_NAV, TOP_PRIMARY_NAV } from "../src/shellNavigation.ts";

test("top panel exposes only the primary creation destinations", () => {
  assert.deepEqual(TOP_PRIMARY_NAV.map(({ screen }) => screen), [
    Screen.MODELS,
    Screen.PAWPRINTS,
    Screen.PAWLISHER,
  ]);
});

test("desktop sidebar keeps creation studios out of the global shell", () => {
  assert.deepEqual(SIDEBAR_NAV.map(({ screen }) => screen), [
    Screen.DASHBOARD,
    Screen.FURBIN,
    Screen.ANIMATOR,
  ]);
  assert.deepEqual(MOBILE_NAV.map(({ screen }) => screen), [
    Screen.DASHBOARD,
    Screen.FURBIN,
    Screen.ANIMATOR,
    Screen.PROFILE,
  ]);
  assert.ok(!SIDEBAR_NAV.some(({ screen }) => screen === Screen.MODELS || screen === Screen.PAWLISHER));
});

test("shell navigation has no duplicate ids or screens per panel", () => {
  for (const panel of [TOP_PRIMARY_NAV, SIDEBAR_NAV, MOBILE_NAV]) {
    assert.equal(new Set(panel.map(({ id }) => id)).size, panel.length);
    assert.equal(new Set(panel.map(({ screen }) => screen)).size, panel.length);
  }
});
