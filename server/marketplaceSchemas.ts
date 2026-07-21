import { z } from "zod";

/**
 * Request validation for the marketplace API.
 *
 * Lives in server/ (like server/hermes/schemas.ts) rather than inline in
 * server.ts, which is already ~267k lines, and rather than src/schemas/, which
 * holds client-side schemas. Nothing here is imported by the browser bundle.
 *
 * Ref: IMPLEMENTATION_SPEC.md §5
 */

export const MARKETPLACE_CATEGORIES = ["breed", "memorial", "accessories", "seasonal"] as const;
export const LISTING_STATUSES = ["draft", "published", "archived"] as const;
export const ASSET_KINDS = ["source_glb", "preview_image", "stl_derivative"] as const;
export const QUALITY_TIERS = ["draft", "standard", "studio"] as const;

/** Licences permitting commercial redistribution. Anything outside this set
 *  cannot be attached to a listing that is published for sale — see
 *  assertCommercialLicence below. */
export const COMMERCIAL_SAFE_LICENSES = new Set([
  "CC0",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "original",
]);

const Trimmed = (max: number) => z.string().trim().min(1).max(max);

/** Slugs appear in public URLs; keep them boring and unambiguous. */
export const SlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words separated by single hyphens.");

export const UuidSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid UUID.");

/** Object keys are minted server-side. Validating the shape on the way back in
 *  stops a caller confirming an asset against a key we never issued. */
export const ObjectKeySchema = z
  .string()
  .trim()
  .max(512)
  .regex(
    /^marketplace\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i,
    "Object key is not a server-minted marketplace key.",
  );

export const Sha256Schema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/i, "sha256 must be 64 hex characters.");

const DimensionsSchema = z
  .object({
    x_mm: z.number().positive().max(10_000),
    y_mm: z.number().positive().max(10_000),
    z_mm: z.number().positive().max(10_000),
  })
  .strict();

