import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import {
  AnnualIncentivePolicySchema,
  PaymentCoverageSchema,
  SealedWagsPackVersionSchema,
  WagsSubscriptionSchema,
  type ExistingGrant,
  type PaymentCoverage,
  type PlannedGrant,
  type SealedWagsPackVersion,
  type WagsSubscription,
} from "./contracts.ts";
import {
  CheckoutReservationSchema,
  PublicUuidSchema,
  PublishedPackPageSchema,
  WagsCheckoutPlanRecordSchema,
  WagsSubscriptionRecordSchema,
  type CheckoutReservation,
  type CreateCheckoutRequest,
  type ListPublishedPacksQuery,
  type PublishedPackPage,
  type WagsCheckoutPlanRecord,
  type WagsSubscriptionRecord,
} from "./apiContracts.ts";
import type {
  CompleteCheckoutInput,
  ReserveCheckoutInput,
  WagsApiRepositoryPort,
  WagsSubscriptionTransactionPort,
} from "./repository.ts";
import type {
  WagsDeliveryHeader,
  WagsDeliveryTransactionPort,
} from "./ports.ts";
import { hashIdentity } from "./identity.ts";
import { buildMonthlyEntitlementPeriods } from "./entitlements.ts";

type Queryable = mysql.Pool | mysql.PoolConnection;

interface CursorValue {
  publishedAt: string;
  packUuid: string;
  versionNumber: number;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function sqlDate(value: Date | string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid database timestamp.");
  return parsed;
}

function parseJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): CursorValue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorValue>;
    return {
      publishedAt: iso(String(parsed.publishedAt)),
      packUuid: PublicUuidSchema.parse(parsed.packUuid),
      versionNumber: Number(parsed.versionNumber),
    };
  } catch {
    throw new Error("Invalid Wags catalog cursor.");
  }
}

function isDuplicateKey(error: unknown): boolean {
  return !!error && typeof error === "object" && Number((error as { errno?: unknown }).errno) === 1062;
}

function affectedRows(result: unknown): number {
  return Number((result as { affectedRows?: unknown })?.affectedRows || 0);
}

function mapCheckout(row: any): CheckoutReservation {
  return CheckoutReservationSchema.parse({
    checkoutUuid: row.checkout_uuid,
    ownerUuid: row.owner_uuid,
    requestHash: row.request_hash,
    state: row.state,
    providerSessionRef: row.provider_session_ref || null,
    checkoutUrl: row.checkout_url || null,
    expiresAt: row.expires_at ? iso(row.expires_at) : null,
  });
}

async function appliedEventIds(db: Queryable, subscriptionId: number): Promise<string[]> {
  const [rows]: any = await db.query(
    `SELECT provider_event_id
       FROM wags_lifecycle_events_v2
      WHERE subscription_id = ? AND processed_at IS NOT NULL
      ORDER BY occurred_at, id
      LIMIT 2000`,
    [subscriptionId],
  );
  return rows.map((row: any) => String(row.provider_event_id));
}

async function mapSubscription(db: Queryable, row: any): Promise<WagsSubscriptionRecord> {
  return WagsSubscriptionRecordSchema.parse({
    schemaVersion: "wags.subscription.v1",
    subscriptionUuid: row.subscription_uuid,
    ownerUuid: row.owner_uuid,
    planUuid: row.plan_uuid,
    planVersionNumber: Number(row.plan_version_number),
    cadence: row.cadence,
    status: row.status,
    serviceStartsAt: iso(row.service_starts_at),
    serviceEndsAt: iso(row.service_ends_at),
    cancelEffectiveAt: row.cancel_effective_at ? iso(row.cancel_effective_at) : null,
    lastLifecycleEventAt: row.last_lifecycle_event_at ? iso(row.last_lifecycle_event_at) : null,
    appliedEventIds: await appliedEventIds(db, Number(row.id)),
    providerSubscriptionRef: row.provider_subscription_ref,
  });
}

