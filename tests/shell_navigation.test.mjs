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

test("desktop and mobile panels use the same stable destination set", () => {
  const expected = [Screen.DASHBOARD, Screen.FURBIN, Screen.PROFILE, Screen.PAWLISHER];
  assert.deepEqual(SIDEBAR_NAV.map(({ screen }) => screen), expected);
  assert.deepEqual(MOBILE_NAV.map(({ screen }) => screen), expected);
});

test("shell navigation has no duplicate ids or screens per panel", () => {
  for (const panel of [TOP_PRIMARY_NAV, SIDEBAR_NAV, MOBILE_NAV]) {
    assert.equal(new Set(panel.map(({ id }) => id)).size, panel.length);
    assert.equal(new Set(panel.map(({ screen }) => screen)).size, panel.length);
  }
});
