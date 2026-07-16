import assert from "node:assert/strict";
import { test } from "node:test";
import { Screen } from "../src/types.ts";
import { MOBILE_NAV, SIDEBAR_NAV, TOP_PRIMARY_NAV } from "../src/shellNavigation.ts";

test("top panel exposes only the requested primary destinations", () => {
  assert.deepEqual(TOP_PRIMARY_NAV.map(({ label, screen }) => ({ label, screen })), []);
});

test("left and mobile panels expose the stable requested destination set", () => {
  const expected = [Screen.DASHBOARD, Screen.MODELS, Screen.PAWPRINTS, Screen.PAWLISHER, Screen.FURBIN];
  assert.deepEqual(SIDEBAR_NAV.map((item) => item.screen), expected);
  assert.deepEqual(MOBILE_NAV.map((item) => item.screen), expected);
  for (const removed of [Screen.STORE, Screen.COMMUNITY, Screen.ANIMATOR, Screen.PROFILE]) {
    assert.equal(SIDEBAR_NAV.some((item) => item.screen === removed), false);
  }
});

test("shell navigation IDs and screens do not duplicate within a panel", () => {
  for (const panel of [TOP_PRIMARY_NAV, SIDEBAR_NAV, MOBILE_NAV]) {
    assert.equal(new Set(panel.map((item) => item.id)).size, panel.length);
    assert.equal(new Set(panel.map((item) => item.screen)).size, panel.length);
  }
});
