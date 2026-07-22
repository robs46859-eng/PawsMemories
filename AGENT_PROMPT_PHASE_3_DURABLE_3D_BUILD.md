# Antigravity Execution Prompt: Phase 3 Durable 3D Build and Dual Verification

You are Gemini 3.6 Antigravity acting as the implementation agent for Pawsome3D Phase 3. Work directly in `/Users/robert/Desktop/claude7126/PawsMemories`. Implement the phase end to end. Do not respond with a design-only proposal.

## Authority and required reading

Read in this order before editing:

1. `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`, especially sections 3, 5, 6, 15, and 20-22
2. `BUILD_EXECUTION_SCAFFOLD.md`, especially the Phase 2 boundary and Phase 3 contract
3. `PHASED_IMPLEMENTATION.md`
4. `handoff.md`, newest lead correction first
5. `phase-evidence/PHASE_2.md` and `phase-evidence/PHASE_2_CHECKLIST.html`
6. `AGENT_PROMPT_PHASE_2_MULTIVIEW.md` for the immutable input contract
7. `/Users/robert/.codex/skills/image-to-3d/SKILL.md`
8. `server/reference-sessions/*`, `server/assets/*`, `server/migrations/runner.ts`, `storage.private.ts`, `pricing.ts`, and the existing Tripo/GLB validation paths in `server.ts`
9. `src/components/create-flow/*`, `src/api.ts`, and existing model viewer/validation components

Repository code, migrations, tests, and current evidence are authoritative. Earlier conversation summaries are not evidence.

## Checkpoint 0: do not conceal Phase 2 acceptance status

Before Phase 3 edits:

- Confirm Node `v24.18.0`, npm `v11.16.0`, MySQL 8.4, and `CURRENT_SCHEMA_VERSION = 21`.
- Confirm the branch contains the Phase 2 lead hardening described in the newest `handoff.md` entry.
- Confirm the worktree is clean. If the lead hardening is uncommitted or another agent is modifying owned files, stop and report the exact conflict; do not absorb unrelated changes into a Phase 3 commit.
- Run `npm run lint` and the 19-test Phase 2 suite.
- Keep `MULTIVIEW_APPROVAL_ENABLED=false` and `VITE_MULTIVIEW_APPROVAL_ENABLED=false` by default.
- If Gemini/private-storage credentials are available, complete and record the bounded Phase 2 sandbox and browser/mobile matrix first. If they are unavailable, Phase 3 development may continue behind default-off flags, but neither Phase 2 nor Phase 3 may be labeled production-enabled.
- Create `phase-evidence/PHASE_3.md` and `phase-evidence/PHASE_3_CHECKLIST.html` immediately. Keep exact commands, totals, skips, provider calls, costs, notes, risks, and HTML comment sections current.

## Phase boundary

Phase 3 begins only from an immutable, approved Phase 2 manifest:

`approved canonical five-view manifest -> durable paid build job -> provider attempts -> downloaded GLB -> canonical artifact -> post-build verification -> correction attempts -> user delivery/acceptance`
You are Gemini 3.6 Antigravity acting as the implementation agent for Pawsome3D Phase 3. Work directly in `/Users/robert/Desktop/claude7126/PawsMemories`. Implement the phase end to end. Do not respond with a design-only proposal.

## Authority and required reading

Read in this order before editing:

1. `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`, especially sections 3, 5, 6, 15, and 20-22
2. `BUILD_EXECUTION_SCAFFOLD.md`, especially the Phase 2 boundary and Phase 3 contract
3. `PHASED_IMPLEMENTATION.md`
4. `handoff.md`, newest lead correction first
5. `phase-evidence/PHASE_2.md` and `phase-evidence/PHASE_2_CHECKLIST.html`
6. `AGENT_PROMPT_PHASE_2_MULTIVIEW.md` for the immutable input contract
7. `/Users/robert/.codex/skills/image-to-3d/SKILL.md`
8. `server/reference-sessions/*`, `server/assets/*`, `server/migrations/runner.ts`, `storage.private.ts`, `pricing.ts`, and the existing Tripo/GLB validation paths in `server.ts`
9. `src/components/create-flow/*`, `src/api.ts`, and existing model viewer/validation components

