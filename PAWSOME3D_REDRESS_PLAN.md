# Pawsome3D Deployment Redress Plan — Full Architecture
**Scope:** Fix the collateral damage from the Phase 2 create-to-print update, document the printed-model and Pawprints workflows/APIs as deployed, and add **optional rigging (with facial option) as a checkbox** to the create flow with credit pricing and hard guards against the known rig bugs. No dates or timelines. Companion docs: `DEPLOYMENT_REVIEW_2026-07-19.md` (findings), `FSAI_ARCHITECTURE_SPEC.md` (BIM moves to fsai.pro).

---

## 1. Current deployed architecture (as of `pawsome3d-deploy.zip` @ `7387e9d`)

```
Browser (SPA: HomePage / Create flow / Marketplace / Pawprints / FurBin / Store / Profile)
   │
   ▼
server.ts (Express, Hostinger)
   ├─ Auth + credits (PupCoins, src/pricing.ts)
   ├─ Create pipeline  /api/create-pipeline/*  → Tripo/Meshy → raw GLB (NO rig)
   ├─ Pawprints        /api/pawprints/*        → Gemini image + collageEngine → Printful physical
   ├─ Print (3D)       /api/print/*            → blender-worker /prepare-print → STL → Slant3D + Stripe
   ├─ Model library    /api/models/library     → pipeline models + legacy avatars
   ├─ 🔒 Legacy avatars /api/avatars/*         → agent orchestrator → blender-worker (rig+visemes) [UI locked]
   ├─ 🔒 Animator      /animator/*, /lipsync   → Rhubarb lip-sync, jobs [UI locked]
   └─ 🔒 BIM           /api/bim/*              → ifc_worker (IfcOpenShell) [UI removed with AvatarDashboard]
   │
   ├── blender-worker (Render): TCP bridge · rig engine · ifc_worker · prepare_print_stl
   ├── MySQL (legacy mypets.cc DB) · Backblaze B2 (media/models/STL/print files)
   └── External: Tripo/Meshy · Gemini · Stripe · Slant3D · Printful · Resend (email) · SMS
```

## 2. Redress items (deployment fixes)

| # | Issue (from deployment review) | Fix |
|---|---|---|
| RD-1 | Sidebar "Animate" navigates to a lock screen (dead end) | Remove the entry from `SIDEBAR_NAV` while the studio is gated; restore when unlocked |
| RD-2 | BIM builder collaterally unreachable (lived inside locked AvatarDashboard) | **Decision:** BIM ships on fsai.pro (see FSAI spec). On pawsome3d: remove BIM entries from Store/paths and add a "BIM has moved to fsai.pro" pointer. Do not remount `BimModelBuilder` here |
| RD-3 | Create-flow models are unrigged static GLBs while pricing still lists "Rigged 3D Avatar (80)" | Implement **optional rigging checkbox** (§5) so the sold capability matches the pipeline |
| RD-4 | `animator_handoff` test asserts the lockout (masks regressions) | Keep gating assertions, but re-add source-integrity assertions for the animator components so deletion/corruption fails CI |
| RD-5 | Widened triage enum (`ExtendedSubjectClass`) untested against legacy avatar path | Add triage contract tests for all 10 classes before any Furball3D unlock |
| RD-6 | Store's "Go to Avatars" and AR launch route to the locked MODELS screen | Point them at Create flow / model library until Furball3D returns |

## 3. Printed models — workflow and API (as deployed)

**Workflow (Slant3D figurines):**
1. User picks a model in the library (creation `model_url` or avatar `rigged_model_url`/`model_url`) and a physical height.
2. `POST /api/print/slant3d/checkout` (auth + paid limiter + **required `Idempotency-Key` header**):
   - Resolves the model URL (ownership checked) → calls blender-worker `POST /prepare-print` (`x-worker-secret`, 10-min timeout) which imports the GLB and runs `prepare_print_stl`: join meshes → scale to `targetHeightMm` (25–300 mm) → triangulate → topology audit (non-manifold edges, degenerate faces).
   - If `printable=false` → `422` with `dimensionsMm` + `topology` (mesh needs repair — no charge).
   - STL uploaded to Backblaze (`print-ready/`), file registered with Slant3D (hashed owner id), quote → retail price.
   - Stripe Checkout session created (metadata: `slant3d_print_order`, order id, user); `print_orders` row saved with `checkout_url`, status `awaiting_payment`. Idempotent replays return the existing order/checkout URL; unpriced stale quotes → `409`.
