import assert from "node:assert/strict";
import test from "node:test";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  process.env.JWT_SECRET = "super_secret_jwt_key_for_testing_12345";
}

import { formatReadinessResponse } from "../server.ts";

test("production formatReadinessResponse sanitizes raw database errors and credentials", () => {
  const sensitiveError = "Access denied for user 'db_admin_user'@'10.0.0.5' (using password: YES) to database 'paws_prod_db'";
  const dbHealth = {
    configured: true,
    healthy: false,
    latencyMs: 12,
    error: sensitiveError,
  };

  const response = formatReadinessResponse(dbHealth, { version: "1.0.0", commit: "abc", schemaVersion: 17 });

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.status, "not_ready");
  assert.equal(response.body.database.reason, "database_unavailable");
  assert.equal(response.body.database.healthy, false);

  const resJson = JSON.stringify(response.body);
  assert.equal(resJson.includes("db_admin_user"), false, "Must not leak database username");
  assert.equal(resJson.includes("10.0.0.5"), false, "Must not leak database hostname/IP");
  assert.equal(resJson.includes("paws_prod_db"), false, "Must not leak database name");
  assert.equal(resJson.includes("password"), false, "Must not leak password references");
});
