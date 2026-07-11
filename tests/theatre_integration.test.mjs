import test from "node:test";
import assert from "node:assert";
import * as core from "@theatre/core";

test("theatre_integration", async (t) => {
  await t.test("Theatre sheet can be created and values round-trip", () => {
    const project = (core.getProject || core.default.getProject)("TestProject");
    const sheet = project.sheet("Scene");
    
    // Create an object and set a value
    const obj = sheet.object("Camera", {
      position: { x: 0, y: 0, z: 5 },
      fov: 50
    });
    
    // Simulate setting a keyframe or value. In core without studio, we just read the initial value.
    const currentPos = obj.value.position;
    assert.strictEqual(currentPos.x, 0);
    assert.strictEqual(currentPos.z, 5);
    assert.strictEqual(obj.value.fov, 50);
    
    // Test that we can round-trip through JSON using standard serialization of the value
    const savedValue = JSON.stringify(obj.value);
    const parsedValue = JSON.parse(savedValue);
    
    assert.strictEqual(parsedValue.position.z, 5);
    assert.strictEqual(parsedValue.fov, 50);
  });
});
