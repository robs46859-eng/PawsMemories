# Phase BO-3: Wags Intelligence (2D materializers)

**Date:** 2026-07-23
**Branch:** `phase/bo-3-wags-intelligence` (worktree `PawsMemories-bo3`, based on `phase/bo-1-customizer-surfaces` @ `cd350d3`)
**Managed schema version:** 34 (`wags_box_item_assets`, checksum `d6ec91c3b529d73f28a958ef312317629e7628443be9aa77a400b37e94f6b23a`)

## What changed

Before this phase, the Gemini box plan materialized as color-matched picks from a
small static catalog plus **text-only rows** — no sticker PNGs, no art, nothing a
subscriber could actually see or download. Now:

### Migration 34 — `wags_box_item_assets`

Adds to `wardrobe_wags_box_items` (information_schema-guarded, additive,
`skipWhenTableMissing: wardrobe_wags_box_items`):
`asset_url TEXT`, `asset_status ENUM('none','pending','generated','failed')
DEFAULT 'none'`, `asset_error VARCHAR(255)`, `asset_generated_at DATETIME`.

### `server/wags/materializer.ts` (new)

- **Slot taxonomy:** `sticker_1..5`, `seasonal`, `pawprint` are 2D-generative;
  `accessory*`/`minimodel` are reserved for the BO-5 spatial-generator executor
  (`isFuture3dSlot`) — the seam exists, no schema change needed later;
  entitlement slots (`credit_pack`, `video_gen`, `restyle`) untouched.
- **Deterministic prompts** per slot from the plan item + subscription context
  (species, breed, pet name, season, theme, palette). Stickers demand a
  transparent background; the prompt is *not trusted* — a **sharp alpha gate**
  rejects any sticker whose PNG lacks an alpha channel or ships fully opaque,
  before any upload happens.
- **Idempotent per (box_id, slot):** `generated` slots are never regenerated;
  `failed` slots regenerate independently on retry.
- **Delivery gate:** the box flips `approved -> delivered` only when zero
  generative slots remain pending/failed — a subscriber never opens a box with
  missing paid content.
- All providers injected (`MaterializerDeps`); tests run entirely on fakes.

### Flow changes

- `deliverBox` gains `{ finalizeStatus?: boolean }` (default true, back-compat):
  the approve route now creates items/grants with `finalizeStatus: false` and
  generative slots inserted as `asset_status='pending'`; the materializer owns
  the delivered flip.
- `PATCH /api/admin/wags/boxes/:id` approve → responds `status: "materializing"`
  and runs the materializer in the background.
- New `POST /api/admin/wags/boxes/:id/materialize` (admin): idempotent retry for
  failed/pending slots; reports generated/failed/skipped/delivered.
- `GET /api/wags/boxes` items now include `asset_url`/`asset_status`.

### UI

- **WagsInboxScreen:** generated slot assets render as real images on a
  checkerboard backdrop (transparency visible) with tap-to-download.
- **WagsAdminPanel:** approve shows "generating slot assets…"; approved boxes get
  a **Generate assets** retry button showing generated/failed/skipped counts and
  the delivered flip.

### Design deviation (recorded)

The spec's pawprint slot called for a server-side render through the Pawprints
template pipeline; that pipeline is browser-canvas-only today (no server
renderer exists). V1 delivers the pawprint slot as generated themed card art —
matching wags.md's own slot definition ("Themed greeting card / art piece") —
and the template-pipeline render is deferred until a server-side Pawprints
renderer exists.

## Gates (Node 24.18.0)

```
npm run lint                                    # PASS (tsc --noEmit, 0 errors)
npm run test                                    # PASS (1106 tests: 1103 pass, 0 fail, 3 skips)
npx tsx --test tests/bo3_wags_materializer.test.mjs   # 11/11 PASS
npm run build                                   # PASS (release manifest, 56 files)
node scripts/animator-doctor.mjs                # PASS
```

Focused coverage: slot taxonomy; transparent-background + context in prompts;
generative-only materialization with zero provider calls for entitlement slots;
failed-slot isolation holding the box out of delivered; idempotent retry;
**real sharp alpha-gate rejection of an opaque sticker with zero uploads**;
seasonal art exempt from the sticker gate; unapproved-box refusal;
`finalizeStatus:false` semantics + per-slot pending/none insert values;
back-compat delivered flip.

## Exit gate status

| Criterion | Status |
|---|---|
| Approved box delivers real generated assets into the inbox | Implemented; live Gemini generation requires deployed env (owner smoke test) |
| Re-delivery grants nothing twice | Existing deliverBox idempotency preserved (tested); materializer skips generated slots (tested) |
| Failed slot regenerates independently | Tested |
| Box cannot reach delivered with missing paid slots | Tested (fake pool) + enforced in SQL flip condition |
| Accessory/minimodel executor seam for BO-5 | `isFuture3dSlot` + asset columns already generic |
| Admin review shows generated assets before subscriber delivery | Box stays `approved` during materialization; admin panel shows counts; inbox hides items until delivered |

## Remaining owner gates

- Live smoke test on deployment: approve a test box with `GEMINI_API_KEY` set;
  verify stickers arrive transparent and the box flips delivered.
- Stripe price IDs (`WAGS_BASIC_MONTHLY_PRICE_ID` … `WAGS_PLUS_ANNUAL_PRICE_ID`)
  and `WAGS_V2_ENABLED` remain the deployment gates from wags.md — unchanged here.
