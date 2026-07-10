import test from "node:test";
import assert from "node:assert";
import { parseJobFile, enqueue } from "../server/animator/queue.ts";
import { v4 as uuidv4 } from "uuid";

test("animator_jobs - parseJobFile", async (t) => {
  await t.test("parses valid job", () => {
    const validJson = JSON.stringify({
      id: uuidv4(),
      userPhone: "+1234567890",
      assetId: uuidv4(),
      type: "convert",
      preset: "safe",
      params: {},
      createdAt: new Date().toISOString(),
      state: "pending"
    });
    const parsed = parseJobFile(validJson);
    assert.strictEqual(parsed.type, "convert");
    assert.strictEqual(parsed.state, "pending");
  });

  await t.test("rejects invalid state", () => {
    const invalidJson = JSON.stringify({
      id: uuidv4(),
      userPhone: "+1234567890",
      assetId: uuidv4(),
      type: "convert",
      preset: "safe",
      params: {},
      createdAt: new Date().toISOString(),
      state: "invalid_state"
    });
    assert.throws(() => parseJobFile(invalidJson), /Invalid option/);
  });
});
