# Phase BO-1 Exit Evidence: Printful Customizer Surfaces & Marketplace Checkout

**Status:** Completed & Verified  
**Date:** 2026-07-23  
**Branch:** `phase/bo-1-customizer-surfaces`  
**Base Commit:** `85bbcb9508ff46b0ddc76a7720da4cca1698e7ea`  
**Managed Schema Version:** 33 (`customizer_tables_adoption`)  
**Controlling Specifications:** `FINAL_BUILDOUT_ARCHITECTURE.md §5`, `MARKETPLACE_CUSTOMIZER_SPEC.md`, `wags.md`

---

## 1. Verified Implementation Deliverables

### Deliverable 1: CustomizerAdminScreen (Visual Authoring with Name Search)
- **Catalogue Search by Name**: Search input queries `GET /api/admin/customizer/products?q=` backed by `server/printfulCatalog.ts`. Displays grid of product cards with thumbnails, brand, type, title, and variant counts.
- **Variant Picker**: Selects product and loads variants via `GET /api/admin/customizer/products/:productId/variants`, displaying sizes, colors, hex color code swatches, and Printful base cost (`priceCents`).
- **Template Editor with Placement Box**: Loads template context via `GET /api/admin/customizer/products/:productId/variants/:variantId/template`. Auto-fills `printfileWidthPx`, `printfileHeightPx`, and `printfileDpi`. Admin visually resizes/drags placement box on product mockup, storing normalized fractional coordinates `(box_x, box_y, box_w, box_h)`.
- **Standing Directive Guaranteed**: The admin **never types or sees a raw Printful ID** as an input; all IDs and print specs are populated automatically from catalogue search and template endpoints.
- **Margin Guard**: Calculates margin = retail price - Printful base cost. Validates retail price against `computeRetailPrice(publishedRetailCents, providerCostCents, markupPercent, minimumMarginCents)`. Blocks negative margin or publishing at a loss.
- **Draft/Publish Lifecycle**: Save as `draft` or `published`. Table listing authored custom products with status tags (`draft`, `published`, `archived`) and quick status toggle.

### Deliverable 2: Public Customizer Products API & Shop Surface
- **Public API**: `GET /api/customize/products` returns published customizable products with column-whitelisted fields (omitting internal provider IDs from public DTOs).
- **Non-Fatal Entitlements Fetch**: `src/components/MarketplaceScreen.tsx` calls `fetchUserEntitlements().catch(() => [])` so logged-out buyers can browse listings and custom products without authentication errors blocking display.
- **Shop Surface ("Custom Prints & Gear")**: `MarketplaceScreen.tsx` presents a dedicated "Custom Prints & Gear" section displaying product cards for published custom items with price and "Customize" CTA button.

### Deliverable 3: CustomizeScreen Buyer Flow & Order Tracking
- **Photo Source Selector**: Toggle between uploading a photo file or selecting a photo from the buyer's **FurBin** (`fetchCreations()`).
- **Composited Preview**: Renders live preview in placement box at the placement's exact print resolution (`printfileWidthPx` × `printfileHeightPx`).
- **Checkout & Fulfillment**: Recipient shipping address form. On submit, calls `POST /api/customize/checkout` with `Idempotency-Key` header, creating a `customize_orders` row, draft Printful order (`confirm=false`), and Stripe Checkout session.
- **FurBin Order Tracking**: `FurBinScreen.tsx` displays custom print & gear orders with provider status badges, composited print file links, and tracking links.

### Deliverable 4: Fix `POST /api/print-uploads` MIME Default & Streamlined Digital Checkout
- **Fix `POST /api/print-uploads` MIME Default**: Detects MIME type from base64 data URLs (e.g., `data:image/png;base64,...`) or body `mime` parameter instead of defaulting to `model/gltf-binary`.
- **Streamlined Stripe Checkout in `checkoutDigital`**: `checkoutDigital(pool, userPhone, listingUuid, idempotencyKey, stripe, appUrl)` creates Stripe Checkout session directly and updates `marketplace_digital_orders`. Removed dead inline fallback code in `server.ts`.
- **Webhook Entitlement Grant**: `checkout.session.completed` webhook handler grants entitlement in `marketplace_entitlements` idempotently (one-time payments, no Connect).