Repository code, migrations, tests, and current evidence are authoritative. Earlier conversation summaries are not evidence.

## Checkpoint 0: do not conceal Phase 2 acceptance status

Before Phase 3 edits:

- Confirm Node `v24.18.0`, npm `v11.16.0`, MySQL 8.4, and `CURRENT_SCHEMA_VERSION = 21`.
- Confirm the branch contains the Phase 2 lead hardening described in the newest `handoff.md` entry.
- Confirm the worktree is clean. If the lead hardening is uncommitted or another agent is modifying owned files, stop and report the exact conflict; do not absorb unrelated changes into a Phase 3 commit.
- Run `npm run lint` and the 19-test Phase 2 suite.
- Keep `MULTIVIEW_APPROVAL_ENABLED=false` and `VITE_MULTIVIEW_APPROVAL_ENABLED=false` by default.
- If Gemini/private-storage credentials are available, complete and record the bounded Phase 2 sandbox and browser/mobile matrix first. If they are unavailable, Phase 3 development may continue behind default-off flags, but neither Phase 2 nor Phase 3 may be labeled production-enabled.
- Create `phase-evidence/PHASE_3.md` and `phase-evidence/PHASE_3_CHECKLIST.html` immediately. Keep exact commands, totals, skips, provider calls, costs, notes, risks, and HTML comment sections current.

## Phase boundary

Phase 3 begins only from an immutable, approved Phase 2 manifest:

`approved canonical five-view manifest -> durable paid build job -> provider attempts -> downloaded GLB -> canonical artifact -> post-build verification -> correction attempts -> user delivery/acceptance`
You are Gemini 3.6 Antigravity acting as the implementation agent for Pawsome3D Phase 3. Work directly in `/Users/robert/Desktop/claude7126/PawsMemories`. Implement the phase end to end. Do not respond with a design-only proposal.

## Authority and required reading

Read in this order before editing:

1. `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`, especially sections 3, 5, 6, 15, and 20-22
2. `BUILD_EXECUTION_SCAFFOLD.md`, especially the Phase 2 boundary and Phase 3 contract
3. `PHASED_IMPLEMENTATION.md`
4. `handoff.md`, newest lead correction first
5. `phase-evidence/PHASE_2.md` and `phase-evidence/PHASE_2_CHECKLIST.html`
6. `AGENT_PROMPT_PHASE_2_MULTIVIEW.md` for the immutable input contract
7. `/Users/robert/.codex/skills/image-to-3d/SKILL.md`
8. `server/reference-sessions/*`, `server/assets/*`, `server/migrations/runner.ts`, `storage.private.ts`, `pricing.ts`, and the existing Tripo/GLB validation paths in `server.ts`
9. `src/components/create-flow/*`, `src/api.ts`, and existing model viewer/validation components

Repository code, migrations, tests, and current evidence are authoritative. Earlier conversation summaries are not evidence.

## Checkpoint 0: do not conceal Phase 2 acceptance status

Before Phase 3 edits:

- Confirm Node `v24.18.0`, npm `v11.16.0`, MySQL 8.4, and `CURRENT_SCHEMA_VERSION = 21`.
- Confirm the branch contains the Phase 2 lead hardening described in the newest `handoff.md` entry.
- Confirm the worktree is clean. If the lead hardening is uncommitted or another agent is modifying owned files, stop and report the exact conflict; do not absorb unrelated changes into a Phase 3 commit.
- Run `npm run lint` and the 19-test Phase 2 suite.
- Keep `MULTIVIEW_APPROVAL_ENABLED=false` and `VITE_MULTIVIEW_APPROVAL_ENABLED=false` by default.
- If Gemini/private-storage credentials are available, complete and record the bounded Phase 2 sandbox and browser/mobile matrix first. If they are unavailable, Phase 3 development may continue behind default-off flags, but neither Phase 2 nor Phase 3 may be labeled production-enabled.
- Create `phase-evidence/PHASE_3.md` and `phase-evidence/PHASE_3_CHECKLIST.html` immediately. Keep exact commands, totals, skips, provider calls, costs, notes, risks, and HTML comment sections current.

