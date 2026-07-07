# AR_PET_SIM_SCAFFOLD_PLAN.md
# Pawsome3D AR Virtual Pet — Phased Scaffolding Plan

**Version:** 1.0 · **Date:** 2026-07-06
**Implements:** `AR_PET_SIM_SPEC.md` §10 milestones
**Test runner decision:** repo built-in `node:test` (`node --test tests/*.test.mjs`) — NOT Vitest.
**Scope of first pass (this session):** AR1 built fully; AR2–AR9 created as TODO-marked stubs.

---

## How to read this plan

Each phase is one coding-agent session. Commit at the end of each. Do not skip order — later
phases import modules defined earlier. "Stub" = file exists with typed exports + `// TODO(ARx)`
markers so downstream imports resolve and `tsc --noEmit` passes, but no real logic yet.

Everything in `src/brain/` is framework-agnostic TS (no React/three imports) so an Option B
Unity/C# client can port it mechanically later.

---

## Phase AR1 — Brain engine (`src/brain/`)  ✅ built this pass

**Goal:** the entire decision engine as pure, testable TS. No rendering, no network.

Files:
- `src/brain/types.ts` — shared types: `Drives`, `Hormones`, `Temperament`, `BreedModifiers`,
  `ActionId`, `Consideration`, `BrainState`, `BrainEvent`.
- `src/brain/drives.ts` — 5 drives (hunger, thirst, tiredness, playfulness, happiness),
  decay/recovery with breed modifiers; extreme-state override flags.
- `src/brain/hormones.ts` — 3 slow scalars (excitement, stress, affection) with
  exponential return-to-baseline; event bumps.
- `src/brain/considerations.ts` — curve library: linear, quadratic, logistic, inverse,
  clamp helpers. All map input→[0,1].
- `src/brain/utility.ts` — `U_a = w_a · Π C_i(x_i)^{p_i}` scorer + fuzzy noise
  `±0.08` + re-select throttle (≥1.5 s or on event).
- `src/brain/actions.ts` — action catalog (eat, drink, nap, fetch, dig, greet, idle, …)
  each with its considerations + linked drive recovery + vocalization.
- `src/brain/behaviorTree.ts` — tiny hand-rolled BT: Sequence / Selector / Parallel /
  Decorator + leaf registry + tick status (Success/Failure/Running).
- `src/brain/trees/*.ts` — one BT per action (starts as simple leaf sequences).
- `src/brain/reinforcement.ts` — touch reward/punish → `w_a` update (±0.05, clamp [0.2,2.0])
  + command compliance update.
- `src/brain/pacing.ts` — adaptive-pacing gates (§4.7): neglect disabled until score > S1;
  ordered mechanic unlocks; single tunable config.
- `src/brain/brain.ts` — `createBrain()` + `tick(dt)`: decay → utility select → BT execute;
  emits events; exposes serialisable state for DB sync (AR2).
- `src/brain/index.ts` — public barrel.

Tests (`tests/brain_*.test.mjs`, node:test):
- decay math (drive floors/ceilings, breed multipliers)
- utility ordering (higher weight/consideration wins; determinism with noise seeded off)
- fuzzy-noise bounds (final utility within ±8%)
- BT traversal (Sequence stops on Failure; Selector returns first Success; Running propagates)
- reinforcement clamps (weights stay in [0.2, 2.0]; compliance in [0,1])

**Done when:** `npm test` green, `tsc --noEmit` clean, no React/three imports in `src/brain/`.

---

## Phase AR2 — Server: migrations, classify, state sync  (stub this pass)

- `server/migrations/001_pet_tables.sql` — the four tables from spec §8
  (`pet_profiles`, `pet_commands`, `pet_buttons`, `semantic_scans`).
- `server/breedProfiles.ts` — static map (~60 breeds) + `size_class` fallback; per-profile
  scale, drive-decay multipliers, exercise need, compliance base, mouthHitbox, bark set.
- `server/petClassify.ts` — `POST /api/pets/classify`: OpenRouter **vision** LLM call,
  strict-JSON system prompt (§3.2), zod validation, retry-once at temp 0.
- `server/petState.ts` — `GET/PATCH /api/pets/:id/state` offline-aware drive/hormone sync
  (mirror existing `needs.ts` sync pattern).
- Wire routes into `server.ts` behind JWT; tests with a mocked LLM client.

