import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CreateListingSchema,
  UpdateListingSchema,
  UploadUrlRequestSchema,
  ConfirmAssetSchema,
  PrintCheckoutSchema,
  FidosProjectSchema,
  ObjectKeySchema,
  SlugSchema,
  assertCommercialLicence,
  MAX_WARDROBE_ITEMS,
} from "../server/marketplaceSchemas.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

const validListing = {
  name: "Chihuahua Classic",
  slug: "chihuahua-classic",
  category: "breed",
  digital_price_cents: 1499,
};

test("a minimal valid listing is accepted", () => {
  assert.equal(CreateListingSchema.safeParse(validListing).success, true);
});

test("unknown fields are rejected rather than silently dropped", () => {
  const result = CreateListingSchema.safeParse({ ...validListing, is_admin: true });
  assert.equal(result.success, false, "strict schemas stop privilege-shaped fields sneaking through");
});

test("slugs must be URL-safe", () => {
  for (const good of ["chihuahua-classic", "memorial-2026", "a-b-c"]) {
    assert.equal(SlugSchema.safeParse(good).success, true, good);
  }
  for (const bad of ["Chihuahua Classic", "../etc", "trailing-", "-leading", "double--hyphen", "a"]) {
    assert.equal(SlugSchema.safeParse(bad).success, false, bad);
  }
});

test("digital price honours the Stripe minimum", () => {
  // Below Stripe's floor the failure would otherwise appear at checkout, long
  // after the admin thought the listing was fine.
  assert.equal(
    CreateListingSchema.safeParse({ ...validListing, digital_price_cents: 50 }).success,
    false,
  );
  assert.equal(
    CreateListingSchema.safeParse({ ...validListing, digital_price_cents: 100 }).success,
    true,
  );
  // Explicit null disables digital download and is legitimate.
  assert.equal(
    CreateListingSchema.safeParse({ ...validListing, digital_price_cents: null }).success,
    true,
  );
});

test("physical listings must declare a print size range", () => {
  const missingRange = CreateListingSchema.safeParse({ ...validListing, physical_enabled: true });
  assert.equal(missingRange.success, false, "physical_enabled without sizes must fail");

  const ok = CreateListingSchema.safeParse({
    ...validListing,
    physical_enabled: true,
    print_size_min_mm: 80,
    print_size_max_mm: 160,
  });
  assert.equal(ok.success, true);
});

test("an inverted print size range is rejected", () => {
  const result = CreateListingSchema.safeParse({
    ...validListing,
    physical_enabled: true,
    print_size_min_mm: 200,
    print_size_max_mm: 100,
  });
  assert.equal(result.success, false);
});

test("listing updates accept a status transition", () => {
  assert.equal(UpdateListingSchema.safeParse({ status: "published" }).success, true);
  assert.equal(UpdateListingSchema.safeParse({ status: "deleted" }).success, false);
});

test("object keys must match the server-minted shape", () => {
  const good = "marketplace/3f2504e0-4f89-11d3-9a0c-0305e82c3301/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed.glb";
  assert.equal(ObjectKeySchema.safeParse(good).success, true);

  for (const bad of [
    "marketplace/../../secret.glb",
    "other-prefix/3f2504e0-4f89-11d3-9a0c-0305e82c3301/x.glb",
    "marketplace/not-a-uuid/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed.glb",
    "/marketplace/3f2504e0-4f89-11d3-9a0c-0305e82c3301/x.glb",
    "marketplace/3f2504e0-4f89-11d3-9a0c-0305e82c3301/x.glb/../../evil",
  ]) {
    assert.equal(ObjectKeySchema.safeParse(bad).success, false, bad);
  }
});

test("asset confirmation requires a real sha256", () => {
  const base = {
    listing_uuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    kind: "source_glb",
    object_key:
      "marketplace/3f2504e0-4f89-11d3-9a0c-0305e82c3301/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed.glb",
    sha256: "a".repeat(64),
    size_bytes: 2048,
    mime_type: "model/gltf-binary",
  };
  assert.equal(ConfirmAssetSchema.safeParse(base).success, true);
  assert.equal(ConfirmAssetSchema.safeParse({ ...base, sha256: "abc" }).success, false);
  assert.equal(ConfirmAssetSchema.safeParse({ ...base, size_bytes: 0 }).success, false);
});