## Phase boundary

Phase 3 begins only from an immutable, approved Phase 2 manifest:

`approved canonical five-view manifest -> durable paid build job -> provider attempts -> downloaded GLB -> canonical artifact -> post-build verification -> correction attempts -> user delivery/acceptance`
You are Gemini 3.6 Antigravity acting as the implementation agent for Pawsome3D Phase 3. Work directly in `/Users/robert/Desktop/claude7126/PawsMemories`. Implement the phase end to end. Do not respond with a design-only proposal.

## Authority and required reading

Read in this order before editing:

1. `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`, especially sections 3, 5, 6, 15, and 20-22
2. `BUILD_EXECUTION_SCAFFOLD.md`, especially the Phase 2 boundary and Phase 3 contract
3. `PHASED_IMPLEMENTATION.md`
4. `handoff.md`, newest lead correction first
5. `phase-evidence/PHASE_2.md` and `phase-evidence/PHASE_2_CHECKLIST.html`
6. `AGENT_PROMPT_PHASE_2_MULTIVIEW.md` for the immutable input contract
7. `/Users/robert/.codex/skills/image-to-3d/SKILL.md`
8. `server/reference-sessions/*`, `server/assets/*`, `server/migrations/runner.ts`, `storage.private.ts`, `pricing.ts`, and the existing Tripo/GLB validation paths in `server.ts`
9. `src/components/create-flow/*`, `src/api.ts`, and existing model viewer/validation components

Repository code, migrations, tests, and current evidence are authoritative. Earlier conversation summaries are not evidence.

## Checkpoint 0: do not conceal Phase 2 acceptance status

Before Phase 3 edits:

- Confirm Node `v24.18.0`, npm `v11.16.0`, MySQL 8.4, and `CURRENT_SCHEMA_VERSION = 21`.
- Confirm the branch contains the Phase 2 lead hardening described in the newest `handoff.md` entry.
- Confirm the worktree is clean. If the lead hardening is uncommitted or another agent is modifying owned files, stop and report the exact conflict; do not absorb unrelated changes into a Phase 3 commit.
- Run `npm run lint` and the 19-test Phase 2 suite.
- Keep `MULTIVIEW_APPROVAL_ENABLED=false` and `VITE_MULTIVIEW_APPROVAL_ENABLED=false` by default.
- If Gemini/private-storage credentials are available, complete and record the bounded Phase 2 sandbox and browser/mobile matrix first. If they are unavailable, Phase 3 development may continue behind default-off flags, but neither Phase 2 nor Phase 3 may be labeled production-enabled.
- Create `phase-evidence/PHASE_3.md` and `phase-evidence/PHASE_3_CHECKLIST.html` immediately. Keep exact commands, totals, skips, provider calls, costs, notes, risks, and HTML comment sections current.

## Phase boundary

Phase 3 begins only from an immutable, approved Phase 2 manifest:

`approved canonical five-view manifest -> durable paid build job -> provider attempts -> downloaded GLB -> canonical artifact -> post-build verification -> correction attempts -> user delivery/acceptance`
You are Gemini 3.6 Antigravity acting as the implementation agent for Pawsome3D Phase 3. Work directly in `/Users/robert/Desktop/claude7126/PawsMemories`. Implement the phase end to end. Do not respond with a design-only proposal.

## Authority and required reading

Read in this order before editing:

1. `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`, especially sections 3, 5, 6, 15, and 20-22
2. `BUILD_EXECUTION_SCAFFOLD.md`, especially the Phase 2 boundary and Phase 3 contract
3. `PHASED_IMPLEMENTATION.md`
4. `handoff.md`, newest lead correction first
5. `phase-evidence/PHASE_2.md` and `phase-evidence/PHASE_2_CHECKLIST.html`
6. `AGENT_PROMPT_PHASE_2_MULTIVIEW.md` for the immutable input contract
7. `/Users/robert/.codex/skills/image-to-3d/SKILL.md`
8. `server/reference-sessions/*`, `server/assets/*`, `server/migrations/runner.ts`, `storage.private.ts`, `pricing.ts`, and the existing Tripo/GLB validation paths in `server.ts`
9. `src/components/create-flow/*`, `src/api.ts`, and existing model viewer/validation components

