# Agent Prompt — Phase 3: Admin Catalog Manager (`/admin/marketplace`)

You are the implementation engineer for Phase 3 of the Pawsome3D marketplace.
Phases 0–2 are shipped. Phase 3 is the chokepoint — Phases 4 (digital
purchase), 5 (physical fulfillment), and 3.5 (Sketchfab ingest) all depend on it.

## ⚡ SCAFFOLD STATUS — read this first

The difficult parts are ALREADY BUILT, wired, compiling, and tested. Do not
rewrite them; your job is to finish the UI on top:

| Piece | Status | Where |
|---|---|---|
| Core logic: verify/versioning/publish-gate | ✅ complete | `server/marketplaceAdmin.ts` |
| All 8 admin endpoints (route glue) | ✅ complete | `server.ts` (search `requireMarketplaceAdmin`) |
| Browser upload pipeline (presign → PUT w/ progress → sha-256 → confirm) | ✅ complete | `src/lib/adminUpload.ts` |
| Screen skeleton: table, filters, publish/archive, uploads with staged progress | ✅ working | `src/components/MarketplaceAdminScreen.tsx` |
| Screen wiring (enum, path `/admin/marketplace`, nav button, shell arrays) | ✅ complete | `src/types.ts`, `src/App.tsx` |
| Contract tests | ✅ green | `tests/marketplace_admin.test.mjs` |

**Your remaining work is the AGENT TODO block at the top of
`MarketplaceAdminScreen.tsx`:** the full listing editor form, the preview-image
grid with reorder, the GLB version-history slot with replace
(`replacesAssetId`), and listing reorder controls. Everything server-side you
need already exists — if you feel the urge to add an endpoint, re-read
`server/marketplaceAdmin.ts` first; the capability is probably there.

Read these before writing any code, in this order:

1. `IMPLEMENTATION_SPEC.md` §5 — the Phase 3 contract you are implementing.
2. `MARKETPLACE_AND_STYLES_SPEC.md` §2 — architecture rationale (why the
   private bucket exists, why HeadObject verification is mandatory).
3. `server/marketplaceSchemas.ts` — every request schema you need already
   exists. Do not invent new ones; extend these if a gap appears.
4. `storage.private.ts` — the presign/verify/mint helpers already exist:
   `mintObjectKey`, `createPresignedUpload`, `headPrivateObject`,
   `validateUploadClaim`, `PRESIGNED_UPLOAD_TTL_SECONDS`.
5. `src/components/WagsAdminPanel.tsx` — the admin UI pattern to follow
   (screen enum + lazy import + `userProfile.isAdmin` gate + server-side
   `isUserAdmin` as the real guard).

## What already exists (do not rebuild)

- Tables: `marketplace_listings`, `marketplace_assets` (versioned, with
  provenance columns), `marketplace_digital_orders`, `marketplace_entitlements`
  — created idempotently in `db.ts`, mirrored in
  `server/migrations/011_marketplace.sql`.
- Zod schemas: `CreateListingSchema`, `UpdateListingSchema`,
  `ReorderListingsSchema`, `UploadUrlRequestSchema`, `ConfirmAssetSchema`,
  `UpdateAssetSchema`, `ListingQuerySchema`, `assertCommercialLicence`.
- Private storage: `storage.private.ts` (never sets an ACL, never touches the
  public bucket — enforced by `tests/marketplace_storage.test.mjs`).
- Auth: `requireAuth` + `isUserAdmin(phone)` in `server.ts` (see the
  `/api/admin/wags/*` endpoints around L1602 for the exact guard pattern).
- Seeded listings: `npm run seed:wags` inserts 33 metadata-only listings.
  Your listing UI must render these correctly (they have no assets yet).

## Build

### 1. Admin API — seven endpoints in `server.ts`

