# Pawsome3D Production Readiness Swarm Plan

**Director:** Codex
**Started:** 2026-07-14
**Baseline:** `origin/main` at `5085d0b`
**Release state:** HOLD - implementation and evidence gates remain open

## Product Outcome

Production readiness means all of the following work together as one supported product:

1. A signed-in user can provide a prompt, choose owned 3D models and objects, optionally
   choose an owned BIM building model, and receive a playable, downloadable animated
   video with an exact duration of 10 seconds.
2. AR passes the complete P0-P9 hardening program and a named human reviewer records a
   real-device go/no-go decision. Automated checks cannot substitute for this approval.
3. Pawprints provides curated creative templates with useful customization, previews,
   validation, accessible controls, persistence, and deterministic failure handling.
4. The global application shell is consistent and responsive. Every visible navigation
   item, button, card, link, and menu has an owned route or action and a verified state.
5. CI, staging, observability, rollback, privacy, cost controls, and deployment evidence
   support the same release artifact that reaches production.

## Hard Constraints

- Keep `PETSIM_RIG_ENABLED=false` through P0-P5 and human acceptance.
- Do not call paid providers from unit, contract, browser, or CI tests.
- Do not persist arbitrary remote URLs. Use owned media and BIM identifiers.
- Do not deploy from a dirty tree or from an unreviewed branch.
- Do not import the rejected `swarm/p0-containment` patch.
- Do not mark a phase complete until every exit criterion and evidence item is present.
- Production deployment requires a named human approval after staging acceptance.

## Workstreams

### A. Cost and Security Foundation

Owner: Director implementation lane

- Add atomic per-user and aggregate request reservations for each paid operation.
- Add aggregate dollar ceilings, warning thresholds, critical shutoff, and reconciliation.
- Preserve zero-cap semantics and independent user/global configuration.
- Add idempotency, bounded concurrency, provider timeouts, and zero-call rejection tests.
- Complete P0-P4 security, ownership, private-media, and hostile-input evidence.

Exit: concurrency tests cannot exceed any configured cap; invalid, unauthorized, cached,
or rejected work consumes neither a reservation nor a provider call; staging kill switches
have been exercised and restored by an operator.

### B. Ten-Second Prompt-to-Video

Owner: Video pipeline lane

- Define a versioned job contract containing prompt, owned actor/model IDs, owned object
  IDs, optional owned BIM model ID, output aspect ratio, audio choice, and `duration=10`.
- Resolve all assets server-side and enforce ownership before reserving cost.
- Normalize the prompt into a deterministic scene plan and provider request.
- Support a provider-backed path and a deterministic fake with call counters.
- Validate delivered duration, codec, dimensions, size, and ownership before persistence.
- Expose durable queued/running/succeeded/failed/cancelled states with idempotent retries.

Exit: supported inputs produce an owned 10-second output in staging, failures are
recoverable and observable, and no caller can reference another user's assets.

### C. AR Hardening and Human Acceptance

Owner: AR lane; final approver must be a named human

- Execute `AR_PET_SIM_HARDENING_PLAN_V2.md` P0-P9 without weakening gates.
- Capture real-device memory, frame-rate, thermal, interruption, permission, offline,
  low-light, tracking-loss, and recovery evidence on the supported device matrix.
- Validate BIM scale, coordinate systems, occlusion, anchoring, and persistent-space use.
- Complete consent, retention, export, deletion, replay, and spatial-data controls.
- Record a human staging walkthrough and explicit approval or blocking defects.

Exit: all automated evidence is green and the human acceptance record says GO. A missing
human record is a release blocker, not an implied approval.

### D. Pawprints Templates and Customization

Owner: Pawprints lane

- Inventory and version templates, field schemas, copy, image requirements, and pricing.
- Add safe text, media, palette, typography, layout, and preview customization where the
  selected template supports it.
- Validate fields before cost reservation and preserve user input across recoverable errors.
- Add loading, empty, unavailable, insufficient-credit, failure, success, reset, and retry
  states with accessible labels and keyboard behavior.
