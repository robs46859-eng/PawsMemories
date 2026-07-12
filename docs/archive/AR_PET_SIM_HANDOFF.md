# AR_PET_SIM_HANDOFF.md
# Pawsome3D AR Virtual Pet — Build Handoff (AR1–AR4)

**Updated:** 2026-07-07
**Spec:** `AR_PET_SIM_SPEC.md` · **Plan:** `AR_PET_SIM_HARDENING_PLAN.md` (scaffold plan retired)

> **SHIPPED (2026-07-07):** AR1–AR9 all committed & pushed. `ARPetStage` is wired into the live
> UI (`src/components/LivingAvatarView.tsx`, commit `4b900d5`) — replaced legacy `ARScene`,
> which stays as a fallback. Deployed to Hostinger. Remaining: real-hardware smoke test
> (Android WebXR + iPhone 8th Wall) and the `AR_PET_SIM_HARDENING_PLAN` items.

**Test runner:** repo `node:test` via `tsx` — NOT Vitest.
`npm run test:ar` runs all AR-sim tests (`tests/brain_*`, `tests/pets_*`, `tests/ar_*`).
**Current tests:** 115 passing (`npm test` — now runs via `tsx`). `npx tsc --noEmit` clean.
**Deployment gotchas:** see `DEPLOYMENT_NOTES.md` (index.html is a Vite dev template — prod needs `npm run build`; SPA catch-all masks unknown /api routes; deploy zip = `git archive HEAD`; etc).

---

## Status at a glance

| Phase | What | Commit | State |
|---|---|---|---|
| AR1 | `src/brain/` engine + tests | `c3478a0` | ✅ committed & pushed |
| AR2 | pet data model + `/api/pets/classify` + state sync | `bcbe742` | ✅ committed & pushed |
| AR3 | rig pipeline (Tripo → worker bake-lod → B2) | `cf2fad7` | ✅ committed (push if not already) |
| AR4 | `ARPetStage` (reticle, shadows, head-look-at IK) | `10956c1` | ✅ committed & pushed |
| AR5 | brain↔stage bridge, object utilityTags, gestures→reinforcement | `4429c95` | ✅ committed & pushed |
| AR6 | semantic scan + navmesh cost/behaviour + iOS occlusion-fade/luminance | `eee0ca5` | ✅ committed & pushed |
| AR7 | voice command training + spatial buttons | `31ade88` | ✅ committed & pushed |
| AR8 | progression + disc/agility trials + aging settings | `de10224` | ✅ committed & pushed |
| AR9 | dispose/cleanup + capability matrix + error boundary + budget audit | `de10224` | ✅ committed & pushed |
| — | **wire `ARPetStage` into live UI** (`LivingAvatarView`) | `4b900d5` | ✅ committed, pushed & **deployed** |
| AR10 | Option B: Unity + Lightship client (separate project) | — | ⬜ out of scope here |

**All web milestones AR1–AR9 are code-complete, committed, wired into the live UI, and deployed.**
AR10 is the native Unity/Lightship port (separate project) — it reuses this backend and ports
`src/brain/` to C#.

### Next steps
1. **Smoke-test on real hardware:** Android Chrome (WebXR `Enter AR`) + iPhone Safari (8th Wall
   `Start AR (beta)`). CI can't exercise these paths.
2. Work the `AR_PET_SIM_HARDENING_PLAN.md` items (H1–H8).

<details><summary>Historical: the AR8+AR9 commit recovery (git lock)</summary>

(`git add -A` picked up all AR8/AR9 files: `src/brain/{aging,progression,index}.ts`,
`src/three/ar/{trials/disc,trials/agility,dispose,capabilities,capabilityMatrix,ARErrorBoundary,ARPetStage}.tsx?`,
`server.ts`, `db.ts`, `package.json`, `tests/ar_progression.test.mjs`, `tests/ar_polish.test.mjs`,
`AR_PET_SIM_HANDOFF.md`.)

</details>

---

## Decisions made (carry forward)

- **Test runner:** `node:test` (+ `tsx` to import TS). Scripts: `test:brain`, `test:pets`, `test:ar`.
- **LLM provider:** reuse **Gemini** (`@google/genai`, `GEMINI_API_KEY`) — NOT the spec's OpenRouter. Same strict-JSON contract, no new account.
- **Validation:** `zod` added as a dependency.
- **Migrations:** pet tables created idempotently inside `db.ts` `initDb()` (repo pattern), not a standalone runner. Reference SQL also in `server/migrations/001_pet_tables.sql`.
- **Tripo rig body (verified vs docs + ComfyUI-Tripo schema):**
  `{ type:"animate_rig", original_model_task_id, out_format:"glb", spec:"tripo", model_version:"v2.0-20250506" }`.
  Preset-animation fallback uses `animate_retarget`.
