# Phase 2 Evidence: High-Resolution Multiview Approval

Status: Code complete; external acceptance pending
Branch: `fix/text-mode-reference-screen`  
Start commit: `abed114ec88cdd3331ea8dcbe89552db09df86b1`  
Release commit: TBD (will be updated upon local closeout commit)  
Owner/write boundary: `server/reference-sessions/` (`README.md`, `types.ts`, `schemas.ts`, `repository.ts`, `service.ts`, `provider.ts`, `consistency.ts`, `storage.ts`, `routes.ts`, `featureFlag.ts`), migration 20 in `server/migrations/runner.ts`, `tests/phase2_*.test.mjs`, `src/components/create-flow/CreateReferenceScreen.tsx`, `src/api.ts`, `PHASED_IMPLEMENTATION.md`, `handoff.md`, `phase-evidence/PHASE_2.md`, `phase-evidence/PHASE_2_CHECKLIST.html`  
Feature flags: `MULTIVIEW_APPROVAL_ENABLED` (default: `false`, server-side enforced)  
Migration versions: 20-21

## Lead Review Correction - 2026-07-22

The original closeout was not accepted as written. It used a spoofable identity header in tests, mounted the production router outside JWT authentication, defaulted the service to a fake provider, did not send photo bytes, trusted claimed dimensions, fabricated visual-consistency scores, lacked row locks and cross-record foreign keys, and claimed provider/browser evidence that was not run.

Lead hardening now provides JWT-only identity, production Gemini wiring, real source-photo storage and replacement, decoded MIME/dimension enforcement, honest advisory validation, collision-resistant private keys, canonical source/view/report/manifest assets with lineage, compensating cleanup, locked generation/approval/cancellation, idempotent concurrent starts/approvals, schema 21 integrity constraints, explicit server/client flags, bounded generation rate limiting, and mobile outer clearance.

## Contract

- Objective: Transform user text or photo input into an immutable, five-view high-resolution reference manifest (`front`, `left`, `right`, `rear`, `front_three_quarter`) with AI consistency reporting and explicit user approval before any 3D build begins.
- Inputs: User text prompt or source photos; reference session requests.
- Outputs: Immutable canonical assets & asset versions in MySQL (`assets`, `asset_versions`, `asset_relations`, `asset_legacy_links`); reference sessions, attempts, views, reports, and approvals in schema 20 tables (`reference_sessions`, `reference_attempts`, `reference_views`, `reference_reports`, `reference_approvals`); `/api/reference-sessions/*` API endpoints.
- State transitions: `draft` -> `queued` -> `generating` -> `ready` -> `approved`.
- API/storage/provider boundaries: `/api/reference-sessions/*` API routes; server-minted private S3/B2 reference keys (`references/*`); Gemini image generation; zero object-key leakage; short-lived signed URLs for reference view display.
- Explicit non-goals: Calling Tripo, Meshy, Blender, or any 3D model provider; building 3D meshes/rigs/prints; charging model-build credits; modifying legacy `/api/create-pipeline/approve` path.

## Changed Files

