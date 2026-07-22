# Pawsome3D Remaining Build Execution Scaffold

Updated: 2026-07-22  
Architecture authority: `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`  
Status authority: `PHASED_IMPLEMENTATION.md`  
Evidence directory: `phase-evidence/`

## Purpose

This scaffold constrains implementation from Phase 1 through Phase 9 and the Spatial Glow UI track. It does not replace the architecture specification. It turns that specification into phase-sized write boundaries, dependency gates, durable evidence, and stop conditions that every coding agent must follow.

## Mandatory Read Order

Before editing, every agent reads:

1. `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`
2. `BUILD_EXECUTION_SCAFFOLD.md`
3. `PHASED_IMPLEMENTATION.md`
4. `handoff.md`
5. The current phase evidence file under `phase-evidence/`
6. The phase-specific skills and source modules listed below

Conversation summaries are context only. Repository code, tests, migrations, manifests, and evidence files are authoritative.

## Global Engineering Contract

- Only one numbered product phase may be `In progress` at a time.
- A phase starts from a clean, named Git commit and ends at a clean, named Git commit.
- Do not amend, reset, force-push, deploy, or merge unless the lead explicitly requests it.
- Preserve unrelated user and agent changes. Stop if another active agent owns the same files.
- New database changes are migration-first. Phase 1 starts at migration version 18; later phases increment from the committed registry.
- Do not add new one-off compatibility DDL to `initDb()` when a managed migration can express it.
- New API behavior belongs in focused `server/` route/service/repository modules. Do not continue expanding `server.ts` with feature internals.
- Shared domain contracts use Zod at external boundaries and exported TypeScript types internally.
- Paid actions require server-side price authority, idempotency, entitlement checks, audit records, and compensating refunds or cleanup.
- External AI/provider work runs as durable attempts with persisted state; no paid long-running task may exist only in process memory.
- Object storage keys remain private unless an asset is explicitly publishable. Database rows point to immutable versions, not mutable URLs.
- Every generated 3D artifact records source inputs, provider/model, units, coordinate convention, checksums, validation reports, and parent version.
- Tests must execute production helpers, repositories, route modules, or workers. Source-regex and copied simulations supplement but never replace behavioral tests.
- No phase closes with skipped phase-specific integration tests.
- A passing dirty archive is diagnostic only. Release evidence requires a clean exact-commit archive.

## Required Phase Skeleton

Each phase follows this sequence:

1. Baseline: record branch, commit, worktree, relevant test totals, and known risks.
2. Contract: finalize schemas, state transitions, endpoint contracts, storage paths, flags, and migration numbers before feature UI.
3. Persistence: implement migrations and repositories with rollback/recovery behavior.
4. Services: implement provider-independent orchestration and validation.
5. Interfaces: mount APIs and UI only after service contracts pass.
6. Integration: exercise database, storage, worker, provider sandbox, and browser paths appropriate to the phase.
7. Review: inspect security, billing, accessibility, mobile, performance, and failure recovery.
8. Evidence: update the phase evidence file with exact commands and results.
9. Release gate: run full tests, type checking, production build, and clean archive verification.
10. Handoff: update `PHASED_IMPLEMENTATION.md` and `handoff.md`, commit once, then stop for lead approval.

## Phase Dependency Graph

```text
Phase 0 release stability
  -> Phase 1 canonical asset registry
       -> Phase 2 multiview approval
            -> Phase 3 durable 3D build and dual verification
                 -> Phase 4 rig, facial mesh, accessories
                      -> Phase 5 Fur Bin showcase and marketplace
       -> Phase 6 stationery and physical fulfillment
       -> Phase 7 Wags subscription packs
       -> Phase 8 Randy product assistant
       -> Phase 9 scaled shell and IFC BIM

Spatial Glow UI track
  -> token/runtime foundation after Phase 0
  -> route migration only when the owning product phase is stable
```

Phase 1 is the shared prerequisite. Phases 2 through 9 must reference canonical asset IDs and immutable asset versions rather than introducing parallel file registries.

## Phase Contracts

### Phase 1: Canonical Asset Registry

Objective: create the shared identity, version, lineage, storage, and accounting layer for every image, model, mesh, animation, print template, and BIM artifact.

Write boundary:

- New migration 18 and focused migration tests.
- New `server/assets/` schemas, repository, service, routes, reconciliation, and accounting modules.
- Minimal adapters from existing creations, avatars, marketplace assets, BIM builds, animator assets, and print artifacts.
- Asset-management UI only where needed to prove registration and version history.

