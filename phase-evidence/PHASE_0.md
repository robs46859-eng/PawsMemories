# Phase 0 Evidence

Status: Pass  
Branch: `fix/text-mode-reference-screen`  
Start commit: `4ef7e84`  
Release commit: this evidence is part of the release commit; use the clean archive's `release-manifest.json` for the full SHA  
Owner/write boundary: database lifecycle, migrations 16-17, release provenance, STL derivative persistence, Phase 1 execution scaffold  
Feature flags: none added  
Migration versions: 16-17

## Contract

- Objective: stabilize database startup/migrations and produce a verifiable exact-commit deployment archive before feature expansion.
- Inputs: representative pre-16 MySQL schema, tracked repository files, Node 24.18.0, npm 11.16.0.
- Outputs: migration ledger, active-only STL derivative constraint, readiness/build provenance, complete release checksums, and build execution scaffold.
- State transitions: migration ledger records only successfully completed retryable migrations; duplicate active STL derivatives reconcile to one winner.
- API/storage/provider boundaries: public readiness is sanitized; private losing STL objects are deleted; no provider call is needed for Phase 0 acceptance.
- Explicit non-goals: no canonical asset registry or Phase 1 product behavior.

## Changed Systems

| System | Evidence |
|---|---|
| Database lifecycle | Bounded pool, health/readiness, shutdown, configured-startup failure propagation |
| Migrations | Dedicated connection/lock, baseline transition, checksums, versions 16-17, DDL/ledger recovery tests |
| STL derivatives | Two-decimal normalization, generated active-height uniqueness, exact named-conflict recovery, losing-object cleanup |
| Production build | Fail-closed staged orchestrator exercised by `npm run build` and injectable failure test |
| Release archive | Exact commit staging, complete regular-file checksum set, commit/branch/schema/engine/dirty validation |
| Runtime provenance | Full manifest shape validation and packaged-provenance fallback for hosts that build without `.git` |

## Automated Evidence

| Gate | Command | Result | Skips |
|---|---|---|---|
| TypeScript | `npm run lint` | Pass | 0 |
| Full JavaScript suite | `MYSQL_TEST_ENABLED=1 ... npm run test` | 767 total, 766 pass, 0 fail | 1 pre-existing opt-in Hostinger integration suite |
| Phase 0 live MySQL | `MYSQL_TEST_ENABLED=1 ... node --import tsx --test tests/migrations_mysql_integration.test.mjs tests/stl_concurrency_real.test.mjs` | 8 pass, 0 fail | 0 |
| Production build | `npm run build` | Pass; Vite, esbuild, and 57-file dist manifest | 0 |
| Focused integrity tests | release, build failure, migration, STL, and commerce tests | Pass | 0 |
| Whitespace | `git diff --check` | Pass | 0 |

## Integration Evidence

| Environment/fixture | Behavior exercised | Result |
|---|---|---|
| Homebrew MySQL 8.4 on `127.0.0.1:3306` | pre-16 upgrade, duplicate reconciliation, idempotency, fresh concurrent runner, DDL-before-ledger recovery, failed SQL ledger exclusion | Pass |
| Homebrew MySQL 8.4 STL fixture | two production persistence calls at heights resolving to the same DECIMAL(8,2) value | one winner, one cleaned loser, one active row |
| Dirty diagnostic archive | complete staged file set, extraction, file-set equality, hashes, provenance | Pass; diagnostic only, not release evidence |

## Manual Review

- [x] Security and privacy
- [x] Billing, idempotency, entitlement, refund, and cleanup where Phase 0 applies
- [x] Failure recovery and rollback
- [x] Exact-path environment-file exclusion
- [x] Build and runtime provenance without a Git directory
- [x] No Phase 1 behavior introduced

## Release Artifact

- Archive: `pawsome3d-deploy.zip`, generated from the clean closing commit
- Manifest schema version: 17
- Manifest file count: reported by the clean packaging gate
- Complete extracted checksum verification: required by `scripts/verify-release-directory.mjs`
- Archive SHA-256 and full commit: reported by the packaging gate and final lead handoff

## Risks and Deviations

- The one full-suite skip is the existing production-like Hostinger integration suite, which requires separate explicit authorization and staging credentials. It is not a Phase 0 local-MySQL test.
- MySQL 8.4 remains running locally; all randomized `paws_test_*` databases are dropped by test cleanup.
- Large Vite chunks remain warnings for later performance work; they do not fail the Phase 0 release contract.
- Render IFC tests remain tied to the pinned worker environment and are outside the local Phase 0 database/release gate.

## Exit Decision

- [x] All Phase 0 criteria passed
- [x] No Phase 0-specific skips
- [x] Clean exact-commit archive required immediately after commit
- [x] Tracker, handoff, execution scaffold, and evidence updated

Decision: `PASS`
