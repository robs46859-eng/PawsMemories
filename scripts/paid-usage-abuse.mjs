import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const REQUIRED_ACK = "staging-only";
const dbName = process.env.DB_NAME ?? "";
const safeDbName = dbName.toLowerCase().includes("test") || dbName.toLowerCase().includes("staging");

if (process.env.ABUSE_TEST_ACK !== REQUIRED_ACK || !safeDbName) {
  console.error("ABUSE TEST REFUSED: staging acknowledgement and database name checks failed.");
  console.error("Required: ABUSE_TEST_ACK=staging-only and DB_NAME containing 'test' or 'staging'.");
  process.exit(2);
}

const { getPool, reservePaidUsage } = await import("../db.ts");
const { PAID_ENDPOINTS } = await import("../server/paidApiGuards.ts");

const endpoint = PAID_ENDPOINTS.find((candidate) => candidate === "pawprint");
assert.equal(endpoint, "pawprint", "pawprint must remain a type-valid PaidEndpoint");

const ATTEMPTS = 24;
const ESTIMATED_COST_MICRO_USD = 1_000;
const runId = `abuse_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
const ownerMarker = `Paid usage abuse test ${runId}`;
const pool = getPool();
const ownedUsers = new Map();
const initialGlobalRowExistence = new Map();
let interrupted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    process.exitCode = 130;
    console.error(`Received ${signal}; finishing database cleanup before exit.`);
  });
}

function asSafeCounter(raw, label) {
  const value = Number(raw ?? 0);
  assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a safe non-negative integer`);
  return value;
}

async function readGlobalUsage(connection = pool) {
  const [rows] = await connection.query(
    `SELECT DATE_FORMAT(clock.day, '%Y-%m-%d') AS day,
            usage.count,
            usage.reserved_cost_micro_usd
     FROM (SELECT UTC_DATE() AS day) AS clock
     LEFT JOIN api_usage_global_daily AS usage
       ON usage.endpoint = ? AND usage.day = clock.day`,
    [endpoint],
  );
  const row = rows[0];
  const exists = row.count != null;
  return {
    day: row.day,
    exists,
    count: exists ? asSafeCounter(row.count, "global count") : 0,
    reservedCostMicroUsd: asSafeCounter(
      exists ? row.reserved_cost_micro_usd : 0,
      "global reserved cost",
    ),
  };
}

async function readUserUsage(phone, day) {
  const [rows] = await pool.query(
    `SELECT count
     FROM api_usage_daily
     WHERE user_phone = ? AND endpoint = ? AND day = ?`,
    [phone, endpoint, day],
  );
  return rows.length === 0 ? 0 : asSafeCounter(rows[0].count, "user count");
}

async function createOwnedUser(suffix) {
  const phone = `${runId}_${suffix}`;
  assert.ok(phone.length <= 32, "generated user key must fit users.phone");
  await pool.query(
    `INSERT INTO users (phone, full_name) VALUES (?, ?)`,
    [phone, ownerMarker],
  );
  ownedUsers.set(phone, ESTIMATED_COST_MICRO_USD);
  return phone;
}