Place them with the other admin endpoints. Every one starts with:
`if (!req.user || !await isUserAdmin(req.user.phone)) return res.status(403).json({ error: "Admin only." });`

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/admin/marketplace/listings` | All statuses, newest first, include per-listing asset counts by kind. Paginate (limit ≤ 200). |
| POST | `/api/admin/marketplace/listings` | `CreateListingSchema`. Mint `uuid` server-side (`randomUUID`). Status starts `draft`. |
| PATCH | `/api/admin/marketplace/listings/:id` | `UpdateListingSchema`. On transition to `published`: load the listing's assets and run `assertCommercialLicence` — reject 422 with the guard's message on failure. Publishing also requires ≥1 active `preview_image` and, if `digital_price_cents` is set, ≥1 active `source_glb`. Archiving must NOT touch entitlements. |
| POST | `/api/admin/marketplace/listings/:id/reorder` | `ReorderListingsSchema`, batch `sort_order` update in one transaction. |
| POST | `/api/admin/marketplace/upload-url` | `UploadUrlRequestSchema` → `validateUploadClaim` → `mintObjectKey(listingUuid, mime)` → `createPresignedUpload`. Return `{ uploadUrl, objectKey, expiresAt }`. Listing must exist. |
| POST | `/api/admin/marketplace/assets` | `ConfirmAssetSchema`. **Call `headPrivateObject(objectKey)` and reject 422 if it returns null or its `sizeBytes`/`mimeType` disagree with the claim.** Insert the asset row (`bucket='private'` for `source_glb`; preview images in this phase also go to the private bucket and are served to the admin UI via short signed URLs — moving public previews to the media bucket is Phase 4 wiring). If `replaces_asset_id` is set: mark that row `superseded`, insert with `version = old.version + 1`. Never delete objects. |
| PATCH | `/api/admin/marketplace/assets/:id` | `UpdateAssetSchema` — reorder or supersede only. |

### 2. Admin UI — `src/components/MarketplaceAdminScreen.tsx`

Follow the `WagsAdminPanel` pattern exactly: `Screen.ADMIN_MARKETPLACE` in
`src/types.ts`, path `/admin/marketplace` in `SCREEN_PATHS`, lazy import,
render block gated on `userProfile.isAdmin` (with the same non-admin
HomePage fallback used by `ADMIN_WAGS`), header nav button next to the
existing `PackageCheck` admin button (use a different lucide icon, e.g.
`Store`), and add the screen to both shell screen arrays.

Capabilities, per `IMPLEMENTATION_SPEC.md` §5:
- Listing table: name, category, status chip, price, asset counts, updated-at.
  Filter by status. Create / edit / publish / archive. Reorder via up/down
  buttons writing `sort_order` (drag-and-drop not required this phase).
- Listing editor: all `CreateListingSchema` fields. Enforce client-side what
  the schema enforces server-side (e.g. physical requires a size range) so
  admins see errors before submitting.
- Upload flow (the critical piece):
  1. request upload-url → 2. `PUT` the file bytes directly to `uploadUrl`
  with `Content-Type` set to the file's MIME (browser → Backblaze; the file
  NEVER goes through the app server) → 3. compute sha256 in the browser
  (`crypto.subtle.digest("SHA-256", buffer)`) → 4. POST `/assets` to confirm.
  Show per-file progress and a clear failure state for each step.
- GLB slot: one active `source_glb` shown with version history (superseded
  rows listed read-only). Replace = the upload flow with `replaces_asset_id`.
- Preview images: up to 8, reorderable, shown via signed URLs returned by the
  listings endpoint (generate them server-side in the GET, TTL default).

### 3. Tests — `tests/marketplace_admin.test.mjs` (+ extend contracts)

Follow the repo's node:test conventions (source-level assertions where DB/HTTP
is not available; see `tests/wags_delivery.test.mjs` for the style):

- All seven endpoints exist and each contains the `isUserAdmin` guard line.
- The confirm endpoint calls `headPrivateObject` before any INSERT into
  `marketplace_assets` (assert source ordering, like the credit-grant test).
- Publish transition calls `assertCommercialLicence`.
- Replacement inserts a new version and supersedes; no `DELETE FROM
  marketplace_assets` and no object deletion anywhere in the new code.
- The upload flow in `MarketplaceAdminScreen.tsx` PUTs to `uploadUrl` and
  never POSTs file bytes to an `/api/` route.
- Archive path contains no writes to `marketplace_entitlements`.

## Hard constraints (violating any of these fails review)

1. Security criteria 1–12 in `IMPLEMENTATION_SPEC.md` §9 apply verbatim.
   In particular: private `object_key`s never appear in any non-admin
   response; client-declared size/MIME are never trusted; object keys are
   only ever minted by `mintObjectKey`.
2. `server.ts` is ~270k lines — add endpoints, do not refactor surrounding
   code. New logic beyond route glue goes in `server/marketplaceAdmin.ts`
   (new module, mirroring `server/wags/delivery.ts`).
3. Do not touch: the Stripe webhook, `print_orders`, the Wags code paths,
   `storage.ts` (public), or anything under `blender-worker/`.
4. No new npm dependencies. No new env vars — everything needed exists
   (`MEDIA_PRIVATE_BUCKET_NAME` etc. are documented in `.env.example`).
5. Node test runner (`node:test` via `npm test`), NOT Vitest. TypeScript
   must pass `npx tsc --noEmit`. The Vite build must succeed.

## Verification before you finish

1. `npx tsc --noEmit` — zero errors.
2. `npx vite build --outDir /tmp/distcheck --emptyOutDir` — succeeds
   (building into the repo `dist/` may EPERM in the sandbox; use /tmp).
3. `npm test` — baseline is **628 pass / 4 fail**; the 4 known failures are
   Blender-worker infra (`animator_import`, `animator_worker`, 2 job-queue
   subtests). You may not add a single new failure.
4. `git add -A && git commit` with a message following the style of `b7dcf34`
   (grouped bullets, test counts stated).

## Known repo gotchas

- `git` may leave a stale `.git/index.lock` on aborted runs — if commit
  fails with "File exists", the lock is stale and must be removed.
- `.env.example` is tracked but `.env*` is otherwise gitignored; add any new
  variable documentation to `.env.example` only (there should be none).
- The repo root contains many spec .md files; only the ones listed at the top
  are normative for this phase.

## Out of scope (do not build, even partially)

- Public marketplace API and `MarketplaceScreen` wiring (Phase 4).
- Stripe checkout, entitlements, downloads (Phase 4).
- Physical print resolver (Phase 5).
- Sketchfab ingest UI (Phase 3.5 — but your provenance fields and
  `assertCommercialLicence` wiring are what it will plug into).
- Any change to Wags, Fido's Styles, or the texture re-bake.
