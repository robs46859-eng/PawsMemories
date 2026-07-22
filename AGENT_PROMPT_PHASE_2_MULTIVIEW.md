# Antigravity Execution Prompt: Phase 2 High-Resolution Multiview Approval

You are Gemini 3.6 Antigravity acting as the implementation agent for Pawsome3D Phase 2. Work directly in `/Users/robert/Desktop/claude7126/PawsMemories`. Complete the phase end to end; do not merely propose code.

## Authority and mandatory read order

Read these before editing:

1. `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`, especially sections 3, 5, 6.1-6.4, 20-22
2. `BUILD_EXECUTION_SCAFFOLD.md`
3. `PHASED_IMPLEMENTATION.md`
4. `handoff.md`, starting at the newest Phase 1 lead update
5. `phase-evidence/PHASE_1.md`
6. `/Users/robert/.codex/skills/image-to-3d/SKILL.md`
7. Existing implementation at `server.ts` around the image/turnaround helpers and `/api/create-pipeline/*`
8. `src/components/create-flow/*`, `src/api.ts`, `avatarPrompts.ts`, `server/imageTriage.ts`, `pricing.ts`, `storage.ts`, `storage.private.ts`, and `server/assets/*`

Repository code, tests, migration ledger, and evidence are authoritative. Conversation summaries and earlier Phase 2 Animator documents are not evidence for this product phase.

## Starting contract

- Start from a clean Phase 1 lead-correction commit on `fix/text-mode-reference-screen`.
- Confirm Node `v24.18.0`, npm `v11.16.0`, `CURRENT_SCHEMA_VERSION = 19`, and MySQL 8.4 availability.
- Mark only Phase 2 `In progress`; do not alter statuses for Phases 3-9.
- Create `phase-evidence/PHASE_2.md` from the template and `phase-evidence/PHASE_2_CHECKLIST.html` immediately. Keep both updated after every checkpoint with checked items, exact commands/results, risks, notes, and an HTML comment/notes section. Never claim a gate before running it.
- Use `MULTIVIEW_APPROVAL_ENABLED=false` as a server-authoritative default. A `VITE_` mirror may choose presentation only. Document prerequisites and rollback.
- Migration 20 is allocated to Phase 2. Do not edit migrations 18 or 19.
- Do not push, merge, deploy, or rebuild the deployment zip until every exit gate passes. At closeout, make one local Phase 2 commit and stop for lead review.

## Non-negotiable behavior

The Phase 2 boundary is:

`text or user photos -> five high-resolution immutable reference views -> pre-build consistency/suitability report -> optional retry/replace -> explicit approval of exact manifest`

Phase 2 must not call Tripo, Meshy, Blender, or any 3D-build provider. Approval must not create a model job, reserve model-build credits, or call the legacy `/api/create-pipeline/approve` behavior. Phase 3 alone consumes an approved manifest.

Required ordered views:

1. `front`
2. `left`
3. `right`
4. `rear`
5. `front_three_quarter`

For text input, generate a consistent character/object sheet. For photo input, preserve identity and synthesize only missing views. The UI must state that generated hidden views are estimates and that pre-build checks do not prove mesh, rig, print, or dimensional accuracy.

Every generated or uploaded byte must receive a server-minted object key, server-computed SHA-256/size/MIME, an immutable canonical asset version, provider/model/license metadata, and lineage. Never accept client-supplied object keys, hashes, owner IDs, prices, approval hashes, or provider success claims.

## Architecture and write boundaries

Create a focused `server/reference-sessions/` domain. Expected modules:

- `types.ts`: domain states and provider-independent contracts
- `schemas.ts`: strict Zod request, response, provider, report, and manifest schemas
- `repository.ts`: transaction-only persistence functions
- `service.ts`: state machine, authorization, idempotency, retries, replacement, approval
- `provider.ts`: `ReferenceImageProvider` port and current Gemini adapter wiring
- `consistency.ts`: deterministic report composition and strict vision-result parsing
- `storage.ts`: server-minted private reference object persistence returning computed identity
- `routes.ts`: thin authenticated routes through a dependency-injected router factory
- `featureFlag.ts`: server-authoritative flag and dependency checks

`server.ts` may receive imports, dependency construction, and one route mount only. Do not add Phase 2 business logic there. Preserve the legacy `/api/create-pipeline/*` behavior behind its existing path until a later controlled cutover; the new feature uses focused endpoints such as `/api/reference-sessions/*`.

