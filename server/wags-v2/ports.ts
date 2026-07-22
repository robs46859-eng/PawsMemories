import { GrantPlanSchema, PlannedGrantSchema, type GrantPlan, type PlannedGrant } from "./contracts.ts";

export interface WagsDeliveryHeader {
  deliveryIdentity: string;
  subscriptionUuid: string;
  deliveryKind?: "monthly_pack" | "annual_incentive";
  periodKey?: string | null;
  packUuid?: string | null;
  packVersionNumber?: number | null;
  packHash?: string | null;
  policyUuid?: string | null;
  policyVersionNumber?: number | null;
  termStartsAt?: string | null;
  termEndsAt?: string | null;
}

export interface WagsDeliveryTransactionPort {
  /** Backed by UNIQUE(delivery_identity); never creates a second delivery. */
  insertDeliveryIfAbsent(header: WagsDeliveryHeader): Promise<"inserted" | "existing">;
  /** Reads grant identities while the keyed delivery lock is held. */
  listGrantIdentitiesForUpdate(deliveryIdentity: string): Promise<Set<string>>;
  /**
   * Backed by UNIQUE(grant_identity). The inserted row is the authoritative
   * asset entitlement, credit-ledger entry, or benefit grant; no second side
   * effect may occur when this returns "existing".
   */
  insertGrantIfAbsent(grant: PlannedGrant): Promise<"inserted" | "existing">;
  markDeliveryComplete(deliveryIdentity: string, expectedGrantCount: number): Promise<void>;
}

export interface WagsDeliveryRepositoryPort {
  /**
   * Runs one database transaction under a lock keyed by deliveryIdentity.
   * Implementations must also use unique identities as the concurrency backstop.
   */
  withDeliveryLock<T>(deliveryIdentity: string, work: (transaction: WagsDeliveryTransactionPort) => Promise<T>): Promise<T>;
}

export interface PersistGrantPlanResult {
  deliveryIdentity: string;
  insertedGrantIdentities: string[];
  existingGrantIdentities: string[];
}

export async function persistGrantPlanExactlyOnce(
  repository: WagsDeliveryRepositoryPort,
  rawPlan: GrantPlan,
): Promise<PersistGrantPlanResult> {
  const plan = GrantPlanSchema.parse(rawPlan);
  return repository.withDeliveryLock(plan.deliveryIdentity, async (transaction) => {
    await transaction.insertDeliveryIfAbsent({
      deliveryIdentity: plan.deliveryIdentity,
      subscriptionUuid: plan.subscriptionUuid,
      deliveryKind: "monthly_pack",
      periodKey: plan.period.periodKey,
      packUuid: plan.packUuid,
      packVersionNumber: plan.packVersionNumber,
      packHash: plan.packHash,
    });
    const existing = await transaction.listGrantIdentitiesForUpdate(plan.deliveryIdentity);
    const insertedGrantIdentities: string[] = [];
    const existingGrantIdentities = [...plan.replayedGrants.map((grant) => grant.grantIdentity)];
    for (const rawGrant of plan.newGrants) {
      const grant = PlannedGrantSchema.parse(rawGrant);
      if (existing.has(grant.grantIdentity)) {
        existingGrantIdentities.push(grant.grantIdentity);
        continue;
      }
      const outcome = await transaction.insertGrantIfAbsent(grant);
      if (outcome === "inserted") insertedGrantIdentities.push(grant.grantIdentity);
      else existingGrantIdentities.push(grant.grantIdentity);
    }
    await transaction.markDeliveryComplete(
      plan.deliveryIdentity,
      plan.newGrants.length + plan.replayedGrants.length,
    );
    return { deliveryIdentity: plan.deliveryIdentity, insertedGrantIdentities, existingGrantIdentities };
  });
}

export interface AnnualIncentivePersistenceInput {
  deliveryIdentity: string;
  subscriptionUuid: string;
  policyUuid: string;
  policyVersionNumber: number;
  termStartsAt: string;
  termEndsAt: string;
  newGrants: PlannedGrant[];
  replayedGrants: PlannedGrant[];
}

export async function persistAnnualIncentiveExactlyOnce(
  repository: WagsDeliveryRepositoryPort,
  input: AnnualIncentivePersistenceInput,
): Promise<PersistGrantPlanResult> {
  return repository.withDeliveryLock(input.deliveryIdentity, async (transaction) => {
    await transaction.insertDeliveryIfAbsent({
      deliveryIdentity: input.deliveryIdentity,
      subscriptionUuid: input.subscriptionUuid,
      deliveryKind: "annual_incentive",
      periodKey: null,
      packUuid: null,
      packVersionNumber: null,
      packHash: null,
      policyUuid: input.policyUuid,
      policyVersionNumber: input.policyVersionNumber,
      termStartsAt: input.termStartsAt,
      termEndsAt: input.termEndsAt,
    });
    const existing = await transaction.listGrantIdentitiesForUpdate(input.deliveryIdentity);
    const insertedGrantIdentities: string[] = [];
    const existingGrantIdentities = input.replayedGrants.map((grant) => grant.grantIdentity);
    for (const rawGrant of input.newGrants) {
      const grant = PlannedGrantSchema.parse(rawGrant);
      if (grant.deliveryIdentity !== input.deliveryIdentity) {
        throw new Error("Annual incentive grant does not belong to its deterministic delivery.");
      }
      if (existing.has(grant.grantIdentity)) {
        existingGrantIdentities.push(grant.grantIdentity);
        continue;
      }
      const outcome = await transaction.insertGrantIfAbsent(grant);
      if (outcome === "inserted") insertedGrantIdentities.push(grant.grantIdentity);
      else existingGrantIdentities.push(grant.grantIdentity);
    }
    await transaction.markDeliveryComplete(
      input.deliveryIdentity,
      input.newGrants.length + input.replayedGrants.length,
    );
    return { deliveryIdentity: input.deliveryIdentity, insertedGrantIdentities, existingGrantIdentities };
  });
}