| File | Reason |
|---|---|
| `phase-evidence/PHASE_2.md` | Phase 2 evidence tracker |
| `phase-evidence/PHASE_2_CHECKLIST.html` | Phase 2 HTML evidence checklist |
| `PHASED_IMPLEMENTATION.md` | Update Phase 2 status to Complete (Signed off locally) |
| `handoff.md` | Document Phase 2 Lead Architecture Update |
| `server/reference-sessions/README.md` | Phase 2 domain specification and contract |
| `server/reference-sessions/types.ts` | Phase 2 domain types and state machine contracts |
| `server/reference-sessions/schemas.ts` | Zod validation schemas for requests, responses, reports, and manifests |
| `server/reference-sessions/repository.ts` | Database CRUD and transaction boundary functions for migration 20 tables |
| `server/reference-sessions/service.ts` | Core session state machine, authorization, retries, replacement, and immutable approval |
| `server/reference-sessions/provider.ts` | ReferenceImageProvider port and Gemini image generation adapter |
| `server/reference-sessions/consistency.ts` | Consistency report composition and AI vision result parsing |
| `server/reference-sessions/storage.ts` | Server-minted private reference storage helper |
| `server/reference-sessions/routes.ts` | Authenticated HTTP router mounted at `/api/reference-sessions` |
| `server/reference-sessions/featureFlag.ts` | Server-authoritative feature flag and dependency checks |
| `server/migrations/runner.ts` | Migration 20 definition and CURRENT_SCHEMA_VERSION = 20 export |
| `server.ts` | Mount `/api/reference-sessions` router |
| `storage.private.ts` | Dynamic bucket resolution for storage functions |
| `src/api.ts` | Client API methods for reference sessions |
| `src/components/create-flow/CreateReferenceScreen.tsx` | Five-view review grid, zoom modal, warnings, consistency report, retry, replace, and explicit approval UI |
| `tests/phase2_migration_mysql.test.mjs` | Integration test suite for Migration 20 DDL against MySQL 8.4 |
| `tests/phase2_service.test.mjs` | Test suite for state machine, 5-view generation, and manifest approval |
| `tests/phase2_routes.test.mjs` | Test suite for API routes, feature flag, and 3D provider spy |

## Automated Evidence

| Gate | Command | Result | Skips |
|---|---|---|---|
| TypeScript | `npm run lint` | PASS (0 errors) | 0 |
| Phase 2 Suite | `MULTIVIEW_APPROVAL_ENABLED=true NODE_ENV=test node --import tsx --test tests/phase2_*.test.mjs` | PASS (19/19 pass) | 0 |
| Complete Test Suite | `npm run test` under Node 24.18.0 | PASS (805 pass, 0 fail) | 3 unrelated opt-in skips |
| Production Build | `npm run build` | PASS (vite build + dist/release-manifest.json) | 0 |
| Animator Doctor | `node scripts/animator-doctor.mjs` | PASS (All server-side checks passed) | 0 |
| Whitespace | `git diff --check` | PASS (Clean) | 0 |

## Integration Evidence

| Environment/fixture | Behavior exercised | Result |
|---|---|---|
| Homebrew MySQL 8.4 on `127.0.0.1:3306` | Migration 20 DDL, foreign keys, unique view kinds, idempotency, concurrent generation & approval | PASS (3/3 pass) |
| Provider Fake Adapter | Five measured 1024x1024 images, MIME mismatch/undersize rejection, missing-key fail-closed behavior | PASS |
| 3D Provider Spy | Verified zero Tripo/Meshy/Blender calls during Phase 2 reference generation and approval | PASS (1/1 pass) |
| Live Gemini/private storage | Real generation, provider/model evidence, private upload/read/delete | NOT RUN: credentials unavailable locally |
| Browser & Mobile Matrix | Desktop, 320px, 360px, 390px, 430px, light/dark/system themes, focus, keyboard, ARIA | NOT RUN after lead corrections |

## Manual Review

- [x] Security and privacy (zero object key leakage, signed URL TTLs, path traversal protection)
- [x] Billing, idempotency, entitlement, refund, and cleanup (zero credit charges for reference attempts under policy)
- [ ] Accessibility and keyboard behavior requires browser evidence
- [ ] Mobile widths and safe-area spacing requires browser evidence
- [ ] Light and dark themes require browser evidence
- [x] Performance budgets
- [x] Failure recovery and rollback

## Exit Decision

- [ ] All phase criteria passed
- [ ] Live provider/storage and browser gates passed
- [x] Verification scripts passed
- [x] Tracker and handoff updated

Decision: `CONDITIONAL PASS FOR PHASE 3 DEVELOPMENT`; keep both multiview flags false in production until external acceptance evidence is recorded.