async function runScenario({ label, suffix, expectedAllowed, expectedReason, makeLimits }) {
  if (interrupted) throw new Error("Abuse test interrupted");

  const before = await readGlobalUsage();
  if (!initialGlobalRowExistence.has(before.day)) {
    initialGlobalRowExistence.set(before.day, before.exists);
  }
  const phone = await createOwnedUser(suffix);
  const limits = makeLimits(before);
  const settledReservations = await Promise.allSettled(
    Array.from({ length: ATTEMPTS }, () => reservePaidUsage(phone, endpoint, limits)),
  );
  const rejectedReservations = settledReservations.filter((result) => result.status === "rejected");
  if (rejectedReservations.length > 0) {
    throw new AggregateError(
      rejectedReservations.map((result) => result.reason),
      `${label}: ${rejectedReservations.length} reservation calls rejected`,
    );
  }
  const reservations = settledReservations.map((result) => result.value);
  const after = await readGlobalUsage();
  assert.equal(after.day, before.day, `${label}: UTC day changed during the scenario; rerun it`);
  const userCount = await readUserUsage(phone, before.day);
  const allowed = reservations.filter((reservation) => reservation.allowed);
  const denied = reservations.filter((reservation) => !reservation.allowed);

  assert.equal(allowed.length, expectedAllowed, `${label}: allowed reservation count`);
  assert.equal(userCount, expectedAllowed, `${label}: persisted user count`);
  assert.equal(after.count - before.count, expectedAllowed, `${label}: global count delta`);
  assert.equal(
    after.reservedCostMicroUsd - before.reservedCostMicroUsd,
    expectedAllowed * limits.estimatedCostMicroUsd,
    `${label}: global cost delta`,
  );
  assert.ok(userCount <= limits.userDailyCap, `${label}: user cap exceeded`);
  assert.ok(after.count <= limits.globalDailyCap, `${label}: global cap exceeded`);
  assert.ok(
    after.reservedCostMicroUsd <= limits.globalDailyCostMicroUsd,
    `${label}: global cost cap exceeded`,
  );

  for (const reservation of reservations) {
    assert.ok(reservation.userCount <= limits.userDailyCap, `${label}: returned user count exceeded cap`);
    assert.ok(
      reservation.globalCount <= limits.globalDailyCap,
      `${label}: returned global count exceeded cap`,
    );
    assert.ok(
      reservation.globalReservedCostMicroUsd <= limits.globalDailyCostMicroUsd,
      `${label}: returned cost exceeded cap`,
    );
  }
  for (const reservation of denied) {
    assert.equal(reservation.reason, expectedReason, `${label}: denial reason`);
  }

  console.log(`[PASS] ${label}: ${allowed.length} allowed, ${denied.length} denied (${expectedReason}).`);
}

