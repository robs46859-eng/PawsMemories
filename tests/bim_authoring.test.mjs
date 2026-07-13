import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bimHistoryReducer, EMPTY_BIM_MODEL, preflightBimModel, snap, validateBimModel } from "../src/bim/model.ts";

describe("BIM constrained authoring", () => {
  test("snaps dimensions to a metric grid", () => {
    assert.equal(snap(2.97, 0.1), 3);
    assert.equal(snap(24.9, 0.025), 24.9);
    assert.throws(() => snap(1, 0));
  });
  test("undo and redo preserve a bounded command history", () => {
    let state = { past: [], present: structuredClone(EMPTY_BIM_MODEL), future: [] };
    state = bimHistoryReducer(state, { type: "add-element", element: { id: "w1", type: "wall", name: "Wall", levelId: "level-0", position: [0, 0, 0], end: [4, 0], height: 3, thickness: 0.2 } });
    assert.equal(state.present.elements.length, 1);
    state = bimHistoryReducer(state, { type: "undo" });
    assert.equal(state.present.elements.length, 0);
    state = bimHistoryReducer(state, { type: "redo" });
    assert.equal(state.present.elements.length, 1);
  });
  test("validation enforces host and filling relationships", () => {
    const invalid = { ...structuredClone(EMPTY_BIM_MODEL), elements: [{ id: "d1", type: "door", name: "Door", levelId: "level-0", position: [0, 0, 0], width: 1, depth: 0.1, height: 2 }] };
    assert.match(validateBimModel(invalid).join(" "), /opening/);
  });
  test("preflight runs before construction and reports physical bounds", () => {
    const model = { ...structuredClone(EMPTY_BIM_MODEL), elements: [{ id: "w1", type: "wall", name: "Wall", levelId: "level-0", position: [0, 0, 0], end: [4, 0], height: 3, thickness: 0.2 }] };
    const report = preflightBimModel(model);
    assert.equal(report.stage, "pre-build");
    assert.equal(report.passed, true);
    assert.deepEqual(report.bounds.max, [4, 0.2, 3]);
  });
  test("tampered payload fails preflight instead of throwing", () => {
    const report = preflightBimModel({ name: "Bad", siteName: "", buildingName: "", levels: [{ id: "l", name: "L", elevation: 0 }], elements: [{ id: "broken", name: "Broken", type: "wall", levelId: "l" }] });
    assert.equal(report.passed, false);
    assert.match(report.errors.join(" "), /position/);
  });
});
