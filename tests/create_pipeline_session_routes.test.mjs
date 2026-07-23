import test from "node:test";
import assert from "node:assert/strict";

import { resolveOwnedReferenceSession } from "../server/createPipelineSession.ts";

test("a missing client session receives a server-generated id", async () => {
  const result = await resolveOwnedReferenceSession(undefined, "user-a", async () => null, () => "fresh-id");
  assert.equal(result.id, "fresh-id");
  assert.equal(result.session, null);
});

test("an owned editable session can be resumed", async () => {
  const owned = { id: "owned-id", user_phone: "user-a", status: "reference_ready" };
  const result = await resolveOwnedReferenceSession("owned-id", "user-a", async () => owned, () => "fresh-id");
  assert.equal(result.id, "owned-id");
  assert.equal(result.session, owned);
});

test("a stale or foreign client session id is replaced, never adopted", async () => {
  const result = await resolveOwnedReferenceSession("foreign-id", "user-a", async () => null, () => "fresh-id");
  assert.equal(result.id, "fresh-id");
  assert.equal(result.session, null);
});
