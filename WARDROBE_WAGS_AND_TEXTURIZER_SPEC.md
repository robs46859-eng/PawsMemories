# Fido's Texturizer + Wardrobe Wags — Feature Specification

**Status:** Design — awaiting implementation sign-off  
**Author:** Project engineer  
**Date:** 2026-07-20  
**Depends on:** MARKETPLACE_AND_STYLES_SPEC.md Phase 6 (Fido's Styles workspace)

---

## 0. Scope

This spec adds two features on top of the Phase 6 Fido's Styles workspace:

1. **Fido's Texturizer** — a material/texture tool in the Fido's Styles left rail that lets users apply AI-generated or preset textures (patterns, colors, fabric simulations) to accessories and wardrobe items on their 3D pet model, similar in concept to Tripo3D's texture module in its 3D workspace.

2. **Wardrobe Wags** — a monthly digital subscription box (dog and cat only) that delivers a curated, personalized drop of digital wardrobe accessories, seasonal collectibles, a prefab mini-model, and a Pawprint — all generated and selected automatically but reviewed by a human admin before each box is released.

Neither feature requires a physical fulfillment path. All deliverables are digital entitlements.

---

## 1. Fido's Texturizer

### 1.0 How accessories actually sit on the model (mesh attachment)

This is the foundational question: **accessories must sit on the pet model as real meshes, not as floating geometry or painted-on images.** There is no shortcut that produces realistic results. The industry-standard approach — used by every character customization system from Fortnite to VRChat — is **skeletal bone attachment with proportional auto-scaling.** Here is exactly what that means in this stack:

**The approach:**

1. Every accessory GLB is modeled to fit a **normalized skeleton** (the `skeletonContract.ts` quadruped rig, `SKELETON_CONTRACTS.quadruped`). The modeler places the mesh so it sits correctly on a reference pet at scale 1.0.

2. Each accessory carries a `WardrobeAttachment` record specifying which bone it attaches to (`targetBone`), its resting offset in bone-local space (`position`, `rotation`, `scale`), and which species it fits (`speciesCompatibility`).

3. At runtime in the R3F viewer, the accessory GLB is loaded as a child node of the target bone in the pet's skeleton. Three.js bone transforms propagate automatically — when the pet's head bone rotates (from a Hermes-planned pose), the hat rotates with it. No simulation needed; it follows the skeleton.

4. **Auto-fit scaling.** Because real pets vary in size, the skeleton's actual bone length (measured at load from the pet GLB's skeleton) is compared to the normalized contract length. A scalar is computed and applied to the accessory's `scale` field at mount time. A collar modeled for a Labrador will auto-scale to fit a Chihuahua without manual adjustment.

5. **Texture then applies on top** of the correctly-placed mesh. The Texturizer panel described below replaces the mesh's `MeshStandardMaterial.map` with the selected texture — the mesh geometry does not change.

**What this requires from the GLB assets:**
- The pet model GLB must have a valid armature (skeleton) matching the `skeletonContract.ts` bone names.
- Each accessory GLB must be exported with the accessory mesh bound at the origin of its `targetBone` (e.g. a hat is centered at the `head` bone origin).
- Accessories that wrap around the body (a coat, a sweater) must be **skinned** to multiple bones (chest, spine, shoulders) — the mesh deforms with the pose. Rigid accessories (a hat, a badge) need only a single bone.

**Skinned vs. rigid accessories:**

| Accessory type | Attachment | Deforms with pose? |
|---|---|---|
| Hat, badge, collar tag, bow | Single bone (`head`, `neck`) | No — rigid, transforms with bone |
| Collar, bandana | 2–3 bones (`neck`, `chest`) | Minimal — slight deform |
| Coat, sweater, vest | Full upper-body skinning | Yes — mesh deforms naturally |
| Booties, paw cuffs | Single bone per paw (`front_paw.L/R`) | No — rigid |

Skinned clothing requires the accessory GLB to carry blend weights for the target bones. This is standard Blender workflow — export with armature modifier applied to the accessory mesh targeting the pet skeleton. The Sketchfab ingest pipeline (Phase 3.5) must normalize bone names during Blender processing before uploading accessories.

