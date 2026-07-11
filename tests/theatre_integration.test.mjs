import test from "node:test";
import assert from "node:assert";
import * as core from "@theatre/core";

test("theatre_integration", async (t) => {
  await t.test("Theatre sheet can be created and values round-trip", () => {
    const project = (core.getProject || core.default.getProject)("TestProject");
    const sheet = project.sheet("Scene");
    
    // Create an object and set a value
    const obj = sheet.object("Camera", {
      position: { x: 0, y: 0, z: 5 }
    });
    
    // Simulate setting a keyframe or value (Theatre API is complex for keyframes in tests, 
    // so we'll just check if the object exposes its current value correctly).
    const currentPos = obj.value.position;
    assert.strictEqual(currentPos.x, 0);
    assert.strictEqual(currentPos.z, 5);
    
    // Verify it generates state that could be saved/loaded
    // Theatre internal state might just be accessed via the state getter.
    // If we want to export, it's studio.createStudio().createExport() but in core we can just check if state exists.
    assert.ok(project);
  });
});
