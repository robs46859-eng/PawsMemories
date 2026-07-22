import { z } from "zod";
import { Sha256Schema } from "./contracts";

const IdempotencyKeySchema = z.string().trim().min(16).max(200);

export const DurableBimPreBuildInputSchema = z.object({
  reportHash: Sha256Schema,
  overallPass: z.boolean(),
  modelHash: Sha256Schema,
  calibrationHash: Sha256Schema,
  reportJson: z.record(z.string(), z.unknown()),
}).strict();

export const EnqueueDurableBimRequestSchema = z.object({
  mode: z.enum(["shell", "ifc"]),
  idempotencyKey: IdempotencyKeySchema,
  modelHash: Sha256Schema,
  calibrationHash: Sha256Schema,
  proposalHash: Sha256Schema,
  acceptedProposalHash: Sha256Schema,
  preBuild: DurableBimPreBuildInputSchema,
}).strict();

export const RetryDurableBimRequestSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
}).strict();

export const AcceptDurableBimRequestSchema = z.object({
  outputManifestHash: Sha256Schema,
}).strict();

export const EmptyDurableBimRequestSchema = z.object({}).strict();

export type EnqueueDurableBimRequest = z.infer<typeof EnqueueDurableBimRequestSchema>;
