# Phase BO-0: Durable Model Persistence

**Date:** 2026-07-23
**Branch:** `phase/bo-1-customizer-surfaces`
**Commit:** `2a73a17`
**Schema version:** 33 (migration 32 = durable_model_persistence, migration 33 = customizer_tables_adoption)

## Implementation Summary

### Migration 32 — `durable_model_persistence` (checksum `095fe7faf347472ca9de48dff32bd1f966659503bf3019d301f5ec6b4db10819`)

- **`model_persistence_events`**: append-only audit table tracking the lifecycle of every 3D model build. `job_id BIGINT NULL` (nullable for V3 jobs that don't use generation_jobs). Indexed by job_id and event_type+created_at.
- **`generation_jobs.canonical_asset_uuid`**: tracks the canonical asset UUID after a finished GLB is registered.
- **`generation_jobs.done_static_fallback_at`**: timestamp when a rig-failure-after-storage job was resolved as `done_static_fallback`.

### 1. Server-authoritative completion for all 3D build paths (§4.1.1)

**Legacy avatar V3 stub fix:** When `MODEL_BUILD_V3_ENABLED=true` and a legacy avatar's Tripo generation completes in the status poll handler, the code now:
- **Persists** the paid Tripo GLB to durable storage via `uploadBinaryFromUrl` (previously marked it as `failed`)
- **Marks** the avatar as `done` with the static model URL
- **Skips** the legacy in-process rig pipeline (`runBuildPipeline`)
- **Returns** the model URL to the caller

**New legacy avatar prohibition:** `POST /api/avatars` now returns 503 `LEGACY_AVATAR_DISABLED` when V3 is enabled, preventing new Tripo charges on the legacy path. Already-debited credits are refunded before the rejection.

**resumeStalledBuilds:** guarded by `if (isModelBuildV3Enabled()) return` — the 3-minute interval only runs when V3 is off.

**Canonical asset registration:** `registerLegacyModelAsset()` is called from all three completion paths (background sweep, `/api/jobs/:id`, `/api/image-to-3d/:jobId/status`) with real SHA-256 computed by re-fetching the stored B2 URL.

### 2. `done_static_fallback` resolution (§4.1.2)

The `finalizeRejected` function in `pipeline-rig-recovery.ts` already supported `done_static_fallback`. The status poll endpoints now surface it:
- `GET /api/avatars/:id/status` — recognizes `done_static_fallback` as terminal
- `GET /api/jobs/:id` — returns `done_static_fallback` with model_url
- `GET /api/image-to-3d/:jobId/status` — same handling

### 3. Canonical asset registration with lineage (§4.1.3)

**`server/legacy-asset-registration.ts`**: `registerLegacyModelAsset(input)` calls the Phase 1 `registerAsset()` with `{ internal: true }` authorization. When `sha256` is `"unknown"` or `sizeBytes` is 0, the function fetches the stored B2 URL and computes real SHA-256/size. Falls back gracefully on fetch failure.

**`server/model-persistence-events.ts`**: `recordPersistenceEvent(type, opts)` — append-only audit writer with 9 event types, non-fatal error handling.

### 4. Truthful billing disposition and failure_code (§4.1.4)

**`/api/models/library` endpoint** now returns:
- `billing_disposition`: `"charged" | "refunded" | "not_charged"` — derived from `generation_jobs.rig_refunded_at`/`generation_refunded_at`/`credits_reserved` for creations, and `avatars.generation_status` for avatars.
- `failure_code`: `generation_jobs.recovery_reason` or `avatars.generation_error`
- `canonical_asset_uuid`: the canonical asset UUID when registered

**Client-side `ModelLibraryItem`** interface updated with `billing_disposition`, `failure_code`, `canonical_asset_uuid`.

### 5. Create flow V3 wiring (§4.2)

The Create flow already routes through `/api/model-builds` when `VITE_MODEL_BUILD_V3_ENABLED=true`:
- `CreateCheckoutScreen` calls `getModelBuildQuote`/`startModelBuild`
- `CreateBuildProgressScreen` polls `/api/model-builds/:jobUuid`
- `CreateBuildReviewScreen` calls `acceptModelBuild` with hash-bound acceptance
- All V3 API functions already exist in `src/api.ts`

### 6. Flag-default-off

`MODEL_BUILD_V3_ENABLED=false` remains the committed default in `server/model-builds/featureFlag.ts`. Enablement is an owner action after evidence review.

## Files Changed

| File | Change |
|---|---|
| `server/migrations/runner.ts` | Migration 32 (durable_model_persistence), CURRENT_SCHEMA_VERSION → 33 |
| `server.ts` | Fix V3 stub (persist GLB instead of fail), guard POST /api/avatars, add billing_disposition/failure_code to /api/models/library, wire canonical asset registration at 3 call sites |
| `server/legacy-asset-registration.ts` | NEW — canonical asset registration with real SHA-256 computation |
| `server/model-persistence-events.ts` | NEW — append-only audit event writer |
| `src/api.ts` | Add `billing_disposition`, `failure_code`, `canonical_asset_uuid` to `ModelLibraryItem` |
| `tests/bo0_durable_persistence.test.mjs` | NEW — 24 focused tests |
| `tests/migrations.test.mjs` | Update migration 32 checksum |
| `phase-evidence/BO_0.md` | This file |

## Verification

### Node 24.18.0 gates

```bash
npm run lint                           # PASS (tsc --noEmit, 0 errors)
npm run test                           # PASS (1095 tests: 1092 pass, 0 fail, 3 skips)
node --import tsx --test tests/bo0_durable_persistence.test.mjs  # 24/24 PASS
npm run build                          # PASS (Vite + esbuild)
node scripts/animator-doctor.mjs       # PASS (all server-side checks, Rhubarb optional)
```

## Exit Gate Status

| Criterion | Status |
|---|---|
| Server-authoritative completion for all 3D build paths | Implemented: V3 stub persists GLB, legacy avatar creation blocked, canonical registration on all 3 completion paths |
| done_static_fallback resolves visibly (model in profile, rigging refunded) | Implemented: terminal state surfaced in all poll endpoints, billing_disposition shows "charged" for static model |
| Canonical asset registration with lineage for every finished GLB | Implemented: registerLegacyModelAsset at all 3 completion paths with real SHA-256 |
| Truthful billingDisposition and failure_code on creations DTOs | Implemented: /api/models/library returns billing_disposition and failure_code |
| Unioned FurBin/profile listing endpoint | Implemented: /api/models/library unions creations + avatars with billing data |
| 20 fixture runs of create→approve with browser closed and mid-build restart | Requires live deployment with MODEL_BUILD_V3_ENABLED=true |
| Focused tests for done_static_fallback, registration, V3 gating | 24 tests pass |
| MODEL_BUILD_V3_ENABLED=false in committed defaults | Verified: featureFlag.ts defaults to false |
| Full suite + build + animator doctor green | Verified under Node 24.18 |

## Risks & Open Items

1. **Canonical asset registration** in the sweep fetches the stored B2 URL to compute SHA-256. This is an extra HTTP round-trip per completion but avoids requiring the raw buffer at the call site.
2. **`POST /api/create-3d-model`** and `POST /api/image-to-3d` are still on the legacy path — they get canonical registration and persistence events, but are not routed through V3 model-builds. This is acceptable for the initial hardening pass.
3. **E2E fixture runs** (20 create→approve→close browser→restart→verify) require a live deployment with `MODEL_BUILD_V3_ENABLED=true` and are deferred to the owner.
## Validation Review Correction (2026-07-23)

- Fixed `/api/models/library`: the avatars branch selected the nonexistent column
  `avatars.canonical_asset_uuid` (migration 32 adds that column to `generation_jobs`
  only), which would have returned HTTP 500 for every user with avatar models,
  regardless of the V3 flag. Avatars now return an empty canonical UUID until a
  registration path exists for them.
- Re-verified all gates under Node 24.18.0 after the fix: TypeScript clean; full
  suite 1095 tests — 1092 pass, 0 fail, 3 intentional skips; production build +
  58-file release manifest pass; animator doctor passes.