Required contracts:

- Asset, asset version, relation/lineage, source/provenance, validation report, storage object, and usage/accounting records.
- Immutable versions with one explicit current pointer.
- Owner, visibility, license, commercial-use, retention, deletion, and entitlement policies.
- Idempotent registration by source checksum/provider identity.
- Reconciliation for database rows without objects and objects without database rows.
- Storage totals derived from registered immutable objects without double counting.

Forbidden shortcuts:

- Do not move or rewrite every legacy object in one migration.
- Do not expose private object keys or make paid assets public.
- Do not add Phase 2 image-generation behavior.
- Do not replace existing route responses until compatibility adapters and tests exist.

Exit gate:

- Migration 18 passes fresh, upgraded, idempotent, concurrent, and recovery tests on MySQL 8.4.
- At least one existing artifact from each major legacy source can register without duplication.
- Version lineage, ownership, signed access, storage accounting, and reconciliation tests pass.
- Full release gates pass with no Phase 1 skips.

### Phase 2: High-Resolution Multiview Approval

Objective: produce a consistent high-resolution reference set from text or images, show multiple angles, and require immutable user approval before 3D generation.

Required outputs:

- Reference session and attempt records linked to Phase 1 assets.
- Front, left, right, rear, and optional three-quarter views with identity/appearance consistency checks.
- Pre-build report that describes image suitability and scale confidence without claiming mesh accuracy.
- Explicit Approve and optional Retry paths with credit policy visible before action.
- Approved reference-set version becomes immutable input to Phase 3.

Exit gate: provider-independent tests, provider sandbox evidence, browser approval flow, mobile review, credit/idempotency tests, and immutable lineage proof.

### Phase 3: Durable 3D Build and Verification

Objective: turn an approved reference set or text specification into a durable GLB build with authoritative post-build verification and correction attempts.

Required outputs:

- Persisted build jobs, attempts, provider handles, input/output versions, logs, costs, and terminal states.
- Post-build geometry, topology, orientation, dimensions, likeness, texture, and artifact-integrity reports.
- Correction/retry policy with bounded attempts and compensating refund behavior.
- User acceptance only after post-build validation; pre-build and post-build reports remain distinct.

Exit gate: recovery after process restart, duplicate request safety, failed validation refund, provider callback/poll recovery, GLB reopen, and extracted artifact checks.

### Phase 4: Rigging, Facial Mesh, and Accessories

Objective: make eligible human and animal models riggable, provide honest facial capability, and attach/export accessories without corrupting the base asset.

Required outputs:

- Deterministic subject classification and rig profile selection.
- Skeleton, skinning, animation, facial morph/viseme, attachment, and export validation manifests.
- Explicit fallback when facial geometry cannot be produced; never fabricate capability badges.
- Accessory assets, fit transforms, collision/penetration checks, ownership, and derivative lineage.

Skills: read `skills/animator/*.md` and `/Users/robert/.codex/skills/image-to-3d/SKILL.md` before implementation.

Exit gate: representative human/quadruped corpus, animation playback sweep, facial test set, accessory fit/export, mobile viewer budgets, and full regression gates.

### Phase 5: Fur Bin Showcase

Objective: provide a private asset library and optional public showcase built entirely on canonical assets and immutable versions.

Required outputs:

- Search, tags, collections, thumbnails, version history, validation badges, storage usage, and signed viewing.
- Explicit publish/unpublish flow, rights checks, marketplace linkage, moderation state, and privacy-safe public metadata.
- Viewer degradation for mobile GPU/memory limits.

Exit gate: owner isolation, public/private boundary, stale signed URL behavior, version rollback, storage totals, moderation, accessibility, and browser/mobile tests.

### Phase 6: Digital and Physical Stationery

Objective: create high-resolution managed templates for holidays, events, memorials, and other topics, with digital export and provider-backed physical fulfillment.

Required outputs:

- Canonical template/background assets with rights and print specifications.
- Deterministic server render contract for dimensions, bleed, safe area, color profile, DPI, and text overflow.
- Preview-to-print lineage, order idempotency, provider reconciliation, shipment status, and refund handling.

Exit gate: pixel-dimension/DPI verification, template stress corpus, Printful sandbox/read-only deployment check, sample order evidence where authorized, and accessibility/mobile tests.

### Phase 7: Wags Subscription Packs

Objective: deliver monthly digital packs containing mini models, accessories, and printables with transparent prepaid incentives.

