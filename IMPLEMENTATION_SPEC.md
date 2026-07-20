# Pawsome3D — Full Implementation Specification

**Status:** Architecture fully mapped. Phase 0 and Phase 1 shipped; Phases 2–6 specified and ready to build.
**Date:** 2026-07-20
**Supersedes:** the architecture sections of `MARKETPLACE_AND_STYLES_SPEC.md`, which remains the record of *why* each decision was made. This document is the build order.

**Companion documents**
- `MARKETPLACE_AND_STYLES_SPEC.md` — decision rationale, Sketchfab evaluation, UX rules
- `GEMINI_CALL_AUDIT.md` — every Gemini invocation, line-referenced

---

## 0. Verified infrastructure

Everything in this section was confirmed live on 2026-07-20, not assumed.

### 0.1 Backblaze B2 — account `robs46859`

| Bucket | Type | Bucket ID | Endpoint |
|---|---|---|---|
| `pawsmemories-media` | **Public** | `c15667b7d70e989096e50111` | `s3.us-east-005.backblazeb2.com` |
| `pawsmemories-private` | **Private** | `21c667f7876e78f096f50111` | `s3.us-east-005.backblazeb2.com` |

The private bucket was created for this work. The public bucket is untouched (612 files, 769.6 MB).

**Why two buckets, not one.** B2's S3-compatible API does not support object-level ACLs: objects inherit the bucket ACL, only `private` and `public-read` are accepted, and setting a differing object ACL returns 403. Access control on B2 is a bucket-level property. Anything written to the public bucket is world-readable by URL with no revocation path — unacceptable for paid assets. The bucket boundary *is* the security boundary.

**Application keys.** Both pre-existing keys are pinned to `pawsmemories-media` and cannot reach the new bucket:

| Key | keyID | `bucketName` |
|---|---|---|
| Master | `16777e806511` | `-` (all) — do not use in the app |
| `pawsmemories-app-key` | `…0000000001` | `pawsmemories-media` |
| `pawsmemories-private-media` | `…0000000003` | `pawsmemories-media` ← **name is misleading** |

A new all-buckets key with `shareFiles` (required for presigned GET) replaces them. Delete the two pinned keys once it is verified.

### 0.2 Hostinger VPS `srv1830764`

KVM 2, Boston 2, IP `2.24.87.40`, 8 GB / 100 GB disk, 4% CPU, 12% memory. Weekly backups.

| Docker project | Containers | Status | Exposed at |
|---|---|---|---|
| `hermes-agent-nxqw` | 1 | Running | `https://hermes-agent-nxqw.srv1830764.hstgr.cloud` |
| `hermes-producer-relay` | 2 | Running | **`https://hermes.pawsome3d.com`** |
| `traefik` | 1 | Running | (reverse proxy / TLS) |

`GET https://hermes.pawsome3d.com/health` returns:

```json
{"status":"ok","database":"ok","service":"hermes-producer-relay","version":"1.0.0",
 "worker":{"status":"active","last_seen_at":"2026-07-20T12:45:30Z",
           "last_completed_model":"gemma-4-e2b","last_completed_at":"2026-07-17T03:10:02Z"}}
```

**Read this carefully — it changes the plan.** The relay is healthy and a worker is heartbeating, but `last_completed_model` is `gemma-4-e2b` and `last_completed_at` is **three days stale**. Per `hermes-looks-worker/README.md`, `gemma-4-e2b` is the Android/Pixel LiteRT-LM worker. The evidence is consistent with the relay running on the VPS while the *worker behind it is still the Pixel*.

If that holds, **repointing `HERMES_EDGE_BRIDGE_URL` at the VPS does not fix latency** — it just moves the queue endpoint while jobs still wait on the phone. Verification and remedy are Phase 0.5 below.

---

## 1. Phase status