3. Stripe webhook confirms payment → order placed with Slant3D.
4. `GET /api/print/orders` (history) · `GET /api/print/orders/:id/status` (provider status + shipment tracking via `fulfillmentTracking.ts`) · read-only diagnostics from `fulfillmentReadiness.ts` (`7387e9d`).

**Endpoints:** `POST /api/print-uploads` · `GET /api/models/library` · `POST /api/print/slant3d/checkout` · `GET /api/print/orders` · `GET /api/print/orders/:id/status`. Treatstock checkout follows the same prepare→quote→Stripe pattern (added in `289004b`).

## 4. Pawprints (photo collages) — workflow and API (as deployed)

**Workflow:**
1. `GET /api/pawprints/templates` — categories + templates, each with `layoutId` (collageEngine: classic, overlay, split, frame, story, filmstrip, circles, mosaic, polaroid, triptych, magazine, panorama) and a typed `fieldSchema` (text/image fields, max lengths).
2. `POST /api/pawprints/generate` (auth + paid limiter, **required idempotency key**, price `CREDIT_PRICES.PAWPRINT = 75`):
   - Validates fields against the template schema (image fields must be png/jpeg/webp data URLs).
   - **Subject reuse:** `reuseCreationId` reuses a prior generated image as background, skipping fresh image generation at **20% off** (`REUSE_DISCOUNT`).
   - Generates/derives artwork, composes the collage, saves a `pawprint_assets` row + FurBin creation. Idempotent replays return the existing asset.
3. `POST /api/pawprints/send` — emails a saved Pawprint (Resend; HTML-escaped, reply-to sender). `503` if `RESEND_API_KEY`/`MAIL_FROM` unset.
4. Physical product path: `GET /api/pawprints/print-products` (catalog from `pawprintProducts.ts`, inch dimensions per product) → `POST /api/pawprints/printful-order` (auth + paid limiter + idempotency key): fetches the saved image → **sharp** resize to width×300 DPI / height×300 DPI PNG on white → uploads print file → creates Printful order (recipient schema validated by zod, quantity 1–10) → Stripe Checkout → `pawprint_print_orders` row. `GET /api/pawprints/print-orders` for history.

**Frontend:** `PawprintsStudio.tsx` + `src/pawprints/collageEngine.ts` (layout planner returns normalized rects, text zones, overlay/inset flags).

---

## 5. Optional rigging on the create flow (new feature)

### 5.1 UX (decisive)

On **CreateCustomizeScreen**, one new section, two checkboxes — nothing else changes in the flow:

```
☐ Rig this model for animation            +35 PupCoins
   ☐ Include facial rig (blendshapes)     +20 PupCoins   [enabled only when rigging is checked]
```

- Total price is always displayed live on the checkout screen: base `STATIC_3D_PHOTO` (45) → 80 with rigging (equals the existing `RIGGED_3D_AVATAR` price) → 100 with facial.
- Checkbox states persist in `customization_state` (existing MD5 staleness hash covers them automatically — a change re-requires validation).
- Print orders ignore rigging (STL derivation strips the armature); the library shows a "Rigged" badge and stores both `model_url` (static) and `rigged_model_url`.

### 5.2 Pricing (src/pricing.ts additions)

```ts
RIG_ADDON: 35,          // STATIC_3D_PHOTO 45 + 35 = RIGGED_3D_AVATAR 80 (consistent with published price)
FACIAL_RIG_ADDON: 20,   // viseme blendshapes viseme_A..X + facial weight zones
```

### 5.3 Backend wiring

