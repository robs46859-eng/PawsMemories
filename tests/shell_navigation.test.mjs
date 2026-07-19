import assert from "node:assert/strict";
import { test } from "node:test";
import { Screen } from "../src/types.ts";
import { MOBILE_NAV, SIDEBAR_NAV, TOP_PRIMARY_NAV } from "../src/shellNavigation.ts";

test("top panel exposes Create, Marketplace, Pawprints", () => {
  assert.deepEqual(TOP_PRIMARY_NAV.map(({ screen }) => screen), [
    Screen.CREATE,
    Screen.MARKETPLACE,
    Screen.PAWPRINTS,
  ]);
});

test("desktop sidebar keeps creation studios out of the global shell", () => {
  assert.deepEqual(SIDEBAR_NAV.map(({ screen }) => screen), [
    Screen.DASHBOARD,
    Screen.FURBIN,
    Screen.MARKETPLACE,
  ]);
  assert.deepEqual(MOBILE_NAV.map(({ screen }) => screen), [
    Screen.DASHBOARD,
    Screen.FURBIN,
    Screen.MARKETPLACE,
    Screen.PROFILE,
  ]);
  assert.ok(!SIDEBAR_NAV.some(({ screen }) => screen === Screen.MODELS || screen === Screen.PAWLISHER));
});

test("RD-1: no shell entry routes to a gated (UnderConstructionLock) screen", () => {
  const gated = new Set([Screen.MODELS, Screen.ANIMATOR, Screen.PAWLISHER]);
  for (const panel of [TOP_PRIMARY_NAV, SIDEBAR_NAV, MOBILE_NAV]) {
    assert.ok(!panel.some(({ screen }) => gated.has(screen)), "shell navigation must not dead-end into a lock screen");
  }
});

test("shell navigation has no duplicate ids or screens per panel", () => {
  for (const panel of [TOP_PRIMARY_NAV, SIDEBAR_NAV, MOBILE_NAV]) {
    assert.equal(new Set(panel.map(({ id }) => id)).size, panel.length);
    assert.equal(new Set(panel.map(({ screen }) => screen)).size, panel.length);
  }
});