| Phase | Contents | Status |
|---|---|---|
| **0** | Gemini weakness fixes; repo repair | ✅ **Shipped** |
| **1** | Hero copy, featured models, Coming Soon removal | ✅ **Shipped** |
| **2** | Private storage layer + marketplace schema | ✅ **Shipped** |
| **W1–W2** | Wags subscription, planner (Gemini), admin review panel | ✅ **Shipped** |
| **W3** | Delivery: plan→box_items materialization, wardrobe unlocks, credit grants, Wags Inbox (`/wags`), unboxing reveal | ✅ **Shipped** |
| **T1** | Accessory Texturizer (presets/color/pattern) | ✅ Shipped, **gated digital-only** |
| **T2** | AI texture endpoint | ❌ **Cancelled** — STL/Slant path is single-color; textures can never print. Gate recorded in the Texture panel + Export panel. UV plan supersedes. |
| **Seed** | `npm run seed:wags` — 33 listings (15 base + 12 Wags-exclusive + 6 collectible templates), idempotent by slug | ✅ **Shipped** |
| **UV8** | Texture re-bake from reference photos (with minimal UV1 audit + UV4 projection-bake): worker job `rebake_texture.py`, `/texture/rebake` endpoint, `texture_jobs` table (012), `/api/texture/rebake` + poll endpoints, "Texture repair" action in Fido's Styles Surface panel with reversible viewer override | ✅ **Shipped** — needs live worker validation (bpy code cannot run in CI; see tests/texture_rebake.test.mjs for the contracts under test) |
| **UV1–UV7, UV9** | Remaining pet-mesh UV texture generation | 📋 Planned — `UV_TEXTURE_GENERATION_PLAN.md` |
| **0.5** | Verify Hermes worker location; deploy looks worker to VPS | Config done; worker location needs SSH |
| **3** | Admin catalog manager | Depends on 2 |
| **3.5** | Sketchfab admin ingest | Depends on 3 |
| **4** | Digital purchase + entitlements | Depends on 3 |
| **5** | Physical purchase + fulfillment | Depends on 4 |
| **6** | Fido's Styles workspace + quality tiers | Depends on 2, 3.5, 0.5 |

---

## 2. Phase 0 — shipped

### 2.1 Repo repair (blocking, found during verification)

`tripo.ts` and `ollama-agent.ts` were **tracked in git but deleted from the working tree**. The server could not boot; `tsc` reported 3 module-resolution errors and 5 test suites failed with `Server exited early with code 1`. Restored from commit `b656b17`.

Result: `tsc --noEmit` clean, test failures 10 → 5.

### 2.2 Gemini fixes (`GEMINI_CALL_AUDIT.md` §4)

| Finding | Fix |
|---|---|
| §4.1 `GEMINI_TEXT_FALLBACK_MODEL` declared but read nowhere | New `TEXT_MODELS` chain reads `GEMINI_TEXT_MODEL` + `GEMINI_TEXT_FALLBACK_MODEL`. Defaults preserve prior behaviour exactly. |
| §4.2 Log named `gemini-2.5-flash-image`, code called `gemini-2.0-flash-exp` | Single `fallbackModel` const drives both log and call; they cannot drift again. |
| §4.3 Silent `"placeholder-key"` fallback | Throws in production; warns loudly in dev/test so offline work and mock suites still boot. |
| §4.5 Tier models absent | `gemini-3.1-flash-lite-image` added to `IMAGE_MODELS`; `IMAGE_MODELS_BY_TIER` added for Phase 6. |

### 2.3 Phase 1 — UI

- Hero: "Turn your pet into something you can hold." → **"Create a memory that lasts forever 🐾"**, with `role="img"` / `aria-label` on the emoji.
- Featured models: four hotlinked `lh3.googleusercontent.com` URLs → local WebP. **4.6 MB → 88 KB total**, third-party CDN removed from the above-the-fold critical path. Added `width`/`height` (prevents layout shift), `loading="lazy"`, `decoding="async"`.
- Coming Soon section, `LOCKED_MODULES`, and the now-unused `Lock` / `Construction` imports deleted.
- `Dashboard` import removed from `App.tsx` — the component is **orphaned**: imported but never rendered, since `Screen.DASHBOARD` renders `HomePage`. `Dashboard.tsx` left on disk pending a decision (see §9).

Featured model mapping — repo filenames do **not** match contents:

| Source | Contents | Destination |
|---|---|---|
| `bostron1.png` | Chihuahua | `chihuahua.webp` |
| `frenchbd.jpg` | Boston Terrier (owner-confirmed) | `boston-terrier.webp` |
| `tuck2.png` | Tuck, a Labradoodle | `tuck.webp` |
| `shiba1.png` | White Shiba Inu | `shiba-inu.webp` |

