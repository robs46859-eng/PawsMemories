import assert from "node:assert/strict";
import test from "node:test";

import { GenerateVideosOperation } from "@google/genai";
import {
  LEGACY_VEO_OPERATION_RECONSTRUCTION_ERROR,
  getPersistedVeoOperation,
} from "../server/veoOperation.ts";

test("persisted Veo names are restored as SDK operations before polling", async () => {
  const expected = new GenerateVideosOperation();
  expected.name = "operations/updated-operation";
  expected.done = false;
  let received;

  const result = await getPersistedVeoOperation(
    {
      async getVideosOperation({ operation }) {
        received = operation;
        return expected;
      },
    },
    "  operations/persisted-operation  ",
  );

  assert.ok(received instanceof GenerateVideosOperation);
  assert.equal(received.name, "operations/persisted-operation");
  assert.equal(typeof received._fromAPIResponse, "function");
  assert.equal(result, expected);
});

test("blank persisted Veo operation names are rejected before an SDK call", async () => {
  let calls = 0;
  await assert.rejects(
    () => getPersistedVeoOperation(
      {
        async getVideosOperation() {
          calls += 1;
          return new GenerateVideosOperation();
        },
      },
      "   ",
    ),
    /operation name is required/i,
  );
  assert.equal(calls, 0);
});

test("legacy recovery targets only the exact SDK reconstruction failure", () => {
  assert.equal(
    LEGACY_VEO_OPERATION_RECONSTRUCTION_ERROR,
    "operation._fromAPIResponse is not a function",
  );
});
