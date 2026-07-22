# Phase 1 Evidence: Canonical Asset Registry and Storage Accounting

Status: Complete (Signed off locally)  
Branch: `fix/text-mode-reference-screen`  
Start commit: `29fc88a5de9755e998da8b21fb83160ff4195970`  
Release commit: TBD (recorded upon atomic commit creation)  
Owner/write boundary: `server/assets/` (`README.md`, `schemas.ts`, `types.ts`, `repository.ts`, `service.ts`, `access.ts`, `accounting.ts`, `reconciliation.ts`, `legacyAdapters.ts`, `routes.ts`), migration 18 in `server/migrations/runner.ts`, `tests/phase1_*.test.mjs`, `PHASED_IMPLEMENTATION.md`, `handoff.md`, `phase-evidence/PHASE_1.md`  
Feature flags: `CANONICAL_ASSETS_ENABLED` (default: `false`, server-side enforced)  
Migration versions: 18  

## Contract

- Objective: Create shared identity, versioning, lineage, storage authorization, accounting, and reconciliation for all platform assets without breaking legacy subsystems.
- Inputs: Legacy assets across creations, avatars, marketplace assets, BIM builds, animator assets, stationery/prints; new canonical registration payloads.
- Outputs: Immutable canonical assets & asset versions in MySQL (`assets`, `asset_versions`, `asset_relations`, `asset_legacy_links`); `/api/assets` endpoints; distinct storage accounting; drift reconciliation reports.
- State transitions: `draft` -> `registered` -> `version_added` -> `current_pointer_updated` -> `archived` / `deleted`.
- API/storage/provider boundaries: `/api/assets/*` API routes; private/public S3/B2 bucket abstraction; zero object-key leakage; short-lived presigned URLs for private assets.
- Explicit non-goals: Multiview generation, reference approval UI, new 3D/image AI providers, mesh building/rigging/facial generation, subscription delivery, IFC authoring, Spatial Glow UI redesign.

## Changed Files

| File | Reason |
|---|---|
| `phase-evidence/PHASE_1.md` | Phase 1 evidence tracker |
| `PHASED_IMPLEMENTATION.md` | Mark Phase 1 Complete / Signed off locally |
| `handoff.md` | Document Phase 1 execution |
| `server/assets/README.md` | Canonical Phase 1 contract specification |
| `server/assets/types.ts` | Phase 1 domain types and enums |
| `server/assets/schemas.ts` | Zod validation contracts for asset API payloads |
| `server/assets/repository.ts` | Database operations, SQL queries, transaction ownership for schema 18 tables |
| `server/assets/service.ts` | Core asset registration, immutable versioning, lineage, pointer updates, compensating cleanup |
| `server/assets/access.ts` | Asset authorization, visibility, short-lived signed URL generation |
| `server/assets/accounting.ts` | Owner storage totals based on distinct physical objects |
| `server/assets/reconciliation.ts` | Database/object storage drift reporting and explicit `--fix` execution |
| `server/assets/legacyAdapters.ts` | Adapters for legacy creations, avatars, marketplace assets, BIM builds, animator assets, and stationery |
| `server/assets/routes.ts` | Authenticated HTTP router mounted at `/api/assets` |
| `server/migrations/runner.ts` | Migration 18 definition and CURRENT_SCHEMA_VERSION = 18 export |
| `server.ts` | Mount `/api/assets` router and feature flag |
| `scripts/generate-manifest.mjs` | Consume CURRENT_SCHEMA_VERSION (18) |
| `scripts/build-deploy-zip.sh` | Consume CURRENT_SCHEMA_VERSION (18) |
| `tests/phase1_migration_mysql.test.mjs` | Real MySQL 8.4 tests for Migration 18 |
| `tests/phase1_service.test.mjs` | Production service unit tests |
| `tests/phase1_routes.test.mjs` | API route integration tests |
| `tests/phase1_reconciliation.test.mjs` | Storage accounting and reconciliation tests |

## Automated Evidence

| Gate | Command | Result | Skips |
|---|---|---|---|
| TypeScript | `npm run lint` | PASS (0 errors) | 0 |
| Complete Test Suite | `npm run test` | PASS (778 pass, 0 fail) | 3 (environment skips) |
| Phase 1 Real MySQL 8.4 Suite | `MYSQL_TEST_HOST=127.0.0.1 ./node_modules/.bin/tsx --test tests/phase1_*.test.mjs` | PASS (20 pass, 0 fail) | 0 |
| Production Build | `npm run build` | PASS | 0 |
| Whitespace | `git diff --check` | PASS | 0 |

## Integration Evidence

| Environment/fixture | Behavior exercised | Result |
|---|---|---|
| Homebrew MySQL 8.4 on `127.0.0.1:3306` | Migration 18 upgrade, canonical tables creation, idempotency, concurrent runners, lineage constraints, version immutability | PASS (4/4 subtests) |
| Production Service & Router | Registration, versioning, lineage, signed URL, accounting, reconciliation, legacy adapters, Fur Bin fallback | PASS (16/16 subtests) |

## Exit Decision

- [x] All phase criteria passed
- [x] No phase-specific skips
- [x] Verification scripts passed
- [x] Tracker and handoff updated

Decision: `SIGNED_OFF_LOCALLY`