- **Canonical clip skeleton** (from `blender-worker/skeletal-clips.js`, targeted by `bonemap.json`):
  `hips, spine, chest, neck, head, front_leg_upper.L/R, front_leg_lower.L/R, front_paw.L/R, back_leg_upper.L/R, back_leg_lower.L/R, back_paw.L/R, tail_01/02/03`.
- **`src/brain/` stays framework-agnostic** (no React/three/DOM imports) so an Option B Unity/C# client can port it.

---

## What exists now (by area)

### Brain engine — `src/brain/` (AR1, pure TS)
`types, drives, hormones, considerations, utility (mulberry32 seeded RNG + ±0.08 fuzz + 1.5s reselect throttle), actions, behaviorTree (Sequence/Selector/Parallel/Decorator/Leaf + registry), trees/, reinforcement (±0.05 weights clamp [0.2,2.0], compliance, forgetting), pacing (neglect gate + ordered unlocks), bodyLanguage, brain.ts (tick orchestrator), index barrel`.
Tests: `tests/brain_*.test.mjs` (31).

### Server (AR2/AR3) — `server.ts`, `db.ts`, `server/*`, `storage.ts`, `tripo.ts`
- `POST /api/pets/classify` — Gemini vision, ownership-checked, zod-validated, retry-once at temp 0, caches onto `pet_profiles` (skip with `force:true`).
- `GET/PATCH /api/pets/:id/state` — drives/hormones/weights; GET applies offline decay via `src/brain` `decayDrives`.
- `POST /api/pets/:id/rig` — **feature-flagged `PETSIM_RIG_ENABLED`** (off ⇒ 501). Ownership-checked; `genTaskId` from body or `avatar.meshy_handle`; Tripo `animate_rig` → mirror rigged GLB to B2 → worker `/bake-lod` → upload LOD to B2 → persist `rigged_glb_url`/`lod_glb_url`.
- `server/petClassify.ts` — injectable `GenerateFn`, `ClassifySchema` (clamps 0–1), `parseAndValidateClassify`, `extractJson`.
- `server/breedProfiles.ts` — ~20 breeds + size_class fallback.
- `server/rigBudget.ts` — pure `checkBudget` + `needsRetargetFallback` (unit-tested).
- `db.ts` — tables `pet_profiles/pet_commands/pet_buttons/semantic_scans`; helpers `getPetProfileByAvatar/ById`, `upsertPetProfile`, `savePetState`, `savePetRigUrls`.
- `storage.ts` — `uploadBase64Binary` (baked LOD bytes).
- `tripo.ts` — `startRig`, `startRetarget`, `pollTripoTask`.
Tests: `tests/pets_classify.test.mjs` (8), `tests/pets_rig.test.mjs` (5), `tests/pets_tripo.test.mjs` (5, mocked `fetch`).

### Worker (AR3) — `blender-worker/`
- `jobs/bake_lod.py` — real bpy: decimate ≤30k tris, texture downscale ≤1024, bone-rename to canonical via bonemap, 4-leg-chain validate, budget + reject-retry, 24fps; prints `BAKE_RESULT:{json}`.
- `POST /bake-lod` in `server.js` (added to worker-auth + bridge list) — imports GLB, runs `bake_lod.py`, returns `{ stats, glb_base64 }`.
- `bonemap.json` — candidate-based source→canonical map + `legChains` + `confidenceThreshold`.
- Runs in Blender only; **untested in CI**. The pure-JS budget interpreter (`server/rigBudget.ts`) is what tests cover.

### AR stage (AR4) — `src/three/ar/`
- `ARPetStage.tsx` — two backends (WebXR primary, `EighthWallARView` iOS fallback), shared behavior store; hit-test reticle + WebXR anchor, contact shadow, head-look-at IK, light-estimation + depth-occlusion hooks. **Additive** — does not yet overwrite `ARScene.tsx`/`EighthWallARView.tsx`.
- `ik.ts` — `LEG_CHAINS`, `buildLegIK`, `headLookAt`, pure `pelvisHeightFromPaws`/`clampSlope`.
- `shadows.ts` — `makeContactShadow`, `zoneFadeOpacity`, `applyOpacity`.
- `stageModel.ts` — `chooseStageModelUrl` (LOD→rigged→fallback), `hasRiggedModel`.
Tests: `tests/ar_stage.test.mjs` (6, pure).