Verified: `vite build` clean, all eight assets emitted, 573/579 tests pass.

---

## 3. Phase 0.5 — Hermes worker relocation

**Goal:** looks planning completes in under `HERMES_TIMEOUT_MS` (100–60000, default 10000) without depending on the Pixel.

### 3.1 Verify first

Before changing anything, establish where the worker actually runs. Over SSH (`root@srv1830764.hstgr.cloud`):

```bash
docker compose -p hermes-producer-relay ps        # what are the 2 containers?
docker compose -p hermes-producer-relay logs --tail=200
```

Two outcomes:

- **Worker is already a VPS container** → the stale `last_completed_at` is just idleness. Repoint the env, run a live job, measure p95. Done.
- **Worker is the Pixel** (expected, given `gemma-4-e2b`) → §3.2.

### 3.2 Deploy the looks worker to the VPS

`hermes-looks-worker/` is the reference implementation and should be **deployed, not rewritten** — it already enforces Outlines + Pydantic `LookSpecV1` constrained decoding, which is what makes plans schema-valid by construction rather than by retry.

```
hermes-looks-worker/  →  docker build  →  VPS container
  env: HERMES_LOOKS_MODEL_ID       (Transformers-compatible Gemma 4 E2B —
                                    NOT the Android .litertlm file)
       HERMES_LOOKS_WORKER_TOKEN   (bridge→worker bearer)
  contract: POST /v1/looks/plan  →  pawsome.look-spec.v1
```

Sizing note: KVM 2 with 8 GB is workable for Gemma 4 E2B on CPU but will not be fast. If measured p95 exceeds ~10 s, the fix is a warm/persistent worker process or a smaller model — **not** a larger `HERMES_TIMEOUT_MS`. The user is waiting on this call.

### 3.3 Configuration (no code change)

`server/hermes/config.ts` already treats the bridge as a configurable remote and enforces HTTPS, rejecting URLs with credentials, query strings, or fragments.

```
HERMES_ENABLED="true"
HERMES_EDGE_BRIDGE_URL="https://hermes.pawsome3d.com"    # no path — client appends /v1/jobs
HERMES_EDGE_PRODUCER_SECRET="<relay producer secret>"
HERMES_TIMEOUT_MS="10000"
```

**Acceptance:** a real looks job completes end-to-end, `last_completed_at` advances, and p95 planning latency is recorded in `SMOKE_CHECKLIST.md`.

---

## 4. Phase 2 — storage layer and schema ✅ SHIPPED

**Delivered:** `storage.private.ts`, `server/marketplaceSchemas.ts`, `server/migrations/011_marketplace.sql`, guarded DDL in `db.ts`, `@aws-sdk/s3-request-presigner@^3.1090.0`, and 29 new tests (`tests/marketplace_storage.test.mjs` ×11, `tests/marketplace_schemas.test.mjs` ×18). Suite 579 → 608 tests, `tsc --noEmit` clean, no new failures.

Also fixed: `tests/fidos_styles_viewer.test.mjs` pointed at `PawlisherScreen.tsx`, renamed long ago to `FidosStylesScreen.tsx`, so it had been failing on ENOENT rather than testing anything. With the path corrected it now runs and **legitimately fails** — it asserts the Edison bulb and `pawlisher_light` localStorage are gone, which is Phase 6 work. Treat it as a pre-written acceptance test for §8.2; it turns green when Phase 6 lands.

The sections below record the design as built.



### 4.1 `storage.private.ts`

New module. Never writes to the public bucket, never sets an ACL (redundant on a private bucket, 403 on a public one).

```ts
const privateBucket = process.env.MEDIA_PRIVATE_BUCKET_NAME;
const privateClient = new S3Client({
  region: "us-east-1",
  endpoint: process.env.MEDIA_BUCKET_URL,          // same endpoint
  credentials: {
    accessKeyId:     process.env.MEDIA_PRIVATE_BUCKET_KEY    || process.env.MEDIA_BUCKET_KEY!,
    secretAccessKey: process.env.MEDIA_PRIVATE_BUCKET_SECRET || process.env.MEDIA_BUCKET_SECRET!,
  },
  forcePathStyle: true,
});
```

Exports: `putPrivateObject`, `headPrivateObject`, `getPrivateSignedUrl`, `mintObjectKey`.