async function cleanupOwnedRows() {
  if (ownedUsers.size === 0) return;

  const phones = [...ownedUsers.keys()];
  const placeholders = phones.map(() => "?").join(", ");
  const [dayRows] = await pool.query(
    `SELECT DISTINCT DATE_FORMAT(day, '%Y-%m-%d') AS day
     FROM api_usage_daily
     WHERE endpoint = ? AND user_phone IN (${placeholders})
     ORDER BY day`,
    [endpoint, ...phones],
  );
  const days = dayRows.map((row) => row.day);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    for (const day of days) {
      await connection.query(
        `SELECT count, reserved_cost_micro_usd
         FROM api_usage_global_daily
         WHERE endpoint = ? AND day = ?
         FOR UPDATE`,
        [endpoint, day],
      );
    }
    const [usageRows] = await connection.query(
      `SELECT user_phone, DATE_FORMAT(day, '%Y-%m-%d') AS day, count
       FROM api_usage_daily
       WHERE endpoint = ? AND user_phone IN (${placeholders})
       FOR UPDATE`,
      [endpoint, ...phones],
    );

    let ownedCount = 0;
    const usageByDay = new Map();
    for (const row of usageRows) {
      const count = asSafeCounter(row.count, `owned count for ${row.user_phone}`);
      const estimatedCost = ownedUsers.get(row.user_phone);
      assert.equal(
        estimatedCost,
        ESTIMATED_COST_MICRO_USD,
        `unexpected owned user ${row.user_phone}`,
      );
      ownedCount += count;
      const dayUsage = usageByDay.get(row.day) ?? { count: 0, costMicroUsd: 0 };
      dayUsage.count += count;
      dayUsage.costMicroUsd += count * estimatedCost;
      usageByDay.set(row.day, dayUsage);
    }

    await connection.query(
      `DELETE FROM api_usage_daily
       WHERE endpoint = ? AND user_phone IN (${placeholders})`,
      [endpoint, ...phones],
    );

    for (const [day, usage] of usageByDay) {
      const [result] = await connection.query(
        `UPDATE api_usage_global_daily
         SET count = count - ?, reserved_cost_micro_usd = reserved_cost_micro_usd - ?
         WHERE endpoint = ? AND day = ?
           AND count >= ? AND reserved_cost_micro_usd >= ?`,
        [usage.count, usage.costMicroUsd, endpoint, day, usage.count, usage.costMicroUsd],
      );
      assert.equal(result.affectedRows, 1, `could not subtract owned global usage safely for ${day}`);
    }

    const [deletedUsers] = await connection.query(
      `DELETE FROM users WHERE full_name = ? AND phone IN (${placeholders})`,
      [ownerMarker, ...phones],
    );
    assert.equal(deletedUsers.affectedRows, phones.length, "all owned test users must be deleted");

    for (const day of days) {
      if (initialGlobalRowExistence.get(day) === false) {
        await connection.query(
          `DELETE FROM api_usage_global_daily
           WHERE endpoint = ? AND day = ? AND count = 0 AND reserved_cost_micro_usd = 0`,
          [endpoint, day],
        );
      }
    }

    const [remainingRows] = await connection.query(
      `SELECT COUNT(*) AS count FROM users WHERE full_name = ? AND phone IN (${placeholders})`,
      [ownerMarker, ...phones],
    );
    assert.equal(asSafeCounter(remainingRows[0].count, "remaining owned users"), 0);

    await connection.commit();
    console.log(`[CLEANUP] Removed ${phones.length} test users and ${ownedCount} paid-usage reservations.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

let testError;
let cleanupError;

try {
  const initial = await readGlobalUsage();
  initialGlobalRowExistence.set(initial.day, initial.exists);
  console.log(
    `Paid-usage abuse test ${runId} targeting ${process.env.DB_HOST ?? "localhost"}/${dbName}.`,
  );

  await runScenario({
    label: "user cap",
    suffix: "user",
    expectedAllowed: 3,
    expectedReason: "user_cap",
    makeLimits: (baseline) => ({
      userDailyCap: 3,
      globalDailyCap: baseline.count + ATTEMPTS,
      estimatedCostMicroUsd: ESTIMATED_COST_MICRO_USD,
      globalDailyCostMicroUsd: baseline.reservedCostMicroUsd + ATTEMPTS * ESTIMATED_COST_MICRO_USD,
    }),
  });
  await runScenario({
    label: "global cap",
    suffix: "global",
    expectedAllowed: 4,
    expectedReason: "global_cap",
    makeLimits: (baseline) => ({
      userDailyCap: ATTEMPTS,
      globalDailyCap: baseline.count + 4,
      estimatedCostMicroUsd: ESTIMATED_COST_MICRO_USD,
      globalDailyCostMicroUsd: baseline.reservedCostMicroUsd + ATTEMPTS * ESTIMATED_COST_MICRO_USD,
    }),
  });
  await runScenario({
    label: "global cost cap",
    suffix: "cost",
    expectedAllowed: 3,
    expectedReason: "global_cost_cap",
    makeLimits: (baseline) => ({
      userDailyCap: ATTEMPTS,
      globalDailyCap: baseline.count + ATTEMPTS,
      estimatedCostMicroUsd: ESTIMATED_COST_MICRO_USD,
      globalDailyCostMicroUsd: baseline.reservedCostMicroUsd + 3 * ESTIMATED_COST_MICRO_USD,
    }),
  });

  if (interrupted) throw new Error("Abuse test interrupted");
} catch (error) {
  testError = error;
} finally {
  try {
    await cleanupOwnedRows();
  } catch (error) {
    cleanupError = error;
  }
  await pool.end();
}

if (testError || cleanupError) {
  console.error("ABUSE TEST FAILED.");
  if (testError) console.error(testError);
  if (cleanupError) console.error("Cleanup failed:", cleanupError);
  process.exitCode = process.exitCode || 1;
} else {
  console.log("ABUSE TEST PASS: user, global, and cost caps were never exceeded.");
}