Repository code, migrations, tests, and current evidence are authoritative. Earlier conversation summaries are not evidence.

## Checkpoint 0: do not conceal Phase 2 acceptance status

Before Phase 3 edits:

- Confirm Node `v24.18.0`, npm `v11.16.0`, MySQL 8.4, and `CURRENT_SCHEMA_VERSION = 21`.
- Confirm the branch contains the Phase 2 lead hardening described in the newest `handoff.md` entry.
- Confirm the worktree is clean. If the lead hardening is uncommitted or another agent is modifying owned files, stop and report the exact conflict; do not absorb unrelated changes into a Phase 3 commit.
- Run `npm run lint` and the 19-test Phase 2 suite.
- Keep `MULTIVIEW_APPROVAL_ENABLED=false` and `VITE_MULTIVIEW_APPROVAL_ENABLED=false` by default.
- If Gemini/private-storage credentials are available, complete and record the bounded Phase 2 sandbox and browser/mobile matrix first. If they are unavailable, Phase 3 development may continue behind default-off flags, but neither Phase 2 nor Phase 3 may be labeled production-enabled.
- Create `phase-evidence/PHASE_3.md` and `phase-evidence/PHASE_3_CHECKLIST.html` immediately. Keep exact commands, totals, skips, provider calls, costs, notes, risks, and HTML comment sections current.

## Phase boundary

Phase 3 begins only from an immutable, approved Phase 2 manifest:

`approved canonical five-view manifest -> durable paid build job -> provider attempts -> downloaded GLB -> canonical artifact -> post-build verification -> correction attempts -> user delivery/acceptance`

Phase 3 must not:

- generate or silently replace Phase 2 reference views;
- accept a client object key, owner, provider handle, cost, hash, validation result, model URL, or approval claim;
- call a 3D provider from the Phase 2 approval endpoint;
- charge before server-side preflight re-verifies the approved manifest;
- call pre-build image suitability “mesh accuracy,” “print accuracy,” “riggable,” or “dimensionally accurate”;
- implement rigging, facial morph authoring, accessories, Fur Bin publishing, stationery, subscriptions, Randy, or BIM/IFC behavior;
- mutate an approved reference session, provider attempt, delivered GLB version, validation report, or ledger event.

Phase 4 owns rigging/facial/accessories. Phase 9 owns calibrated scale and IFC. A Phase 3 model may be unscaled and unrigged unless measured evidence says otherwise.

## User-visible behavior

After Phase 2 approval, show a separate confirmation step that states:

- the exact approved reference revision and manifest hash prefix;
- the configured GLB build price from authoritative `pricing.ts` data;
- that a charge is reserved only after server-side preflight succeeds;
- that post-build geometry/artifact checks occur after generation;
- that likeness is advisory and scale is unknown unless calibrated;
- that failed build/verification attempts follow the documented release/refund policy.

The user explicitly starts the build. Refreshing, double-clicking, retrying a timed-out request, or replaying a callback must not duplicate a job, provider call, charge, refund, or delivery.

## Architecture

Create a focused `server/model-builds/` domain. Keep business logic out of `server.ts`.

Expected modules:

- `types.ts`: job, attempt, callback, artifact, validation, cost, and public DTO contracts
- `schemas.ts`: strict Zod request/provider/callback/report schemas
- `repository.ts`: transaction-only persistence and row locks
- `service.ts`: authorization, preflight, state machine, idempotency, charging, retries, validation, delivery, recovery
- `provider.ts`: provider-independent `ModelBuildProvider` port and existing Tripo adapter
- `poller.ts`: bounded polling/callback convergence with leases and restart recovery
- `storage.ts`: private temporary provider input/output persistence, streaming limits, computed identity, cleanup
- `validation.ts`: deterministic GLB reopen and artifact checks
- `renderVerification.ts`: standard render request/results through the existing Blender worker
- `routes.ts`: thin authenticated routes with dependency-injected factory
- `featureFlag.ts`: server-authoritative `MODEL_BUILD_V3_ENABLED`, default false
- `recovery.ts`: stale lease/job reconciliation runnable at startup and from an admin command

