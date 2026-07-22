import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_STL_DERIVATIVE_INDEX,
  isActiveStlDerivativeConflict,
  normalizeDerivativeHeightMm,
  persistStlDerivativeOrResolveWinner,
} from "../server/marketplaceStl.ts";

test("STL derivative heights use the database DECIMAL(8,2) precision", () => {
  assert.equal(normalizeDerivativeHeightMm(75.004), 75);
  assert.equal(normalizeDerivativeHeightMm(75.005), 75.01);
  assert.equal(normalizeDerivativeHeightMm(75.999), 76);
  assert.throws(() => normalizeDerivativeHeightMm(0), /positive finite/);
  assert.throws(() => normalizeDerivativeHeightMm(Number.NaN), /positive finite/);
});

test("only the active STL derivative index is treated as a recoverable race", () => {
  assert.equal(
    isActiveStlDerivativeConflict({
      code: "ER_DUP_ENTRY",
      message: `Duplicate entry for key '${ACTIVE_STL_DERIVATIVE_INDEX}'`,
    }),
    true,
  );
  assert.equal(
    isActiveStlDerivativeConflict({
      code: "ER_DUP_ENTRY",
      message: "Duplicate entry for key 'uniq_marketplace_asset_uuid'",
    }),
    false,
  );
  assert.equal(isActiveStlDerivativeConflict(new Error("duplicate request")), false);
});

test("production persistence cleans the loser and resolves the normalized winner", async () => {
  const deleted = [];
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("INSERT")) {
        const error = new Error(`Duplicate entry for key '${ACTIVE_STL_DERIVATIVE_INDEX}'`);
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      return [[{ object_key: "marketplace/listing/winner.stl" }]];
    },
  };

  const result = await persistStlDerivativeOrResolveWinner({
    db,
    deleteObject: async (key) => deleted.push(key),
    listingId: 42,
    assetUuid: "loser-uuid",
    stored: { objectKey: "marketplace/listing/loser.stl", sizeBytes: 123, sha256: "abc" },
    targetHeightMm: 75.005,
  });

  assert.deepEqual(result, { objectKey: "marketplace/listing/winner.stl", wonRace: false });
  assert.deepEqual(deleted, ["marketplace/listing/loser.stl"]);
  assert.equal(calls[0].values.at(-1), 75.01);
  assert.equal(calls[1].values.at(-1), 75.01);
  assert.match(calls[1].sql, /generated_active_height = \?/);
});

test("unrelated persistence failures clean storage and remain fatal", async () => {
  const deleted = [];
  const unrelated = Object.assign(
    new Error("Duplicate entry for key 'uniq_marketplace_asset_uuid'"),
    { code: "ER_DUP_ENTRY" },
  );
  const db = { query: async () => { throw unrelated; } };

  await assert.rejects(
    persistStlDerivativeOrResolveWinner({
      db,
      deleteObject: async (key) => deleted.push(key),
      listingId: 42,
      assetUuid: "duplicate-uuid",
      stored: { objectKey: "marketplace/listing/orphan.stl", sizeBytes: 123, sha256: "abc" },
      targetHeightMm: 75,
    }),
    (error) => error === unrelated,
  );
  assert.deepEqual(deleted, ["marketplace/listing/orphan.stl"]);
});