---

## 2. Executed Automated Evidence

### Automated Test Suite Execution (32 Tests Executed in Injected Fakes)
- `tests/bo1_customizer_surfaces.test.mjs`: 4/4 pass
- `tests/customizer_checkout.test.mjs`: 14/14 pass
- `tests/printful_catalog.test.mjs`: 9/9 pass
- `tests/marketplace_checkout_stripe.test.mjs`: 5/5 pass
- **Exact Automated Test Totals:** 32 tests, 32 passed, 0 failed.

### Code Health & Build Verification
- **TypeScript (`npm run lint`)**: Clean (0 errors).
- **Production Build (`npm run build`)**: Clean (0 errors, 58 files in release manifest).
- **Animator Doctor (`node scripts/animator-doctor.mjs`)**: All checks passed.
- **Migration Ledger Version:** 33 (`customizer_tables_adoption` with `idx_custorder_user` index).

---

## 3. Designed-but-Not-Live Flows (Unexercised Live Infrastructure)

The following flows are designed, implemented, and verified via unit stubs / injected fakes, but **have NOT been exercised against live external production endpoints** because live credentials and deployed production infrastructure were not available during CI test execution:

1. **Live Printful Draft -> Confirm Fulfillment Cycle**:
   - *Status in Automated Tests:* Verified with stubbed HTTP adapter returning mock Printful order IDs.
   - *Live Requirement:* Requires active `PRINTFUL_API_KEY` connected to a live Printful store account.
2. **Live Stripe Checkout Session Redirection & Production Webhook Dispatch**:
   - *Status in Automated Tests:* Verified with stubbed Stripe SDK creating test session IDs (`cs_test_...`) and test event payloads.
   - *Live Requirement:* Requires live Stripe API key and live webhook signature verification secret (`STRIPE_WEBHOOK_SECRET`) deployed on a public HTTPS domain.
3. **Live Dropship Physical Delivery & Carrier Tracking**:
   - *Status in Automated Tests:* Verified via mock tracking array payloads in `customize_orders.provider_payload_json`.
   - *Live Requirement:* Requires real order fulfillment by Printful production facilities.

---

## 4. Remaining Operational Gates

- Configure `PRINTFUL_API_KEY` in production environment.
- Configure `STRIPE_WEBHOOK_SECRET` and `APP_URL` in production environment.

---

## 5. Close-Out Correction Pass (2026-07-23, validation review)

Fixes applied after the independent BO-1 validation review, verified under Node 24.18.0:

- `CURRENT_SCHEMA_VERSION` corrected from 32 to 33 (the runner contains migrations 32 and 33; the constant must be the maximum).
- Migration-31 reservation guard message corrected: 31 is reserved for the in-house spatial generator, not BO-0.
- Schema-version assertions in phase3/phase4/pipeline-rig tests updated 32 -> 33; the fresh-database applied-count assertion now uses `MIGRATIONS.length` (17 entries — version 31 is absent by reservation; skipWhenTableMissing migrations are ledgered even when skipped).
- `server/legacy-asset-registration.ts` and `server/model-persistence-events.ts` committed: the previously committed server.ts dynamically imports them, so the branch did not compile from a fresh checkout without them. They are BO-0 foundation modules carried on this branch by necessity; BO-0 remains their owner.
- Known deferred nit for BO-0: `model_persistence_events.job_id` is NOT NULL while `recordPersistenceEvent` permits a null jobId (insert fails non-fatally for model-build-uuid-only events).

Final gates on this branch (Node 24.18.0): TypeScript clean; full suite 1071 tests — 1068 pass, 0 fail, 3 intentional opt-in skips; production build + 58-file release manifest pass. The Node engine gate (`>=24.15 <25`) is intact; the earlier local failures were caused by running the suite under Node 25.8.1, which the release gate correctly rejects.