test("upload requests bound the claimed size", () => {
  const base = {
    listing_uuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    kind: "source_glb",
    filename: "model.glb",
    mime_type: "model/gltf-binary",
    size_bytes: 1024,
  };
  assert.equal(UploadUrlRequestSchema.safeParse(base).success, true);
  assert.equal(
    UploadUrlRequestSchema.safeParse({ ...base, size_bytes: 500 * 1024 * 1024 }).success,
    false,
  );
});

test("print checkout requires a complete shipping address", () => {
  const recipient = {
    name: "Robert Smith",
    email: "robs46859@example.com",
    address_line1: "1 Main St",
    city: "Boston",
    postal_code: "02101",
    country_code: "US",
  };
  assert.equal(
    PrintCheckoutSchema.safeParse({ target_height_mm: 120, recipient }).success,
    true,
  );
  // Missing postal code.
  const { postal_code, ...incomplete } = recipient;
  assert.equal(
    PrintCheckoutSchema.safeParse({ target_height_mm: 120, recipient: incomplete }).success,
    false,
  );
  // Country must be a 2-letter code.
  assert.equal(
    PrintCheckoutSchema.safeParse({
      target_height_mm: 120,
      recipient: { ...recipient, country_code: "USA" },
    }).success,
    false,
  );
});

test("the 15-item wardrobe cap is enforced in the schema", () => {
  const under = Array.from({ length: MAX_WARDROBE_ITEMS }, (_, i) => `item-${i}`);
  const over = Array.from({ length: MAX_WARDROBE_ITEMS + 1 }, (_, i) => `item-${i}`);

  assert.equal(FidosProjectSchema.safeParse({ name: "Look", wardrobe: under }).success, true);
  assert.equal(FidosProjectSchema.safeParse({ name: "Look", wardrobe: over }).success, false);
});

test("duplicate wardrobe items are rejected", () => {
  const result = FidosProjectSchema.safeParse({
    name: "Look",
    wardrobe: ["gold-crown", "gold-crown"],
  });
  assert.equal(result.success, false, "duplicates would silently consume the 15-item budget");
});

test("quality tier is constrained to the three real tiers", () => {
  for (const tier of ["draft", "standard", "studio"]) {
    assert.equal(FidosProjectSchema.safeParse({ name: "L", quality_tier: tier }).success, true);
  }
  assert.equal(FidosProjectSchema.safeParse({ name: "L", quality_tier: "ultra" }).success, false);
});

test("non-commercial assets cannot be published", () => {
  // A marketplace selling prints and downloads is unambiguously commercial, so
  // CC-BY-NC in a paid listing is a licence violation.
  assert.throws(
    () =>
      assertCommercialLicence([
        { id: 7, source_provider: "sketchfab", source_license: "CC-BY-NC-4.0" },
      ]),
    /commercial use/i,
  );
});

test("assets with unrecorded provenance cannot be published", () => {
  assert.throws(
    () => assertCommercialLicence([{ id: 8, source_provider: "sketchfab", source_license: null }]),
    /commercial use/i,
    "unknown licence must fail closed, not open",
  );
});

test("original and CC0 assets publish cleanly", () => {
  assert.doesNotThrow(() =>
    assertCommercialLicence([
      { id: 1, source_provider: "original", source_license: null },
      { id: 2, source_provider: "sketchfab", source_license: "CC0" },
      { id: 3, source_provider: "sketchfab", source_license: "CC-BY-4.0" },
    ]),
  );
});

test("migration SQL and db.ts declare the same marketplace tables", () => {
  const migration = readFileSync(
    path.join(repoRoot, "server/migrations/011_marketplace.sql"),
    "utf8",
  );
  const dbSource = readFileSync(path.join(repoRoot, "db.ts"), "utf8");

  const tables = [
    "marketplace_listings",
    "marketplace_assets",
    "marketplace_digital_orders",
    "marketplace_entitlements",
    "fidos_projects",
  ];
  for (const table of tables) {
    assert.ok(
      migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
      `${table} missing from migration 011`,
    );
    assert.ok(
      dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
      `${table} missing from db.ts — initDb is what actually runs on boot`,
    );
  }

  // The entitlement UNIQUE key is what makes Stripe webhook replay a no-op.
  assert.ok(
    migration.includes("uniq_marketplace_entitlement") &&
      dbSource.includes("uniq_marketplace_entitlement"),
    "entitlement uniqueness must exist in both places",
  );

  // print_orders must accept marketplace listings in both places.
  assert.ok(migration.includes("marketplace_listing"), "migration must widen print_orders");
  assert.ok(dbSource.includes("marketplace_listing"), "db.ts must widen print_orders");
});
