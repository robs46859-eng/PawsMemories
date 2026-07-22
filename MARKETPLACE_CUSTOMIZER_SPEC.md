# Marketplace Product Customizer — Implementation Spec

**Status:** Draft, 2026-07-21
**Decisions locked:** admin-authored templates · full Printful blank catalogue ·
silent auto-submit (no white-label shipping in v1).

Buyers drop a photo — uploaded or picked from FurBin — onto an admin-defined
placement on a Printful blank (shirt, mug, poster, tote, …). On payment the
composited print file is submitted to Printful automatically; the customer never
sees a fulfilment provider.

---

## 1. What already exists (do not rebuild)

Verified in the current tree, not assumed:

| Capability | Where | Reuse as |
|---|---|---|
| Draft-then-confirm Printful order, white-label server-side | `server/printful.ts` `createPrintfulOrder()` / `confirmPrintfulOrderIfDraft()` | The submit path. Already drafts with `confirm=false`, confirms only after Stripe. |
| Photo-onto-template canvas compositor → print JPEG | `src/components/PawprintsStudio.tsx` (`cover()`, `planPawprintCollage`, offscreen canvas export) | The compositor primitive, generalised to one placement box. |
| Base64 → hosted URL for a print file | `POST /api/print-uploads` → `uploadBase64Binary` | Print-file hosting. **Bug to fix:** it defaults mime to `model/gltf-binary`; pass the real image mime. |
| Marketplace listing with physical flags | `marketplace_listings` (`physical_enabled`, `print_size_*`, `print_notes`) | The listing a customizable product attaches to. |
| Versioned listing assets in private B2 | `marketplace_assets`, `storage.private.ts` | Where the buyer's uploaded source + generated print file live. |
| Stripe checkout → webhook → provider submit | `pawprint_print_orders` flow in `server.ts` (webhook `type: "pawprint_print_order"`) | The payment→fulfilment state machine to copy. |
| Shipment tracking extraction | `server/printful.ts` tracking parse; surfaced in FurBin | Order status surfacing, already built. |

**Implication:** the silent-dropship and the compositor are done. The new work
is (a) modelling the full Printful catalogue, (b) an admin template editor,
(c) a generalised buyer customizer with a FurBin source, and (d) print files at
each variant's correct pixel dimensions.

---

## 2. The hard part of "full catalogue": print geometry

A poster is forgiving; a shirt is not. Every Printful product has variants, and
every variant has one or more **print placements** (front, back, sleeve, mug
wrap…), each with an exact **print-file pixel size and DPI**. Compositing at the
wrong resolution yields a rejected order or a blurry product.

So v1 cannot hard-code sizes. We fetch them from Printful's Catalog / Mockup
Generator API and store them per product:

- `GET /products/{id}` — variants for a product.
- `GET /mockup-generator/printfiles/{id}` — **authoritative** print-file
  dimensions (px) and DPI per placement, per variant. This is the field that
  governs canvas resolution.
- `GET /mockup-generator/create-task/{id}` (optional, Phase 4) — real product
  mockups for the buyer preview.

These are cached; Printful's catalogue changes rarely.

---

## 3. Data model (additions)

New tables, applied via the idempotent column/table path in `db.ts` (the repo
has no standalone migration runner — see `014_avatar_soft_hide.sql` note).

```sql
-- A Printful blank exposed as a customizable marketplace product. One row per
-- (listing, printful variant). The admin authors the placement geometry here.
CREATE TABLE customizable_products (
  id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
  listing_id          BIGINT NOT NULL,              -- FK marketplace_listings
  printful_product_id INT    NOT NULL,              -- catalogue product
  printful_variant_id INT    NOT NULL,              -- specific variant (size/colour)
  placement           VARCHAR(32) NOT NULL DEFAULT 'default', -- front/back/…
  -- Print-file spec cached from Printful, governs composite resolution.
  printfile_width_px  INT    NOT NULL,
  printfile_height_px INT    NOT NULL,
  printfile_dpi       INT    NOT NULL,
  -- Admin-defined box the buyer photo fills, in FRACTIONS of the print file
  -- (0..1) so it is resolution-independent. This is the "pre-placed template".
  box_x               DECIMAL(6,5) NOT NULL,
  box_y               DECIMAL(6,5) NOT NULL,
  box_w               DECIMAL(6,5) NOT NULL,
  box_h               DECIMAL(6,5) NOT NULL,
  box_shape           ENUM('rect','circle','arch') NOT NULL DEFAULT 'rect',
  -- Optional fixed overlay art placed above/below the photo (logos, frames).
  overlay_asset_uuid  CHAR(36) NULL,
  retail_price_cents  INT    NOT NULL,              -- what the buyer pays
  status              ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_custprod_listing (listing_id, status)
);

-- One buyer customisation → one fulfilment lifecycle. Mirrors pawprint_print_orders.
CREATE TABLE customize_orders (
  id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_phone          VARCHAR(32) NOT NULL,
  customizable_id     BIGINT NOT NULL,              -- FK customizable_products
  source_photo_url    TEXT   NOT NULL,              -- buyer upload / FurBin asset
  source_kind         ENUM('upload','furbin') NOT NULL,
  print_file_url      TEXT   NULL,                  -- composited, private bucket
  recipient_json      JSON   NOT NULL,              -- shipping address
  retail_price_cents  INT    NOT NULL,
  stripe_session_id   VARCHAR(255) NULL,
  provider_order_id   VARCHAR(64)  NULL,            -- Printful draft/live id
  provider_payload_json JSON NULL,
  status ENUM('draft','awaiting_payment','payment_received','submitting',
              'submitted','failed','refunded') NOT NULL DEFAULT 'draft',
  idempotency_key     VARCHAR(64) NOT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_custorder_idem (user_phone, idempotency_key),
  INDEX idx_custorder_status (status)
);
```

