import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bimHistoryReducer, EMPTY_BIM_MODEL, preflightBimModel, snap, validateBimModel } from "../src/bim/model.ts";
import { BIM_PREFABS, prefabInsertOrigin } from "../src/bim/prefabs.ts";

describe("BIM prefab library", () => {
  test("every prefab inserts a valid, buildable element group", () => {
    for (const prefab of BIM_PREFABS) {
      const elements = prefab.build("level-0", [0, 0], 0.1);
      const model = { ...structuredClone(EMPTY_BIM_MODEL), elements };
      assert.deepEqual(validateBimModel(model), [], `${prefab.id} must validate cleanly`);
    }
  });
  test("studio apartment prefab is a complete dwelling", () => {
    const prefab = BIM_PREFABS.find((item) => item.id === "studio-apartment");
    const elements = prefab.build("level-0", [0, 0], 0.1);
    const count = (type) => elements.filter((item) => item.type === type).length;
    assert.equal(count("wall"), 6);
    assert.equal(count("door"), 2);
    assert.equal(count("window"), 2);
    assert.equal(count("opening"), 4);
    assert.equal(count("slab"), 1);
    assert.equal(count("roof"), 1);
    assert.equal(count("space"), 2);
    const report = preflightBimModel({ ...structuredClone(EMPTY_BIM_MODEL), elements });
    assert.equal(report.passed, true);
    assert.deepEqual(report.warnings, [], "studio template must be warning-free");
  });
  test("batch insert is one undoable step and repeated inserts do not overlap", () => {
    const prefab = BIM_PREFABS.find((item) => item.id === "studio-apartment");
    let state = { past: [], present: structuredClone(EMPTY_BIM_MODEL), future: [] };
    state = bimHistoryReducer(state, { type: "add-elements", elements: prefab.build("level-0", [0, 0], 0.1) });
    const firstCount = state.present.elements.length;
    const origin = prefabInsertOrigin(state.present.elements);
    assert.ok(origin[0] >= 6.4, "second insert origin must clear the first footprint");
    state = bimHistoryReducer(state, { type: "add-elements", elements: prefab.build("level-0", origin, 0.1) });
    assert.equal(state.present.elements.length, firstCount * 2);
    state = bimHistoryReducer(state, { type: "undo" });
    assert.equal(state.present.elements.length, firstCount, "undo removes the whole prefab in one step");
  });
});

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