Allowed shared edits are limited to:

- migration 20 in `server/migrations/runner.ts`
- minimal generic storage helpers in `storage.private.ts` with focused tests
- canonical asset relation types/schemas only if a required relation cannot be represented by `turnaround` or `derivative`
- `src/api.ts`, `src/components/create-flow/*`, and minimal app routing/flag plumbing
- `.env.example`, evidence, tracker, handoff, and focused tests

Do not edit Animator, BIM, marketplace, Wags, Pawprints, Randy, Stripe webhook, IFC worker, or unrelated styling modules. If another agent changes an owned file, stop and report the conflict.

## Migration 20 contract

Design and test normalized tables for at least:

- reference sessions: UUID, owner, input mode, subject class, state, current attempt, approved attempt, retry count, timestamps
- reference attempts: session, attempt number, idempotency key, provider/model, prompt/config hash, state, failure code, started/completed timestamps
- reference views: attempt, ordered view kind, canonical `asset_id` and `asset_version_id`, width/height, source/synthesized marker, uniqueness
- reference reports: attempt, canonical validation-report asset version, pass/warn/fail summary, scale confidence, report hash
- reference approvals: session, exact attempt, canonical ordered-manifest hash, approving user, immutable timestamp

Use foreign keys and unique constraints to enforce owner/session integrity, one view kind per attempt, one attempt number per session, idempotency, and one immutable approval per approved session. Approval rows are append-only. Use a forward migration and retry-safe DDL. Add fresh, upgraded, idempotent, partial-retry, constraint, and concurrent tests against MySQL 8.4.

## Service state machine

Implement and validate:

`draft -> queued -> generating -> ready -> approved`

Failure/cancel/retry transitions:

- `queued|generating -> failed`
- `draft|ready -> cancelled`
- `ready|failed -> queued` only through a new immutable attempt
- `approved` is terminal for that session; further changes create a new revision/session, never mutate the approved attempt

Requirements:

- owner/admin checks are repeated in the service, not only routes
- every mutating command has an idempotency key and transaction boundary
- duplicate/concurrent requests resolve to one attempt/approval
- retry notes are bounded, persisted, and included in the next config hash
- replacing one source photo creates a new source asset version and new attempt
- no successful approval unless all five required views exist, dimensions pass the minimum contract, consistency report is present, and the server recomputes the exact ordered manifest SHA-256
- approval must fail if any view/version/report changed after the review response
- generation failure records a safe error and performs compensating object cleanup
- never store secrets, base64 image payloads, signed URLs, or raw provider responses in logs

## Provider and image-quality contract

Use the existing configured Gemini image chain rather than adding another SDK or model family. Current expected chain is `gemini-3-pro-image`, `gemini-3.1-flash-image`, then `gemini-2.5-flash-image`, overridable by `GEMINI_IMAGE_MODELS`; verify actual code before relying on these names.

Define a provider-independent request/response port. Persist the actual provider and model returned. Decode each output, inspect actual dimensions/MIME, and reject corrupt or undersized data. “High resolution” must be an enforced measured threshold chosen from actual provider capability, not a prompt adjective. Preserve the original source and distinguish captured vs synthesized views.

Consistency reporting must cover silhouette/proportions, markings/colors, limb/anatomy count, accessories, eyes/face where applicable, crop/background suitability, and cross-view identity. Strictly parse AI judgments through Zod. Deterministic file/dimension checks remain authoritative; AI consistency is advisory unless a named safety/input-integrity rule fails. Scale confidence is `unknown`, `declared`, or `calibrated`; never infer real dimensions from an uncalibrated photo.

Run provider-independent tests with a fake adapter. If valid local provider credentials are available, run a bounded sandbox generation without printing credentials or full image payloads and record provider/model, measured dimensions, duration, and cleanup. If the required sandbox cannot run, report `BLOCKED`; do not mark Phase 2 complete.

## Storage and canonical assets

Store user references privately. Add a narrowly scoped server helper that mints collision-resistant `references/` keys without raw user identifiers, computes SHA-256/size/MIME from bytes, writes without public ACL, and supports compensating deletion only under the allowed prefix. Extend deletion allowlists deliberately and test traversal/prefix confusion.

Register source photos, five views, ordered manifest, and consistency report through `server/assets/service.ts` using explicit trusted-internal authorization. Use canonical lineage to connect source -> attempt views -> manifest/report. API responses expose canonical UUID/version metadata and short-lived authorized display URLs, never object keys.

