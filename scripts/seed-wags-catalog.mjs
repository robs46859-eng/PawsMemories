#!/usr/bin/env node
/**
 * Seed marketplace_listings with the Wags catalog pool.
 *
 * Purpose: the Wags box planner and future marketplace phases select from
 * marketplace_listings, which starts empty (the cold-start problem flagged in
 * WARDROBE_WAGS_AND_TEXTURIZER_SPEC.md §5). This seeds a real pool from things
 * that exist and render TODAY:
 *
 *   - the 15 base wardrobe items          (digital, free-tier, renderable)
 *   - the 12 Wags-exclusive variants      (digital, wags-only, renderable)
 *   - Purr Pack sticker set templates     (digital collectible metadata)
 *   - mini-model + Pawprint templates     (digital collectible metadata)
 *
 * Honest limits, on purpose:
 *   - No marketplace_assets rows are created — there are no real GLB/preview
 *     files yet. Listings carry metadata only; the publish-time licence guard
 *     and asset checks stay meaningful for real uploads later.
 *   - digital_price_cents stays NULL (not individually purchasable) and
 *     physical_enabled stays 0 (nothing here is printable).
 *   - Idempotent by slug: re-running updates nothing and duplicates nothing.
 *
 * Usage:  node scripts/seed-wags-catalog.mjs            (uses .env DB_* vars)
 *         DRY_RUN=1 node scripts/seed-wags-catalog.mjs  (print, no writes)
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

// Keep in sync with src/wardrobe/catalog.ts — asserted by tests/wags_seed.test.mjs
// so drift between this list and the renderable catalog fails CI, since a seeded
// listing that cannot render would produce undeliverable box items.
const BASE_WARDROBE = [
  ["scarlet-collar", "Scarlet Collar", "neck"], ["forest-collar", "Forest Collar", "neck"],
  ["gold-bow", "Golden Bow Tie", "neck"], ["blue-bandana", "Blue Bandana", "neck"],
  ["ranger-cape", "Ranger Cape", "back"], ["royal-cape", "Royal Cape", "back"],
  ["party-hat", "Party Hat", "head"], ["wizard-hat", "Wizard Hat", "head"],
  ["ranger-hood", "Ranger Hood", "head"], ["gold-crown", "Golden Crown", "head"],
  ["round-glasses", "Round Glasses", "face"], ["heart-glasses", "Heart Glasses", "face"],
  ["adventure-vest", "Adventure Vest", "body"], ["winter-vest", "Winter Vest", "body"],
  ["hero-medallion", "Hero Medallion", "neck"],
];

const WAGS_EXCLUSIVES = [
  ["wags-rose-collar", "Rose Garden Collar", "neck"], ["wags-midnight-collar", "Midnight Collar", "neck"],
  ["wags-copper-bow", "Copper Bow Tie", "neck"], ["wags-sunset-bandana", "Sunset Bandana", "neck"],
  ["wags-frost-cape", "Frost Cape", "back"], ["wags-ember-cape", "Ember Cape", "back"],
  ["wags-meadow-hat", "Meadow Party Hat", "head"], ["wags-star-hat", "Stargazer Hat", "head"],
  ["wags-silver-crown", "Silver Crown", "head"], ["wags-amber-glasses", "Amber Glasses", "face"],
  ["wags-autumn-vest", "Autumn Vest", "body"], ["wags-spring-vest", "Spring Vest", "body"],
];

const COLLECTIBLE_TEMPLATES = [
  ["purr-pack-classic", "Purr Pack — Classic Stickers", "seasonal", "Five-sticker digital pack: portrait, name banner, emote, seasonal, and snack stickers."],
  ["purr-pack-holiday", "Purr Pack — Holiday Stickers", "seasonal", "Five-sticker digital pack themed for the current holiday season."],
  ["minimodel-terrier", "Mini-Model — Terrier Pal", "breed", "Prefab low-poly companion mini-model, displayed beside the user's main pet model."],
  ["minimodel-tabby", "Mini-Model — Tabby Pal", "breed", "Prefab low-poly cat companion mini-model."],
  ["pawprint-seasonal", "Seasonal Pawprint Card", "seasonal", "Monthly themed Pawprint keepsake card template."],
  ["pawprint-birthday", "Birthday Pawprint Card", "seasonal", "Birthday-themed Pawprint keepsake card template."],
];

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE || process.env.ADMIN_KEY || "admin";
const DRY = process.env.DRY_RUN === "1";

function listingRow({ slug, name, category, description, tags }) {
  return {
    uuid: randomUUID(),
    slug,
    name,
    category,
    description,
    tags_json: JSON.stringify(tags),
    status: "published",
    created_by: ADMIN_PHONE,
  };
}

const rows = [
  ...BASE_WARDROBE.map(([id, name, kind]) =>
    listingRow({
      slug: `wardrobe-${id}`,
      name,
      category: "accessories",
      description: `Digital wardrobe accessory (${kind}) for your pet's 3D model. Included with every account.`,
      tags: ["wardrobe", "digital", kind, "base"],
    })),
  ...WAGS_EXCLUSIVES.map(([id, name, kind]) =>
    listingRow({
      slug: `wardrobe-${id}`,
      name,
      category: "accessories",
      description: `Wardrobe Wags exclusive accessory (${kind}). Delivered only in monthly Wags boxes.`,
      tags: ["wardrobe", "digital", kind, "wags-exclusive"],
    })),
  ...COLLECTIBLE_TEMPLATES.map(([slug, name, category, description]) =>
    listingRow({ slug, name, category, description, tags: ["wags-pool", "digital", "collectible"] })),
];

async function main() {
  if (DRY) {
    console.log(`[dry run] would ensure ${rows.length} listings:`);
    for (const r of rows) console.log(`  ${r.slug}  (${r.category})`);
    return;
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2,
  });

  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    // Idempotency lives on the slug UNIQUE key. ON DUPLICATE KEY UPDATE id=id
    // makes a rerun a no-op instead of an error — same pattern the Stripe
    // entitlement webhook uses.
    const [result] = await pool.query(
      `INSERT INTO marketplace_listings
         (uuid, slug, name, category, description, tags_json, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [row.uuid, row.slug, row.name, row.category, row.description, row.tags_json, row.status, row.created_by],
    );
    if (result.affectedRows === 1) inserted += 1; else skipped += 1;
  }

  console.log(`✅ Wags catalog seed complete: ${inserted} inserted, ${skipped} already present (${rows.length} total).`);
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err?.message || err);
  process.exit(1);
});