Rationale for the fractional box: the admin sets it once against a preview; it
maps onto whatever pixel size a variant's print file happens to be, so the same
template survives a Printful print-area change without re-authoring.

---

## 4. Print-file generation

Reuse the `PawprintsStudio` compositor, generalised to a single placement:

1. Canvas sized to `printfile_width_px × printfile_height_px` (never the preview
   size — the preview is downscaled for the browser).
2. Fill background (transparent for apparel PNG, white for posters JPEG — Printful
   wants PNG with alpha for garments).
3. `cover()` the buyer photo into the fractional box scaled to px, clipped to
   `box_shape`.
4. Composite the optional `overlay_asset_uuid` art.
5. Export at DPI. Apparel → PNG (alpha); flat paper → JPEG q0.92.
6. Upload via `/api/print-uploads` (with the mime fix) to the **private** bucket;
   the URL handed to Printful is a short-lived presigned GET.

Where it runs: **client canvas** for v1 (matches Pawprints, no server GPU). Guard
against very large print files (some posters exceed 6000px) with the same
mobile-downscale worker Pawprints already uses, but export must stay full-res —
so on low-memory devices, fall back to a **server-side** sharp composite
(`sharp` is already a dependency). Flag: `CUSTOMIZER_SERVER_COMPOSITE`.

---

## 5. Buyer flow (silent)

1. Buyer opens a customizable listing → customizer screen.
2. **Photo source:** upload, or "From FurBin" → picker listing the user's
   creations/photos (the FurBin data the profile already loads). This is the
   one explicitly requested new UI surface.
3. Buyer positions/scales the photo inside the fixed box (box is fixed; the photo
   pans/zooms within it). Live preview uses the downscaled canvas; optionally a
   Printful mockup (Phase 4).
4. "Add to cart / Buy" → `POST /api/customize/checkout`:
   - server composites is NOT trusted from the client; server re-derives the
     print file from `source_photo_url` + stored box, or validates a client
     upload's dimensions against the spec.
   - creates a `customize_orders` row (`awaiting_payment`), a **draft** Printful
     order, and a Stripe Checkout session. Idempotency-Key required.
5. Stripe webhook `type:"customize_order"` → mark `payment_received` →
   `confirmPrintfulOrderIfDraft` → `submitted`. Identical to the pawprint path.
6. Buyer sees "Your order is being made" + tracking in FurBin. No provider name
   anywhere in UI or email.

**Never confirm the Printful order before the webhook.** Same invariant the
pawprint flow already enforces.

---

## 6. Admin flow

Extend the existing admin catalogue screen (`MarketplaceAdminScreen.tsx`):

1. Pick a Printful product from the synced catalogue (searchable).
2. Pick a variant + placement → print-file spec auto-loads.
3. Drag the placement box on a preview of the print area → stores fractional box.
4. Optional: upload fixed overlay art.
5. Set retail price; publish. Server guards price ≥ Printful cost + floor, reusing
   `FULFILLMENT_MIN_MARGIN_CENTS` / `FULFILLMENT_MARKUP_PERCENT`.

---

## 7. Phasing (ship increments, not a big bang)

- **P0 — Catalogue module.** `server/printfulCatalog.ts`: fetch/cache products,
  variants, print-file specs. Admin can list products. No UI customiser yet.
- **P1 — Schema + one product end to end.** Tables above; hard-config a single
  poster variant; buyer uploads a photo → composite → draft → Stripe → submit.
  Proves the full pipe on the forgiving product.
- **P2 — FurBin source + box editor.** The requested photo picker; admin drag-box
  authoring; fractional-box compositor.
- **P3 — Apparel + multi-placement.** PNG/alpha, per-variant print files, the
  low-memory server-composite fallback.
- **P4 — Mockup previews.** Printful mockup generator for a real product preview.
- **P5 — Polish.** Refund handling (mirror `refunds.ts`), order surfacing, admin
  moderation of buyer photos (content check reusing `imageTriage.ts`).

Each phase is independently shippable and leaves the marketplace working.

---

## 8. Risks / decisions still open

- **Content moderation.** Buyer-uploaded photos go onto physical products you
  fulfil. P5 routes them through the existing `server/imageTriage.ts` before
  submit; until then, admin-review gate. Do not auto-submit un-moderated buyer
  photos to production at scale.
- **Printful cost at order time.** Retail price is fixed at publish, but Printful
  cost can drift. The margin guard must re-check at submit and fail the order to
  `failed` (auto-refund) rather than eat a loss.
- **Licensing.** This is the buyer's own photo on their own product — no Tripo /
  sublicensing exposure (unlike the 3D marketplace). Clean.
- **Tax/returns.** Silent auto-submit only. Full white-label shipping (your
  branding on the package) is deliberately out of scope for v1 and is a Printful
  account setting + a returns-ownership decision, not code.
