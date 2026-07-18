import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { 
  initDb, 
  getPool, 
  dbConfigured,
  reservePipelineSessionForBuild,
  commitPipelineSessionBuild,
  markPipelineSessionRecoveryRequired,
  recoverPipelineSession,
  getPipelineSessionByProviderHandle,
  deductCredits
} from "../db.js";

// Ensure it skips cleanly when not opted in.
const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
if (!RUN_INTEGRATION) {
  test("Hostinger DB Integration Tests", (t) => {
    t.skip("Skipping DB integration test. RUN_DB_INTEGRATION!=1");
  });
} else {
  // Guard to ensure we don't accidentally run this against a production database.
  if (process.env.DB_INTEGRATION_DATABASE !== "staging") {
    console.error("CRITICAL: DB_INTEGRATION_DATABASE must be set to 'staging' to prevent running tests against production.");
    process.exit(1);
  }

  if (!dbConfigured()) {
    console.error("CRITICAL: DB environment variables are missing but RUN_DB_INTEGRATION is enabled.");
    process.exit(1);
  }

  test("Hostinger DB Integration Tests", async (t) => {
    // Generate unique prefixes to ensure we don't collide with any actual data
    // even in a staging environment.
    const testRunId = crypto.randomUUID().split("-")[0];
    const testPhone = `+15555${testRunId}`;
    
    // Setup Phase
    await t.test("Setup: Run migrations and create test user", async () => {
      // 1. Run migrations safely against Hostinger staging
      await initDb();
      
      const pool = getPool();
      
      // Verify Enum Values remain intact
      const dbName = process.env.DB_NAME;
      const [cols] = await pool.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'create_pipeline_sessions' AND COLUMN_NAME = 'status'`,
        [dbName]
      );
      
      const enumDef = cols[0]?.COLUMN_TYPE || "";
      assert.ok(enumDef.includes("build_starting"), "build_starting enum state should exist");
      assert.ok(enumDef.includes("recovery_required"), "recovery_required enum state should exist");
      assert.ok(enumDef.includes("reference_ready"), "reference_ready enum state should remain intact");

      // Verify provider_handle exists
      const [handleCols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'create_pipeline_sessions' AND COLUMN_NAME = 'provider_handle'`,
        [dbName]
      );
      assert.strictEqual(handleCols.length, 1, "provider_handle column should exist");

      // Setup user and a dummy session row manually for testing state machine
      await pool.query(
        `INSERT INTO users (phone, credits, profile_complete) VALUES (?, ?, 1)`,
        [testPhone, 100]
      );
    });

    try {
      await t.test("Concurrency: Exactly one PupCoins deduction for identical idempotency requests", async () => {
        const pool = getPool();
        const sessionId = `test_sess_${testRunId}_conc`;
        const idempotencyKey = `idem_${testRunId}`;
        const cost = 20;
        
        // Insert starting session
        await pool.query(
          `INSERT INTO create_pipeline_sessions (session_id, user_phone, status, is_printable) 
           VALUES (?, ?, 'reference_ready', 1)`,
          [sessionId, testPhone]
        );

        // Fire 5 concurrent requests
        const results = await Promise.all([
          reservePipelineSessionForBuild(sessionId, testPhone, idempotencyKey, cost),
          reservePipelineSessionForBuild(sessionId, testPhone, idempotencyKey, cost),
          reservePipelineSessionForBuild(sessionId, testPhone, idempotencyKey, cost),
          reservePipelineSessionForBuild(sessionId, testPhone, idempotencyKey, cost),
          reservePipelineSessionForBuild(sessionId, testPhone, idempotencyKey, cost),
        ]);

        // Exactly one should succeed. The rest should return the same result (already Reserved) safely,
        // without deducting multiple times.
        const successes = results.filter(r => r.success);
        const alreadyReserved = results.filter(r => r.alreadyReservedOrBuilding);
        
        assert.ok(successes.length === 1 || alreadyReserved.length > 0, "Should have a successful reservation or idempotency catch.");
        
        // Verify balance. Started with 100, cost is 20, should be exactly 80.
        const [rows] = await pool.query(`SELECT credits FROM users WHERE phone = ?`, [testPhone]);
        assert.strictEqual(rows[0].credits, 80, "Balance must be exactly 80, indicating a single deduction.");
        
        // Test different idempotency key returns 409
        const diffRes = await reservePipelineSessionForBuild(sessionId, testPhone, "different_key", cost);
        assert.strictEqual(diffRes.success, false, "Should fail with different key");
        assert.strictEqual(diffRes.error, "Concurrency conflict: another build process is already holding this session.");
        
        // Verify balance hasn't dropped further
        const [rows2] = await pool.query(`SELECT credits FROM users WHERE phone = ?`, [testPhone]);
        assert.strictEqual(rows2.credits, 80, "Balance should still be 80 after failed concurrent attempt.");
      });

      await t.test("Recovery: Lookup and finalization are idempotent (no duplicate creations)", async () => {
        const pool = getPool();
        const sessionId = `test_sess_${testRunId}_rec`;
        const idempotencyKey = `idem_rec_${testRunId}`;
        const providerHandle = `tripo_${testRunId}`;
        const cost = 20;

        await pool.query(
          `INSERT INTO create_pipeline_sessions (session_id, user_phone, status, is_printable) 
           VALUES (?, ?, 'reference_ready', 1)`,
          [sessionId, testPhone]
        );

        // Reserve it
        await reservePipelineSessionForBuild(sessionId, testPhone, idempotencyKey, cost);

        // Mark it as recovery required because "DB finalization failed"
        const recRes = await markPipelineSessionRecoveryRequired(sessionId, testPhone, providerHandle);
        assert.strictEqual(recRes.success, true, "Should successfully transition to recovery_required");

        // Verify lookup by provider_handle works
        const sessionRec = await getPipelineSessionByProviderHandle(providerHandle);
        assert.ok(sessionRec, "Should find session by provider handle");
        assert.strictEqual(sessionRec.session_id, sessionId, "Should match session ID");
        assert.strictEqual(sessionRec.status, "recovery_required", "Should be in recovery status");

        // Recover it (simulate the manual/sweep recovery)
        const commitPayload = { media_type: "model", style: "realistic", image_url: "fake" };
        const recoverRes = await recoverPipelineSession(sessionId, testPhone, commitPayload, {
          camera_position: [0, 0, 5],
          camera_target: [0, 0, 0]
        });

        assert.strictEqual(recoverRes.success, true, "Should successfully recover session");

        // Run recovery a second time to ensure idempotency
        const duplicateRes = await recoverPipelineSession(sessionId, testPhone, commitPayload, {
          camera_position: [0, 0, 5],
          camera_target: [0, 0, 0]
        });
        
        assert.strictEqual(duplicateRes.success, true, "Second recovery attempt should return success safely");

        // Verify only ONE creations row was made
        const [creationRows] = await pool.query(
          `SELECT id FROM creations WHERE user_phone = ? AND image_url = 'fake'`,
          [testPhone]
        );
        
        assert.strictEqual(creationRows.length, 1, "Should have exactly ONE creations row to prevent duplicates");
      });

    } finally {
      // Cleanup Phase - regardless of success or failure
      console.log(`Cleaning up test data for phone: ${testPhone}`);
      const pool = getPool();
      try {
        await pool.query(`DELETE FROM users WHERE phone = ?`, [testPhone]);
        // Foreign keys ON DELETE CASCADE will handle creations, sessions, and jobs
      } catch (err) {
        console.error("Cleanup failed:", err);
      }
    }
  });
}
