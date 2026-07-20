# Agent Prompt — Phase 4: Digital Purchase, Entitlements, Public Marketplace

You are the implementation engineer for Phase 4. Phases 0–3 are shipped
(`e287f74`): private storage, marketplace schema, admin catalog manager.
This phase makes the marketplace real: public listings, Stripe digital
checkout, webhook-granted entitlements, signed downloads. **This is money-path
code — the webhook is the only source of truth for granting anything.**

Read first, in order:
1. `IMPLEMENTATION_SPEC.md` §6 (Phase 4 contract) and §9 (security criteria — all 12 apply verbatim).
2. `MARKETPLACE_AND_STYLES_SPEC.md` §2.4 (digital purchase flow rationale).
3. `server/marketplaceSchemas.ts` — `ListingQuerySchema`, `DigitalCheckoutSchema` exist.
4. `storage.private.ts` — `getPrivateSignedUrl` exists; its CALLER CONTRACT comment is binding: entitlement check happens in YOUR route, it mints for whoever asks.
5. Existing Stripe patterns: webhook at `server.ts` L~377 (`checkout.session.completed` switch on `metadata.type`), Slant checkout for the Idempotency-Key + resume pattern, `marketplace_entitlements` DDL comment in `db.ts` for the `ON DUPLICATE KEY UPDATE id = id` replay contract.

## Build

### 1. Public API (no auth for reads)
- `GET /api/marketplace/listings` — `ListingQuerySchema` (category/q/page/per_page), `status='published'` ONLY. Each listing: metadata + preview images as **short-lived signed URLs** (reuse `listingAssets` previews path from `server/marketplaceAdmin.ts` or extract a shared helper). **A contract test must assert no `object_key` and no `marketplace/` key appears in any public response body.**
- `GET /api/marketplace/listings/:uuid` — one published listing, previews only. 404 for draft/archived (do not leak existence).

### 2. Digital checkout — `POST /api/marketplace/listings/:uuid/checkout`
`requireAuth, paidLimiter`, `Idempotency-Key` header required (Slant pattern: replay returns the same session/checkout URL).
Sequence: listing must be `published` with non-null `digital_price_cents` → resolve the ACTIVE `source_glb` asset and **pin its asset_id** on the order → existing live entitlement → 409 "already owned" → INSERT `marketplace_digital_orders` (`awaiting_payment`) → `stripe.checkout.sessions.create` with `metadata: { type: 'marketplace_digital', digitalOrderId, userPhone, listingId }`, `success_url` → `/fur-bin?digital_success=true&order_id=…`, then store `checkout_url`/`stripe_session_id` on the order.

### 3. Webhook branch (extend the existing handler — do NOT add a second webhook route)
New `metadata.type === 'marketplace_digital'` case in the existing `checkout.session.completed` handler:
UPDATE order → `paid` + `stripe_payment_intent`; INSERT entitlement with
`INSERT … ON DUPLICATE KEY UPDATE id = id` (replay-safe). **The redirect/
success_url must never grant** — it polls `GET /api/marketplace/orders/:id`.

### 4. Download — `GET /api/marketplace/listings/:uuid/download`
`requireAuth`. Entitlement WHERE user+listing AND `revoked_at IS NULL` → 403 if absent → `getPrivateSignedUrl` on the **pinned asset version** from the entitlement (not "current active" — a later replacement must not change what was bought) → return `{ url, expiresAt }`.

### 5. Order polling + ownership
- `GET /api/marketplace/orders/:id` — owner only: `{ status }`.
- `GET /api/marketplace/entitlements` — owner's live entitlements with listing names (Fur Bin "My models" source).

### 6. Frontend
- `MarketplaceScreen.tsx`: delete `PLACEHOLDER_ITEMS` and the `// Phase 2: wire…` comment; fetch real listings (category tabs + search already exist — wire them to the query params); listing detail with preview carousel, price, Buy button → checkout redirect; "Owned" badge via entitlements.
- Success return path: on `?digital_success=true&order_id=`, poll the order until `paid`, then show a Download action calling the download endpoint. Put the Owned/Download surface in `FurBinScreen` (a compact "Marketplace models" section) — keep it minimal.
- Signed preview URLs expire (~15 min): render-then-refetch on error is fine; do not cache them in localStorage.

### 7. Cleanup (do these in the same pass)
- `server/marketplaceAdmin.ts`: if you extracted a shared signed-preview helper, have `listingPreviews`/`listingAssets` use it too (one implementation).
- `.env.example`: no new vars expected; if Stripe success-URL base needs `APP_URL` note, it already exists — do not duplicate.
- `IMPLEMENTATION_SPEC.md`: flip Phase 4 row to shipped with test counts; move any newly-resolved open items.
- Delete nothing else; no drive-by refactors of `server.ts`.

## Hard constraints
1. Webhook grants; redirect never grants. 2. Private keys/unsigned URLs never in any response. 3. Pinned `asset_id` governs downloads. 4. Idempotency-Key required on checkout; replay returns the same checkout. 5. 409 on already-owned. 6. Reads expose `published` only. 7. New logic in `server/marketplacePublic.ts` (mirror `marketplaceAdmin.ts`); route glue only in `server.ts`. 8. No new deps/env vars. 9. `node:test` not Vitest.

## Tests — `tests/marketplace_purchase.test.mjs` (+ extend contracts file)
Source-level, repo style: webhook case exists inside the EXISTING handler and uses `ON DUPLICATE KEY`; checkout requires Idempotency-Key and pins asset_id; download checks `revoked_at IS NULL` before `getPrivateSignedUrl` (assert ordering); public listing module never selects `object_key` into responses (or strips it — assert); `MarketplaceScreen` has no `PLACEHOLDER_ITEMS`; success path polls orders endpoint.

## Verify, then commit
`npx tsc --noEmit` clean · `npx vite build --outDir /tmp/distcheck --emptyOutDir` (repo `dist/` may EPERM) · `npm test` baseline **647 pass / 0 fail** — no new failures (the 4 Blender-worker infra failures were fixed upstream; if they reappear they are environmental, note them) · `git add -A` + commit in the `e287f74` message style. Stale `.git/index.lock` after a crashed run: remove it.

## Out of scope
Physical marketplace prints (Phase 5) · Sketchfab ingest (3.5) · refund UI (revocation via `server/refunds.ts` setting `revoked_at` already exists — do not build UI) · any Wags/Fido's/texture change · Stripe subscription code paths.