Required outputs:

- Stripe price-to-entitlement mapping, monthly and prepaid terms, renewal/cancellation behavior, and versioned catalog packs.
- Exactly-once monthly grants and annual/prepaid bonuses.
- Owned-item deduplication, substitution policy, inbox/history, and admin review.

Exit gate: webhook replay, concurrent delivery, proration/cancellation, failed-payment recovery, entitlement audit, and no duplicate assets or credits.

### Phase 8: Randy 3D Assistant

Objective: replace the placeholder assistant with an optimized 3D character grounded in the live module registry and authorized to perform only explicit safe actions.

Required outputs:

- Versioned Randy GLB/LOD, rig/facial capability, mobile performance fallback, and accessible non-3D fallback.
- Versioned module knowledge registry generated from real routes, flags, pricing, and help content.
- Grounded citations to current in-app help and context-aware navigation.
- Action allowlist, confirmation tiers, authorization, idempotency, and audit trail.

Exit gate: stale-knowledge detection, hallucination refusal, prompt-injection tests, action authorization, mobile budget, accessibility fallback, and module walkthrough corpus.

### Phase 9: Scaled Shell and IFC BIM

Objective: create calibrated building models from text or images, with a lower-cost visual shell lane and a higher-cost semantic IFC/BIM lane.

Required outputs:

- Pre-build calibration/scale report and post-build dimensional verification for both lanes.
- Shell GLB contract with no false BIM semantics.
- IFC4 semantic model, unit/coordinate preservation, GlobalId mapping, properties, hierarchy, reopen validation, and semantic GLB.
- Separate pricing, disclosure, acceptance, retry, and refund behavior for Shell and IFC/BIM.

Skills/tools: read `/Users/robert/.codex/skills/image-to-3d/SKILL.md`; use the pinned Render worker with IfcOpenShell 0.8.5 and NumPy 2.2.1; do not add browser IFC libraries without a measured need.

Exit gate: calibrated image fixture, text fixture, rotated/unit fixtures, two-room IFC acceptance, shell-vs-IFC pricing tests, reopen/conversion checks, and before/after accuracy reports.

## Spatial Glow UI Track

The controlling plan is `SPATIAL_GLOW_UI_IMPLEMENTATION_PLAN.md`. Build shared tokens and theme runtime after Phase 0, but migrate feature routes only with the owning phase. Preserve 20-24px mobile outer gutters plus safe-area insets and at least 16px visible clearance outside panel borders, shadows, and glows.

No product phase may create a second theme system. Every new component consumes shared semantic tokens and must pass both themes at 320px, 360px, 390px, and 430px widths.

## Feature Flags

Every incomplete customer-facing capability is disabled by default. Flags must be server-authoritative for paid or privileged behavior and may have a client mirror only for presentation. A phase evidence file records:

- Flag name and default.
- Server enforcement location.
- Enablement prerequisites.
- Rollback procedure.
- Removal milestone after stable release.

## Migration Allocation

- Phase 0 ends at schema version 17.
- Phase 1 begins at version 18.
- An agent reads `CURRENT_SCHEMA_VERSION` before selecting the next number.
- One authoritative TypeScript migration registry remains the source of truth.
- Every statement must be independently retryable because MySQL DDL autocommits.
- Applied checksums are immutable. Never edit a released migration; add a corrective migration.

## Required Evidence and Stop Conditions

Each phase copies `phase-evidence/PHASE_TEMPLATE.md` to `phase-evidence/PHASE_<N>.md` and fills it with actual results.

Stop and report `BLOCKED` when:

- A required provider or test environment cannot be exercised.
- A phase-specific integration test is skipped.
- A migration cannot recover after partial DDL.
- Paid behavior lacks idempotency, refund, cleanup, or entitlement proof.
- Private assets can be reached without authorization.
- Pre-build checks are presented as post-build accuracy.
- The clean archive commit or complete file-set checksums do not match.
- Another agent changes an owned file during implementation.

Warnings, mocked provider tests, source-regex assertions, and dirty archives cannot waive a stop condition.

## Universal Release Gate

Run under the package-pinned Node 24 engine:

```bash
npm run lint
npm run test
npm run build
bash scripts/build-deploy-zip.sh
git diff --check
git status --short
```

Also run the current phase's real database, worker, provider sandbox, browser, mobile, visual, or artifact fixtures. Record exact totals, skips, archive path/SHA-256, manifest file count, branch, and commit.