**Done when:** migrations apply on a scratch DB; classify returns validated JSON from a mock;
state round-trips.

---

## Phase AR3 — Rig pipeline  (stub this pass)

- `server/petRig.ts` — `POST /api/pets/:id/rig`: existing Tripo gen task → Tripo
  `animate_rig` (v2.5 / UniRig) → poll → rigged GLB.
- `blender-worker/jobs/bake_lod.py` — decimate ≤30k tris, atlas 1024², rename bones to
  canonical map, validate 4 leg chains, enforce ≤4 MB / ≤40 bones / 24 fps, upload B2.
- `blender-worker/bonemap.json` — Tripo→clip skeleton bone mapping; retarget-confidence
  fallback to Tripo animation presets + manual-review log.
- Feature flag: avatars without a rig keep the current render path.

**Done when:** a sample GLB round-trips through bake-lod within budget; retarget verified
against the 15 existing clips.

---

## Phase AR4 — ARPetStage skeleton  (stub this pass)

- `src/three/ar/ARPetStage.tsx` — one component, two backends (WebXR Android / XR8 iOS),
  shared scene graph; reticle placement reused from current code.
- `src/three/ar/ik.ts` — CCDIKSolver on 4 leg chains + head look-at; paw raycast grounding.
- `src/three/ar/shadows.ts` — ShadowMaterial contact shadows.
- Renders the rigged pet with existing clips; OVERWRITES `ARScene.tsx` / `EighthWallARView.tsx`
  once at parity (keep old files until AR4 lands).

---

## Phase AR5 — Brain ↔ Stage wiring  (stub this pass)

- `src/three/ar/brainBridge.ts` — rAF tick → `brain.tick(dt)`; utility goal → BT → clip;
  object `utilityTags`; body-language mapping table (`src/brain/bodyLanguage.ts`) —
  NO stat bars.
- Gestures: `src/three/ar/gestures.ts` — stroke / slap / tap classification → reinforcement.

---

## Phase AR6 — Semantic snapshot + occlusion + lighting  (stub this pass)

- `server/semanticScan.ts` — `POST /api/ar/semantic-scan`: 1 frame → vision LLM → zone
  polygons; cache per anchor hash.
- `src/three/ar/navmesh.ts` — project zones to floor; cost table (grass 1.0 / artificial 1.2 /
  water 5.0 / seating 2.5 / vegetation ∞); zone behaviours (dig/drink/rest/sniff).
- `src/three/ar/occlusion.ts` (extend existing) — Android WebXR Depth; iOS fade heuristic.
- `src/three/ar/lightProbe.ts` (extend existing) — Android lighting estimation; iOS luminance
  sampling every 2 s.

---

## Phase AR7 — Voice + spatial buttons  (stub this pass)

- `src/three/ar/voice.ts` — Web Speech API; teach mode (3 samples → doubleMetaphone keys);
  runtime Levenshtein match; 15 s response window; forgetting decay; iOS push-to-talk fallback.
- `src/three/ar/buttons.ts` — MediaRecorder → B2 → `pet_buttons`; association events;
  step-on trigger.
- Server: `POST/GET /api/pets/:id/commands`, `.../buttons`.

---

## Phase AR8 — Progression + trials  (stub this pass)

- `src/brain/pacing.ts` wired to UI; trainer points; ordered unlocks.
- `src/three/ar/trials/disc.ts` — swipe ballistic arc × mouthHitbox catch check.
- `src/three/ar/trials/agility.ts` — prefab obstacle course; time + compliance scoring.
- `src/three/walk/*` — non-AR walk mode reusing Community geo APIs.
- Server: `POST /api/trials/:type/result` → credits/ledger; aging/mortality settings.

---

## Phase AR9 — Polish + budget audit  (stub this pass)

- FPS ≥30 on mid-range phone; GLB ≤4 MB; texture/geometry disposal on session end.
- Error boundaries around AR canvas.
- `src/three/ar/capabilityMatrix.tsx` — capability-detect test page (WebXR depth / lighting /
  Web Speech / XR8 presence).

---

## Cross-cutting rules (every phase)

- Stay in scope; tests required; RUN `git commit` at end; don't touch `node_modules`;
  feature-flag anything user-visible.
- `src/brain/` stays free of React/three/DOM imports.
- New env vars documented in `.env.example`.