1. `POST /api/create-pipeline/approve` reads `customization_state.rigging: {enabled, facial}`; reserves `STATIC_3D_PHOTO + (enabled ? RIG_ADDON : 0) + (facial ? FACIAL_RIG_ADDON : 0)` under the existing idempotent reserve→commit machine.
2. Job poller: when a Tripo GLB completes **and** `rigging.enabled`, the job does not finalize as `done`; it enters `rigging` status and invokes the existing legacy pipeline `runBuildPipeline()` (agent orchestrator → blender-worker) with a subject profile derived from the create-session species/type. Facial checkbox routes through the existing `facialVisemeBpyScript()` pass in finalize.
3. On rig success: upload rigged GLB → `rigged_model_url`, status `done`. On rig failure **after passing validation retries**: store the static GLB, refund only the add-on portion (`RIG_ADDON` + facial), status `done_static_fallback` with a user-visible notice. Base model money is never lost to a rig failure.
4. Status endpoint surfaces: `queued → generating → rigging → validating → done | done_static_fallback | failed`, plus the validation report (§5.4) on request.

### 5.4 Rig quality gates — known-bug guards (normative)

Each guard runs in the orchestrator verify stage (blender-worker side); failures trigger the existing `retry_rigging` path once, then fallback per §5.3.3. Every check emits a pass/fail line into the job's validation report.

| Known bug | Guard |
|---|---|
| **Neck sagging** (head droops, neck weights bleed into torso) | Neck-chain check: head bone must hold rest orientation under gravity test pose (deviation ≤ 5°); neck vertex weights must sum to neck/head bones only (torso bleed ≤ 5% per vertex); auto-add neck stiffness (rotation limit) when chain length > contract norm |
| **Face contortion** (mesh crumples when bones/visemes move) | Facial region is weight-locked to the head bone unless facial rig is purchased; with facial rig, blendshape deltas are clamped to the face region mask and the synthetic-viseme deformation guard (`5b5ba7c`) applies — a test activation of each viseme at 1.0 must keep non-face vertices static (max delta ≤ ε) and face silhouette within tolerance (vision verify node) |
| **Misaligned limbs** (joints off the mesh, legs crossing, bent wrong way) | Landmark joint placement: hips/shoulders/knees/elbows within tolerance of mesh landmarks; L/R symmetry ≤ 2% chain-length delta; hinge axes validated by pendulum test (limb released from horizontal must swing downward — flipped axes fail); test-pose interpenetration check (limb meshes may not intersect torso) |
| Candy-wrapper twist (wrists/forearms) | Twist distributed across forearm twist bone or roll clamped; 90° wrist-twist test pose must not collapse forearm volume (cross-section area loss ≤ 30%) |
| Foot sliding / floating | Rest pose feet planted on ground plane (sole vertices within ±5 mm of Z=0 at profile scale); walk clip (if baked) checked for ground contact at contact frames |
| Broken weights (spikes, unweighted islands) | Every vertex weighted; ≤ 4 influences; no vertex weighted to a bone farther than its region radius (weight-distance heuristic); no single-vertex spikes after a full-range pose sweep |

Physics context for all gravity-dependent checks: world gravity (0, 0, −9.8) m/s², model scaled to profile real-world height — same `physics_validate` method specified for FSAI (build once in blender-worker, shared by both products).

### 5.5 Tests (added to CI)

Fixture set: one biped, one quadruped, plus **deliberately broken fixtures** (flipped knee, torso-weighted neck, unlocked face) that MUST fail their guard. Contract tests for the two new pricing paths, add-on-only refund on `done_static_fallback`, and checkbox → `customization_state` → reserve-amount propagation.

---

## 6. Delivery phases (no dates)

1. **P1 — Redress:** RD-1…RD-6 nav/test/copy fixes; deploy via existing zip flow; smoke checklist.
2. **P2 — Worker guards:** implement `physics_validate` + §5.4 checks in blender-worker (shared with FSAI); broken-fixture tests red→green.
3. **P3 — Rigging option:** pricing constants, checkbox UI, approve/poller wiring, fallback + refund path, status surface, Rigged badge in library.
4. **P4 — Facial add-on:** viseme pass behind the second checkbox, face-lock guard default-on for all rigs.
5. **P5 — Hardening:** full test matrix (§5.5), deploy, then update `SMOKE_CHECKLIST.md` with a rigged-model print order (verifies armature stripping in STL path).
