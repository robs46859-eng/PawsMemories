import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("storage purchase UI confirms price and keeps one idempotency key per attempt", () => {
  const source = fs.readFileSync("src/components/StorageMeter.tsx", "utf8");
  assert.match(source, /purchaseRequestIdRef/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(source, /const requestId = `purchase_\$\{Date\.now\(\)\}/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /4 PupCoins/);
  assert.match(source, /Purchase 1 GB/);
  assert.doesNotMatch(source, /\(4 cr\)/);
});

test("cold-storage grant and PupCoin deduction share one owner-scoped transaction", () => {
  const source = fs.readFileSync("db.ts", "utf8");
  const start = source.indexOf("export async function purchaseColdStorage");
  const body = source.slice(start, start + 3500);
  assert.match(body, /beginTransaction\(\)/);
  assert.match(body, /SELECT credits FROM users WHERE phone = \? FOR UPDATE/);
  assert.match(body, /user_phone = \? AND reason = \?/);
  assert.match(body, /INSERT INTO credit_transactions/);
  assert.match(body, /commit\(\)/);
  assert.match(body, /rollback\(\)/);
});
