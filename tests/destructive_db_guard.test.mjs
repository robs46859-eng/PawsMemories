import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../clear-db.ts", import.meta.url), "utf8");

test("database clear utility is production-disabled and user-scoped", () => {
  assert.match(source, /NODE_ENV === ["']production["']/);
  assert.match(source, /ALLOW_DESTRUCTIVE_DB_CLEAR/);
  assert.match(source, /DB_CLEAR_USER_PHONE/);
  assert.match(source, /DB_CLEAR_BACKUP_REF/);
  assert.doesNotMatch(source, /DELETE FROM (creations|avatars|photo_requests)["'`]/);
  assert.match(source, /DELETE FROM creations WHERE user_phone = \?/);
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /rollback\(\)/);
});
