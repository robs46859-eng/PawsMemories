import { z } from "zod";

export const AssetVisibilitySchema = z.enum(["private", "public", "published"]);
export const AssetStatusSchema = z.enum(["active", "archived", "deleted"]);
export const StorageBucketSchema = z.enum(["public", "private"]);

export const RelationTypeSchema = z.enum([
  "turnaround",
  "mesh",
  "rig",
  "stl",
  "render",
  "print_file",
  "derivative",
]);

export const RegisterAssetSchema = z
  .object({
    ownerId: z.string().min(1).max(190),
    assetType: z.string().min(1).max(64),
    visibility: AssetVisibilitySchema.default("private"),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().length(64).regex(/^[a-fA-F0-9]{64}$/),
    bucket: StorageBucketSchema,
    objectKey: z.string().min(1).max(512),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
    sourceProvider: z.string().min(1).max(64).default("original"),
    license: z.string().min(1).max(64).default("proprietary"),
    commercialUseEligible: z.boolean().default(false),
    legacyTable: z.string().min(1).max(64).optional(),
    legacyId: z.string().min(1).max(190).optional(),
  })
  .strict();

export type RegisterAssetInput = z.infer<typeof RegisterAssetSchema>;

export const AddVersionSchema = z
  .object({
    assetUuid: z.string().uuid(),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().length(64).regex(/^[a-fA-F0-9]{64}$/),
    bucket: StorageBucketSchema,
    objectKey: z.string().min(1).max(512),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
    sourceProvider: z.string().min(1).max(64).default("original"),
    license: z.string().min(1).max(64).default("proprietary"),
    commercialUseEligible: z.boolean().default(false),
    setAsCurrent: z.boolean().default(true),
  })
  .strict();

export type AddVersionInput = z.infer<typeof AddVersionSchema>;

export const SetCurrentVersionSchema = z
  .object({
    assetUuid: z.string().uuid(),
    versionNumber: z.number().int().positive(),
  })
  .strict();

export const AddLineageSchema = z
  .object({
    parentAssetUuid: z.string().uuid(),
    parentVersionNumber: z.number().int().positive(),
    childAssetUuid: z.string().uuid(),
    childVersionNumber: z.number().int().positive(),
    relationType: RelationTypeSchema,
  })
  .strict();

export const SignedAccessSchema = z
  .object({
    assetUuid: z.string().uuid(),
    versionNumber: z.coerce.number().int().positive().optional(),
    ttlSeconds: z.coerce.number().int().min(30).max(604800).default(900),
  })
  .strict();

export const ReconciliationQuerySchema = z
  .object({
    fix: z
      .string()
      .transform((val) => val === "true" || val === "1")
      .optional(),
  })
  .strict();

export const AssetListQuerySchema = z
  .object({
    ownerId: z.string().min(1).max(190).optional(),
    assetType: z.string().min(1).max(64).optional(),
    visibility: AssetVisibilitySchema.optional(),
    status: AssetStatusSchema.optional(),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().min(1).max(100))
      .default("20" as any),
    offset: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().min(0))
      .default("0" as any),
  })
  .strict();