const ProvenanceSchema = z
  .object({
    source_provider: z.enum(["original", "sketchfab"]).default("original"),
    source_url: z.string().trim().url().max(512).optional(),
    source_author: z.string().trim().max(190).optional(),
    source_license: z.string().trim().max(40).optional(),
    attribution_text: z.string().trim().max(500).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Listings                                                            */
/* ------------------------------------------------------------------ */

const ListingCoreSchema = z.object({
  name: Trimmed(160),
  slug: SlugSchema,
  breed: z.string().trim().max(120).optional(),
  category: z.enum(MARKETPLACE_CATEGORIES),
  description: z.string().trim().max(8_000).optional(),
  tags: z.array(Trimmed(40)).max(20).optional(),
  dimensions: DimensionsSchema.optional(),
  print_notes: z.string().trim().max(4_000).optional(),
  // Omitted or null disables digital download. $1.00 floor avoids Stripe's
  // minimum-charge rejection, which would otherwise surface as a confusing
  // failure at checkout rather than at publish time.
  digital_price_cents: z.number().int().min(100).max(1_000_000).nullable().optional(),
  physical_enabled: z.boolean().optional(),
  print_size_min_mm: z.number().positive().max(1_000).optional(),
  print_size_max_mm: z.number().positive().max(1_000).optional(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
});

const withSizeRangeCheck = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value: any, ctx: z.RefinementCtx) => {
    const min = value?.print_size_min_mm;
    const max = value?.print_size_max_mm;
    if (min != null && max != null && min > max) {
      ctx.addIssue({
        code: "custom",
        message: "print_size_min_mm cannot exceed print_size_max_mm.",
        path: ["print_size_min_mm"],
      });
    }
    if (value?.physical_enabled === true && (min == null || max == null)) {
      ctx.addIssue({
        code: "custom",
        message: "Physical printing requires both a minimum and maximum print size.",
        path: ["physical_enabled"],
      });
    }
  });

export const CreateListingSchema = withSizeRangeCheck(ListingCoreSchema.strict());

export const UpdateListingSchema = withSizeRangeCheck(
  ListingCoreSchema.partial()
    .extend({ status: z.enum(LISTING_STATUSES).optional() })
    .strict(),
);

export const ReorderListingsSchema = z
  .object({
    order: z
      .array(z.object({ id: z.number().int().positive(), sort_order: z.number().int().min(0) }).strict())
      .min(1)
      .max(500),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

/**
 * Request a presigned upload URL.
 *
 * Everything here is a CLAIM. The size and MIME type are used to reject the
 * obviously-wrong early and to pick a file extension — they are re-checked
 * against the stored object via HeadObject before any asset row is written.
 */
export const UploadUrlRequestSchema = z
  .object({
    listing_uuid: UuidSchema,
    kind: z.enum(["source_glb", "preview_image"]),
    filename: z.string().trim().min(1).max(255),
    mime_type: Trimmed(120),
    size_bytes: z.number().int().positive().max(200 * 1024 * 1024),
  })
  .strict();

/** Confirm an upload landed. object_key must be one we minted. */
export const ConfirmAssetSchema = z
  .object({
    listing_uuid: UuidSchema,
    kind: z.enum(ASSET_KINDS),
    object_key: ObjectKeySchema,
    sha256: Sha256Schema,
    size_bytes: z.number().int().positive(),
    mime_type: Trimmed(120),
    sort_order: z.number().int().min(0).max(1_000).optional(),
    replaces_asset_id: z.number().int().positive().optional(),
    provenance: ProvenanceSchema.optional(),
  })
  .strict();

export const UpdateAssetSchema = z
  .object({
    sort_order: z.number().int().min(0).max(1_000).optional(),
    status: z.enum(["active", "superseded"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No changes supplied." });

/* ------------------------------------------------------------------ */
/* Purchase                                                            */
/* ------------------------------------------------------------------ */

export const DigitalCheckoutSchema = z.object({}).strict();

export const PrintCheckoutSchema = z
  .object({
    target_height_mm: z.number().positive().min(10).max(1_000),
    recipient: z
      .object({
        name: Trimmed(120),
        email: z.string().trim().email().max(190),
        phone: z.string().trim().max(32).optional(),
        address_line1: Trimmed(200),
        address_line2: z.string().trim().max(200).optional(),
        city: Trimmed(120),
        state: z.string().trim().max(120).optional(),
        postal_code: Trimmed(32),
        country_code: z.string().trim().length(2),
      })
      .strict(),
  })
  .strict();

export const ListingQuerySchema = z
  .object({
    category: z.enum(MARKETPLACE_CATEGORIES).optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    per_page: z.coerce.number().int().min(1).max(48).default(24),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Fido's Styles                                                       */
/* ------------------------------------------------------------------ */

/** 15 is the per-user wardrobe cap. Enforced server-side; the client limit is
 *  a convenience, not a control. */
export const MAX_WARDROBE_ITEMS = 15;

const FidosProjectBase = z
  .object({
    name: Trimmed(160),
    avatar_id: z.number().int().positive().nullable().optional(),
    prompt: z.string().trim().max(2_000).optional(),
    wardrobe: z.array(Trimmed(64)).max(MAX_WARDROBE_ITEMS).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    quality_tier: z.enum(QUALITY_TIERS).optional(),
  })
  .strict();

/** Duplicates would silently eat the 15-item budget, so reject them explicitly
 *  rather than de-duplicating and surprising the user with a shorter list. */
const rejectDuplicateWardrobe = (value: { wardrobe?: string[] }, ctx: z.RefinementCtx) => {
  if (!value.wardrobe) return;
  if (new Set(value.wardrobe).size !== value.wardrobe.length) {
    ctx.addIssue({ code: "custom", message: "Wardrobe items must be unique.", path: ["wardrobe"] });
  }
};

export const FidosProjectSchema = FidosProjectBase.superRefine(rejectDuplicateWardrobe);

export const FidosProjectUpdateSchema = FidosProjectBase.partial()
  .superRefine((value, ctx) => {
    rejectDuplicateWardrobe(value, ctx);
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", message: "No changes supplied." });
    }
  });

/* ------------------------------------------------------------------ */
/* Publish guard                                                       */
/* ------------------------------------------------------------------ */

export interface AssetLicenceRow {
  id: number;
  source_license: string | null;
  source_provider: string;
}

/**
 * Block publishing a listing whose assets cannot legally be sold.
 *
 * A marketplace selling prints and downloads is unambiguously commercial, so a
 * CC-BY-NC asset in a paid listing is a licence violation. This runs at publish
 * time rather than at ingest so that non-commercial assets can still be stored
 * and reviewed — they just cannot go live.
 */
export function assertCommercialLicence(assets: AssetLicenceRow[]): void {
  const offending = assets.filter((asset) => {
    if (asset.source_provider === "original") return false;
    const licence = (asset.source_license || "").trim();
    if (!licence) return true; // unknown provenance is not publishable
    return !COMMERCIAL_SAFE_LICENSES.has(licence);
  });
  if (offending.length > 0) {
    const detail = offending
      .map((a) => `asset ${a.id} (${a.source_license || "no licence recorded"})`)
      .join(", ");
    throw new Error(
      `Cannot publish: ${detail}. Only licences permitting commercial use may appear in a paid listing.`,
    );
  }
}

export type CreateListingInput = z.infer<typeof CreateListingSchema>;
export type UpdateListingInput = z.infer<typeof UpdateListingSchema>;
export type UploadUrlRequest = z.infer<typeof UploadUrlRequestSchema>;
export type ConfirmAssetInput = z.infer<typeof ConfirmAssetSchema>;
export type PrintCheckoutInput = z.infer<typeof PrintCheckoutSchema>;
export type FidosProjectInput = z.infer<typeof FidosProjectSchema>;