**There is no alternative that produces real results.** Texture-only approaches (projecting a pattern onto the pet's fur mesh) look painted on. Particle/proxy approaches (simulated cloth) are too expensive for real-time web. Skeletal attachment is the only method that is both realistic and web-viable.

### 1.1 What the Texturizer does

With a wardrobe accessory correctly attached to the skeleton (see §1.0), the Texturizer applies a surface material — color, pattern, fabric type, or a custom Gemini-generated map — to change how that accessory looks. The mesh geometry is not touched; only the `MeshStandardMaterial` is swapped. The result is a material override stored per project.

This is the "Texture" step that Tripo3D exposes as its final workspace action. Here it lives as a distinct tool panel alongside Looks, Wardrobe, Materials, Lighting, and Export in the left rail, sitting between Materials and Export.

### 1.2 Placement in the existing layout

```
Left tool rail — addition after Materials:
  Looks
  Wardrobe
  Materials
  ► Texture  ← new
  Lighting
  Export
```

The Texture panel appears in the Configuration panel column when active. The central GLB viewer updates live as texture parameters change (preview-quality, low-latency re-render).

### 1.3 Texture sources

Three input modes, presented as tabs in the Texture panel:

**Presets** — A curated grid of ~24 preset material tiles: denim, velvet, leather, linen, houndstooth, plaid, floral, stripes, polka dot, argyle, camo, tie-dye, metallic (gold, silver, bronze), glitter, mesh, fur, cotton, silk, fleece, seasonal (snowflake, pumpkin, stars-and-stripes). Each preset is a tileable texture map stored as a small PNG in `public/textures/presets/`. No AI call for presets — applied instantly.

**Color + Pattern** — A color wheel (or hex input) paired with a pattern selector (solid, chevron, argyle, stripe, dots) and a scale/rotation slider. Computed as a procedural material in the `@react-three/fiber` `MeshStandardMaterial` layer. No AI call, instant.

**AI Generate** — A short prompt ("faded indigo denim", "red leather with stitching", "festive holiday plaid in green and gold") produces a tileable texture map via Gemini image generation. The system prompt instructs Gemini to produce a seamless tileable texture suitable for fabric. One credit per generation. The result is stored as a `texture_maps` object in Backblaze (public bucket, same pattern as generated look variations).

### 1.4 Target selection

When the Texture panel is open, clicking any wardrobe item in the central viewport (or selecting it in the Wardrobe inspector) highlights it as the active texture target. A yellow outline ring appears on the selected mesh. Only one item is textured at a time; switching target preserves each item's last applied texture in the project save.

If no wardrobe item is selected, the panel shows "Select an accessory to texture it." Clicking the pet model itself (not an accessory) shows "Texturing applies to accessories — select a wardrobe item."

### 1.5 Three.js / R3F implementation

Material override is applied as a `MeshStandardMaterial` on the selected mesh node without touching the underlying GLB:

```typescript
// Simplified — texture override stored in project state, applied at render time
interface TextureOverride {
  itemId: string;          // wardrobe item ID
  mode: "preset" | "color_pattern" | "ai_generated";
  presetId?: string;       // maps to public/textures/presets/<presetId>.png
  color?: string;          // hex
  pattern?: string;        // procedural pattern key
  textureObjectKey?: string; // B2 object key for AI-generated map
  tileScale: number;       // default 1.0
  rotation: number;        // radians, default 0
}
```

The texture override is serialized into `settings_json` on the `fidos_projects` row (existing column, already planned in §6.6 of the base spec). No schema addition required for the texture data itself.

### 1.6 AI-generated texture endpoint

```
POST /api/fidos/texture/generate
  requireAuth, paidLimiter
  body: { prompt: string, itemId: string, projectId: number }
  → 202 { jobId }

GET /api/fidos/texture/jobs/:id
  requireAuth
  → { status, textureObjectKey?, error? }
```

Internally uses `generateImageWithFallback` with a texture-specific system prompt requesting a square (1024×1024) seamless tileable pattern. The result is uploaded to the public media bucket at `textures/user/{phone}/{uuid}.jpg`. Job state is stored in a lightweight `texture_jobs` in-memory cache (TTL 10 min, no new DB table needed for MVP — if the user refreshes, they simply regenerate). A second iteration can persist to a `texture_jobs` table if history is wanted.

Rate: **5 AI texture generations per user per day** — lighter than looks (10/day) since texture prompts are shorter and cheaper.

### 1.7 Export with texture

When the user exports or sends a look to the image generator, the active texture overrides are serialized as material swap instructions in the Hermes looks payload (`settings_json` field, already planned). The image generator prompt includes the texture description verbatim ("wearing a red velvet bow tie with fine stitching") so the rendered image matches the texture applied in the viewer.

---

## 2. Wardrobe Wags

### 2.1 What it is

Wardrobe Wags is a **monthly digital subscription** for dog and cat owners. On the first of each month (or the subscriber's anniversary date), they receive a "Wags Box" — a curated drop of digital content personalized to their pet. All items land as entitlements in their Fur Bin and are immediately usable in Fido's Styles and Pawprints.

Species restriction: **dogs and cats only.** Users with no dog or cat pet profile cannot subscribe (or see the feature).

### 2.2 Subscription tiers and pricing

Two tiers. Yearly plans must be presented with the savings prominently — not buried in fine print, but as the primary value signal on the pricing card (large badge, crossed-out monthly price, "Save $X" callout).

| Plan | Monthly | Yearly | Monthly equiv | You save |
|---|---|---|---|---|
| **Basic** (4 items/month) | $5/mo | $50/yr | $4.17/mo | **$10 a year — 2 months free** |
| **Plus** (10 items/month) | $10/mo | $100/yr | $8.33/mo | **$20 a year — 2 months free** |

UI rule: on the pricing screen, the yearly card is the **default selected** tab with the savings badge shown in primary color. Monthly is available but de-emphasized. The copy "2 months FREE" is larger than the price itself.

Plus Annual subscribers get one additional annual bonus: a **free digital pet-themed calendar** (12 monthly pages, one per month, each featuring a seasonal pet illustration with the subscriber's pet species). Calendar is delivered in January (or on anniversary month for mid-year sign-ups) as a Pawprint-generated PDF entitlement.

### 2.3 Box contents by tier

**Basic tier — 4 items per month:**

| Slot | Item type | Format | Notes |
|---|---|---|---|
| 1 | Wardrobe accessory | GLB (private bucket) | Breed/size personalized, sits on model via skeletal attachment (§1.0) |
| 2 | Seasonal or holiday collectible | GLB (private bucket) | Tied to current month/season — July 4th bandana, October witch hat |
| 3 | Prefab mini-model variant | GLB (public preview + private source) | Breed-template figurine in a seasonal pose, not the user's own model |
| 4 | Pawprint design | PNG + Pawprints project | Pre-built template personalized to pet species and season |

**Plus tier — 10 items per month (Basic 4 + 6 more):**

| Slot | Item type | Format | Notes |
|---|---|---|---|
| 5 | Wardrobe accessory #2 | GLB (private bucket) | Different category from slot 1 (e.g. slot 1 = outerwear, slot 5 = accessories) |
| 6 | Wardrobe accessory #3 | GLB (private bucket) | Complementary piece to complete the look (e.g. matching boots) |
| 7–11 | **Purr Pack** — 5 animal stickers | PNG, 1024×1024, transparent bg | Fun/playful pet-themed digital stickers (not NFTs — these are flat PNGs for use in Pawprints, messaging, etc.). Generated monthly by Gemini with a seasonal theme. |
| 12 | **Credit pack** | 20 credits applied to account | Standard platform credits, usable for Look generation, texture AI, restyle, video |
| 13 | **Free video generation** | Entitlement (1 use, expires next month) | Uses a premade monthly script — script changes each month, tied to the season. User selects their pet; the video is generated using the script + their existing pet model. The entitlement grants one free use of the video generation endpoint with that month's script pre-loaded. |
| 14 | **Free restyle** | Entitlement (1 use, expires next month) | Restyle an existing model in a different style: Realistic → Cartoon, Clay, Low-poly, Watercolor, etc. Model must already exist in user's assets — this is not a new creation. The entitlement gates one call to the restyle endpoint at zero credit cost. |

**Plus Annual bonus (once per year at renewal):**

| Bonus | Format | Notes |
|---|---|---|
| Digital pet calendar | PDF (12 pages) + Pawprints project | 12-month calendar with seasonal pet illustrations, species-matched. Delivered as a Pawprint-generated PDF entitlement. January delivery for annual subs starting Jan; otherwise delivered on subscription anniversary month. |

The 15-item wardrobe cap (per existing `WARDROBE_ITEM_IDS` enforcement) applies to user-curated wardrobe only. Wags Box accessories are stored in a separate `wags_wardrobe` namespace and do not count against the 15-item limit.

### 2.3 Automation architecture

```
Monthly trigger (cron: 1st of month at 02:00 UTC)
   │
   ├─ For each active subscription:
   │     ├─ Read subscriber pet profile (species, breed, name, age)
   │     ├─ Read prior boxes (avoid repeating recent items)
   │     ├─ POST /internal/wags/generate-box  [internal, worker-secret]
   │     │     ├─ Gemini prompt → box plan JSON
   │     │     │     { accessory: {...}, seasonal: {...}, minimodel: {...}, pawprint: {...} }
   │     │     ├─ Validate box plan against WagsBoxPlanSchema (Zod)
   │     │     ├─ INSERT wardrobe_wags_boxes (status = 'pending_review')
   │     │     └─ INSERT wardrobe_wags_box_items (one per slot)
   │     │
   │     └─ (box waits for admin review — not yet delivered)
   │
   ├─ Admin review gate #1 — BEFORE delivery
   │     Admin panel: /admin/wags/boxes?status=pending_review
   │     ├─ View each box: subscriber name/species/breed, AI-selected items
   │     ├─ Swap any item (pick alternate from catalog)
   │     ├─ Regenerate specific slot (re-runs Gemini for that slot only)
   │     ├─ Approve box → status = 'approved'
   │     └─ Reject box → status = 'rejected' (subscriber notified, month skipped)
   │
   ├─ Delivery job (runs after admin approval)
   │     ├─ Grant entitlements for each item (INSERT marketplace_entitlements)
   │     ├─ Create Pawprint project (INSERT into pawprints table)
   │     ├─ Send push notification / in-app notification
   │     └─ status = 'delivered'
   │
   └─ Admin review gate #2 — POST-delivery spot-check (optional, async)
         Admin can flag a delivered box for quality review
         'delivered_flagged' → admin inspects → 'reviewed_ok' or 'reviewed_issue'
         Issues: notify subscriber + offer re-delivery of affected slot
```

### 2.4 Gemini box planner prompt

The internal box generation call uses `gemini-2.5-flash` with a structured JSON schema (same constrained-decoding pattern as the Hermes looks planner):

```typescript
const WAGS_BOX_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    accessory: {
      type: "OBJECT",
      properties: {
        catalog_id: { type: "STRING" },    // references marketplace_listings.uuid
        personalization_note: { type: "STRING" },  // ≤120 chars, why this fits the pet
      },
      required: ["catalog_id", "personalization_note"],
    },
    seasonal: {
      type: "OBJECT",
      properties: {
        catalog_id: { type: "STRING" },
        theme: { type: "STRING" },
      },
      required: ["catalog_id", "theme"],
    },
    minimodel: {
      type: "OBJECT",
      properties: {
        breed_template_id: { type: "STRING" },
        pose: { type: "STRING", enum: ["sitting", "standing", "playful", "resting"] },
        seasonal_note: { type: "STRING" },
      },
      required: ["breed_template_id", "pose", "seasonal_note"],
    },
    pawprint: {
      type: "OBJECT",
      properties: {
        template_id: { type: "STRING" },
        occasion: { type: "STRING" },
        suggested_caption: { type: "STRING" },  // ≤80 chars
      },
      required: ["template_id", "occasion", "suggested_caption"],
    },
  },
  required: ["accessory", "seasonal", "minimodel", "pawprint"],
} as const;
```

The prompt includes: subscriber's pet species, breed, age, subscription month number, current month/season, list of items already delivered (to avoid repetition), and the full catalog of available items (UUIDs + names only, not GLB keys).

### 2.5 Database schema

```sql
-- Subscription record
CREATE TABLE IF NOT EXISTS wardrobe_wags_subscriptions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone            VARCHAR(32) NOT NULL,
  pet_id                INT         NOT NULL,
  species               ENUM('dog','cat') NOT NULL,
  tier                  ENUM('basic','plus') NOT NULL DEFAULT 'basic',
  billing_period        ENUM('monthly','annual') NOT NULL DEFAULT 'monthly',
  stripe_subscription_id  VARCHAR(128) NOT NULL,
  stripe_customer_id    VARCHAR(128) NOT NULL,
  status                ENUM('active','paused','cancelled') NOT NULL DEFAULT 'active',
  current_period_start  DATE        NOT NULL,
  current_period_end    DATE        NOT NULL,
  annual_bonus_delivered_year INT   NULL,   -- year the calendar bonus was last sent
  created_at            TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_wags_stripe_sub (stripe_subscription_id),
  INDEX idx_wags_user (user_phone),
  CONSTRAINT fk_wags_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Monthly box (one per subscriber per month)
CREATE TABLE IF NOT EXISTS wardrobe_wags_boxes (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscription_id     BIGINT      NOT NULL,
  user_phone          VARCHAR(32) NOT NULL,
  box_month           CHAR(7)     NOT NULL,   -- 'YYYY-MM'
  status              ENUM('pending_review','approved','rejected','delivered',
                           'delivered_flagged','reviewed_ok','reviewed_issue')
                      NOT NULL DEFAULT 'pending_review',
  plan_json           JSON        NULL,        -- raw Gemini plan
  admin_notes         TEXT        NULL,
  reviewed_by         VARCHAR(32) NULL,
  delivered_at        TIMESTAMP   NULL,
  created_at          TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_wags_box_month (subscription_id, box_month),
  INDEX idx_wags_box_status (status, created_at),
  CONSTRAINT fk_wags_box_sub FOREIGN KEY (subscription_id)
    REFERENCES wardrobe_wags_subscriptions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Line items per box (4 slots Basic, 10 slots Plus + annual bonus)
CREATE TABLE IF NOT EXISTS wardrobe_wags_box_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  box_id          BIGINT      NOT NULL,
  slot            ENUM(
    'accessory',        -- Basic slot 1
    'seasonal',         -- Basic slot 2
    'minimodel',        -- Basic slot 3
    'pawprint',         -- Basic slot 4
    'accessory_2',      -- Plus slot 5
    'accessory_3',      -- Plus slot 6
    'sticker_1',        -- Plus Purr Pack slot 7
    'sticker_2',        -- Plus Purr Pack slot 8
    'sticker_3',        -- Plus Purr Pack slot 9
    'sticker_4',        -- Plus Purr Pack slot 10
    'sticker_5',        -- Plus Purr Pack slot 11
    'credit_pack',      -- Plus slot 12 (no listing_id — credits applied directly)
    'video_gen',        -- Plus slot 13 (entitlement to free video generation)
    'restyle',          -- Plus slot 14 (entitlement to free restyle)
    'calendar'          -- Plus Annual bonus
  ) NOT NULL,
  listing_id      BIGINT      NULL,           -- FK to marketplace_listings (NULL for credits/entitlements)
  asset_id        BIGINT      NULL,           -- version pinned at time of box approval
  entitlement_type VARCHAR(60) NULL,          -- 'video_gen' | 'restyle' | 'credit_pack_20' | 'calendar'
  credit_amount   INT         NULL,           -- populated for credit_pack slot
  personalization_note VARCHAR(200) NULL,
  swapped_by_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wags_item_box (box_id, slot),
  CONSTRAINT fk_wags_item_box FOREIGN KEY (box_id)
    REFERENCES wardrobe_wags_boxes(id) ON DELETE CASCADE,
  CONSTRAINT fk_wags_item_listing FOREIGN KEY (listing_id)
    REFERENCES marketplace_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Entitlement delivery reuses `marketplace_entitlements` with `granted_reason = 'wags_delivery'` (ENUM widened by one value). No separate entitlement table.

### 2.6 Stripe subscription integration

Wardrobe Wags uses Stripe's subscription billing, not one-time checkout sessions. Four Stripe prices (two tiers × two billing periods):

| Plan | Stripe price env var |
|---|---|
| Basic monthly | `WAGS_BASIC_MONTHLY_PRICE_ID` |
| Basic annual | `WAGS_BASIC_ANNUAL_PRICE_ID` |
| Plus monthly | `WAGS_PLUS_MONTHLY_PRICE_ID` |
| Plus annual | `WAGS_PLUS_ANNUAL_PRICE_ID` |

```
POST /api/wags/subscribe
  requireAuth
  body: { petId, priceId }              -- one of the four price IDs above
  → validate species (dog/cat only)
  → stripe.subscriptions.create
  → INSERT wardrobe_wags_subscriptions  -- tier derived from priceId, status='active'
  → 200 { subscriptionId, clientSecret }

Stripe webhook — invoice.payment_succeeded
  metadata.type = 'wardrobe_wags'
  → UPDATE current_period_start/end
  → trigger box generation for the new period
  → if annual renewal AND tier='plus': queue annual calendar delivery

Stripe webhook — customer.subscription.deleted
  → UPDATE status='cancelled'
  → no more boxes generated

Stripe webhook — customer.subscription.updated
  → handle upgrade/downgrade between Basic and Plus
  → pro-rata handled by Stripe; tier column updated on our side

GET /api/wags/subscription             -- current subscription + tier
PUT /api/wags/subscription/pause       -- Stripe subscription pause
DELETE /api/wags/subscription          -- cancel at period end
```

`wardrobe_wags_subscriptions.tier` column: `ENUM('basic','plus') NOT NULL DEFAULT 'basic'`  
`wardrobe_wags_subscriptions.billing_period` column: `ENUM('monthly','annual') NOT NULL DEFAULT 'monthly'`

### 2.7 Admin panel — `/admin/wags`

Two views:

**Pending review queue** (`?status=pending_review`) — cards showing subscriber name, pet species and breed, box month, and all 4 item slots. Each slot shows the AI-selected item with thumbnail, name, and personalization note. Controls per slot: Approve, Swap (opens catalog picker), Regenerate slot. Bottom: Approve All / Reject Box.

**Delivered + flagged** — boxes already delivered. Admin can flag a specific slot for quality issue (sends subscriber a "We're making it right" notification with a replacement item).

Admin panel is guarded on server (`isUserAdmin()` on all `/api/admin/wags/*` routes) and client (`userProfile.isAdmin`).

### 2.8 User-facing surfaces

**Subscribe entry point:** Dashboard tile and a persistent "Wardrobe Wags" card in the Fido's Styles inspector (bottom of the Wardrobe panel). Species gate enforced client-side (checked against pet profile) and server-side (check `species` before INSERT).

**Wags Inbox:** A `Screen.WAGS_INBOX` (new screen, accessible from the sidebar) shows the user's box history. Each box has a countdown ("Next box in 12 days") or an unbox animation for newly delivered boxes. Tapping a slot item launches it directly in Fido's Styles or Pawprints.

**Unboxing interaction:** When a new box arrives, an animated card sequence reveals each of the 4 slots one at a time (CSS keyframe animation, no external library). The user taps "Open next" to reveal the next slot. This is the primary delight moment and the key retention driver.

**Fur Bin integration:** Wags-delivered GLBs appear in the Fur Bin under a "Wardrobe Wags" filter tab alongside the user's own creations. Entitlement check gates download (same signed-URL flow as marketplace purchases).

### 2.9 Notifications

Delivery is notified via: in-app notification (existing notification system if present), and an optional email (existing email path if present). The notification copy: "Your [Month] Wags Box is here! 🐾 4 surprises waiting."

### 2.10 Human review SLA

Target: admin approves all pending boxes within 48 hours of generation. Boxes are generated 3 days before the 1st of the month to give the review window. If a box is not reviewed within the SLA, it auto-escalates (email to admin). Boxes are never auto-approved — a human must explicitly approve.

---

## 3. Arkham note (answering the direct question)

**Arkham in this codebase = Batman's Arkham Prison themed scene presets for the Animation Studio.** Specifically, 5 environment backdrops in `server/animator/environments/` (Security Ops Center, Gymnasium, Infirmary, Approach Road, and one more), designed so your pet avatar can be placed and animated inside moody, cinematic prison interiors. These were built during Phase 7 planning (the Animation Studio) against concept renders you provided. They're wired to `GET /api/scenes/environments` and work correctly — the Animation Studio itself is still gated (`UnderConstructionLock` on `Screen.ANIMATOR`), so they're waiting in place for when that phase ships.

The "Arkham monorepo" item in the deferred list is different: it refers to the parallel `PawsMemories-*` working directories (swarm agent branches) on your Desktop that have accumulated merge conflicts and haven't been folded back into the main `PawsMemories` directory. Not a separate product — just housekeeping.

---

## 4. Phase placement

| Phase | Contents | Depends on |
|---|---|---|
| **T1** | Texturizer preset + color/pattern modes (no AI, no DB) | Phase 6 (Fido's Styles workspace live) |
| **T2** | AI texture generation endpoint + credit charge | Phase 6 + Gemini key |
| **W1** | Wardrobe Wags DB schema · Stripe subscription flow · subscribe/cancel endpoints | Phases 2 + 3 (marketplace tables + private bucket) |
| **W2** | Box generation worker · Gemini planner · admin review panel | W1 + Phase 3.5 (catalog seeded) |
| **W3** | Delivery · entitlement grant · Wags Inbox screen · unboxing animation | W2 |
| **W4** | Post-delivery spot-check · quality flag flow · notification emails | W3 |

T1 is unblocked the moment Phase 6 ships. W1 can run in parallel with Phases 2–3.

---

## 5. Open items

### Resolved
- ✅ **Wags pricing** — Basic $5/mo · $50/yr; Plus $10/mo · $100/yr. Yearly discount leads in the UI.
- ✅ **Box contents** — 4 items (Basic), 10 items (Plus). Plus Annual adds digital calendar.
- ✅ **All digital** — no physical fulfillment path for Wags.
- ✅ **Mesh attachment approach** — skeletal bone attachment with auto-fit scaling (§1.0). No alternative produces real results.

### Still open
1. **Wags catalog seeding.** The box planner selects from `marketplace_listings`. The catalog needs wardrobe accessories, seasonal collectibles, Purr Pack sticker sets, mini-model templates, and Pawprint templates listed before W2 can generate real boxes. Phase 3.5 (Sketchfab ingest) is the fastest path.
2. **Mini-model breed template library.** Prefab mini-models require one GLB per common breed. Source: Sketchfab CC0 (Animals & Pets) + Blender normalization, or in-house. How many breeds at launch? Recommend: top 20 dog breeds + 10 cat breeds = 30 templates.
3. **Monthly video script.** Each month's Plus video generation uses a premade script. Who writes the script? Recommend: Gemini drafts a 15–30 second seasonal pet-themed script each month during the box generation run; admin reviews/approves as part of the standard review gate.
4. **Species gate UX.** Recommend: "Wardrobe Wags is for dogs and cats — add a dog or cat to your profile to subscribe." Link to pet profile screen.
5. **Texture presets art.** 24 preset PNG tiles at `public/textures/presets/`. Source from ambientCG.com (CC0 tileable) or Polyhaven; resize to 512×512.
6. **Subscriber cap at launch.** Recommend 200 subscribers for month 1 while admin review workflow is being proven.
7. **Purr Pack sticker content.** 5 stickers generated by Gemini per month (seasonal animal theme). Stickers are square PNG 1024×1024 transparent bg. The monthly theme is chosen by Gemini during box generation and approved by admin. No user input — it's a surprise.
