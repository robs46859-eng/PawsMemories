# Phase 3 Evidence: Durable 3D Build and Verification

Status: Complete (Code complete; external acceptance pending credentialed provider / browser matrix)  
Branch: `fix/text-mode-reference-screen`  
Start commit: `d488b9e`  
Release commit: TBD (local commit pending)  
Owner/write boundary: `server/model-builds/` (`types.ts`, `schemas.ts`, `repository.ts`, `service.ts`, `provider.ts`, `storage.ts`, `validation.ts`, `routes.ts`, `featureFlag.ts`, `recovery.ts`), migration 22 in `server/migrations/runner.ts`, `tests/phase3_*.test.mjs`, `src/api.ts`, `PHASED_IMPLEMENTATION.md`, `handoff.md`, `phase-evidence/PHASE_3.md`, `phase-evidence/PHASE_3_CHECKLIST.html`  
Feature flags: `MODEL_BUILD_V3_ENABLED` (default: `false`, server-side enforced)  
Migration versions: 22  

## Contract

- Objective: Transform an immutable, approved Phase 2 reference session manifest into a durable 3D model build job (`draft -> preflight -> reserving -> queued -> submitted -> processing -> downloading -> validating -> ready -> accepted`), with provider execution (Tripo), private storage streaming, post-build GLB geometry validation, zero-double-charge credit reservation/release/refunds, and explicit user acceptance.
- Inputs: Approved Phase 2 reference session UUID and manifest hash; output configuration.
- Outputs: Durable model build jobs, attempts, provider events, artifacts, post-build reports, and approvals in schema 22 tables (`model_build_jobs`, `model_build_attempts`, `model_provider_events`, `model_build_artifacts`, `model_post_build_reports`, `model_build_acceptances`); canonical assets & asset versions (`model_glb`, `validated_glb`); `/api/model-builds/*` API endpoints.
- State transitions: `draft -> preflight -> reserving -> queued -> submitted -> processing -> downloading -> validating -> ready -> accepted`.
  - Non-success terminal states: `failed_preflight`, `failed_provider`, `failed_validation`, `cancelled`.
- API/storage/provider boundaries: `/api/model-builds/*` API routes; server-minted private S3/B2 keys (`models/*`); Tripo 3D API integration; zero object-key leakage; short-lived signed URLs for GLB and render viewing.
- Explicit non-goals: Modifying Phase 2 reference views; generating meshes without an approved manifest; rigging; facial morph authoring; accessories; Fur Bin publishing; stationery; Wags subscriptions; Randy assistant; BIM/IFC behavior.

## Changed Files

| File | Reason |
|---|---|
| `phase-evidence/PHASE_3.md` | Phase 3 evidence tracker |
| `phase-evidence/PHASE_3_CHECKLIST.html` | Phase 3 HTML evidence checklist |
| `PHASED_IMPLEMENTATION.md` | Mark Phase 3 Complete |
| `handoff.md` | Document Phase 3 execution |
| `server/model-builds/types.ts` | Phase 3 domain types, state machine enums, and public DTOs |
| `server/model-builds/schemas.ts` | Zod validation schemas for requests, callbacks, and validation reports |
| `server/model-builds/repository.ts` | Database CRUD, transaction boundaries, and row locking for schema 22 tables |
| `server/model-builds/service.ts` | Core durable state machine, authorization, preflight checks, credit debit/refunds, and job lifecycle |
| `server/model-builds/provider.ts` | Provider-independent ModelBuildProvider port and Tripo adapter |
| `server/model-builds/storage.ts` | Private temporary provider GLB download streaming and identity computation |
| `server/model-builds/validation.ts` | Deterministic GLB magic, reopen, geometry, bounds, and material checks |
| `server/model-builds/routes.ts` | Authenticated HTTP router mounted at `/api/model-builds` |
| `server/model-builds/featureFlag.ts` | Server-authoritative feature flag for MODEL_BUILD_V3_ENABLED |
| `server/model-builds/recovery.ts` | Stale lease and stuck job reconciliation worker |
| `server/migrations/runner.ts` | Migration 22 definition and CURRENT_SCHEMA_VERSION = 22 export |
| `server.ts` | Mount `/api/model-builds` router |
| `storage.private.ts` | Allow `models/` prefix for compensating private object cleanup |
| `src/api.ts` | Client API methods for model builds |
| `tests/phase3_migration_mysql.test.mjs` | Test Migration 22 DDL on live MySQL 8.4 |
| `tests/phase3_provider.test.mjs` | Test ModelBuildProvider port and Tripo adapter SSRF/security |
| `tests/phase3_validation.test.mjs` | Test post-build GLB validation metrics and hash generation |
| `tests/phase3_service.test.mjs` | Test core state machine, preflight, billing, and job lifecycle |
| `tests/phase3_routes.test.mjs` | Test `/api/model-builds` HTTP routes and auth |
| `tests/phase2_migration_mysql.test.mjs` | Updated schema version assertion (>= 21) |

## Automated Evidence

| Gate | Command | Result | Skips |
|---|---|---|---|
| TypeScript | `npm run lint` | PASS | 0 |
| Phase 2 Suite | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && MYSQL_TEST_HOST=127.0.0.1 ./node_modules/.bin/tsx --test tests/phase2_*.test.mjs` | 19/19 PASS | 0 |
| Phase 3 Suite | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && MYSQL_TEST_HOST=127.0.0.1 ./node_modules/.bin/tsx --test tests/phase3_*.test.mjs` | 21/21 PASS | 0 |
| Complete Test Suite | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && npm run test` | 826/829 PASS | 3 (Hostinger opt-in & skipped benchmarks) |
| Production Build | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && npm run build` | PASS | 0 |
| Animator Doctor | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && node scripts/animator-doctor.mjs` | PASS | 0 |
| Whitespace | `git diff --check` | PASS | 0 |

## Integration Evidence

| Environment/fixture | Behavior exercised | Result |
|---|---|---|
| Homebrew MySQL 8.4 on `127.0.0.1:3306` | Migration 22 DDL, foreign keys, idempotency, row locking, concurrent builds, credit debit/refund reconciliation | PASS (5/5 migration, 4/4 service, 4/4 routes) |
| Provider Fake Adapter & Sandbox | Tripo 3D model generation simulation, streaming GLB download, private storage persistence, compensating cleanup | PASS (3/3 provider tests) |
| Post-Build Verification | GLB reopening, triangle/vertex geometry validation, bound calculation | PASS (5/5 validation tests) |

## Exit Decision

Decision: `CODE COMPLETE; EXTERNAL ACCEPTANCE PENDING`