**Boot assertion.** If `MEDIA_PRIVATE_BUCKET_NAME === MEDIA_BUCKET_NAME`, throw. A misconfiguration pointing both at the public bucket must fail loudly, because B2 offers no per-object fallback to catch it.

Add `@aws-sdk/s3-request-presigner` (not currently in `package.json`).

### 4.2 Object keys

Server-minted UUIDs only. User filenames are display metadata, never part of a key path — no traversal surface.

```
marketplace/{listingUuid}/{assetUuid}.{ext}
```

### 4.3 Schema

Four new tables plus `fidos_projects`, created in `db.ts` using the established guarded-idempotent pattern (information_schema check → conditional `ALTER TABLE` → `try/catch` + `console.warn`), and mirrored as `server/migrations/011_marketplace.sql`.

Full DDL is in `MARKETPLACE_AND_STYLES_SPEC.md` §2.3. Summary:

| Table | Owns |
|---|---|
| `marketplace_listings` | Metadata, pricing, status, ordering |
| `marketplace_assets` | Versioned B2 objects + licence provenance |
| `marketplace_digital_orders` | Stripe state for digital purchases |
| `marketplace_entitlements` | Proof a user may download |
| `fidos_projects` | Workspace persistence |

`marketplace_assets` carries the Sketchfab provenance columns (`source_provider`, `source_url`, `source_author`, `source_license`, `attribution_text`) from the start, so Phase 3.5 needs no migration.

**`print_orders` widening.** `source_type ENUM('creation','avatar')` → `ENUM('creation','avatar','marketplace_listing')` via the guarded `MODIFY COLUMN` pattern already at `db.ts` L350. No existing row changes meaning; every current read path filters `source_type` explicitly.

**Idempotency.** `uniq_marketplace_entitlement (user_phone, listing_id, asset_id)` lets the Stripe webhook use `INSERT … ON DUPLICATE KEY UPDATE id = id`, so a replayed event cannot double-grant.

---

## 5. Phase 3 — admin catalog manager

Route `/admin/marketplace`. Guarded on both sides; the server guard is authoritative.

Server validators go in **`server/marketplaceSchemas.ts`** (following `server/hermes/schemas.ts`), not inline in the already 267k-line `server.ts`, and not in `src/schemas/` which holds client-side schemas.

### 5.1 Presigned upload

```
POST /api/admin/marketplace/upload-url   → { uploadUrl, fields, objectKey, expiresAt }
   ↓ browser PUTs bytes directly to B2 (never through Hostinger)
POST /api/admin/marketplace/assets       → HeadObject verify → INSERT
```

**The confirm step is not a formality.** It issues `HeadObject` against the private bucket and rejects the asset if `ContentLength` or `ContentType` disagree with the client's claim. Client-declared size and MIME are never trusted.

Limits: GLB `model/gltf-binary` ≤ 100 MB; images `image/jpeg|png|webp` ≤ 10 MB, ≤ 8 per listing; presign TTL 300 s.

### 5.2 Endpoints

| Method | Path |
|---|---|
| GET | `/api/admin/marketplace/listings` |
| POST | `/api/admin/marketplace/listings` |
| PATCH | `/api/admin/marketplace/listings/:id` |
| POST | `/api/admin/marketplace/listings/:id/reorder` |
| POST | `/api/admin/marketplace/upload-url` |
| POST | `/api/admin/marketplace/assets` |
| PATCH | `/api/admin/marketplace/assets/:id` |

All call `isUserAdmin(req.user!.phone)` → 403 with no listing data otherwise.

Archiving hides a listing from public reads but **preserves existing entitlements and download access**. Deletion is not offered.

Replacing a file inserts a new `marketplace_assets` row with an incremented `version` and marks the prior `superseded`; the old object is not deleted, so existing entitlements keep resolving to the version purchased.

---

## 6. Phase 4 — digital purchase

