# Marketplace, Asset Ownership & Fido's Styles — Full Specification

**Status:** Architecture compiled and verified against the repository. Awaiting sign-off before implementation.
**Author:** Project engineer
**Date:** 2026-07-19
**Repo:** PawsMemories / Pawsome3D (`server.ts` ~267k lines, `db.ts` ~150k lines, Vite + React SPA in `src/`)

---

## 0. Scope

This update does five things:

1. Builds a real marketplace with admin-managed catalog, private asset storage, digital entitlements, and physical print fulfillment.
2. Replaces the `MarketplaceScreen` placeholder catalog with real API calls.
3. Replaces the four external `lh3.googleusercontent.com` featured-model images with four local assets.
4. Removes the "Coming Soon" / "Under Construction" module section from the homepage.
5. Rebuilds Fido's Styles as a real workspace backed by the Hermes/Outlines looks pipeline — relocated to the VPS workspace — replacing fake geometry, the Edison-bulb placeholder, simulated motion, and `localStorage`-only saves, and adding user-selectable quality tiers.

Changes the hero headline copy. Evaluates Sketchfab as an asset source (§7).

**Non-goals:** Animation Studio, Video Generation, and AR remain gated and are not linked from any surface touched here.

---

## 1. Verified starting state

Everything below was read from the repository, not assumed.

### 1.1 What already exists and stays authoritative

| System | Location | Notes |
|---|---|---|
| Stripe | `server.ts` — webhook at L377, checkout sessions at L1708, L3472, L3876, L4043, L4131 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Backblaze / S3 storage | `storage.ts` | `MEDIA_BUCKET_NAME/_URL/_KEY/_SECRET`, `forcePathStyle: true`, `ACL: "public-read"` |
| Slant 3D print | `server/slant3d.ts`, `POST /api/print/slant3d/checkout` (L4023) | `SLANT3D_API_KEY`, `SLANT3D_PLATFORM_ID`, `SLANT3D_DEFAULT_FILAMENT_ID`, `SLANT3D_API_BASE_URL` |
| Auth | `requireAuth`, `AuthedRequest`, `isUserAdmin(phone)` in `server.ts` | Bearer token, `paws_auth_token` in `localStorage` via `src/api.ts` |
| Admin identity | `ADMIN_KEY` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `isUserAdmin()` already used at L596, L1083, L1402, L2315, L3560, L4226 |
| Print orders | `print_orders` table, `db.ts` L305 | `source_type ENUM('creation','avatar')` — **must be widened** |
| Hermes looks | `server/hermes/router.ts` L266 `POST /api/hermes/looks`, `hermes_jobs` table, `hermes-looks-worker/` (Outlines + Pydantic `LookSpecV1`) | Already built. Reused as-is. |
| Look schema | `HermesLookSpecSchema` in `server/hermes/schemas.ts` L158 | `pawsome.look-spec.v1` — outfit, pose, environment, camera, lighting, render_prompt, negative_prompt |
| Wardrobe | `src/wardrobe/catalog.ts` | Exactly 15 items, `WARDROBE_ITEM_IDS` set, metric units, anchor points |
| Rate limiting | `paidLimiter`, `express-rate-limit` | Applied to paid endpoints |

### 1.2 What is placeholder and must go

| Placeholder | Location | Replacement |
|---|---|---|
| 4 featured models on external Google CDN | `src/components/HomePage.tsx` L16–48 `FEATURED_MODELS` | Local `public/featured-models/*.jpg` |
| Hero headline | `HomePage.tsx` L104–107 | New copy |
| `LOCKED_MODULES` + Coming Soon section | `HomePage.tsx` L73–77 (data), L319–354 (markup) | Deleted entirely |
| 6 marketplace items, external CDN | `src/components/MarketplaceScreen.tsx` L18–25 `PLACEHOLDER_ITEMS` | Real `GET /api/marketplace/listings` |
| `// Phase 2: wire to marketplace backend` comment | `MarketplaceScreen.tsx` L4 | Removed once wired |
| Edison bulb card | `src/components/FidosStylesScreen.tsx` L295 | Real lighting inspector |
| `localStorage` saves | `FidosStylesScreen.tsx` L127, L173, L233 | Authenticated project persistence |
| `UnderConstructionLock` on `Screen.PAWLISHER` | `src/App.tsx` L785–790 | Real `FidosStylesScreen` |
| Procedural wardrobe geometry | `src/wardrobe/catalog.ts` `geometry: "procedural-web-derivative"` | Real GLB + attachment metadata |

### 1.3 Storage decision — Backblaze cannot do per-object ACLs

**Direction given:** reuse the same Backblaze bucket already used as the media bucket.

**Verified constraint that blocks this for paid assets:** Backblaze B2's S3-compatible API does **not** support object-level ACLs. Objects inherit the bucket's ACL, only the canned values `private` and `public-read` are accepted, and attempting to set an object ACL that differs from its parent bucket returns **403 Forbidden**. Access control on B2 is a bucket-level property, full stop.

The consequence is concrete: `MEDIA_BUCKET_NAME` is a public bucket, so **any object written into it is publicly readable by anyone holding the URL**, regardless of what ACL the code requests. A paid source GLB placed there would be:

- downloadable without purchase by anyone who obtains or guesses the URL
- impossible to revoke after a refund — the URL keeps working forever
- outside any entitlement check, because no check is on the path

Unguessable UUID keys do not fix this. That is obscurity, not access control, and it fails permanently the first time a URL is shared, logged, cached by a proxy, or leaked in a referrer header.

**Resolved — private bucket created 2026-07-20.** Verified live in the B2 console (account `robs46859`):

| Bucket | Type | Bucket ID | Endpoint |
|---|---|---|---|
| `pawsmemories-media` | **Public** | `c15667b7d70e989096e50111` | `s3.us-east-005.backblazeb2.com` |
| `pawsmemories-private` | **Private** | `21c667f7876e78f096f50111` | `s3.us-east-005.backblazeb2.com` |

Same account, same endpoint, encryption and Object Lock left disabled to match the existing bucket. Nothing was moved; the public bucket is untouched (612 files, 769.6 MB).

```
MEDIA_PRIVATE_BUCKET_NAME="pawsmemories-private"
MEDIA_SIGNED_URL_TTL_SECONDS="900"                   # optional, default 900
```

**Blocked — a new application key is required.** Key scope was inspected in the console. Neither existing key can reach the new bucket:

| Key name | keyID | `bucketName` | Usable for private bucket? |
|---|---|---|---|
| Master Application Key | `16777e806511` | `-` (all buckets) | Yes, but **do not use** — full account control including `deleteBuckets` and `writeKeys` |
| `pawsmemories-app-key` | `00516777e8065110000000001` | `pawsmemories-media` | **No** — pinned |
| `pawsmemories-private-media` | `00516777e8065110000000003` | `pawsmemories-media` | **No** — pinned, despite the name |