`server.ts` may receive imports, dependency construction, startup recovery registration, bounded parsers, and one authenticated route mount only.

Reuse `server/assets/service.ts` for canonical assets and lineage. Reuse existing credit ledger primitives rather than inventing another balance table. Isolate legacy create endpoints behind their existing paths and do not partially route them into the new state machine.

## Migration 22 contract

Migration 22 is reserved for Phase 3. Do not edit applied migrations 18-21.

Add normalized tables sufficient for:

- model build jobs: UUID, owner, approved reference session/attempt/manifest asset+version/hash, requested output, pricing key, quoted credits, state, current attempt, accepted output, timestamps;
- model build attempts: job, attempt number, idempotency key, provider/model, provider task handle, input config hash, lease owner/expiry, state, safe failure code, started/completed timestamps;
- provider events: provider, event ID or computed event hash, attempt, event type, received/processed timestamps, sanitized payload metadata, uniqueness;
- build artifacts: attempt, canonical asset/version, role (`provider_glb`, `validated_glb`, standard render), computed hash/size/MIME, uniqueness;
- post-build reports: attempt, canonical report asset/version, status, validator versions, metrics hash, timestamps;
- credit reservations/releases/refunds or an explicit immutable link to the existing authoritative credit ledger;
- delivery/acceptance: one immutable accepted artifact/report per job.

Use composite foreign keys so attempts belong to jobs, reference attempts belong to the selected reference session, asset versions belong to their asset IDs, reports/artifacts belong to their attempt, and accepted outputs belong to the same job. Use checks and unique keys for nonnegative costs, attempt numbering, idempotency, provider events, and one terminal delivery. DDL must be forward-only and retry-safe.

Test fresh, upgraded, rerun, partial-retry, cross-record rejection, crash recovery, and concurrent migration behavior on MySQL 8.4 with zero Phase 3 skips.

## Durable state machine

Use explicit states, with names adjusted only if tests document the mapping:

`draft -> preflight -> reserving -> queued -> submitted -> processing -> downloading -> validating -> ready -> accepted`

Terminal/non-success states:

- `failed_preflight`: no provider call and no charge;
- `failed_provider`: release/refund exactly once according to the existing ledger contract;
- `failed_validation`: artifact remains quarantined; correction may create a new immutable attempt; release/refund exactly once when terminal;
- `cancelled`: allowed only before provider submission unless the provider contract proves cancellation;
- `accepted`: terminal and immutable.

Requirements:

- Every mutation has an idempotency key and a transaction boundary.
- Lock the job row for every state transition.
- Use a lease/claim token for workers. Expired leases are recoverable after process restart.
- A provider task handle is persisted before polling continues.
- Callback and polling paths converge through the same event/state transition logic.
- Duplicate callbacks and concurrent pollers have no duplicate side effects.
- Retry creates a new attempt and preserves all prior attempts and artifacts.
- Store safe failure codes publicly; keep raw provider details bounded and private.
- Never log credentials, signed URLs, base64, raw GLBs, source images, or full provider payloads.

## Pre-build verification and billing

Immediately before reserving credits, server-side preflight must reload and verify:

- authenticated owner or authorized admin;
- approved Phase 2 session and exact approved attempt;
- canonical manifest asset/version and manifest hash;
- all five canonical view assets/versions, ordered kinds, measured dimensions, and hashes;
- canonical Phase 2 report/version/hash with status not `fail`;
- no stale or changed reference versions;
- authoritative pricing key and current price from `pricing.ts`;
- sufficient balance using the current credit service.

The client never supplies the debit amount. Reserve/debit exactly once only after preflight. Persist immutable ledger correlation IDs. Define and test one policy for:

- success/acceptance;
- provider failure;
- validation failure;
- correction retry;
- user cancellation before submission;
- timeout and recovery;
- administrator repair.