- Persist generated Pawprints as owned creations with reproducible template metadata.

Exit: every shipped template passes schema, preview, generation-fake, persistence,
accessibility, mobile, and error-recovery tests.

### E. Global Shell and UI Action Map

Owner: Shell/UI lane

- Replace implicit screen transitions with a single typed route/action registry.
- Inventory every visible button, card, link, icon button, menu item, and assistant action.
- Assign each control a destination/action, auth requirement, feature flag, loading state,
  error state, analytics event, and automated test reference.
- Remove or clearly disable no-op controls; preserve browser history and deep-link recovery.
- Verify responsive layout, focus order, labels, contrast, overflow, and error boundaries.

Exit: the UI action map contains no unexplained or untested no-op, and browser smoke tests
pass on supported desktop and mobile viewports.

### F. Release Engineering and Deployment

Owner: Release lane; production action requires human approval

- Produce immutable build metadata and a manifest/checksum for the exact reviewed commit.
- Add staging deployment and automated smoke, health, migration, rollback, and artifact checks.
- Keep environment values in host configuration; never place `.env` in the ZIP.
- Verify Node version, start command, proxy behavior, database migration, worker deployment,
  storage policy, provider callbacks, alerts, and rollback on Hostinger/staging.
- Generate the source ZIP only from the approved commit and verify its contents and hash.

Exit: staging passes every gate, rollback is rehearsed, the human release approver records
GO, and the approved artifact is deployed with post-deploy smoke and monitoring evidence.

## Pull Request Order

1. P0 atomic budgets, kill switches, and evidence scaffolding.
2. Importable full app and complete route/security contracts.
3. Private media ownership and signed delivery.
4. Versioned 10-second video job contract and deterministic orchestration.
5. BIM/model/object scene resolution and output validation.
6. Pawprints template registry, customization, and persistence.
7. Typed route/action registry and global shell cleanup.
8. P5-P8 device, provider, observability, and privacy closure.
9. Staging automation, rollback rehearsal, and human AR acceptance.
10. Production release PR and approved deployment artifact.

Each PR must be independently reviewable and keep production rigging disabled. Parallel
work may proceed in isolated worktrees, but integration follows this dependency order.

## Required Evidence Register

| Gate | Required evidence | Status |
|---|---|---|
| Protected source | Required checks and protected `main` export | Verified |
| Baseline CI | Type, unit/AR, IFC, security, contract, build | Verified for stabilization baseline |
| P0 budgets | Concurrent reservation, dollar ceiling, kill-switch staging report | Open |
| Ownership/privacy | Two-user media/BIM/video contracts and private bucket evidence | Open |
| Video | Exact 10-second staging output and media validation report | Open |
| Pawprints | Template/action inventory and browser/accessibility report | Open |
| Shell | Complete UI action map and desktop/mobile smoke report | Open |
| AR P0-P9 | Evidence register with no unwaived critical/high findings | Open |
| Human AR | Named reviewer, devices, date, result, defects, acknowledgement | Open |
| Deployment | Staging URL, smoke results, artifact hash, rollback rehearsal | Open |
| Production | Human GO, deployed commit/hash, post-deploy smoke and monitoring | Open |

## Current Swarm Lanes

- `director/production-readiness`: authoritative coordination and evidence.
- `swarm/video-pipeline`: prompt-to-video discovery and later scoped implementation.
- `swarm/pawprints-ui`: Pawprints and customization discovery and later implementation.
- `swarm/shell-route-map`: shell, deployment, and AR evidence audit.
- `swarm/p0-containment`: quarantined rejected patch; never merge or cherry-pick.

## Immediate Director Decision

Begin with the P0 atomic budget contract and complete product/route inventories in
parallel. Video, Pawprints, and shell implementation may start after their inventories are
reviewed, but no paid provider path or production deployment may be enabled before P0 and
ownership gates are proven.