> **Naming trap.** The key called `pawsmemories-private-media` is scoped to the **public** `pawsmemories-media` bucket. It has `listAllBucketNames`, which makes it look broader than it is, but the `bucketName` restriction confines it to the public bucket. Do not assume from the name that it is the private-bucket key — it is not. Recommend renaming or deleting it once the real key exists, because this will mislead someone during an incident.

**Action required by the account owner** (deliberately not automated — creating a key emits a secret that must not pass through this session): in **B2 → Application Keys → Add a New Application Key**, create a key with access to **all buckets** (leave the bucket restriction unset) and capabilities `listBuckets, listFiles, readFiles, writeFiles, deleteFiles, shareFiles`. `shareFiles` is what permits presigned GET generation and is **required** for the entitlement-gated download path. Copy the `keyID` and `applicationKey` straight into the deployment environment — the secret is displayed exactly once and should not be pasted into this conversation.

Then set both clients to that key. If you prefer to keep the existing public-bucket key in place, the alternative is two credential pairs (`MEDIA_BUCKET_KEY/_SECRET` for public, a new `MEDIA_PRIVATE_BUCKET_KEY/_SECRET` for private); a single all-buckets key is simpler and is what §2.1 assumes.

Preview images, look variations, and all existing media continue to go to the current public bucket. Nothing already stored moves.

**If a second bucket is genuinely unacceptable,** the only other secure option is to proxy downloads through Hostinger: keep the GLB in a private store and have `server.ts` stream bytes to the user after checking entitlement. This works and needs no presigning, but it puts every 100 MB GLB body through Hostinger — the exact cost the presigned-upload design was built to avoid — and it is slower for the user. Presigned GET from a private bucket is materially better.

`@aws-sdk/s3-request-presigner` is **not** currently in `package.json` and must be added. `@aws-sdk/client-s3` ^3.1063.0 is present.