Do not use a compensating balance update without an idempotent ledger event. Prove the sum of reservations, captures, releases, and refunds reconciles for every terminal job.

## Provider contract

Use the existing configured Tripo integration unless current code proves another provider is authoritative. Wrap it behind `ModelBuildProvider`; do not scatter HTTP calls through routes.

The adapter must:

- send the approved five-view inputs in the provider-supported ordered contract;
- persist the actual provider, model/version, request config hash, provider handle, timestamps, and bounded cost metadata;
- enforce connect/read/overall timeouts and bounded polling with jitter/backoff;
- validate callback signatures when callbacks are supported;
- reject provider URLs outside allowlisted HTTPS hosts and prevent SSRF/private-address resolution;
- stream downloads with byte limits, timeout, MIME/magic validation, and SHA-256;
- never treat HTTP 200 alone as model success;
- expose a deterministic fake for tests and a bounded sandbox path for credentialed evidence.

Do not add a second SDK unless the existing integration cannot meet the contract and the evidence explains why.

## Canonical output and lineage

Register every provider GLB, validated GLB, standard render, and report through the canonical asset service using server-computed identity. Required lineage:

`approved manifest version -> provider GLB version -> validated GLB version -> post-build report and standard renders`

Provider output is private and quarantined until validation passes. Public API responses expose canonical UUID/version metadata and short-lived authorized URLs, never object keys or raw provider URLs.

Failed persistence must clean newly written objects and unpublished canonical rows. Reconciliation must detect DB-only and object-only drift without deleting by default.

## Post-build verification

Post-build verification is separate from Phase 2 and runs after the GLB bytes are downloaded.

Deterministic required checks:

- GLB magic/version/declared length and bounded total bytes;
- reopen through the current glTF Transform stack;
- at least one scene, node, mesh, primitive, POSITION accessor, and renderable material path;
- finite positions, transforms, bounds, normals/UV diagnostics, triangle and vertex counts;
- no NaN/Infinity, impossible indices, empty geometry, corrupt buffers, or external URI dependencies;
- orientation/up-axis and ground contact report;
- measured bounding box and dimensions labeled unscaled unless calibration exists;
- texture MIME, dimensions, count, color-space metadata where available, and GPU/mobile budget warnings;
- standard front/left/right/rear/three-quarter renders from the existing Blender worker;
- artifact SHA-256, size, validator versions, and reproducible report hash.

Advisory checks:

- silhouette and proportion agreement against approved references;
- markings/color/accessory/face identity continuity;
- crop/background artifacts and obvious duplicated/missing anatomy.

Strictly parse any AI/vision judgment through Zod and store its provider/model. AI may produce warnings or quarantine according to named thresholds, but it cannot override deterministic corruption. Never claim real-world scale from uncalibrated images.

Correction attempts are bounded by configuration. Each attempt uses the prior report as bounded correction instructions, creates a new provider attempt and canonical outputs, and never overwrites history.

## API minimum

Implement strict authenticated endpoints for:

- build preflight/quote from an approved reference session;
- explicit build start with idempotency key;
- job detail/status with authorized signed URLs;
- bounded correction retry after failed/warn validation;
- cancellation before submission;
- explicit user acceptance of one validated artifact/report hash;
- authenticated provider callback on a separate signature-verified route if supported;
- admin-only stale-job reconciliation and diagnostics.

Use bounded parsers, UUID validation, per-user/provider rate limits, stable error codes, and service-layer authorization. Status reads must not trigger provider side effects.

## UI minimum

Extend the Create flow without starting a build on Phase 2 approval.

Required states:

- approved-reference summary and exact revision;
- authoritative credit quote and explicit paid confirmation;
- queued/processing/recovering progress that survives refresh;
- post-build report separating deterministic checks from advisory likeness;
- standard render review and GLB viewer only after safe parsing;
- retry/correction with bounded notes and visible pricing/refund policy;
- explicit acceptance/delivery;
- clear failures, cancellation rules, and support correlation ID.

