# Phase 3 Evidence: Durable 3D Build and Verification

Status: Code complete; external acceptance pending
Branch: `fix/text-mode-reference-screen`
Release commit: `TBD`
Owner/write boundary: `server/model-builds/` (`types.ts`, `schemas.ts`, `repository.ts`, `service.ts`, `provider.ts`, `storage.ts`, `validation.ts`, `routes.ts`, `featureFlag.ts`, `recovery.ts`, `likeness.ts`), migration 22 in `server/migrations/runner.ts`, `tests/phase3_*.test.mjs`, `src/api.ts`, `src/components/create-flow/*`, `PHASED_IMPLEMENTATION.md`, `HANDOFF.md`, `phase-evidence/PHASE_3.md`, `phase-evidence/PHASE_3_CHECKLIST.html`
Feature flags: `MODEL_BUILD_V3_ENABLED` (default: `false`, server-side enforced)
Migration versions: 22

## Contract

- Objective: Transform an immutable, approved Phase 2 reference session manifest into a durable 3D model build job (`draft -> preflight -> reserving -> queued -> submitted -> processing -> downloading -> validating -> ready -> accepted`), with provider execution (Tripo), private storage streaming, post-build GLB geometry validation, zero-double-charge credit reservation/release/refunds, standard high-resolution renders, advisory likeness scoring, complete Create flow UI, interactive 3D GLB preview viewer, and explicit user acceptance.
- Inputs: Approved Phase 2 reference session UUID and manifest hash; output configuration.
- Outputs: Durable model build jobs, attempts, provider events, artifacts, post-build reports, and approvals in schema 22 tables (`model_build_jobs`, `model_build_attempts`, `model_provider_events`, `model_build_artifacts`, `model_post_build_reports`, `model_build_acceptances`); canonical assets & asset versions (`model_glb`, `validated_glb`, `model_render`); `/api/model-builds/*` API endpoints.
- State transitions: `draft -> preflight -> reserving -> queued -> submitted -> processing -> downloading -> validating -> ready -> accepted`.
  - Non-success terminal states: `failed_preflight`, `failed_provider`, `failed_validation`, `cancelled`.
- API/storage/provider boundaries: `/api/model-builds/*` API routes; server-minted private S3/B2 keys (`models/*`); Tripo 3D API integration; Blender worker boundary for standard review renders; zero object-key leakage; short-lived signed URLs for GLB and render viewing.
- Explicit non-goals: Modifying Phase 2 reference views; generating meshes without an approved manifest; rigging; facial morph authoring; accessories; Fur Bin publishing; stationery; Wags subscriptions; Randy assistant; BIM/IFC behavior.

## Changed Files

| File | Reason |
|---|---|
| `phase-evidence/PHASE_3.md` | Phase 3 evidence tracker |
| `phase-evidence/PHASE_3_CHECKLIST.html` | Phase 3 HTML evidence checklist |
| `PHASED_IMPLEMENTATION.md` | Track Phase 3 truthfully |
| `HANDOFF.md` | Document Phase 3 execution |
| `server/model-builds/types.ts` | Phase 3 domain types, state machine enums, and public DTOs (including `billingDisposition`) |
| `server/model-builds/schemas.ts` | Zod validation schemas for requests, callbacks, and validation reports |
| `server/model-builds/repository.ts` | Database CRUD, transaction boundaries, and row locking for schema 22 tables |
| `server/model-builds/service.ts` | Core durable state machine, mandatory 5 renders, atomic batch cleanup, canonical report metricsHash, worker boundary hardening, and job lifecycle |
| `server/model-builds/likeness.ts` | Advisory likeness CIEDE2000 palette distance calculator with limitations disclaimed |
| `server/model-builds/provider.ts` | Provider-independent ModelBuildProvider port and Tripo adapter |
| `server/model-builds/storage.ts` | Private temporary provider GLB download streaming, standard render PNG upload, report JSON storage, and identity computation |
| `server/model-builds/validation.ts` | Deterministic GLB magic, reopen, geometry, bounds, PNG signature & IHDR dimension checks |
| `server/model-builds/routes.ts` | Authenticated HTTP router mounted at `/api/model-builds` |
| `server/model-builds/featureFlag.ts` | Server-authoritative feature flag for MODEL_BUILD_V3_ENABLED |
| `server/model-builds/recovery.ts` | Stale lease and stuck job reconciliation worker |
| `server/migrations/runner.ts` | Migration 22 definition and CURRENT_SCHEMA_VERSION = 22 export |
| `src/api.ts` | Client API methods for model builds |
| `src/types.ts` | Screen enum additions for CREATE_BUILD_PROGRESS and CREATE_BUILD_REVIEW |
| `src/components/create-flow/CreateFlowContext.tsx` | Build state storage & session storage active job recovery |
| `src/components/create-flow/CreateCheckoutScreen.tsx` | Quoted price & credit balance check before startModelBuild |
| `src/components/create-flow/CreateBuildProgressScreen.tsx` | Polling, state progress, pre-submission cancel, failure refund notice & retry form |
| `src/components/create-flow/CreateBuildReviewScreen.tsx` | Standard review renders, interactive Three.js 3D GLB viewer, validation metrics, advisory likeness card, hash-bound acceptance |
| `src/components/create-flow/Model3DViewer.tsx` | Interactive Three.js canvas viewer component for 3D GLB preview |
| `src/App.tsx` | Screen router mounting for Phase 3 review and progress screens |
| `tests/phase3_adversarial.test.mjs` | Adversarial test suite covering concurrent starts, retry limits, stale-lease recovery, cross-owner security, malformed GLBs, metricsHash integrity, 5 mandatory renders, atomic cleanup, worker HTTPS/secret fail-closed, handle resume, and billingDisposition DTOs |

## Automated Evidence

| Gate | Command | Result | Skips |
|---|---|---|---|
| TypeScript | `npm run lint` | PASS | 0 |
| Phase 2 Suite | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && MYSQL_TEST_HOST=127.0.0.1 ./node_modules/.bin/tsx --test tests/phase2_*.test.mjs` | 19/19 PASS | 0 |
| Phase 3 Suite | `./node_modules/.bin/tsx --test tests/phase3_*.test.mjs` | 35/35 PASS | 0 |
| Complete Test Suite | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && npm run test` | 840 pass / 843 total | 3 (opt-in environment tests) |
| Production Build | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && npm run build` | PASS | 0 |
| Animator Doctor | `source ~/.nvm/nvm.sh && nvm use 24.18.0 && node scripts/animator-doctor.mjs` | PASS | 0 |
| Whitespace | `git diff --check` | PASS | 0 |

## Exit Decision

Decision: `PHASE 3 CODE UNBLOCKS DEFAULT-OFF PHASE 4 DEVELOPMENT`

Phase 3 mandatory lead corrections pass the local code gates. Real Tripo/private S3/B2/Blender acceptance and the browser matrix remain blocked on external credentials and execution evidence. `MODEL_BUILD_V3_ENABLED` remains false by default. Phase 4 development may proceed behind its own default-off flag; production enablement may not.