async function subscriptionRow(
  db: Queryable,
  subscriptionUuid: string,
  ownerUuid?: string,
  forUpdate = false,
): Promise<any | null> {
  const params: unknown[] = [PublicUuidSchema.parse(subscriptionUuid)];
  let ownerClause = "";
  if (ownerUuid) {
    ownerClause = " AND oi.owner_uuid = ?";
    params.push(PublicUuidSchema.parse(ownerUuid));
  }
  const [rows]: any = await db.query(
    `SELECT s.*, oi.owner_uuid, p.plan_uuid, p.version_number AS plan_version_number
       FROM wags_subscriptions_v2 s
       JOIN wags_owner_identities_v2 oi ON oi.id = s.owner_identity_id
       JOIN wags_plan_versions_v2 p ON p.id = s.plan_version_id
      WHERE s.subscription_uuid = ?${ownerClause}
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    params,
  );
  return rows[0] || null;
}

/**
 * Production MySQL implementation. It intentionally targets the hardened
 * migration-28 shape and fails closed if those columns/tables are absent.
 */
export class MysqlWagsApiRepository implements WagsApiRepositoryPort {
  constructor(private readonly pool: mysql.Pool) {}

  async resolveOwnerUuid(authSubject: string): Promise<string> {
    const subject = authSubject.trim();
    if (!subject || subject.length > 190) throw new Error("Invalid authenticated owner subject.");
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows]: any = await connection.query(
        "SELECT owner_uuid FROM wags_owner_identities_v2 WHERE auth_subject = ? FOR UPDATE",
        [subject],
      );
      if (rows[0]) {
        await connection.commit();
        return PublicUuidSchema.parse(rows[0].owner_uuid);
      }
      const ownerUuid = crypto.randomUUID();
      try {
        await connection.query(
          "INSERT INTO wags_owner_identities_v2 (owner_uuid, auth_subject) VALUES (?, ?)",
          [ownerUuid, subject],
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const [winner]: any = await connection.query(
          "SELECT owner_uuid FROM wags_owner_identities_v2 WHERE auth_subject = ? FOR UPDATE",
          [subject],
        );
        if (!winner[0]) throw error;
        await connection.commit();
        return PublicUuidSchema.parse(winner[0].owner_uuid);
      }
      await connection.commit();
      return ownerUuid;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getStripeCheckoutMetadata(checkoutUuid: string, ownerUuid: string): Promise<{
    checkoutUuid: string;
    subscriptionUuid: string;
    ownerUuid: string;
    planUuid: string;
    planVersionNumber: number;
    cadence: CreateCheckoutRequest["cadence"];
  }> {
    const [rows]: any = await this.pool.query(
      `SELECT c.checkout_uuid, oi.owner_uuid, p.plan_uuid, p.version_number AS plan_version_number, p.cadence
         FROM wags_checkout_sessions_v2 c
         JOIN wags_owner_identities_v2 oi ON oi.id = c.owner_identity_id
         JOIN wags_plan_versions_v2 p ON p.id = c.plan_version_id
        WHERE c.checkout_uuid = ? AND oi.owner_uuid = ? AND c.state = 'reserved' LIMIT 1`,
      [PublicUuidSchema.parse(checkoutUuid), PublicUuidSchema.parse(ownerUuid)],
    );
    if (!rows[0]) throw new Error("Durable checkout reservation was not found.");
    return {
      checkoutUuid: rows[0].checkout_uuid,
      subscriptionUuid: deterministicUuid(`wags-subscription:${rows[0].checkout_uuid}`),
      ownerUuid: rows[0].owner_uuid,
      planUuid: rows[0].plan_uuid,
      planVersionNumber: Number(rows[0].plan_version_number),
      cadence: rows[0].cadence,
    };
  }

  async ensureSubscriptionFromStripe(input: {
    checkoutUuid: string;
    subscriptionUuid: string;
    ownerUuid: string;
    planUuid: string;
    planVersionNumber: number;
    cadence: CreateCheckoutRequest["cadence"];
    providerSubscriptionRef: string;
    serviceStartsAt: string;
    serviceEndsAt: string;
  }): Promise<void> {
    const expectedUuid = deterministicUuid(`wags-subscription:${PublicUuidSchema.parse(input.checkoutUuid)}`);
    if (input.subscriptionUuid !== expectedUuid) throw new Error("Stripe subscription identity is not derived from its checkout reservation.");
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [checkouts]: any = await connection.query(
        `SELECT c.owner_identity_id, c.plan_version_id, oi.owner_uuid, p.plan_uuid,
                p.version_number AS plan_version_number, p.cadence
           FROM wags_checkout_sessions_v2 c
           JOIN wags_owner_identities_v2 oi ON oi.id = c.owner_identity_id
           JOIN wags_plan_versions_v2 p ON p.id = c.plan_version_id
          WHERE c.checkout_uuid = ? AND c.state = 'complete' FOR UPDATE`,
        [input.checkoutUuid],
      );
      const checkout = checkouts[0];
      if (!checkout
        || checkout.owner_uuid !== input.ownerUuid
        || checkout.plan_uuid !== input.planUuid
        || Number(checkout.plan_version_number) !== input.planVersionNumber
        || checkout.cadence !== input.cadence) {
        throw new Error("Signed Stripe metadata does not match the durable checkout reservation.");
      }
      const [existing]: any = await connection.query(
        `SELECT s.subscription_uuid, oi.owner_uuid, s.provider_subscription_ref
           FROM wags_subscriptions_v2 s
           JOIN wags_owner_identities_v2 oi ON oi.id = s.owner_identity_id
          WHERE s.subscription_uuid = ? OR (s.provider = 'stripe' AND s.provider_subscription_ref = ?) FOR UPDATE`,
        [input.subscriptionUuid, input.providerSubscriptionRef],
      );
      if (existing[0]) {
        if (existing[0].subscription_uuid !== input.subscriptionUuid
          || existing[0].owner_uuid !== input.ownerUuid
          || existing[0].provider_subscription_ref !== input.providerSubscriptionRef) {
          throw new Error("Stripe subscription is already bound to a different durable identity.");
        }
        await connection.commit();
        return;
      }
      await connection.query(
        `INSERT INTO wags_subscriptions_v2
          (subscription_uuid, owner_identity_id, plan_version_id, cadence, status,
           provider, provider_subscription_ref, service_starts_at, service_ends_at)
         VALUES (?, ?, ?, ?, 'checkout_pending', ?, ?, ?, ?)`,
        [input.subscriptionUuid, checkout.owner_identity_id, checkout.plan_version_id, input.cadence,
          "stripe", input.providerSubscriptionRef, sqlDate(input.serviceStartsAt), sqlDate(input.serviceEndsAt)],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listPublishedPackVersions(query: ListPublishedPacksQuery): Promise<PublishedPackPage> {
    const cursor = decodeCursor(query.cursor);
    const where = ["published_at <= UTC_TIMESTAMP(3)"];
    const params: unknown[] = [];
    if (query.periodKey) {
      where.push("release_period = ?");
      params.push(query.periodKey);
    }
    if (query.tier) {
      where.push("tier = ?");
      params.push(query.tier);
    }
    if (cursor) {
      where.push("(published_at < ? OR (published_at = ? AND (pack_uuid > ? OR (pack_uuid = ? AND version_number > ?))))");
      params.push(sqlDate(cursor.publishedAt), sqlDate(cursor.publishedAt), cursor.packUuid, cursor.packUuid, cursor.versionNumber);
    }
    params.push(query.limit + 1);
    const [rows]: any = await this.pool.query(
      `SELECT pack_uuid, version_number, release_period, title, tier, pack_hash, published_at
         FROM wags_pack_versions_v2
        WHERE ${where.join(" AND ")}
        ORDER BY published_at DESC, pack_uuid, version_number
        LIMIT ?`,
      params,
    );
    const hasMore = rows.length > query.limit;
    const visible = rows.slice(0, query.limit);
    const last = visible.at(-1);
    return PublishedPackPageSchema.parse({
      items: visible.map((row: any) => ({
        packUuid: row.pack_uuid,
        versionNumber: Number(row.version_number),
        releasePeriod: row.release_period,
        title: row.title,
        tier: row.tier,
        packHash: row.pack_hash,
        publishedAt: iso(row.published_at),
      })),
      nextCursor: hasMore && last ? encodeCursor({
        publishedAt: iso(last.published_at),
        packUuid: last.pack_uuid,
        versionNumber: Number(last.version_number),
      }) : null,
    });
  }

  async getPublishedPackVersion(packUuid: string, versionNumber: number): Promise<SealedWagsPackVersion | null> {
    const [rows]: any = await this.pool.query(
      `SELECT pack_json, pack_hash
         FROM wags_pack_versions_v2
        WHERE pack_uuid = ? AND version_number = ? AND published_at <= UTC_TIMESTAMP(3)
        LIMIT 1`,
      [PublicUuidSchema.parse(packUuid), versionNumber],
    );
    if (!rows[0]) return null;
    const pack = parseJson<Record<string, unknown>>(rows[0].pack_json);
    return SealedWagsPackVersionSchema.parse({ ...pack, packHash: rows[0].pack_hash });
  }

  async getSubscriptionForOwner(ownerUuid: string, subscriptionUuid: string): Promise<WagsSubscriptionRecord | null> {
    const row = await subscriptionRow(this.pool, subscriptionUuid, ownerUuid);
    return row ? mapSubscription(this.pool, row) : null;
  }

  async getPaymentCoverageForPeriod(subscriptionUuid: string, startsAt: string, endsAt: string): Promise<PaymentCoverage | null> {
    const [rows]: any = await this.pool.query(
      `SELECT p.payment_uuid, p.status, p.covers_from, p.covers_until
         FROM wags_payment_coverage_v2 p
         JOIN wags_subscriptions_v2 s ON s.id = p.subscription_id
        WHERE s.subscription_uuid = ?
          AND p.covers_from <= ? AND p.covers_until >= ?
        ORDER BY (p.status = 'paid') DESC, p.covers_until DESC
        LIMIT 1`,
      [PublicUuidSchema.parse(subscriptionUuid), sqlDate(startsAt), sqlDate(endsAt)],
    );
    return rows[0] ? this.mapPayment(rows[0]) : null;
  }

  async getPaymentCoverageByUuid(subscriptionUuid: string, paymentUuid: string): Promise<PaymentCoverage | null> {
    const [rows]: any = await this.pool.query(
      `SELECT p.payment_uuid, p.status, p.covers_from, p.covers_until
         FROM wags_payment_coverage_v2 p
         JOIN wags_subscriptions_v2 s ON s.id = p.subscription_id
        WHERE s.subscription_uuid = ? AND p.payment_uuid = ? LIMIT 1`,
      [PublicUuidSchema.parse(subscriptionUuid), PublicUuidSchema.parse(paymentUuid)],
    );
    return rows[0] ? this.mapPayment(rows[0]) : null;
  }

  async listExistingGrants(deliveryIdentity: string): Promise<ExistingGrant[]> {
    const [rows]: any = await this.pool.query(
      `SELECT g.grant_identity, d.delivery_identity, g.slot_key, g.deliverable_json
         FROM wags_grants_v2 g
         JOIN wags_deliveries_v2 d ON d.id = g.delivery_id
        WHERE d.delivery_identity = ? ORDER BY g.id`,
      [deliveryIdentity],
    );
    return rows.map((row: any) => ({
      grantIdentity: row.grant_identity,
      deliveryIdentity: row.delivery_identity,
      slotKey: row.slot_key,
      deliverable: parseJson(row.deliverable_json),
    }));
  }

  async listOwnedDeliverableKeys(ownerUuid: string): Promise<string[]> {
    const owner = PublicUuidSchema.parse(ownerUuid);
    const [rows]: any = await this.pool.query(
      `SELECT DISTINCT owned_key FROM (
         SELECT CONCAT('asset:', a.asset_uuid) AS owned_key
           FROM assets a
           JOIN wags_owner_identities_v2 oi ON oi.auth_subject = a.owner_id
          WHERE oi.owner_uuid = ? AND a.status = 'active'
         UNION ALL
         SELECT CASE
           WHEN g.deliverable_kind = 'asset' THEN CONCAT('asset:', JSON_UNQUOTE(JSON_EXTRACT(g.deliverable_json, '$.assetUuid')))
           WHEN g.deliverable_kind = 'benefit' THEN CONCAT('benefit:', g.benefit_sku)
           ELSE NULL
         END AS owned_key
           FROM wags_grants_v2 g
           JOIN wags_deliveries_v2 d ON d.id = g.delivery_id
           JOIN wags_subscriptions_v2 s ON s.id = d.subscription_id
           JOIN wags_owner_identities_v2 oi ON oi.id = s.owner_identity_id
          WHERE oi.owner_uuid = ?
       ) owned WHERE owned_key IS NOT NULL`,
      [owner, owner],
    );
    return rows.map((row: any) => String(row.owned_key));
  }

  async isPackEligibleForSubscription(subscription: WagsSubscription, pack: SealedWagsPackVersion): Promise<boolean> {
    const [rows]: any = await this.pool.query(
      `SELECT tier, active
         FROM wags_plan_versions_v2
        WHERE plan_uuid = ? AND version_number = ? AND cadence = ? LIMIT 1`,
      [subscription.planUuid, subscription.planVersionNumber, subscription.cadence],
    );
    if (!rows[0] || !Boolean(rows[0].active)) return false;
    return rows[0].tier === "plus" || pack.tier === "basic";
  }

  async getAnnualIncentivePolicy(policyUuid: string, versionNumber: number) {
    const [rows]: any = await this.pool.query(
      `SELECT policy_json FROM wags_incentive_policies_v2
        WHERE policy_uuid = ? AND version_number = ?
          AND active_from <= UTC_TIMESTAMP(3)
          AND (active_until IS NULL OR active_until > UTC_TIMESTAMP(3))
        LIMIT 1`,
      [PublicUuidSchema.parse(policyUuid), versionNumber],
    );
    return rows[0] ? AnnualIncentivePolicySchema.parse(parseJson(rows[0].policy_json)) : null;
  }

  async getCheckoutPlan(planUuid: string, versionNumber: number, cadence: CreateCheckoutRequest["cadence"]): Promise<WagsCheckoutPlanRecord | null> {
    const [rows]: any = await this.pool.query(
      `SELECT plan_uuid, version_number, cadence, active, provider_price_ref
         FROM wags_plan_versions_v2
        WHERE plan_uuid = ? AND version_number = ? AND cadence = ? LIMIT 1`,
      [PublicUuidSchema.parse(planUuid), versionNumber, cadence],
    );
    return rows[0] ? WagsCheckoutPlanRecordSchema.parse({
      planUuid: rows[0].plan_uuid,
      versionNumber: Number(rows[0].version_number),
      cadence: rows[0].cadence,
      active: Boolean(rows[0].active),
      providerPriceRef: rows[0].provider_price_ref,
    }) : null;
  }

  async reserveCheckout(input: ReserveCheckoutInput) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const existing = await this.checkoutByOwnerKey(connection, input.ownerUuid, input.idempotencyKey, true);
      if (existing) {
        await connection.commit();
        return { disposition: "existing" as const, reservation: mapCheckout(existing) };
      }
      const [identities]: any = await connection.query(
        "SELECT id FROM wags_owner_identities_v2 WHERE owner_uuid = ? FOR UPDATE",
        [input.ownerUuid],
      );
      const [plans]: any = await connection.query(
        `SELECT id FROM wags_plan_versions_v2
          WHERE plan_uuid = ? AND version_number = ? AND cadence = ? AND active = TRUE FOR UPDATE`,
        [input.request.planUuid, input.request.planVersionNumber, input.request.cadence],
      );
      if (!identities[0] || !plans[0]) throw new Error("Checkout owner or active plan version was not found.");
      try {
        await connection.query(
          `INSERT INTO wags_checkout_sessions_v2
            (checkout_uuid, owner_identity_id, plan_version_id, idempotency_key, request_hash, request_json, state)
           VALUES (?, ?, ?, ?, ?, ?, 'reserved')`,
          [input.checkoutUuid, identities[0].id, plans[0].id, input.idempotencyKey, input.requestHash,
            JSON.stringify(input.request)],
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const winner = await this.checkoutByOwnerKey(connection, input.ownerUuid, input.idempotencyKey, true);
        if (!winner) throw error;
        await connection.commit();
        return { disposition: "existing" as const, reservation: mapCheckout(winner) };
      }
      const inserted = await this.checkoutByOwnerKey(connection, input.ownerUuid, input.idempotencyKey, true);
      if (!inserted) throw new Error("Checkout reservation was not persisted.");
      await connection.commit();
      return { disposition: "call_provider" as const, reservation: mapCheckout(inserted) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<CheckoutReservation> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const current = await this.checkoutByUuid(connection, input.checkoutUuid, true);
      if (!current) throw new Error("Checkout reservation was not found.");
      if (current.state === "complete") {
        await connection.commit();
        return mapCheckout(current);
      }
      if (current.state !== "reserved") throw new Error("Checkout reservation is not completable.");
      await connection.query(
        `UPDATE wags_checkout_sessions_v2
            SET state = 'complete', provider_session_ref = ?, checkout_url = ?, expires_at = ?, failure_code = NULL
          WHERE id = ?`,
        [input.providerSessionRef, input.checkoutUrl, sqlDate(input.expiresAt), current.id],
      );
      const updated = await this.checkoutByUuid(connection, input.checkoutUuid, false);
      if (!updated) throw new Error("Completed checkout could not be reloaded.");
      await connection.commit();
      return mapCheckout(updated);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async failCheckout(checkoutUuid: string, failureCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE wags_checkout_sessions_v2 SET state = 'failed', failure_code = ?
        WHERE checkout_uuid = ? AND state = 'reserved'`,
      [failureCode.slice(0, 80), PublicUuidSchema.parse(checkoutUuid)],
    );
  }

  async withDeliveryLock<T>(deliveryIdentity: string, work: (transaction: WagsDeliveryTransactionPort) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    const lockName = `wags-delivery:${crypto.createHash("sha256").update(deliveryIdentity).digest("hex").slice(0, 32)}`;
    let locked = false;
    try {
      const [lockRows]: any = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
      locked = Number(lockRows[0]?.acquired) === 1;
      if (!locked) throw new Error("Could not acquire the Wags delivery lock.");
      await connection.beginTransaction();
      const result = await work(new MysqlDeliveryTransaction(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
      connection.release();
    }
  }

  async withSubscriptionLock<T>(subscriptionUuid: string, work: (transaction: WagsSubscriptionTransactionPort) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await subscriptionRow(connection, subscriptionUuid, undefined, true);
      if (!row) throw new Error("Subscription was not found.");
      const result = await work(new MysqlSubscriptionTransaction(connection, row));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async beginReconciliation(input: {
    reconciliationUuid: string;
    subscriptionUuid: string;
    reason: string;
  }): Promise<void> {
    const [result]: any = await this.pool.query(
      `INSERT INTO wags_reconciliation_runs_v2
        (run_uuid, subscription_id, reason, state, started_at)
       SELECT ?, id, ?, 'fetching', UTC_TIMESTAMP(3)
         FROM wags_subscriptions_v2 WHERE subscription_uuid = ?`,
      [input.reconciliationUuid, input.reason, input.subscriptionUuid],
    );
    if (affectedRows(result) !== 1) throw new Error("Reconciliation subscription was not found.");
  }

  async finishReconciliation(input: {
    reconciliationUuid: string;
    providerSnapshotHash?: string;
    providerEventId?: string;
    failureCode?: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE wags_reconciliation_runs_v2
          SET state = ?, snapshot_hash = ?, provider_event_id = ?, failure_code = ?,
              completed_at = CASE WHEN ? IS NULL THEN NULL ELSE UTC_TIMESTAMP(3) END
        WHERE run_uuid = ? AND state = 'fetching'`,
      [input.failureCode ? "failed" : "fetching", input.providerSnapshotHash || null,
        input.providerEventId || null, input.failureCode || null, input.failureCode || null, input.reconciliationUuid],
    );
  }

  private mapPayment(row: any): PaymentCoverage {
    return PaymentCoverageSchema.parse({
      paymentUuid: row.payment_uuid,
      status: row.status,
      coversFrom: iso(row.covers_from),
      coversUntil: iso(row.covers_until),
    });
  }

  private async checkoutByOwnerKey(db: Queryable, ownerUuid: string, key: string, forUpdate: boolean): Promise<any | null> {
    const [rows]: any = await db.query(
      `SELECT c.*, oi.owner_uuid
         FROM wags_checkout_sessions_v2 c
         JOIN wags_owner_identities_v2 oi ON oi.id = c.owner_identity_id
        WHERE oi.owner_uuid = ? AND c.idempotency_key = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [PublicUuidSchema.parse(ownerUuid), key],
    );
    return rows[0] || null;
  }

  private async checkoutByUuid(db: Queryable, checkoutUuid: string, forUpdate: boolean): Promise<any | null> {
    const [rows]: any = await db.query(
      `SELECT c.*, oi.owner_uuid
         FROM wags_checkout_sessions_v2 c
         JOIN wags_owner_identities_v2 oi ON oi.id = c.owner_identity_id
        WHERE c.checkout_uuid = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [PublicUuidSchema.parse(checkoutUuid)],
    );
    return rows[0] || null;
  }
}

class MysqlSubscriptionTransaction implements WagsSubscriptionTransactionPort {
  constructor(private readonly connection: mysql.PoolConnection, private readonly lockedRow: any) {}

  async claimProviderEvent(input: {
    provider: "stripe";
    providerEventId: string;
    eventHash: string;
    subscriptionUuid: string;
    receivedAt: string;
  }): Promise<"inserted" | "existing_same"> {
    if (input.subscriptionUuid !== this.lockedRow.subscription_uuid) throw new Error("Subscription lock identity mismatch.");
    try {
      await this.connection.query(
        `INSERT INTO wags_lifecycle_events_v2
          (subscription_id, provider, source, provider_event_id, event_type, payload_hash,
           event_json, state, occurred_at, received_at)
         VALUES (?, ?, ?, ?, 'normalized_lifecycle', ?, ?, 'received', ?, ?)`,
        [this.lockedRow.id, input.provider, input.providerEventId.startsWith("reconcile:") ? "reconciliation" : "webhook",
          input.providerEventId, input.eventHash,
          JSON.stringify({ provider: input.provider, providerEventId: input.providerEventId, subscriptionUuid: input.subscriptionUuid }),
          sqlDate(input.receivedAt), sqlDate(input.receivedAt)],
      );
      return "inserted";
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const [rows]: any = await this.connection.query(
        `SELECT subscription_id, payload_hash FROM wags_lifecycle_events_v2
          WHERE provider = ? AND provider_event_id = ? FOR UPDATE`,
        [input.provider, input.providerEventId],
      );
      if (!rows[0] || Number(rows[0].subscription_id) !== Number(this.lockedRow.id) || rows[0].payload_hash !== input.eventHash) {
        throw new Error("Provider event identity was reused with a different payload.");
      }
      return "existing_same";
    }
  }

  async getSubscriptionForUpdate(subscriptionUuid: string): Promise<WagsSubscriptionRecord | null> {
    if (subscriptionUuid !== this.lockedRow.subscription_uuid) return null;
    return mapSubscription(this.connection, this.lockedRow);
  }

  async saveSubscription(subscription: WagsSubscription): Promise<void> {
    const value = WagsSubscriptionSchema.parse(subscription);
    if (value.subscriptionUuid !== this.lockedRow.subscription_uuid) throw new Error("Subscription save identity mismatch.");
    await this.connection.query(
      `UPDATE wags_subscriptions_v2
          SET status = ?, service_starts_at = ?, service_ends_at = ?, cancel_effective_at = ?, last_lifecycle_event_at = ?
        WHERE id = ?`,
      [value.status, sqlDate(value.serviceStartsAt), sqlDate(value.serviceEndsAt), value.cancelEffectiveAt ? sqlDate(value.cancelEffectiveAt) : null,
        value.lastLifecycleEventAt ? sqlDate(value.lastLifecycleEventAt) : null, this.lockedRow.id],
    );
    Object.assign(this.lockedRow, {
      status: value.status,
      service_starts_at: value.serviceStartsAt,
      service_ends_at: value.serviceEndsAt,
      cancel_effective_at: value.cancelEffectiveAt,
      last_lifecycle_event_at: value.lastLifecycleEventAt,
    });
  }

  async upsertPaymentCoverage(payment: PaymentCoverage, providerEventId: string): Promise<void> {
    const value = PaymentCoverageSchema.parse(payment);
    const [existing]: any = await this.connection.query(
      `SELECT p.payment_uuid, p.subscription_id, le.provider_event_id
         FROM wags_payment_coverage_v2 p
         JOIN wags_lifecycle_events_v2 le ON le.id = p.lifecycle_event_id
        WHERE p.payment_uuid = ? OR le.provider_event_id = ? FOR UPDATE`,
      [value.paymentUuid, providerEventId],
    );
    if (existing[0]) {
      if (existing[0].payment_uuid !== value.paymentUuid
        || Number(existing[0].subscription_id) !== Number(this.lockedRow.id)
        || existing[0].provider_event_id !== providerEventId) {
        throw new Error("Payment evidence identity conflicts with an existing record.");
      }
      await this.connection.query(
        `UPDATE wags_payment_coverage_v2
            SET status = ?, covers_from = ?, covers_until = ?
          WHERE payment_uuid = ?`,
        [value.status, sqlDate(value.coversFrom), sqlDate(value.coversUntil), value.paymentUuid],
      );
      return;
    }
    const [events]: any = await this.connection.query(
      `SELECT id FROM wags_lifecycle_events_v2
        WHERE subscription_id = ? AND provider = 'stripe' AND provider_event_id = ? FOR UPDATE`,
      [this.lockedRow.id, providerEventId],
    );
    if (!events[0]) throw new Error("Payment evidence lifecycle event was not found.");
    await this.connection.query(
      `INSERT INTO wags_payment_coverage_v2
        (payment_uuid, subscription_id, lifecycle_event_id, status, covers_from, covers_until)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [value.paymentUuid, this.lockedRow.id, events[0].id, value.status, sqlDate(value.coversFrom), sqlDate(value.coversUntil)],
    );
  }

  async markProviderEventProcessed(providerEventId: string, disposition: string, processedAt: string): Promise<void> {
    const [result]: any = await this.connection.query(
      `UPDATE wags_lifecycle_events_v2
          SET state = 'processed', disposition = ?, processed_at = ?
        WHERE subscription_id = ? AND provider = 'stripe' AND provider_event_id = ?`,
      [disposition, sqlDate(processedAt), this.lockedRow.id, providerEventId],
    );
    if (affectedRows(result) !== 1) throw new Error("Provider event processing evidence was not persisted.");
    if (providerEventId.startsWith("reconcile:")) {
      await this.connection.query(
        `UPDATE wags_reconciliation_runs_v2 r
         JOIN wags_lifecycle_events_v2 le
           ON le.provider = 'stripe' AND le.provider_event_id = r.provider_event_id
            SET r.state = ?, r.lifecycle_event_id = le.id, r.completed_at = ?
          WHERE r.subscription_id = ? AND r.provider_event_id = ? AND r.state = 'fetching'`,
        [disposition === "applied" ? "applied" : "no_change", sqlDate(processedAt), this.lockedRow.id, providerEventId],
      );
    }
  }
}

class MysqlDeliveryTransaction implements WagsDeliveryTransactionPort {
  constructor(private readonly connection: mysql.PoolConnection) {}

  async insertDeliveryIfAbsent(header: WagsDeliveryHeader): Promise<"inserted" | "existing"> {
    const [subscriptions]: any = await this.connection.query(
      `SELECT id, owner_identity_id, service_starts_at, service_ends_at
         FROM wags_subscriptions_v2 WHERE subscription_uuid = ? FOR UPDATE`,
      [header.subscriptionUuid],
    );
    if (!subscriptions[0]) throw new Error("Delivery subscription was not found.");
    const subscription = subscriptions[0];
    let packVersionId: number | null = null;
    let entitlementPeriodId: number | null = null;
    let policyVersionId: number | null = null;
    if (header.packUuid && header.packVersionNumber) {
      const [packs]: any = await this.connection.query(
        "SELECT id, pack_hash FROM wags_pack_versions_v2 WHERE pack_uuid = ? AND version_number = ?",
        [header.packUuid, header.packVersionNumber],
      );
      if (!packs[0] || packs[0].pack_hash !== header.packHash) throw new Error("Immutable delivery pack evidence does not match.");
      packVersionId = Number(packs[0].id);
    }
    if ((header.deliveryKind || "monthly_pack") === "monthly_pack") {
      if (!header.periodKey || !packVersionId || !header.packHash) throw new Error("Monthly delivery evidence is incomplete.");
      const period = buildMonthlyEntitlementPeriods(
        iso(subscription.service_starts_at),
        iso(subscription.service_ends_at),
      ).find((candidate) => candidate.periodKey === header.periodKey);
      if (!period) throw new Error("Monthly delivery period is outside the subscription term.");
      const [payments]: any = await this.connection.query(
        `SELECT id FROM wags_payment_coverage_v2
          WHERE subscription_id = ? AND status = 'paid' AND covers_from <= ? AND covers_until >= ?
          ORDER BY covers_until DESC LIMIT 1 FOR UPDATE`,
        [subscription.id, sqlDate(period.startsAt), sqlDate(period.endsAt)],
      );
      if (!payments[0]) throw new Error("Monthly delivery lacks locked paid coverage.");
      const periodUuid = deterministicUuid(`wags-period:${header.subscriptionUuid}:${header.periodKey}`);
      try {
        await this.connection.query(
          `INSERT INTO wags_entitlement_periods_v2
            (period_uuid, subscription_id, period_key, starts_at, ends_at, payment_coverage_id, state)
           VALUES (?, ?, ?, ?, ?, ?, 'delivering')`,
          [periodUuid, subscription.id, header.periodKey, sqlDate(period.startsAt), sqlDate(period.endsAt), payments[0].id],
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
      const [periodRows]: any = await this.connection.query(
        `SELECT id, starts_at, ends_at, payment_coverage_id
           FROM wags_entitlement_periods_v2
          WHERE subscription_id = ? AND period_key = ? FOR UPDATE`,
        [subscription.id, header.periodKey],
      );
      if (!periodRows[0]
        || iso(periodRows[0].starts_at) !== period.startsAt
        || iso(periodRows[0].ends_at) !== period.endsAt
        || Number(periodRows[0].payment_coverage_id) !== Number(payments[0].id)) {
        throw new Error("Entitlement period identity conflicts with paid coverage evidence.");
      }
      entitlementPeriodId = Number(periodRows[0].id);
    } else {
      if (!header.policyUuid || !header.policyVersionNumber || !header.termStartsAt || !header.termEndsAt) {
        throw new Error("Annual incentive delivery evidence is incomplete.");
      }
      const [policies]: any = await this.connection.query(
        `SELECT id FROM wags_incentive_policies_v2
          WHERE policy_uuid = ? AND version_number = ? FOR UPDATE`,
        [header.policyUuid, header.policyVersionNumber],
      );
      if (!policies[0]) throw new Error("Annual incentive policy version was not found.");
      policyVersionId = Number(policies[0].id);
    }
    try {
      await this.connection.query(
        `INSERT INTO wags_deliveries_v2
          (delivery_identity, subscription_id, owner_identity_id, period_key, entitlement_period_id,
           pack_version_id, pack_hash, policy_version_id, term_starts_at, term_ends_at, delivery_kind, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'granting')`,
        [header.deliveryIdentity, subscription.id, subscription.owner_identity_id, header.periodKey || null,
          entitlementPeriodId, packVersionId, header.packHash || null, policyVersionId,
          header.termStartsAt ? sqlDate(header.termStartsAt) : null, header.termEndsAt ? sqlDate(header.termEndsAt) : null,
          header.deliveryKind || "monthly_pack"],
      );
      return "inserted";
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const [rows]: any = await this.connection.query(
        `SELECT d.delivery_identity, s.subscription_uuid, d.period_key, d.pack_hash, d.delivery_kind,
                d.term_starts_at, d.term_ends_at, ip.policy_uuid, ip.version_number AS policy_version_number
           FROM wags_deliveries_v2 d
           JOIN wags_subscriptions_v2 s ON s.id = d.subscription_id
           LEFT JOIN wags_incentive_policies_v2 ip ON ip.id = d.policy_version_id
          WHERE d.delivery_identity = ? FOR UPDATE`,
        [header.deliveryIdentity],
      );
      if (!rows[0]) throw error;
      const existing = rows[0];
      if (existing.subscription_uuid !== header.subscriptionUuid
        || (existing.period_key || null) !== (header.periodKey || null)
        || (existing.pack_hash || null) !== (header.packHash || null)
        || existing.delivery_kind !== (header.deliveryKind || "monthly_pack")
        || (existing.policy_uuid || null) !== (header.policyUuid || null)
        || Number(existing.policy_version_number || 0) !== Number(header.policyVersionNumber || 0)
        || (existing.term_starts_at ? iso(existing.term_starts_at) : null) !== (header.termStartsAt || null)
        || (existing.term_ends_at ? iso(existing.term_ends_at) : null) !== (header.termEndsAt || null)) {
        throw new Error("Delivery identity conflicts with different immutable evidence.");
      }
      return "existing";
    }
  }

  async listGrantIdentitiesForUpdate(deliveryIdentity: string): Promise<Set<string>> {
    const [rows]: any = await this.connection.query(
      `SELECT g.grant_identity
         FROM wags_grants_v2 g JOIN wags_deliveries_v2 d ON d.id = g.delivery_id
        WHERE d.delivery_identity = ? FOR UPDATE`,
      [deliveryIdentity],
    );
    return new Set(rows.map((row: any) => String(row.grant_identity)));
  }

  async insertGrantIfAbsent(grant: PlannedGrant): Promise<"inserted" | "existing"> {
    const [deliveries]: any = await this.connection.query(
      `SELECT d.id, d.owner_identity_id, oi.auth_subject
         FROM wags_deliveries_v2 d
         JOIN wags_owner_identities_v2 oi ON oi.id = d.owner_identity_id
        WHERE d.delivery_identity = ? FOR UPDATE`,
      [grant.deliveryIdentity],
    );
    if (!deliveries[0]) throw new Error("Grant delivery was not found.");
    const delivery = deliveries[0];
    const [priorRows]: any = await this.connection.query(
      `SELECT g.grant_identity, d.delivery_identity, g.slot_key, g.deliverable_json
         FROM wags_grants_v2 g JOIN wags_deliveries_v2 d ON d.id = g.delivery_id
        WHERE g.grant_identity = ? FOR UPDATE`,
      [grant.grantIdentity],
    );
    if (priorRows[0]) {
      this.assertGrantMatches(priorRows[0], grant);
      return "existing";
    }

    let assetId: number | null = null;
    let assetVersionId: number | null = null;
    let creditAmount: number | null = null;
    let creditLedgerKey: string | null = null;
    let creditTransactionId: number | null = null;
    let benefitSku: string | null = null;
    let benefitQuantity: number | null = null;
    if (grant.deliverable.kind === "asset") {
      const [assets]: any = await this.connection.query(
        `SELECT a.id AS asset_id, av.id AS version_id
           FROM assets a JOIN asset_versions av ON av.asset_id = a.id
          WHERE a.asset_uuid = ? AND av.version_number = ? AND a.status = 'active' LIMIT 1`,
        [grant.deliverable.assetUuid, grant.deliverable.versionNumber],
      );
      if (!assets[0]) throw new Error("Canonical asset grant target was not found.");
      assetId = Number(assets[0].asset_id);
      assetVersionId = Number(assets[0].version_id);
    } else if (grant.deliverable.kind === "credits") {
      creditAmount = grant.deliverable.amount;
      creditLedgerKey = grant.grantIdentity;
      const phone = String(delivery.auth_subject);
      const [priorLedger]: any = await this.connection.query(
        "SELECT id FROM credit_transactions WHERE idempotency_key = ? FOR UPDATE",
        [creditLedgerKey],
      );
      if (priorLedger[0]) throw new Error("Credit ledger exists without its authoritative Wags grant.");
      const [users]: any = await this.connection.query("SELECT credits FROM users WHERE phone = ? FOR UPDATE", [phone]);
      if (!users[0]) throw new Error("Credit grant user account was not found.");
      const balanceAfter = Number(users[0].credits) + grant.deliverable.amount;
      const [updated]: any = await this.connection.query("UPDATE users SET credits = ? WHERE phone = ?", [balanceAfter, phone]);
      if (affectedRows(updated) !== 1) throw new Error("Credit balance was not updated.");
      const [ledger]: any = await this.connection.query(
        `INSERT INTO credit_transactions (user_phone, delta, reason, balance_after, idempotency_key)
         VALUES (?, ?, ?, ?, ?)`,
        [phone, grant.deliverable.amount, `wags:${grant.deliverable.ledgerCode}`.slice(0, 80), balanceAfter, creditLedgerKey],
      );
      creditTransactionId = Number(ledger.insertId);
      if (!Number.isSafeInteger(creditTransactionId) || creditTransactionId <= 0) {
        throw new Error("Canonical credit ledger identity was not returned.");
      }
    } else {
      benefitSku = grant.deliverable.benefitSku;
      benefitQuantity = grant.deliverable.quantity;
    }

    try {
      await this.connection.query(
        `INSERT INTO wags_grants_v2
          (grant_identity, delivery_id, owner_identity_id, owner_auth_subject, slot_key, disposition,
           deliverable_kind, deliverable_json, deliverable_hash, asset_id, asset_version_id,
           credit_amount, credit_ledger_key, credit_transaction_id, benefit_sku, benefit_quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [grant.grantIdentity, delivery.id, delivery.owner_identity_id, delivery.auth_subject, grant.slotKey,
          grant.disposition, grant.deliverable.kind, JSON.stringify(grant.deliverable), hashIdentity(grant.deliverable),
          assetId, assetVersionId, creditAmount, creditLedgerKey, creditTransactionId, benefitSku, benefitQuantity],
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      throw new Error("Concurrent grant identity or delivery-slot conflict.", { cause: error });
    }
    return "inserted";
  }

  private assertGrantMatches(existing: any, grant: PlannedGrant): void {
    if (existing.delivery_identity !== grant.deliveryIdentity
      || existing.slot_key !== grant.slotKey
      || hashIdentity(parseJson(existing.deliverable_json)) !== hashIdentity(grant.deliverable)) {
      throw new Error("Grant identity conflicts with a different immutable grant.");
    }
  }

  async markDeliveryComplete(deliveryIdentity: string, expectedGrantCount: number): Promise<void> {
    const [counts]: any = await this.connection.query(
      `SELECT d.id, COUNT(g.id) AS grant_count
         FROM wags_deliveries_v2 d LEFT JOIN wags_grants_v2 g ON g.delivery_id = d.id
        WHERE d.delivery_identity = ? GROUP BY d.id FOR UPDATE`,
      [deliveryIdentity],
    );
    if (!counts[0] || Number(counts[0].grant_count) !== expectedGrantCount) {
      throw new Error("Delivery grant count does not match its immutable plan.");
    }
    await this.connection.query(
      `UPDATE wags_deliveries_v2
          SET state = 'complete', expected_grant_count = ?, completed_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [expectedGrantCount, counts[0].id],
    );
    await this.connection.query(
      `UPDATE wags_entitlement_periods_v2 ep
         JOIN wags_deliveries_v2 d ON d.entitlement_period_id = ep.id
          SET ep.state = 'delivered'
        WHERE d.id = ? AND d.delivery_kind = 'monthly_pack'`,
      [counts[0].id],
    );
  }
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(crypto.createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