Use the existing Spatial Glow theme and the light/dark design documents. Maintain 20-24px mobile outer clearance and at least 16px outside borders/shadows at 320, 360, 390, and 430px. Check reduced motion, keyboard/focus order, screen-reader names, loading memory, WebGL failure fallback, and no horizontal overflow.

## Subagent delegation

Use subagents only with disjoint write sets. The primary agent owns shared files, integration, billing, route security, evidence, and conflict resolution.

1. **Database/recovery subagent**: migration 22, repository, leases, MySQL tests only.
2. **Provider/storage subagent**: provider port/Tripo adapter, download hardening, fake adapter, storage tests only.
3. **Verification subagent**: GLB validators, fixtures, Blender standard-render bridge, validation tests only. Must read the `image-to-3d` skill.
4. **UI/accessibility subagent**: Create build/review UI and browser evidence only.
5. **Adversarial review subagent**: read-only security, billing, concurrency, privacy, and failure-recovery review after integration.

No two agents may edit `server.ts`, `server/migrations/runner.ts`, `pricing.ts`, `src/api.ts`, tracker, handoff, or the same test file concurrently.

## Mandatory adversarial tests

Prove at minimum:

- no token, spoofed header, wrong owner/admin, disabled flag, and unknown fields fail closed;
- unapproved, stale, incomplete, changed, cross-owner, or corrupt Phase 2 manifests cannot start builds;
- preflight failure produces zero provider calls and zero debits;
- duplicate/concurrent starts produce one job, one provider task, and one reservation;
- process restart after submit resumes the persisted provider handle;
- expired leases are reclaimed once; active leases are not stolen;
- duplicate/out-of-order callbacks and concurrent pollers are harmless;
- SSRF, redirects to private networks, oversized downloads, bad MIME/magic, truncated GLB, external URIs, NaN geometry, and zip/decompression abuse fail closed;
- failed persistence cleans new objects/canonical rows;
- failed provider and failed validation release/refund exactly once;
- correction creates a new immutable attempt and respects the configured maximum;
- accepted jobs cannot mutate, retry, cancel, switch artifact, or be charged again;
- status reads never call providers or modify balances;
- a GLB is reopened and measured from stored bytes, not provider metadata;
- standard renders and report hashes are linked to the exact validated GLB version;
- Phase 3 endpoints do not call rigging, facial, accessory, print, IFC, or marketplace code;
- flag-off legacy Create behavior remains unchanged.

Source-regex tests may supplement but never replace behavioral and MySQL tests.

## Gates and closeout

Run under Node 24.18.0:

```bash
npm run lint
node --import tsx --test tests/phase2_*.test.mjs
node --import tsx --test tests/phase3_*.test.mjs
npm run test
npm run build
node scripts/animator-doctor.mjs
git diff --check
```

Also require:

- MySQL 8.4 Phase 3 tests with zero skips;
- crash/restart recovery evidence using a persisted provider handle;
- bounded provider sandbox evidence if credentials are available, with no secrets or payloads logged;
- downloaded GLB reopen plus extracted geometry evidence;
- private-storage upload/read/delete and compensation evidence;
- desktop and 320/360/390/430px light/dark/system browser matrix;
- exact billing reconciliation for success, provider failure, validation failure, timeout, duplicate, retry, cancellation, and acceptance.

Before closeout:

1. Perform security, privacy, billing, state-machine, provider, storage, mobile, and recovery reviews.
2. Update Phase 3 evidence/checklist after every checkpoint with exact results and unresolved notes.
3. Update `PHASED_IMPLEMENTATION.md` and prepend a concise factual entry to `handoff.md`.
4. Show `git status --short`, branch divergence, and scoped diff summary.
5. Do not claim production signoff when a required credentialed or browser gate is missing; report `BLOCKED` or `CODE COMPLETE; EXTERNAL ACCEPTANCE PENDING`.
6. Make one local Phase 3 commit only after all locally runnable gates pass. Do not push, merge, deploy, rebuild the deployment ZIP, or start Phase 4 without explicit lead approval.

Closeout report must include commit SHA, changed files, migration version, exact test totals/skips, provider/model and measured artifact evidence, billing reconciliation, browser matrix, remaining risks, and rollback steps.
