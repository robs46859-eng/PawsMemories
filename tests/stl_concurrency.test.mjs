import assert from "node:assert/strict";
import test from "node:test";

test("STL derivative duplicate key conflict reconciliation and object cleanup", async () => {
  let objectDeleted = false;
  let deletedKey = "";

  const mockDeletePrivateObject = async (key) => {
    objectDeleted = true;
    deletedKey = key;
  };

  const storedAssets = [];
  const listingId = 42;
  const targetMm = 100;
  const losingKey = "private/stl-losing-123.stl";
  const winningKey = "private/stl-winning-456.stl";

  // Simulate Request A (Winner)
  storedAssets.push({
    listing_id: listingId,
    kind: "stl_derivative",
    object_key: winningKey,
    derivative_height_mm: targetMm,
    status: "active",
  });

  // Simulate Request B (Loser) trying to insert losingKey
  const simulateRequestBInsert = async (newKey) => {
    try {
      const exists = storedAssets.some(
        (a) =>
          a.listing_id === listingId &&
          a.derivative_height_mm === targetMm &&
          a.status === "active",
      );
      if (exists) {
        const err = new Error("Duplicate entry for key 'uniq_stl_active_derivative'");
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
      storedAssets.push({
        listing_id: listingId,
        kind: "stl_derivative",
        object_key: newKey,
        derivative_height_mm: targetMm,
        status: "active",
      });
    } catch (persistError) {
      await mockDeletePrivateObject(newKey);

      const isDuplicate =
        persistError?.code === "ER_DUP_ENTRY" ||
        /duplicate/i.test(persistError?.message || "");

      if (isDuplicate) {
        const winningRow = storedAssets.find(
          (a) =>
            a.listing_id === listingId &&
            a.kind === "stl_derivative" &&
            a.status === "active" &&
            a.derivative_height_mm === targetMm,
        );
        if (winningRow) {
          return { resolvedKey: winningRow.object_key };
        }
      }
      throw persistError;
    }
  };

  const res = await simulateRequestBInsert(losingKey);
  assert.equal(res.resolvedKey, winningKey, "Losing request must resolve winning derivative object key");
  assert.equal(objectDeleted, true, "Losing request must delete newly uploaded private object");
  assert.equal(deletedKey, losingKey, "Deleted object key must match losing object key");
});