Sources: [B2 S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api), [PutObjectAcl](https://www.backblaze.com/apidocs/s3-put-object-acl)

---

## 2. Architecture — Marketplace and asset ownership

### 2.1 Storage boundaries

Two buckets in the **same Backblaze account**, sharing one endpoint and one credential pair, addressed through two distinct clients that are never interchangeable:

```
storage.ts         → publicMediaClient  → MEDIA_BUCKET_NAME          (bucket ACL: public-read)
storage.private.ts → privateAssetClient → MEDIA_PRIVATE_BUCKET_NAME  (bucket ACL: private)
                     both use MEDIA_BUCKET_URL / _KEY / _SECRET
```

Because B2 access control is bucket-level, the security property comes from *which bucket an object lands in*, not from any per-object flag. `storage.private.ts` therefore omits the `ACL` parameter entirely — sending `ACL: "private"` to a private bucket is redundant, and sending it to a public bucket would 403. The bucket name is the boundary.

| Content | Bucket | Access |
|---|---|---|
| Listing preview images | public media | Direct public URL |
| Purchasable source GLB | private | Presigned GET only, after entitlement check |
| STL print derivatives | private | Server-side only, never exposed to browser |
| Generated look variations | public media | Owned by generating user |

**Rule:** `storage.ts` must never write to the private bucket, and `storage.private.ts` must never write to the public one or set any ACL. Enforced by a unit test asserting no `public-read` string and no `MEDIA_BUCKET_NAME` reference appears in `storage.private.ts`, plus a startup assertion that the two bucket names differ (a misconfiguration pointing both at the same bucket must fail loudly at boot, not silently expose paid assets).

The database stores immutable object **keys**, not URLs. URLs are constructed at read time. A `sha256` hash, `size_bytes`, and `mime_type` are recorded per asset. Replacing a file inserts a new `marketplace_assets` row with an incremented `version`; the prior row is marked `superseded` and its object is **not** deleted. Existing entitlements continue to resolve to the version they were purchased against.

### 2.2 Presigned browser upload

Large GLB and image bodies never transit Hostinger.

```
Admin browser                    Hostinger (server.ts)          Backblaze
     │                                    │                          │
     ├─ POST /api/admin/marketplace/upload-url ──────────►           │
     │   {filename, mimeType, sizeBytes, kind}            │          │
     │                                    ├─ validate admin          │
     │                                    ├─ validate mime/size      │
     │                                    ├─ mint objectKey (uuid)   │
     │                                    ├─ createPresignedPost ───►│
     │   ◄─── {uploadUrl, fields, objectKey, expiresAt} ─┤          │
     ├─ PUT/POST file bytes directly ──────────────────────────────►│
     │                                    │                          │
     ├─ POST /api/admin/marketplace/assets ──────────────►          │
     │   {objectKey, sha256, sizeBytes, mimeType}         │          │
     │                                    ├─ HeadObject verify ─────►│
     │                                    ├─ confirm size + mime     │
     │                                    ├─ INSERT marketplace_assets
     │   ◄─── {assetId, version} ────────┤                          │
```

**Server-side validation on confirm is mandatory.** The presign step trusts nothing from the browser; the confirm step issues a `HeadObject` against the private bucket and rejects the asset if `ContentLength` or `ContentType` disagree with what the client claimed. An asset row is only written after that check passes.

Constraints:

- GLB: `model/gltf-binary`, max 100 MB
- Preview images: `image/jpeg`, `image/png`, `image/webp`, max 10 MB each, max 8 per listing
- Presigned URL TTL: 300 s
- Object keys: `marketplace/{listingUuid}/{assetUuid}.{ext}` — never derived from user-supplied filenames

### 2.3 Database schema

Four new tables. Created in `db.ts` alongside the existing `CREATE TABLE IF NOT EXISTS` block, following the established guarded-idempotent pattern (information_schema column check → conditional `ALTER TABLE` → `try/catch` with `console.warn`). Also delivered as `server/migrations/011_marketplace.sql` for the migration record.

```sql
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid                  CHAR(36)     NOT NULL,
  slug                  VARCHAR(140) NOT NULL,
  name                  VARCHAR(160) NOT NULL,
  breed                 VARCHAR(120) NULL,
  category              ENUM('breed','memorial','accessories','seasonal') NOT NULL,
  description           TEXT         NULL,
  tags_json             JSON         NULL,
  dimensions_json       JSON         NULL,   -- {x_mm, y_mm, z_mm}
  print_notes           TEXT         NULL,
  digital_price_cents   INT          NULL,   -- NULL = digital download disabled
  physical_enabled      TINYINT(1)   NOT NULL DEFAULT 0,
  print_size_min_mm     DECIMAL(8,2) NULL,
  print_size_max_mm     DECIMAL(8,2) NULL,
  status                ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  sort_order            INT          NOT NULL DEFAULT 0,
  created_by            VARCHAR(32)  NOT NULL,
  created_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_marketplace_uuid (uuid),
  UNIQUE KEY uniq_marketplace_slug (slug),
  INDEX idx_marketplace_status_sort (status, sort_order),
  INDEX idx_marketplace_category (category),
  CONSTRAINT fk_marketplace_creator FOREIGN KEY (created_by)
    REFERENCES users(phone) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marketplace_assets (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  listing_id        BIGINT       NOT NULL,
  asset_uuid        CHAR(36)     NOT NULL,
  kind              ENUM('source_glb','preview_image','stl_derivative') NOT NULL,
  bucket            ENUM('public','private') NOT NULL,
  object_key        VARCHAR(512) NOT NULL,
  mime_type         VARCHAR(120) NOT NULL,
  size_bytes        BIGINT       NOT NULL,
  sha256            CHAR(64)     NOT NULL,
  version           INT          NOT NULL DEFAULT 1,
  status            ENUM('active','superseded') NOT NULL DEFAULT 'active',
  sort_order        INT          NOT NULL DEFAULT 0,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_marketplace_asset_uuid (asset_uuid),
  UNIQUE KEY uniq_marketplace_object_key (object_key),
  INDEX idx_marketplace_asset_listing (listing_id, kind, status, sort_order),
  CONSTRAINT fk_marketplace_asset_listing FOREIGN KEY (listing_id)
    REFERENCES marketplace_listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marketplace_digital_orders (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone          VARCHAR(32)  NOT NULL,
  listing_id          BIGINT       NOT NULL,
  asset_id            BIGINT       NOT NULL,   -- version pinned at purchase
  price_cents         INT          NOT NULL,
  currency            CHAR(3)      NOT NULL DEFAULT 'usd',
  stripe_session_id   VARCHAR(128) NULL,
  stripe_payment_intent VARCHAR(128) NULL,
  idempotency_key     VARCHAR(128) NOT NULL,
  status              VARCHAR(40)  NOT NULL DEFAULT 'awaiting_payment',
  created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_marketplace_digital_idem (user_phone, idempotency_key),
  INDEX idx_marketplace_digital_user (user_phone),
  INDEX idx_marketplace_digital_session (stripe_session_id),
  CONSTRAINT fk_marketplace_digital_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_digital_listing FOREIGN KEY (listing_id)
    REFERENCES marketplace_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marketplace_entitlements (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone        VARCHAR(32) NOT NULL,
  listing_id        BIGINT      NOT NULL,
  asset_id          BIGINT      NOT NULL,
  digital_order_id  BIGINT      NULL,
  granted_reason    ENUM('purchase','admin_grant','refund_reversal') NOT NULL DEFAULT 'purchase',
  revoked_at        TIMESTAMP   NULL,
  created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_marketplace_entitlement (user_phone, listing_id, asset_id),
  INDEX idx_marketplace_entitlement_user (user_phone),
  CONSTRAINT fk_marketplace_ent_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_ent_listing FOREIGN KEY (listing_id)
    REFERENCES marketplace_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**`print_orders` extension.** `source_type` is currently `ENUM('creation','avatar')`. It widens to `ENUM('creation','avatar','marketplace_listing')` via the guarded `ALTER TABLE ... MODIFY COLUMN` pattern already used at `db.ts` L350–351. `source_id` then holds `marketplace_listings.id`. No existing row changes meaning; every current read path filters on `source_type` explicitly and is unaffected.

`uniq_marketplace_entitlement` is what makes entitlement granting idempotent — the webhook uses `INSERT ... ON DUPLICATE KEY UPDATE id = id`, so a replayed Stripe event cannot double-grant or error.

### 2.4 Digital purchase flow

```
Listing page
   │
   ├─ POST /api/marketplace/listings/:uuid/checkout   [requireAuth, paidLimiter, Idempotency-Key]
   │     ├─ listing.status must be 'published'
   │     ├─ listing.digital_price_cents must be non-null
   │     ├─ resolve active source_glb asset → pin asset_id
   │     ├─ if entitlement already exists → 409 "already owned"
   │     ├─ INSERT marketplace_digital_orders (status='awaiting_payment')
   │     └─ stripe.checkout.sessions.create
   │           metadata: {type:'marketplace_digital', digitalOrderId, userPhone, listingId}
   │           success_url: /fur-bin?digital_success=true&order_id=…
   │
   ├─ Stripe hosted checkout
   │
   ├─ POST /api/stripe-webhook   (checkout.session.completed)
   │     └─ case 'marketplace_digital':
   │           UPDATE …digital_orders SET status='paid', stripe_payment_intent=…
   │           INSERT …entitlements ON DUPLICATE KEY UPDATE id=id
   │
   └─ GET /api/marketplace/listings/:uuid/download   [requireAuth]
         ├─ SELECT entitlement WHERE user_phone=? AND listing_id=? AND revoked_at IS NULL
         ├─ 403 if absent
         ├─ getSignedUrl(privateAssetClient, GetObjectCommand, {expiresIn: TTL})
         └─ 302 redirect (or {url, expiresAt} JSON)
```

**The source GLB is never embedded in the page and never appears in any response before payment.** Listing responses expose preview images only. A `viewer_preview` low-poly derivative is explicitly out of scope for this phase — the public listing page shows still images.

The webhook is the source of truth. The `success_url` redirect is a UX convenience only and must never itself grant an entitlement; it polls `GET /api/marketplace/orders/:id` until `status === 'paid'`.

Refunds: the existing `server/refunds.ts` flow sets `revoked_at` on the entitlement. Download checks `revoked_at IS NULL`.

### 2.5 Physical purchase flow

```
Listing (physical_enabled = 1)
   │
   ├─ Shipping + size form  (reuses PrintRequestForm patterns)
   │
   ├─ POST /api/marketplace/listings/:uuid/print/checkout  [requireAuth, paidLimiter, Idempotency-Key]
   │     ├─ validate targetHeightMm within [print_size_min_mm, print_size_max_mm]
   │     ├─ resolve private source_glb object key SERVER-SIDE (never client-supplied)
   │     ├─ presigned GET (internal, short TTL) → Blender worker
   │     │     BLENDER_WORKER_URL + WORKER_SHARED_SECRET  (x-worker-secret)
   │     ├─ print preparation + validation → dimensions_mm, topology
   │     ├─ STL derivative → private bucket → marketplace_assets(kind='stl_derivative')
   │     ├─ Slant 3D quote  (server/slant3d.ts)
   │     ├─ INSERT print_orders (source_type='marketplace_listing', source_id=listing.id)
   │     └─ stripe.checkout.sessions.create
   │           metadata: {type:'slant3d_print_order', printOrderId, userPhone, slantOrderId}
   │
   └─ Existing webhook path at server.ts L256–293 handles it unchanged:
         payment_received → submitting → Slant submission → tracking
```

This deliberately reuses the **existing** `slant3d_print_order` webhook branch rather than adding a parallel one. The only backend change is the widened `source_type` and a new resolver that maps `marketplace_listing` → private object key, sitting alongside the existing `creation` / `avatar` resolvers.

STL derivatives are cached: if an active `stl_derivative` asset already exists for the listing at the requested height bucket, Blender preparation is skipped.

### 2.6 Admin catalog manager — `/admin/marketplace`

New route, admin-only. Guarded on **both** sides: `isUserAdmin(req.user!.phone)` on every `/api/admin/marketplace/*` endpoint (403 otherwise), and `userProfile.isAdmin` for rendering. The server guard is authoritative; the client guard is cosmetic.

Capabilities:

- Drag-and-drop GLB upload with progress, direct to Backblaze
- Multiple preview images, reorderable, replaceable
- Fields: name, breed, category, description, tags, dimensions, print notes
- Separate digital-download price (cents; blank disables digital)
- Physical-print enable/disable toggle
- Recommended print-size min/max (mm)
- Status: draft / published / archived
- Listing reordering (`sort_order`)
- Edit or unpublish without redeploying

Archiving a listing hides it from public catalog reads but **preserves existing entitlements and download access**. Deleting is not offered in the UI.

### 2.7 Endpoint contracts

Public / authenticated:

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/marketplace/listings` | public | `?category=&q=&page=`, `status='published'` only |
| GET | `/api/marketplace/listings/:uuid` | public | Preview images only; no GLB key |
| POST | `/api/marketplace/listings/:uuid/checkout` | requireAuth, paidLimiter | Digital; `Idempotency-Key` required |
| POST | `/api/marketplace/listings/:uuid/print/checkout` | requireAuth, paidLimiter | Physical; `Idempotency-Key` required |
| GET | `/api/marketplace/listings/:uuid/download` | requireAuth | Entitlement-gated signed URL |
| GET | `/api/marketplace/entitlements` | requireAuth | User's owned models (surfaces in Fur Bin) |
| GET | `/api/marketplace/orders/:id` | requireAuth | Post-checkout polling |

Admin:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/marketplace/listings` | All statuses |
| POST | `/api/admin/marketplace/listings` | Create draft |
| PATCH | `/api/admin/marketplace/listings/:id` | Edit / publish / archive |
| POST | `/api/admin/marketplace/listings/:id/reorder` | `sort_order` batch |
| POST | `/api/admin/marketplace/upload-url` | Mint presigned upload |
| POST | `/api/admin/marketplace/assets` | Confirm upload (HeadObject verify) |
| PATCH | `/api/admin/marketplace/assets/:id` | Reorder / supersede |

All request bodies validated with Zod. Note the repo has two schema conventions: `src/schemas/` (`ar.ts`, `auth.ts`, `pets.ts`, `shared.ts`) holds client-side schemas, while server-side validators are either inline in `server.ts` (e.g. `PrintPrepareSchema` at L4007) or in a module under `server/` (e.g. `server/hermes/schemas.ts`). Given the volume here, marketplace validators go in a new **`server/marketplaceSchemas.ts`**, following the `server/hermes/schemas.ts` pattern rather than adding ~200 lines inline to an already 267k-line `server.ts`.

---

## 3. Featured models

Four attached studio photographs replace the four external `lh3.googleusercontent.com` URLs in `FEATURED_MODELS`.

The four images are now in the repo root, all square 1024×1024 studio shots on neutral grey, front-facing, consistent lighting. They match the Regal Cooper treatment well. The shepherd mix from the earlier attachment set is not in the repo; these four fill the four slots, so nothing is missing.

`tuck2.png` is **Tuck**, a real dog — that is his name, not a breed. Used as the slot 3 display name.

| Repo file | Contents | Size |
|---|---|---|
| `bostron1.png` | Chihuahua — white/tan, black collar with tag | PNG, 1.37 MB |
| `frenchbd.jpg` | **Boston Terrier** — black/white tuxedo *(confirmed by owner)* | JPEG, 440 KB |
| `tuck2.png` | Tuck — cream/apricot Labradoodle | PNG, 1.62 MB |
| `shiba1.png` | White Shiba Inu | PNG, 1.18 MB |

> Filenames are unreliable and must not be used to derive breed labels: `bostron1.png` is the Chihuahua and `frenchbd.jpg` is the Boston Terrier. Destination filenames below are corrected to match contents so this does not resurface.

Renamed on move to `public/featured-models/`:

| Slot | Source | Destination | Name | Breed | Style | Size |
|---|---|---|---|---|---|---|
| 1 | `bostron1.png` | `chihuahua.png` | *(to confirm)* | Chihuahua | Realistic | 4" tall |
| 2 | `frenchbd.jpg` | `boston-terrier.jpg` | *(to confirm)* | Boston Terrier | Realistic | 5" tall |
| 3 | `tuck2.png` | `tuck.png` | **Tuck** | Labradoodle | Realistic | 6" tall |
| 4 | `shiba1.png` | `shiba-inu.png` | *(to confirm)* | Shiba Inu | Realistic | 5" tall |

**Preprocessing before commit.** The three PNGs total 4.2 MB, which is heavy for above-the-fold homepage images. Each is converted to WebP at quality 82 and **center-cropped** from square 1024×1024 to 800×1000, matching the `aspect-[4/5]` render box at 2× density, with a JPEG fallback. The subjects are centered in all four frames, so a symmetric horizontal crop loses only background. Expected result is roughly 60–90 KB per card, cutting ~4 MB off first paint. Originals are kept in the repo but excluded from `public/`.

Note the card is portrait 4:5 while the sources are square, so `object-cover` would crop at render time anyway — doing it at build time simply avoids shipping pixels the browser will discard.

Per your instruction, all four carry the **"Realistic"** style label, matching the existing Regal Cooper card exactly.

**Card treatment is unchanged.** The existing markup at `HomePage.tsx` L160–188 is preserved verbatim:

- `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, `gap-5`
- `glass-showcase group cursor-pointer overflow-hidden rounded-[1.6rem]`
- `aspect-[4/5]` crop, `object-cover`
- `transition-transform duration-300 group-hover:scale-105`
- Gradient overlay `from-black/60`, name + `{breed} · {style}`
- Footer row: size, price, hover-revealed "Customize →"

Two changes only: the `src` values become local paths, and `referrerPolicy="no-referrer"` is dropped (no longer needed for local assets).

Clicking a card calls `onOpenCreate` — which already routes to the real Create flow (`Screen.CREATE`). The listing carries the design as inspiration via a `?inspiration=` query param read by `CreateScreen`.

> **Implementation blocker:** the four images are attached to this conversation but the uploads directory is empty on disk, so they cannot yet be written to `public/featured-models/`. Re-attach them as files, or drop them into the project folder, before Phase 4 begins. The fifth attached image (cream Labradoodle) is unused per the four-slot decision.

---

## 4. Hero copy

`src/components/HomePage.tsx` L104–107.

**Before:**
```
Turn your pet into something you can hold.
```

**After:**
```
Create a memory that lasts forever 🐾
```

The existing `<span className="text-primary">` split highlights "you can hold." The new headline has no natural two-part split, so it renders as a single `<h1>` with the paw emoji inline. The `text-3xl sm:text-4xl lg:text-5xl font-black leading-tight tracking-tight` classes are unchanged.

The emoji gets `role="img"` and `aria-label="paw print"` for screen readers.

Supporting paragraph and both CTAs (`hero-create-cta`, `hero-marketplace-cta`) remain beneath it, unmodified.

---

## 5. Coming Soon section removal

Delete from `src/components/HomePage.tsx`:

- `LOCKED_MODULES` const (L73–77)
- The entire `{/* ─────────────── LOCKED MODULES ─────────────── */}` section (L319–354)
- Now-unused imports: `Lock`, `Construction`

This removes all three cards: Animation Studio, Video Generation, Fido's Styles.

Fido's Styles becomes reachable through normal navigation once Phase 5 lands. Animation Studio and Video Generation are simply not advertised — `src/shellNavigation.ts` already omits "Animate" from `SIDEBAR_NAV` with an explanatory comment, and `src/App.tsx` L798–803 keeps `UnderConstructionLock` on `Screen.ANIMATOR` as a defensive backstop for anyone who reaches the route directly. That backstop stays.

`src/components/Dashboard.tsx` L68–70 also surfaces "Fido's Styles" and "Animation Studio" tiles; the Animation Studio tile is removed there for consistency, and the Fido's Styles tile is repointed at the real screen.

---

## 6. Fido's Styles workspace

Replaces `UnderConstructionLock` at `src/App.tsx` L785–790 with the real `FidosStylesScreen` on `Screen.PAWLISHER`.

Layout organization is inspired by Tripo's workspace structure as documented in `TRIPO_UX_REVIEW.md`. **No Tripo branding, code, markup, or proprietary assets are copied** — only the general arrangement of rail / config / viewport / inspector, which is a conventional DCC layout.

### 6.1 Desktop layout

```
┌──────┬────────────────────┬───────────────────────────────┬──────────────┐
│ Tool │  Configuration     │      Central workspace        │  Inspector   │
│ rail │  panel             │      (GLB viewer)             │              │
│      │                    │                               │  ┌─────────┐ │
│ Looks│  Model selection   │   orbit · zoom · reset cam    │  │ Assets  │ │
│ Ward-│  Reference photo   │   lighting controls           │  │Properties│ │
│ robe │  Prompt            │   before/after compare        │  └─────────┘ │
│ Mat- │  Style presets     │   fullscreen                  │              │
│ erials│ Wardrobe choices  │   loading / error states      │  My models   │
│ Light│  Advanced settings │                               │  Wardrobe    │
│ Export│                   │                               │  Saved looks │
│      │  [Generate Looks]  │                               │  Variations  │
│      │                    │                               │  Colors      │
│      │                    │                               │  Materials   │
│      │                    │                               │  Export      │
└──────┴────────────────────┴───────────────────────────────┴──────────────┘
```

**Left tool rail:** Looks · Wardrobe · Materials · Lighting · Export. No animation tools.

**Configuration panel:** model selection, reference-photo upload, prompt, style presets, wardrobe choices, advanced generation settings, Generate Looks.

**Central workspace:** large interactive GLB viewer — orbit, zoom, reset camera, lighting controls, before/after comparison, fullscreen, explicit loading and error states. Built on the existing `@react-three/fiber` + `@react-three/drei` stack already imported by `FidosStylesScreen.tsx` (`Canvas`, `OrbitControls`, `Bounds`, `Environment`, `useGLTF`), wrapped in the existing `AnimatorErrorBoundary` which already handles WebGL2 absence and OOM.

**Right inspector:** Assets and Properties tabs — user's models, wardrobe library, saved looks, generated variations, colors, materials, export options.

**Mobile:** viewport-first. Bottom tool tabs; configuration and asset panels slide up as sheets. The existing `isMobile()` helper (`FidosStylesScreen.tsx` L38) drives the switch.

### 6.2 What is removed

| Removed | Current location |
|---|---|
| Edison-bulb placeholder card | L295 |
| `localStorage.getItem("pawlisher_light")` | L127 |
| `localStorage.setItem("pawlisher_light", …)` | L173 |
| `localStorage.setItem("pawlisher_controls", …)` | L233 |
| Simulated motion presets (`idle`/`happy`/`sit`/`walk`/`prance` as fake transforms) | L21, model component |
| Procedural fake geometry | via `src/wardrobe/catalog.ts` |

`localStorage` remains in use for the auth token only (`src/api.ts` `paws_auth_token`). No workspace state persists there.

### 6.3 Real wardrobe assets

`src/wardrobe/catalog.ts` currently describes 15 items as `geometry: "procedural-web-derivative"` — box approximations, not real meshes. Each becomes a real GLB with attachment metadata:

```ts
interface WardrobeAttachment {
  targetBone: string;           // skeleton bone name, validated against skeletonContract.ts
  position: [number, number, number];   // meters, relative to bone
  rotation: [number, number, number];   // radians, XYZ euler
  scale: [number, number, number];
  speciesCompatibility: ("dog" | "cat")[];
  physicalUnits: "meter";
}
```

The **15-item limit remains enforced per user**, server-side, using the existing `WARDROBE_ITEM_IDS` set as the validation allowlist. Existing metric conventions are preserved: `sourceUnits: "meter"`, `conversionToMeters: 1`, `axes: "right-handed-y-up"`. Existing CC0 attribution fields (`sourceLibrary`, `sourceUrl`, `license`) are retained on every item.

Bone names are validated against `skeletonContract.ts` at load — specifically `SKELETON_CONTRACTS.quadruped.allBones` (chains: `spine`, `neckHead`, `limbs`, `tail`; e.g. `hips`, `spine`, `chest`, `neck`, `head`, `front_paw.L`). An attachment referencing an unknown bone fails loudly rather than silently rendering at the origin.

### 6.4 Generate Looks — VPS Hermes workspace

**Change of direction:** the Gemma-on-Pixel path is too slow. Look planning moves to the configurable Hermes workspace on the VPS.

**This requires no application code change.** `server/hermes/config.ts` already treats the bridge as a configurable remote: `loadHermesConfig()` reads `HERMES_EDGE_BRIDGE_URL` and `HERMES_EDGE_PRODUCER_SECRET`, enforces HTTPS (loopback allowed only under `NODE_ENV=test`), rejects URLs carrying credentials, query strings, or fragments, and applies `HERMES_TIMEOUT_MS`. Repointing from the Pixel to the VPS is a **deployment configuration change**:

```
HERMES_ENABLED="true"
HERMES_EDGE_BRIDGE_URL="https://<vps-host>/hermes"     # must be HTTPS, no query/fragment
HERMES_EDGE_PRODUCER_SECRET="<shared secret>"
HERMES_TIMEOUT_MS="10000"                              # raise toward 60000 only if measured
```

`HERMES_TIMEOUT_MS` is validated to an integer between 100 and 60000 and defaults to 10000. The Pixel path routinely exceeded that ceiling — the VPS workspace must plan within it. **Measure p95 planning latency on the VPS before setting this**; if planning cannot land under ~10 s, the fix is a faster model or a warm worker, not a larger timeout, because the user is waiting.

The VPS workspace must expose the same contract the current worker does — `POST /v1/looks/plan`, accepting the validated `looks` payload and returning a `pawsome.look-spec.v1` document. `hermes-looks-worker/` (Outlines + Pydantic `LookSpecV1`) is the reference implementation and should be deployed to the VPS rather than rewritten, preserving constrained decoding. **Constrained decoding is not optional** — it is what makes the plan schema-valid by construction instead of by retry.

Unchanged and not to be weakened: the server re-validates the returned plan against `HermesLookSpecSchema` (`schemas.ts` L158) at `router.ts` L328 **before** anything reaches the image generator. A validation failure is a hard stop. Photos still never enter the language model; only text metadata is relayed.

```
Browser
   ├─ POST /api/hermes/looks            [requireStrictHermesAuth, router.ts L266]
   │     HermesLooksPayloadSchema (schemas.ts L139) + quality tier
   │
   ├─ Hermes bridge ──► VPS workspace   POST /v1/looks/plan
   │     Outlines + LookSpecV1 constrained decoding
   │
   ├─ Server re-validates against HermesLookSpecSchema   ← hard gate
   │
   ├─ Structured plan → image generator at the selected tier
   │
   ├─ Variations → public media bucket
   │
   └─ GET /api/hermes/jobs/:id  (router.ts L268) → poll