```
POST /api/marketplace/listings/:uuid/checkout   [requireAuth, paidLimiter, Idempotency-Key]
  ├─ status must be 'published'; digital_price_cents non-null
  ├─ resolve active source_glb asset → pin asset_id
  ├─ existing entitlement → 409 already owned
  ├─ INSERT digital_order (awaiting_payment)
  └─ stripe.checkout.sessions.create
        metadata: { type: 'marketplace_digital', digitalOrderId, userPhone, listingId }

POST /api/stripe-webhook  (checkout.session.completed)
  └─ case 'marketplace_digital':
       UPDATE order → paid
       INSERT entitlement ON DUPLICATE KEY UPDATE id = id

GET /api/marketplace/listings/:uuid/download    [requireAuth]
  ├─ entitlement WHERE user_phone=? AND listing_id=? AND revoked_at IS NULL
  ├─ 403 if absent
  └─ presigned GET, TTL = MEDIA_SIGNED_URL_TTL_SECONDS
```

**The webhook is the only thing that grants entitlement.** The `success_url` redirect is UX convenience and must never grant — it polls `GET /api/marketplace/orders/:id` until `status === 'paid'`.

Refunds (`server/refunds.ts`) set `revoked_at`; downloads check `revoked_at IS NULL`.

Public listing responses expose preview images only. A low-poly `viewer_preview` derivative is explicitly out of scope this phase — listing pages show stills.

`MarketplaceScreen.tsx` drops `PLACEHOLDER_ITEMS` and the `// Phase 2: wire to marketplace backend` comment, and reads `GET /api/marketplace/listings`.

---

## 7. Phase 5 — physical purchase

```
POST /api/marketplace/listings/:uuid/print/checkout  [requireAuth, paidLimiter, Idempotency-Key]
  ├─ validate targetHeightMm ∈ [print_size_min_mm, print_size_max_mm]
  ├─ resolve private GLB key SERVER-SIDE (never client-supplied)
  ├─ presigned GET (internal, short TTL) → Blender worker
  │     BLENDER_WORKER_URL + WORKER_SHARED_SECRET (x-worker-secret)
  ├─ print prep + validation → dimensions_mm, topology
  ├─ STL derivative → private bucket → marketplace_assets(kind='stl_derivative')
  ├─ Slant 3D quote (server/slant3d.ts)
  ├─ INSERT print_orders (source_type='marketplace_listing', source_id=listing.id)
  └─ stripe.checkout.sessions.create
        metadata: { type: 'slant3d_print_order', … }   ← existing shape
```

This deliberately **reuses the existing webhook branch** at `server.ts` L256–293 (`payment_received → submitting → Slant → tracking`) rather than adding a parallel one. The only backend additions are the widened `source_type` and a resolver mapping `marketplace_listing` → private object key, alongside the existing `creation` / `avatar` resolvers.

STL derivatives are cached per height bucket; an existing active derivative skips Blender.

---

## 8. Phase 6 — Fido's Styles workspace

Replaces `UnderConstructionLock` on `Screen.PAWLISHER` (`src/App.tsx`) with the real screen.

### 8.1 Layout

Rail / config / viewport / inspector. Organisation is inspired by Tripo's workspace as documented in `TRIPO_UX_REVIEW.md`; **no Tripo branding, code, or assets are copied** — this is a conventional DCC arrangement.

- **Left rail:** Looks · Wardrobe · Materials · Lighting · Export. No animation tools.
- **Config panel:** model selection, reference photo, prompt, style presets, wardrobe, advanced settings, Generate Looks.
- **Viewport:** GLB viewer — orbit, zoom, reset camera, lighting, before/after, fullscreen, explicit loading and error states. Built on the existing `@react-three/fiber` + `drei` stack already imported by `FidosStylesScreen.tsx`, wrapped in `AnimatorErrorBoundary` (already handles WebGL2 absence and OOM).
- **Right inspector:** Assets / Properties tabs — models, wardrobe, saved looks, variations, colours, materials, export.
- **Mobile:** viewport-first, bottom tool tabs, slide-up sheets. Existing `isMobile()` helper drives the switch.

### 8.2 Removals

| Removed | Was at |
|---|---|
| Edison-bulb placeholder | `FidosStylesScreen.tsx` L295 |
| `localStorage` workspace saves | L127, L173, L233 |
| Simulated motion presets | `MotionPreset`, L21 |
| Procedural fake geometry | `src/wardrobe/catalog.ts` |
| `onGoToAnimator` prop | L15 |

`localStorage` remains only for the auth token (`src/api.ts`).

### 8.3 Wardrobe

The 15 items are currently `geometry: "procedural-web-derivative"` — box approximations. They become real GLBs with attachment metadata:

```ts
interface WardrobeAttachment {
  targetBone: string;                    // validated against SKELETON_CONTRACTS.quadruped.allBones
  position: [number, number, number];    // metres, relative to bone
  rotation: [number, number, number];    // radians, XYZ euler
  scale:    [number, number, number];
  speciesCompatibility: ("dog" | "cat")[];
  physicalUnits: "meter";
}
```

Bone names validate at load against `skeletonContract.ts` (`hips`, `spine`, `chest`, `neck`, `head`, `front_paw.L`, …). An unknown bone fails loudly rather than silently rendering at the origin.

The **15-item limit stays enforced server-side** using `WARDROBE_ITEM_IDS` as the allowlist. Metric conventions (`sourceUnits: "meter"`, `conversionToMeters: 1`, `axes: "right-handed-y-up"`) and CC0 attribution fields are preserved.

### 8.4 Generate Looks

```
Browser  (text metadata only — photos never enter the language model)
  ├─ POST /api/hermes/looks     [requireStrictHermesAuth, router.ts L266]
  │     HermesLooksPayloadSchema + quality_tier
  ├─ bridge → VPS worker   POST /v1/looks/plan   (Outlines + LookSpecV1)
  ├─ server re-validates against HermesLookSpecSchema   ← HARD GATE, router.ts L328
  ├─ plan → Gemini image generator at the selected tier
  ├─ variations → public media bucket
  └─ GET /api/hermes/jobs/:id → poll
```

The plan is re-validated **before** anything reaches the image generator. Validation failure is a hard stop. This is already implemented and must not be weakened.

Rate limit `looks: 10` per window (`router.ts` L26) retained.

### 8.5 Quality tiers

Per `GEMINI_CALL_AUDIT.md` §4.5, the generator is Gemini via the existing client — **no new provider, key, or client**. Chains are already in `server.ts` as `IMAGE_MODELS_BY_TIER`:

| Tier | Model | Wait | Variations |
|---|---|---|---|
| **Draft** | `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | ~10–20 s | 1 |
| **Standard** *(default)* | `gemini-3.1-flash-image` (Nano Banana 2) | ~1–2 min | up to 4 |
| **Studio** | `gemini-3-pro-image` (Nano Banana Pro) | ~3–5 min | up to 4 |

Overridable per tier via `GEMINI_IMAGE_MODELS_DRAFT` / `_STANDARD` / `_STUDIO`.

UX rules, so this does not confuse people:

1. **Name the outcome, not the technology.** Never model names or sampler settings in the UI.
2. **Cost and wait shown before commitment.** No post-click surprises.
3. **Standard pre-selected**, marked Recommended. Most users never think about this.
4. **Draft is a stepping stone** — offer "Regenerate at Studio quality" reusing the same seed and plan.
5. **One control, not a matrix.** Tier sets resolution, count, model, upscaling together.
6. **Honest progress** driven by real job state ("Rendering 2 of 4"), never a fake bar.
7. **Never silently downgrade.** If Studio is unavailable, say so and let the user choose.

`quality_tier: "draft" | "standard" | "studio"` is an optional payload field defaulting to `standard`, so existing callers are unaffected. Credits charge through `CREDIT_PRICES` (`src/pricing.ts`); the existing admin bypass (`isUserAdmin` → cost 0, pattern at `server.ts` L2481/L2805) applies unchanged.

### 8.6 Isolation

Animation and AR are not linked or exposed from this workspace. The `UnderConstructionLock` backstop on `Screen.ANIMATOR` stays as a defensive route guard.

---

## 9. Security acceptance criteria

Non-negotiable.

1. **Private keys never leave the server.** No listing, order, or project response contains a private `object_key` or unsigned private URL.
2. **Every download is entitlement-checked** at request time, including `revoked_at IS NULL`.
3. **All admin endpoints server-guarded** with `isUserAdmin()`.
4. **Presigned uploads confirmed with HeadObject** before an asset row is written.
5. **Object keys are server-minted UUIDs.**
6. **Idempotency-Key required** on both checkout endpoints.
7. **Entitlements granted only by the Stripe webhook**, never by redirect.
8. **Signed URL TTL short** (default 900 s) and configurable.
9. **No secret in any `VITE_` variable** — includes `SKETCHFAB_API_TOKEN`, `HERMES_EDGE_PRODUCER_SECRET`.
10. **Boot fails if the two bucket names match.**
11. **Non-commercial licences cannot be published.**
12. **Hermes bridge URL must be HTTPS** — already enforced; not to be relaxed.

---

## 10. Testing

`node:test` (`npm test` → `tsx --test tests/*.test.mjs`). **The repo uses node:test, not Vitest.**

| Suite | Covers |
|---|---|
| `tests/marketplace_schema.test.mjs` | Guarded DDL idempotency, re-run safety, ENUM widening |
| `tests/marketplace_storage.test.mjs` | Private client never targets public bucket; key minting; HeadObject verify; boot assertion on matching names |
| `tests/security/marketplace_entitlement.test.mjs` | 403 without entitlement; 403 after revocation; webhook replay grants once |
| `tests/security/marketplace_admin.test.mjs` | All 7 admin routes 403 for non-admin |
| `tests/contracts/marketplace_listing.test.mjs` | No private key in any public response |
| `tests/marketplace_checkout.test.mjs` | Idempotency-Key required; duplicate returns same session |
| `tests/fidos_looks.test.mjs` | Invalid LookSpec blocks generation; 15-item limit enforced; tier→model mapping |
| `tests/wardrobe_attachment.test.mjs` | Every attachment bone exists in `skeletonContract.ts` |

### 10.1 Known pre-existing failures (5) — not introduced by this work

| Suite | Cause |
|---|---|
| `tests/fidos_styles_viewer.test.mjs` | Path fixed in Phase 2; now a **real** red test asserting the Phase 6 Edison-bulb removal. Expected to fail until §8.2 ships. |
| `animator_import`, `animator_worker end-to-end`, 2 job-queue subtests | Animator/Blender worker infrastructure not available in this environment. Animation Studio is gated and out of scope. |

Baseline before this work: 10 failures. After the `tripo.ts` / `ollama-agent.ts` restore: **5**. After Phase 2: **5 of 608** (was 5 of 579).

---

## 11. Open items

### Blocking

1. **New B2 application key** — all-buckets, `shareFiles` capability. Owner action; the secret must not pass through an assistant session. Blocks Phase 2.
2. **SSH access to `srv1830764`** to determine whether the looks worker runs on the VPS or the Pixel. Blocks Phase 0.5, which blocks Phase 6.
3. **`HERMES_EDGE_PRODUCER_SECRET`** value. Blocks Phase 0.5.

### Decisions needed

3a. **B2 key is over-privileged.** The console's "Read and Write" + All buckets granted `pawsome3d-all-buckets` (keyID `…0004`) far more than needed — it carries `deleteBuckets`, `writeKeys`, `deleteKeys`, `listKeys`, and `bypassGovernance`, which is close to master-key power. It only needs six: `listBuckets, listFiles, readFiles, shareFiles, writeFiles, deleteFiles`. If that key leaks from an env file or log, the current version lets an attacker delete both buckets and mint fresh credentials. The web UI cannot express least privilege; the CLI can:

```bash
b2 account authorize
b2 key create pawsome3d-app listBuckets,listFiles,readFiles,shareFiles,writeFiles,deleteFiles
```

Not blocking — it works and is server-side only. Harden before the marketplace holds paid assets.

4. **Digital pricing model** — per-listing admin-entered, or platform default?
5. **Quality tier credit costs.** Recommend Draft free to drive activation.
6. **Sketchfab licence allowlist.** Recommend CC0 only for anything sold; CC0 + CC-BY with automatic attribution for free wardrobe items. Requires the terms review in `MARKETPLACE_AND_STYLES_SPEC.md` §7.5.
7. **Wardrobe GLB source** — Sketchfab curation, the cited Quaternius CC0 pack, or authored in-house?
8. **`Dashboard.tsx`** — orphaned (imported but never rendered; `Screen.DASHBOARD` renders `HomePage`). Delete it, or restore it to the route? Left on disk pending this call.
9. **`gemini-2.0-flash-exp`** is an experimental preview build and is not in the current stable line-up per `geminimodels.md`, yet it is the text fallback in three places. Now overridable via `GEMINI_TEXT_FALLBACK_MODEL` — decide a stable replacement.