### Brain ↔ stage bridge (AR5) — `src/three/ar/`, `src/three/objects/`
- `brainBridgeCore.ts` — framework-free core: `createBrainBridge` (`step` → `brain.tick` → selected `ActionId`→clip `BehaviorAction` via `CLIP_HINT`; nearest tagged object → walk target; vocalize + body-language readout) and `applyGesture` (stroke/slap → weight + hormone, tap = attention). Unit-tested.
- `brainBridge.ts` — R3F `usePetBrain(active)` hook driving the shared store's `action` + `target` each frame; re-exports the core.
- `objects/utilityTags.ts` — `UTILITY_TAGS` per kind, `TAG_TO_ACTION`/`ACTION_TO_TAG`, `nearestObjectWithTag`, `objectsToStimuli` (ambient bias). Pure.
- `gestures.ts` — `classifyPointerStroke` + `applyGestureToBrain(bridge, samples)`.
- `brain.ts` gained `applyHormoneEvent()`. Body-language mapping (`bodyLanguage.ts`) drives idle-variant + ear/tail poses — **no stat bars**.
- Wired into `ARPetStage`: `usePetBrain(placed)` drives clips/targets; pointer down/move/up on the pet → `applyGestureToBrain`.
Tests: `tests/ar_brainbridge.test.mjs` (8).

### AR6–AR9 stubs (TODO-marked, importable)
`src/three/ar/{brainBridge,gestures,navmesh,voice,buttons,capabilityMatrix,trials/disc,trials/agility}`, `src/brain/bodyLanguage.ts`, `server/{petState,petRig,semanticScan}.ts` (reference stubs; live logic for state/rig lives in `server.ts`/`db.ts`).

---

## Environment variables
- Existing used: `GEMINI_API_KEY`, `TRIPO_API_KEY`, `BLENDER_WORKER_URL`, `WORKER_SHARED_SECRET`, `MEDIA_BUCKET_*` (B2), DB_* .
- **New (AR3):** `PETSIM_RIG_ENABLED` (feature flag, off by default), `TRIPO_RIG_MODEL_VERSION` (optional, defaults `v2.0-20250506`). ✅ Now documented in `.env.example`.

## Deployment
`bash scripts/build-deploy-zip.sh` → `pawsome3d-deploy.zip` (source only; Hostinger runs `npm install && npm run build`). The script archives **`HEAD`**, so commit first. (This session built the zip from the *staged* tree so it already includes AR4; re-run the script after committing for a clean HEAD-based archive.)

---

## Open follow-ups / known gaps
1. **Commit AR4** (lock-clear command above), then push.
2. Add `PETSIM_RIG_ENABLED` + `TRIPO_RIG_MODEL_VERSION` to `.env.example`.
3. `bake_lod.py` does texture **downscale**, not a full multi-material **atlas merge** — refinement for the ≤1× 1024² budget.
4. IK ships head-look-at; full **CCDIKSolver leg grounding** (targets + pelvis apply) is set up but not solved per-frame yet (pure math helpers are ready/tested).
5. Verify against real hardware: WebXR depth-matrix on target Androids; Web Speech continuous mode on iOS Safari; Tripo `animate_rig` pricing on the current plan.

---

## Next: AR6 — semantic snapshot + occlusion + lighting
Per spec §6.2–6.4 / plan:
- `server/semanticScan.ts` — `POST /api/ar/semantic-scan`: 1 camera frame → vision LLM (reuse Gemini) → zone polygons; cache per `anchor_hash` in `semantic_scans` (H7).
- `src/three/ar/navmesh.ts` — project polygons to floor; cost table (grass 1.0 / artificial 1.2 / water 5.0 / seating 2.5 / vegetation ∞) + zone behaviours (dig/drink/rest/sniff). Feed un-walkable zones into the BT pathfind leaf.
- `occlusion.ts` (extend) — Android WebXR Depth already present; add iOS opacity-fade using `shadows.applyOpacity` when the pet path crosses a furniture zone.
- `lightProbe.ts` (extend) — iOS luminance sampling every 2 s.
- Tests: navmesh cost math, zone→behaviour mapping, semantic-scan parse/validate (mocked LLM), anchor-hash caching.

### AR7–AR9 after that
AR7 voice + spatial buttons (`voice.ts`, `buttons.ts`, `/commands`, `/buttons`); AR8 progression + trials (`pacing` wired, disc/agility, credits); AR9 polish + budget audit + capability matrix + memory disposal.
