import crypto from "node:crypto";
import { z } from "zod";

export const BIM_BUILD_CONTRACT_VERSION = "phase9-v2.0.0";
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical BIM payloads cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().flatMap((key) => record[key] === undefined ? [] : [[key, canonicalValue(record[key])]]),
    );
  }
  throw new Error(`Unsupported canonical BIM value: ${typeof value}`);
}

export function canonicalBimJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function hashBimContract(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalBimJson(value)).digest("hex");
}

export function hashBimModel(model: unknown): string {
  return hashBimContract({ contractVersion: BIM_BUILD_CONTRACT_VERSION, kind: "model", model });
}

export function hashBimCalibration(calibration: unknown): string {
  return hashBimContract({ contractVersion: BIM_BUILD_CONTRACT_VERSION, kind: "calibration", calibration });
}

export const BIM_PROVENANCE_VALUES = ["observed", "measured", "user_confirmed", "inferred", "synthesized"] as const;
export type BimProvenance = typeof BIM_PROVENANCE_VALUES[number];

export const BimBuildCommandSchema = z.object({
  contractVersion: z.literal(BIM_BUILD_CONTRACT_VERSION),
  jobUuid: z.string().uuid(),
  attemptUuid: z.string().uuid(),
  ownerKey: z.string().trim().min(1).max(200),
  mode: z.enum(["shell", "ifc"]),
  idempotencyKey: z.string().trim().min(16).max(200),
  modelHash: Sha256Schema,
  calibrationHash: Sha256Schema,
  proposalHash: Sha256Schema,
  acceptedProposalHash: Sha256Schema,
  preBuildReportHash: Sha256Schema,
  requestedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.proposalHash !== value.acceptedProposalHash) {
    context.addIssue({ code: "custom", path: ["acceptedProposalHash"], message: "The accepted proposal hash does not match the submitted proposal" });
  }
  if (value.proposalHash !== value.modelHash) {
    context.addIssue({ code: "custom", path: ["modelHash"], message: "The durable build model must be the accepted proposal" });
  }
});

export type BimBuildCommand = z.infer<typeof BimBuildCommandSchema>;

export const BimWorkerResultEnvelopeSchema = z.object({
  contractVersion: z.literal(BIM_BUILD_CONTRACT_VERSION),
  jobUuid: z.string().uuid(),
  attemptUuid: z.string().uuid(),
  mode: z.enum(["shell", "ifc"]),
  preBuildReportHash: Sha256Schema,
  modelHash: Sha256Schema,
  calibrationHash: Sha256Schema,
  outputSha256: Sha256Schema,
  evidence: z.unknown(),
}).strict();

export type BimWorkerResultEnvelope = z.infer<typeof BimWorkerResultEnvelopeSchema>;

export type BimDurableJobState = "queued" | "claimed" | "processing" | "validating" | "ready" | "failed_retryable" | "failed_terminal" | "cancelled";

export interface BimDurableJobSnapshot {
  jobUuid: string;
  attemptUuid: string;
  state: BimDurableJobState;
  leaseExpiresAt: string | null;
  retryCount: number;
  result?: BimWorkerResultEnvelope;
}

// The lead integration supplies the SQL/outbox implementation. Domain code depends only on this port.
export interface BimDurableJobPort {
  enqueue(command: BimBuildCommand): Promise<BimDurableJobSnapshot>;
  get(jobUuid: string, ownerKey: string): Promise<BimDurableJobSnapshot | null>;
  recordResult(result: BimWorkerResultEnvelope): Promise<BimDurableJobSnapshot>;
  requestCancellation(jobUuid: string, ownerKey: string): Promise<BimDurableJobSnapshot>;
}

export function createBimBuildCommand(input: Omit<BimBuildCommand, "contractVersion">): BimBuildCommand {
  return BimBuildCommandSchema.parse({ contractVersion: BIM_BUILD_CONTRACT_VERSION, ...input });
}