```

Rate limit `looks: 10` per window (`router.ts` L26) is retained.

### 6.5 Quality tiers — user-facing options

The current wardrobe is 15 procedural box approximations. That is the "not what was in place" problem: it looks like placeholder geometry because it is. Users get an explicit quality choice instead.

Three tiers, presented as a choice **before** generating, with the cost and wait stated up front:

| Tier | What the user gets | Wait | Cost |
|---|---|---|---|
| **Draft** | Fast preview to check framing and pose. Lower resolution, 1 variation. | ~10–20 s | Free / lowest credits |
| **Standard** | Full-resolution looks suitable for sharing. Up to 4 variations. | ~1–2 min | Mid credits |
| **Studio** | Highest fidelity, print- and portfolio-grade. Up to 4 variations, upscaled, best available generator. | ~3–5 min | Highest credits |

Design rules so this does not confuse people:

1. **Name the outcome, not the technology.** "Draft / Standard / Studio", never model names, step counts, or sampler settings. Advanced settings stay collapsed behind "Advanced" for the few who want them.
2. **State cost and wait before commitment.** Each tier card shows credits and an honest time estimate. No surprises after the click.
3. **Default to Standard.** Pre-selected, marked "Recommended". Most users should never have to think about this.
4. **Draft is a stepping stone, not a dead end.** After a Draft renders, offer "Regenerate at Studio quality" using the same seed and plan — so exploring cheaply then committing is the natural path.
5. **One control, not a matrix.** Tier sets resolution, variation count, generator, and upscaling together. Users never assemble a valid combination themselves.
6. **Show progress honestly.** Real stages ("Planning your looks" → "Rendering 2 of 4"), driven by actual job state from `GET /api/hermes/jobs/:id`. No fake progress bars.
7. **Never silently downgrade.** If Studio capacity is unavailable, say so and offer to queue or drop to Standard — decided by the user, not by the server.

Tier is carried as a new optional `quality_tier: "draft" | "standard" | "studio"` field on the looks payload, defaulting to `standard` so existing callers are unaffected. Credits are charged through the existing `CREDIT_PRICES` mechanism (`src/pricing.ts`, already imported by `FidosStylesScreen.tsx`), and the existing admin bypass (`isUserAdmin` → cost 0, the pattern at `server.ts` L2481 and L2805) applies unchanged.

Generated variations persist to Backblaze and appear in both the user's **Fur Bin** (`Screen.FURBIN`) and the Fido's Styles inspector.

### 6.6 Project persistence

New `fidos_projects` table. Projects, selected wardrobe items, prompts, settings, and generation history persist through authenticated API calls — no local-only saves.

```sql
CREATE TABLE IF NOT EXISTS fidos_projects (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone        VARCHAR(32) NOT NULL,
  avatar_id         INT         NULL,
  name              VARCHAR(160) NOT NULL,
  prompt            TEXT        NULL,
  wardrobe_json     JSON        NULL,   -- selected item ids, max 15
  settings_json     JSON        NULL,   -- lighting, camera, materials
  created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fidos_user (user_phone, updated_at),
  CONSTRAINT fk_fidos_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

| Method | Path |
|---|---|
| GET | `/api/fidos/projects` |
| POST | `/api/fidos/projects` |
| PATCH | `/api/fidos/projects/:id` |
| DELETE | `/api/fidos/projects/:id` |

Generation history reads from the existing `hermes_jobs` table filtered on `job_type = 'looks'` and `owner_key = user_phone` — no duplicate history table.

### 6.7 Isolation from gated features

Animation and AR are not linked or exposed from this workspace. Specifically:

- `onGoToAnimator` is removed from `FidosStylesScreenProps` (currently declared at L15)
- No motion, timeline, or clip controls in the tool rail
- `MotionPreset` type and its UI are deleted
- The existing `UnderConstructionLock` backstop on `Screen.ANIMATOR` stays in place

---

## 7. Sketchfab evaluation

Assessed against `https://sketchfab.com/developers`. Sketchfab exposes five APIs: OAuth2 login, Data API v3 (search/upload/collections), Download API, Viewer API, and oEmbed.

### 7.1 The headline number, and the catch

Sketchfab offers **over 1 million free models under Creative Commons licenses, most allowing commercial use**, delivered as **glTF, GLB, and USDZ** — exactly the formats this stack already consumes (`useGLTF`, `@gltf-transform/*`, and USDZ for the AR path).

Two constraints govern how it can actually be used:

**Constraint 1 — download requires an end-user Sketchfab account.** Sketchfab is explicit: *"Downloading models requires users to be authenticated with a Sketchfab account. This means that end-users must be able to log in or create a Sketchfab account inside your application."* Making a pet owner create a Sketchfab account to put a bandana on their dog would be an absurd funnel. An exemption exists — Sketchfab invites you to contact them for app-level download without end-user auth — but it is a business conversation, not a config flag, and cannot be assumed.

**Constraint 2 — "most allow commercial use" is not "all do".** CC-BY permits commercial use *with attribution*. CC-BY-NC forbids it outright. A marketplace that sells prints and digital downloads is unambiguously commercial. Ingesting a CC-BY-NC asset into a paid listing is a licence violation.

### 7.2 Recommended use — admin-side ingest, not end-user browsing

Both constraints dissolve if Sketchfab is used **at curation time by the admin**, never at runtime by users:

```
Admin (authenticated to Sketchfab with the ADMIN account)
   │
   ├─ Data API v3 search   filter: downloadable=true, licence ∈ {CC0, CC-BY}
   │                       category: Animals & Pets / Fashion & Style
   ├─ Review candidates in the admin catalog manager
   ├─ Download API → GLB  (one time, admin's own account — constraint 1 satisfied)
   ├─ Blender normalise: scale to metres, Y-up, origin at anchor,
   │                     decimate to web budget, bake attachment metadata
   ├─ Store in OUR Backblaze bucket
   └─ Record licence + author + source URL in marketplace_assets
```

This yields: no end-user Sketchfab accounts, no runtime dependency on a third party, no surprise if a model is deleted upstream, deterministic performance, and licence provenance captured per asset at ingest.

Two schema additions on `marketplace_assets` support it:

```sql
source_provider    ENUM('original','sketchfab') NOT NULL DEFAULT 'original',
source_url         VARCHAR(512) NULL,
source_author      VARCHAR(190) NULL,
source_license     VARCHAR(40)  NULL,   -- 'CC0','CC-BY-4.0',…
attribution_text   VARCHAR(500) NULL,
```

A publish-time guard rejects any listing whose assets carry a non-commercial licence. Attribution renders on the listing page and in the downloaded package for CC-BY assets — CC-BY attribution is a *condition of the licence*, so this must be automatic, not manual.

### 7.3 Where it genuinely improves the product

**Wardrobe — the strongest case.** The 15 wardrobe items are currently procedural boxes flagged `geometry: "procedural-web-derivative"`. Sketchfab's Fashion & Style category can replace them with real modelled collars, bandanas, hats, and capes. This directly answers "high quality assets, not what was in place," and it is the single highest-visibility quality win available. Effort is admin curation, not modelling.

**Marketplace catalog seeding.** The Animals & Pets category can seed breed models so the marketplace is not empty at launch — a cold-start catalog is the most common reason a marketplace fails to convert. CC0 only for anything sold.

**Viewer API — deliberately declined.** Sketchfab's embedded viewer is capable, but this app already renders GLB through `@react-three/fiber` + `@react-three/drei` with an existing `AnimatorErrorBoundary` handling WebGL2 absence and OOM. Swapping in a third-party iframe would surrender control of the workspace, add a network dependency to the core interaction, and fracture the design system. Keep the in-house viewer.

**oEmbed — small, real marketability win.** Turning a shared Pawsome3D model link into a live 3D embed on social and in blogs is genuinely useful for organic reach. Worth revisiting *after* public model pages exist; not this phase.

### 7.4 Marketability assessment

| Lever | Impact | Honest read |
|---|---|---|
| Real wardrobe assets replacing boxes | **High** | Biggest perceived-quality jump per hour spent. Users judge instantly. |
| Non-empty catalog at launch | **High** | Removes the cold-start problem. |
| Faster catalog expansion | Medium | Curate in hours instead of modelling in weeks. |
| Licence provenance recorded | Medium | Defensive, but real — a licence dispute on a paid marketplace is expensive. |
| oEmbed social embeds | Medium | Deferred. Organic reach, not conversion. |
| Sketchfab as a brand signal | Low | Users do not care where geometry came from. Do not market it. |

**Where it does not help:** the core value proposition is *your* pet turned into *your* model. Sketchfab supplies accessories and catalog filler around that, never the pet itself. It is a cost and time lever, not a differentiator, and should not be positioned publicly as a feature.

### 7.5 Required before adopting

1. Confirm intended use against the [Developer Guidelines](https://sketchfab.com/developers/guidelines) and [API Terms of Use](https://sketchfab.com/developers/terms) — commercial redistribution of downloaded assets inside a paid product is the specific clause to read.
2. Decide the licence allowlist. **Recommend CC0 only for anything sold**, CC0 + CC-BY (with automatic attribution) for free wardrobe items.
3. If end-user download is ever wanted, open the exemption conversation with Sketchfab early.
4. Add `SKETCHFAB_API_TOKEN` as an **admin-only server-side** variable. Never `VITE_`-prefixed.

Sources: [Developers overview](https://sketchfab.com/developers), [Download API](https://sketchfab.com/developers/download-api), [Data API v3](https://sketchfab.com/developers/data-api/v3)

---

## 8. Security requirements

These are non-negotiable acceptance criteria.

1. **Private GLB keys never leave the server.** No listing, order, or project response may contain a private `object_key` or an unsigned private URL. Enforced by a contract test asserting no `marketplace/` key appears in any public listing response body.
2. **Every download is entitlement-checked** at request time, not at page load. `revoked_at IS NULL` is part of the check.
3. **Admin endpoints are server-guarded.** `isUserAdmin()` on all seven `/api/admin/marketplace/*` routes. A non-admin token receives 403 with no listing data.
4. **Presigned uploads are confirmed with HeadObject** before an asset row is written. Client-declared size and MIME type are never trusted.
5. **Object keys are server-minted UUIDs.** User filenames are stored as display metadata only and never used in a key path — no traversal surface.
6. **Idempotency keys are required** on both checkout endpoints, matching the existing Slant 3D pattern at L4030.
7. **Entitlements are granted only by the Stripe webhook**, never by a redirect.
8. **Signed URL TTL is short** (default 900 s) and configurable.
9. No secret is added to any `VITE_`-prefixed variable. This includes `SKETCHFAB_API_TOKEN` and `HERMES_EDGE_PRODUCER_SECRET`.
10. `.gitleaks.toml` is checked to confirm the new variable names are covered by secret scanning.
11. **Paid assets are never written to the public bucket.** Startup assertion that `MEDIA_BUCKET_NAME !== MEDIA_PRIVATE_BUCKET_NAME`; boot fails loudly if they match. B2 gives no per-object fallback, so the bucket split is the entire security boundary.
12. **Non-commercial licences cannot be published.** Publish-time guard rejects any listing whose assets carry a licence forbidding commercial use.
13. **The Hermes bridge URL must be HTTPS.** Already enforced by `loadHermesConfig()`; not to be relaxed when repointing at the VPS. HTTP loopback stays test-only.

---

## 9. Phase order

Phases are sequenced so each is independently shippable and independently revertible.

| Phase | Contents | Risk | Depends on |
|---|---|---|---|
| **0** | Repoint `HERMES_EDGE_BRIDGE_URL` at the VPS workspace · deploy `hermes-looks-worker` there · measure p95 planning latency | Low — config only, no code | VPS workspace reachable over HTTPS |
| **1** | Hero copy · Featured models (convert, rename, move) · Coming Soon removal · Dashboard tile cleanup | Low — presentation only | **Unblocked** — images are in the repo |
| **2** | `storage.private.ts` · add `@aws-sdk/s3-request-presigner` · env vars · migration `011_marketplace.sql` · `db.ts` guarded DDL · `print_orders` ENUM widening | Medium — schema | Private bucket created in B2 |
| **3** | Admin catalog manager · presigned upload · asset confirm · listing CRUD | Medium | Phase 2 |
| **3.5** | Sketchfab admin ingest · licence allowlist · Blender normalise · attribution fields | Low–Medium | Phase 3 + terms review |
| **4** | Digital purchase · entitlements · webhook branch · signed download · `MarketplaceScreen` wired to real API | High — money | Phase 3 |
| **5** | Physical purchase · marketplace resolver · Blender prep · STL derivative · Slant quote | High — money + fulfillment | Phase 4 |
| **6** | Fido's Styles workspace · real wardrobe GLBs · quality tiers · Generate Looks wiring · `fidos_projects` · unlock `Screen.PAWLISHER` | Medium–High | Phases 0, 2, 3.5 |

**Phase 0 and Phase 1 are both unblocked and independent of everything else.** Phase 0 is a pure config change — no code, immediately revertible by restoring the old URL. Phase 1 touches no backend, no schema, no payments, and the images are now in the repo. Either can ship today.

Phase 3.5 is sequenced before Phase 6 because the wardrobe quality upgrade is what makes the Fido's Styles rebuild worth shipping — rebuilding the workspace around procedural boxes would waste the effort.

---

## 10. Testing

Following the existing `node:test` convention (`npm test` → `tsx --test tests/*.test.mjs`; note the repo uses **node:test, not Vitest**).

| Suite | File | Covers |
|---|---|---|
| Schema | `tests/marketplace_schema.test.mjs` | Guarded DDL idempotency, re-run safety, ENUM widening |
| Storage | `tests/marketplace_storage.test.mjs` | Private client never sets public ACL; key minting; HeadObject verification |
| Entitlement | `tests/security/marketplace_entitlement.test.mjs` | Download 403 without entitlement; 403 after revocation; webhook replay grants once |
| Admin guard | `tests/security/marketplace_admin.test.mjs` | All seven admin routes 403 for non-admin |
| Contract | `tests/contracts/marketplace_listing.test.mjs` | No private key in any public response |
| Checkout | `tests/marketplace_checkout.test.mjs` | Idempotency-Key required; duplicate key returns same session |
| Looks | `tests/fidos_looks.test.mjs` | Invalid LookSpec blocks image generation; 15-item wardrobe limit enforced |
| Wardrobe | `tests/wardrobe_attachment.test.mjs` | Every attachment bone exists in `skeletonContract.ts` |

Manual smoke additions to `SMOKE_CHECKLIST.md`: admin upload → publish → purchase → download → revoke → download blocked.

---

## 11. Open items requiring your input

### Resolved since first draft

- ~~Featured model image files~~ — now in the repo (`bostron1.png`, `frenchbd.jpg`, `tuck2.png`, `shiba1.png`). Phase 1 unblocked.
- ~~Hermes planning latency~~ — moving to the VPS workspace; config-only change, no code.
- ~~Slot 3 display name~~ — **Tuck**.
- ~~Breed label on `frenchbd.jpg`~~ — confirmed **Boston Terrier**. Destination filename corrected to `boston-terrier.jpg`.

- ~~Private bucket~~ — **created**: `pawsmemories-private`, Private, same account and endpoint (§1.3).
- ~~B2 key scope question~~ — **answered**: both existing keys are pinned to the public bucket; a new all-buckets key is needed (§1.3).

### Blocking

1. **Create the new B2 application key.** All-buckets, capabilities including `shareFiles`. Owner must do this — the secret is shown once and must not pass through this session. Blocks Phase 2.
2. **VPS Hermes endpoint + secret.** HTTPS URL and producer secret for `HERMES_EDGE_BRIDGE_URL` / `HERMES_EDGE_PRODUCER_SECRET`. Not yet supplied — the VPS host was not reachable from this session. Blocks Phase 0.
4. ~~**Image generator for looks.**~~ **Resolved** — see `GEMINI_CALL_AUDIT.md` §4.5. It is Gemini, via the existing `IMAGE_MODELS` chain at `server.ts` L2131. Tiers map onto the Nano Banana family: Draft → `gemini-3.1-flash-lite-image`, Standard → `gemini-3.1-flash-image`, Studio → `gemini-3-pro-image`. No new provider, key, or client needed. Only `gemini-3.1-flash-lite-image` must be added to the chain.

### Needed before the relevant phase

5. **Three remaining display names** — slots 1, 2, 4 (Chihuahua, Boston Terrier, Shiba Inu). Slot 3 is Tuck.
7. **Digital pricing model.** Per-listing admin-entered, or a platform default?
8. **Quality tier pricing.** Credit cost for Draft / Standard / Studio. Recommend Draft free to drive activation.
9. **Sketchfab licence allowlist.** Recommend CC0 only for anything sold; CC0 + CC-BY with automatic attribution for free wardrobe items. Requires the terms review in §7.5.
10. **Wardrobe GLB source.** Sketchfab curation (§7.2), the cited Quaternius CC0 pack, or authored in-house?