## Billing policy

Do not invent a price. Inspect `pricing.ts` and current Create behavior. If no approved reference-generation price exists, keep Phase 2 reference generation/retry at zero PupCoins and show “No PupCoins charged until 3D build” before generation and retry. Still persist attempt cost as zero and test that failures, retries, duplicate calls, and cancellation cannot debit credits. Model-build pricing and reservation remain Phase 3.

## API minimum

Implement strict authenticated endpoints for:

- create session
- upload/replace source input
- generate reference attempt
- get session/attempt with signed display URLs
- retry with notes
- cancel before approval
- approve exact manifest hash

Use bounded payload parsers, UUID validation, rate limits appropriate to image generation, and stable error codes. Never trust an owner ID from the body. All provider-start routes enforce the server flag and idempotency key.

## UI minimum

Integrate the flag-enabled path into `src/components/create-flow/CreateReferenceScreen.tsx` without breaking the flag-off legacy flow.

Required UX:

- five-view labeled review grid in the canonical order
- click/tap zoom with keyboard close and meaningful alt text
- visible captured/synthesized labels and warnings
- consistency and input-suitability report with honest scale confidence
- optional Retry with bounded notes and a visible zero/approved price before confirmation
- replace source photo path
- explicit approval showing the exact reviewed revision; stale approval response forces refresh
- no automatic navigation into a model build
- loading, partial failure, cancellation, and retry-safe disabled states
- shared Spatial Glow semantic tokens only; no second theme system
- mobile visible outer clearance of 20-24px plus safe areas, with at least 16px outside borders/shadows at 320, 360, 390, and 430px

Use browser testing for desktop and all four mobile widths in light/dark/system modes. Check focus order, keyboard operation, screen-reader labels, reduced motion, no horizontal overflow, and image memory/loading behavior.

## Subagent delegation

If subagents are available, use them only with disjoint ownership:

1. Database subagent: migration 20, repository, and MySQL tests only.
2. Provider/validation subagent: provider port, consistency schemas, fixtures, and fake-adapter tests only.
3. UI/accessibility subagent: Create reference UI and browser/mobile evidence only.

The primary agent owns service integration, route security, shared-file edits, evidence, conflict resolution, and final review. Do not let two agents edit `server.ts`, the migration registry, tracker, handoff, or the same test file.

## Mandatory adversarial tests

Prove at minimum:

- no token, spoofed identity header, wrong owner, and disabled flag fail closed
- unknown request fields and oversized/corrupt/non-image payloads fail
- path traversal and arbitrary object keys are impossible
- duplicate and concurrent generation use one attempt/provider start
- concurrent approval creates one immutable approval
- four views, duplicate view kind, stale manifest hash, changed view version, absent report, and undersized view cannot approve
- retry creates a new attempt and never mutates the prior one
- approved session cannot be edited/retried/cancelled
- signed URLs do not expose object keys and expire within bounds
- generation failure performs cleanup and debits zero credits under the current policy
- a provider spy records zero Tripo/Meshy/Blender/3D calls through every Phase 2 endpoint
- flag-off legacy Create flow still passes existing tests

Source-regex tests may supplement but cannot replace behavioral tests.

## Gates and closeout

Run under Node 24.18.0:

```bash
npm run lint
node --import tsx --test tests/phase2_*.test.mjs
npm run test
npm run build
node scripts/animator-doctor.mjs
git diff --check
```

Also run MySQL 8.4 integration tests with zero Phase 2 skips, the bounded provider sandbox, browser desktop/mobile/theme/accessibility checks, and storage cleanup verification. Do not build the deployment zip while the tree is dirty.

Before closing:

1. Perform a security, privacy, billing, state-machine, mobile, and failure-recovery review.
2. Update `phase-evidence/PHASE_2.md` and `phase-evidence/PHASE_2_CHECKLIST.html` with exact totals and unresolved notes.
3. Update `PHASED_IMPLEMENTATION.md` and prepend a concise Phase 2 section to `handoff.md`.
4. Show `git status --short` and a scoped diff summary.
5. Commit once with `feat(create): Phase 2 immutable multiview approval`.
6. Stop and report the commit SHA, changed files, exact gate totals/skips, provider evidence, manual browser matrix, and remaining risks. Do not push or begin Phase 3 without explicit lead approval.
