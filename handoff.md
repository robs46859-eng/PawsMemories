# Pawsome3D Project Handoff

Updated: 2026-07-14

## State

Phases 0-3 are implemented and their automated exit gates pass. The BIM builder is available from **My Models > Scaled BIM Builder**. It authors in meters, imports IFC through the worker, displays semantic properties, and exports IFC4 only after a server-side reopen and GLB conversion.

Paid builds use two verification gates. Pre-build verification is free and is repeated server-side before charging. Shell builds cost 60 credits and deliver a dimension-verified GLB without BIM semantics. IFC/BIM builds cost 300 credits and deliver IFC4 plus semantic GLB after schema, GlobalId, element-count, and dimensional verification. Failed post-build verification refunds the charge.

The current Animator plan is a separate phase sequence in `PHASED_IMPLEMENTATION.md`. Animator Phases 0–2 are complete. The committed Phase 5–8 work was reviewed on 2026-07-13 and is scaffold/partial work, not completed phase delivery. Phase 3 and Phase 4 dependencies are also not closed.

## Animator Handoff

### Current verified baseline

- Stabilization branch baseline and `origin/main`: `4c4b955`; the branch contains local,
  uncommitted hardening changes described below.
- Current stabilization verification: TypeScript and production client/server build clean,
  with 508/508 tests passing across the combined coverage run.
- Animator Phase 3 now has a provider-free planning foundation in
  `server/animator/rigging-profile.ts`: profile selection, bone-contract masking,
  selective-rig planning, deterministic manifests, and a >=10-mesh corpus acceptance
  rule. Its 12 focused tests pass. It is not mounted and does not complete Phase 3.
- Live Animator voice preview calls ElevenLabs, charges non-admin users 25 credits for a maximum 30 seconds, and drives the selected actor through the L2 face layer.
- `RHUBARB_BIN` is optional. If the executable is absent or invalid, speech remains available with Tier A jaw animation; Tier B visemes require the Linux binary and its adjacent resource directory.
- `PHASE2_CHECKLIST.html` contains the Phase 2 acceptance evidence.

### Phase 5–8 audit

| Phase | Status | What is real | What the next agent must not assume |
|---|---|---|---|
| 5 Mesh Processing | Scaffold | Pure Euler characteristic, LOD target planning, and quadric-budget checks in `server/animator/meshops.ts`; four tests | No caller imports it; no simplification, repair, LOD outputs, compression, runtime LOD, or corpus exit gate exists |
| 6 Sequencer/Capture | Partial foundation | Theatre camera integration, project persistence, MediaRecorder recording, WebCodecs encoder module, RMS/onset helpers | No frame-accurate sequencer/export path; encoder is unused; no image sequence or baked GLB; `/bake` returns 501 |
| 7 Realtime/ML | Scaffold | DSP framing/mel/RMS/onset/statistics primitives and five tests | No AudioWorklet, MFCC classifier/calibration, Audio2Face, ML rigger, reconstruction worker, or sound classifier; `/reconstruct` returns 501 |
| 8 Agentic Batch | Scaffold | Skills/personas and manifest validation/plan printing | Batch dispatch is explicitly unimplemented; there is no retry engine, QA report, or end-to-end catalog run |

Commit `7caffe0` accurately calls these additions “scaffolds.” Older commits named Phase 8/8.1 (`ce62617`, `4a9a528`, `9e2cc52`) refer to an earlier Animation Studio numbering and count as Phase 6 foundations under the current plan, not current Phase 8 completion.

### Required next order

1. Close Animator Phase 3: implement `/rig`, profile fitting/selective rigging, validation manifests, and the ≥10-mesh acceptance corpus.
2. Close Animator Phase 4: expanded canonical clips, batch retarget/repurpose, lip-sync preservation, playback sweep, and foot-slide metrics.
3. Implement Phase 5 production wiring. Reuse `meshops.ts` policy helpers, but derive metrics from actual geometry and produce versioned LOD artifacts/manifests.
4. Complete Phase 6 with a deterministic render clock, connected WebCodecs/image-sequence output, sRGB fixture, audio lane, and a real `/bake` worker path.
5. Build Phase 7 runtime/ML features behind capability and confidence gates.
6. Make Phase 8 batch execution real only after the underlying jobs exist; require retry policy, aggregate QA report, and end-to-end fixtures before closing it.

### Review commands for the next agent

```bash
rg -n "dispatch not implemented|NOT_IMPLEMENTED|returns 501|nothing imports" scripts server src
rg -n "meshops|createMp4Encoder|audio/dsp" server src scripts tests
npm run lint
npm run test
npm run build
node scripts/animator-doctor.mjs
```

Do not delete or overwrite the two untracked source-note markdown files unless the user explicitly asks for them to be added.

## Architecture

- `src/three/spatial/`: authoritative SI metadata, calibration provenance, measurement formatting, transformed GLB bounds.
- `src/bim/model.ts`: constrained BIM model, metric snapping, relationship validation, 50-command undo/redo.
- `src/components/BimModelBuilder.tsx`: authoring, IFC import/export, category filtering/coloring, GlobalId selection, properties, notes.
- `server.ts`: authenticated `/api/bim/import-ifc` and `/api/bim/export-ifc` routes.
- `blender-worker/server.js`: authenticated IFC endpoints, 50 MB limit, 120-second process timeout, two-process concurrency ceiling, SHA-256 conversion cache.
- `blender-worker/ifc_worker/ifc_worker.py`: fail-closed IFC2X3/IFC4/IFC4X3 inspection/conversion and constrained IFC4 export.
- `fixtures/two-room-building.json`: Phase 3 acceptance building.

## Runtime Dependencies

The browser needs no additional IFC package. IFC intelligence runs server-side using pinned `ifcopenshell==0.8.5` and `numpy==2.2.1`. The worker Dockerfile installs these. `web-ifc` is optional and should only be added later if offline/client-side parsing becomes a product requirement.

## Image and 3D Models

Reference images use the configured Gemini chain: `gemini-3-pro-image`, `gemini-3.1-flash-image`, then `gemini-2.5-flash-image` (`GEMINI_IMAGE_MODELS` overrides it). Tripo performs the actual image-to-3D or multiview-to-3D mesh generation. `imagen-4.0-generate-001` belongs to the separate still-image route.

## Verification

```bash
npm run lint
npm run test
npm run build
PYTHONPATH=blender-worker/ifc_worker python3 -m unittest discover -s blender-worker/ifc_worker/tests -v
```

Python must have the worker requirements installed. Fixture regeneration is `npm run fixtures:bim` after installing those requirements.

## Deployment

- Main app requires `BLENDER_WORKER_URL` and `WORKER_SHARED_SECRET`.
- Worker requires the same `WORKER_SHARED_SECRET`; `IFC_PYTHON` is optional in Docker.
- Deploy the updated `blender-worker` separately before exposing IFC controls in production.
- The Hostinger source archive is built with `scripts/build-deploy-zip.sh` after commit, as required by `DEPLOYMENT_NOTES.md`.

## Manual Review

Open `BIM_PHASE_0_3_CHECKLIST.html`. The only intentionally unchecked exit item is the production browser smoke test against the deployed worker. Notes and comments persist in local storage.

## Stabilization Status (branch: stabilize/ar-hardening-foundation)

Work on this branch stabilizes the repository and establishes a testable AR hardening
foundation before any Animator Phase 3, Unity/NSDK, private-storage, or production
rigging work. It does not complete P0, P1, or P2.

### What changed on this branch
- **Shared pet-sim router** (`server/petSimRouter.ts`): the three AR paid routes
  (`/api/pets/classify`, `/api/pets/:id/rig`, `/api/ar/semantic-scan`) now live in one
  factory with injected db/providers. Production `server.ts` mounts the SAME router, so
  contract tests exercise the real route handlers.
- **P2 schemas wired into production**: `ClassifyRequestSchema` (`src/schemas/pets.ts`)
  and `SemanticScanRequestSchema` (`src/schemas/ar.ts`) validate classify/semantic-scan
  requests; `imageUrl` is rejected by the schema (`.never()`). `paidLimiter` and the
  `guardPaidCall` kill-switch + per-user daily cap are applied in the router.
- **Removed artifacts**: `server.ts.bak` and the unused mock `server/app-for-testing.ts`
  are deleted from tracking.
- **Contract tests replaced**: `tests/contract_api.test.mjs` (mock app + `assert.ok(true)`)
  is gone; `tests/contracts/petsim.test.mjs` drives the production router via supertest
  with deterministic fakes + call counters (18 cases: missing/malformed/expired auth,
  two-user isolation, disabled rig 501, master kill-switch 503, per-user cap 429,
  invalid requests rejected before provider calls, MIME mismatch, and rig task-id
  ownership enforcement).
- **Image input validation** (`src/security/image-input.ts`): production classify and
  semantic-scan requests now require canonical JPEG/PNG/WebP data URLs, verified magic
  signatures and MIME agreement, bounded encoded/decoded bytes, dimensions, pixels,
  aspect ratio, and terminal container boundaries. Seven focused security tests pass.
- **Rig side-effect ordering**: the disabled-by-default rig route derives provider task
  IDs only from the owned avatar, validates and checks budgets before upload/persistence,
  and returns sanitized worker/provider errors.
- **CI rewritten**: removed duplicate IFC execution; `npm audit` is now gating (no `|| echo`);
  placeholder jobs (coverage/deploy/notify/branch-protection) removed; `timeout-minutes`
  added to every job as a hard backstop against the historical test hang; added
  `.gitleaks.toml` that extends the default rules without broad path/value allowlists.
- **Defensive**: `src/security/rate-limiter.ts` interval is `unref()`'d so it cannot keep
  the event loop (and thus a test runner) alive; `auth.ts` reads `JWT_SECRET` at call
  time (runtime-injectable, fails closed).

### Honest exit-gate status (do NOT mark complete without every criterion)
- **P0**: Rig remains disabled, arbitrary `imageUrl` input is rejected, and
  `server.ts.bak` is removed. Global daily caps, production cap evidence, bucket-policy
  evidence, secret rotation review, route-specific body ceilings, and staged kill-switch
  evidence remain open. → P0 **partial**.
- **P1**: Contract tests use real production route handlers ✅. IFC discovery path corrected ✅.
  Secret scanning is configured with default rules. The unit-test *hang* is **mitigated**
  (timeout-minutes + child teardown fixes + DB-disabled CI env) but was **not reproduced
  inside GitHub Actions**. A local coverage baseline is recorded (73.39% lines, 83.94%
  branches, 72.45% functions). Remaining route contracts, branch protection, and a green
  remote run are still missing. → P1 **partial**.
- **P2**: Request schemas are wired into the three production paid routes, existing
  Express throttling and per-user daily caps remain in place, and invalid tested inputs
  stop before provider calls.
  `rigBudget`/`needsRetargetFallback` wired into the rig route ✅ (rig stays disabled:
  `PETSIM_RIG_ENABLED=false`). Canonical base64, signature/MIME matching, decoded-size,
  image dimensions, pixel/aspect ceilings, and malformed/trailing-container rejection are
  implemented and tested. Trusted-proxy rate buckets, a complete adversarial corpus,
  maximum-input memory profiling, response-schema enforcement, and safe remote fetch
  remain open. `safe-fetch.ts` is intentionally not wired because its DNS/IPv6 defenses
  are incomplete. → P2 **partial**.

### Remaining owner actions before this branch can merge
1. Enable branch protection on `main` (require passing CI, no force-push).
2. Review secret-scan results and rotate any real credential exposed outside this repo.
3. Authorize push + confirm one fully green CI run.

### Local verification on 2026-07-14

- TypeScript: pass.
- Combined coverage suite: 508/508 pass; exits normally.
- Coverage baseline: 73.39% lines, 83.94% branches, 72.45% functions.
- Dedicated AR suite: 136/136 pass.
- Image-input security suite: 7/7 pass.
- Production-router contracts: 18/18 pass.
- Animator Phase 3 profile-planning foundation: 12/12 focused tests pass.
- Production build: pass (chunk-size warnings only).
- IFC: 5/5 pass under Python 3.11 with the pinned worker requirements.
- Dependency audit/signatures: 0 vulnerabilities; 704 registry signatures verified.
- Gitleaks 8.28 default rules: no leaks found in the working tree.
- Animator Doctor: required checks pass; Rhubarb remains optional/missing and duplicate
  Sharp/libvips native versions still produce a warning.

## Stabilization Review Addendum (2026-07-14)

The post-push review reproduced two release blockers that were not covered by the
existing contract harness. This section is append-only; completed fixes and their
verification evidence will be added below without removing the original status.

- **BLOCKER — image decoding:** `validateImageDataUrl` accepts header-only PNG/JPEG
  fixtures that Sharp cannot decode. A malformed payload can therefore pass validation,
  consume quota, and reach a paid provider.
- **BLOCKER — body-limit mismatch:** production installs the global 1 MB JSON parser
  before the pet-sim routes, while image validation advertises an encoded limit of 5 MB.
  Valid image requests above the global limit are rejected before route validation.
- **BLOCKER — production-app coverage:** contract tests mount `createPetSimRouter` on a
  separate Express app, so production middleware ordering and startup wiring are not
  covered. The fixed-port spawned auth test also remains a possible CI child-process
  teardown risk.

No deployment approval should be inferred from the earlier local verification while
these blockers remain open.

### Fix note — complete image decoding

- **Applied:** image validation now performs a bounded Sharp metadata check and full
  decode after the existing encoded-size, signature, container, dimension, pixel, and
  aspect-ratio checks. Multi-page inputs are rejected. Decoding finishes before
  ownership usage is incremented or a paid provider is called.
- **Tests corrected:** positive JPEG/PNG/WebP fixtures are real decodable images. The
  former header-only PNG/JPEG samples are retained as negative regression fixtures and
  must return `INVALID_IMAGE`.
- **Verification:** `npm run test:security` passes 8/8 and `npm run lint` passes.

### Fix note — production parser and contract app

- **Applied:** `server/petSimApp.ts` is now the importable production app for the
  classify, rig, and semantic-scan routes. It owns the narrowly scoped 6 MiB JSON
  envelope and mounts the shared production router. `server.ts` preserves those two
  image request streams from the global 1 MiB parser and mounts that exact app after
  constructing real provider adapters.
- **Boundary coverage:** contracts prove that a valid, fully decoded image request above
  1 MiB succeeds and that a request above the 6 MiB JSON ceiling returns a sanitized
  413 before quota or provider calls. A trailing slash receives the same parser policy.
- **Isolation coverage:** the two-user semantic-scan contract now uses the same anchor
  key for both users. Each user receives a separate first scan, and only the owner can
  reuse their cached result.
- **Verification:** production paid-route contracts pass 21/21 and TypeScript passes.

### Fix note — full-server smoke-test lifecycle

- **Applied:** `tests/auth-routes.test.mjs` now starts the repository-local `tsx`
  executable directly on a dynamically reserved port. On macOS/Linux it creates and
  terminates a process group, with bounded SIGTERM/SIGKILL fallback, so a wrapper or
  descendant cannot remain alive after the test.
- **Verification:** the focused full-server auth/route-order smoke test passes 4/4 and
  exits normally. This test intentionally binds a port because it checks assembled
  full-server startup; paid-route contracts remain entirely in-process.

### Superseding verification and remaining gates

Local verification after the fixes:

- TypeScript: pass.
- Root unit suite: 483/483 pass and exits normally.
- Dedicated AR suite: 136/136 pass.
- Image-input security suite: 8/8 pass.
- Production paid-route contracts: 21/21 pass.
- Combined coverage: 512/512 pass; 73.55% lines, 83.76% branches, 72.69% functions.
- Production build: pass; existing chunk-size warnings only.
- IFC worker: 5/5 pass with the pinned Python 3.11 requirements. The machine's default
  Python 3.14 lacks `ifcopenshell`, so `npm run test:ifc` fails unless the pinned worker
  environment is activated; this is an environment prerequisite, not a code failure.
- Dependency audit: zero vulnerabilities.
- Animator Doctor: required checks pass; Rhubarb remains optional/missing and the
  duplicate Sharp/libvips warning remains.
- Diff whitespace check: pass. The local Gitleaks binary is unavailable, so the remote
  security-scan job remains required.

The three blockers recorded at the start of this addendum are fixed locally. P0, P1,
and P2 remain **partial** under `AR_PET_SIM_HARDENING_PLAN_V2.md`; this work does not
change their completion labels. Remaining release/merge gates are a pushed fix commit,
a pull request with a fully green GitHub Actions run (including Gitleaks), and owner
configuration of `main` branch protection. Production rigging remains disabled unless
`PETSIM_RIG_ENABLED=true`; do not enable it as part of this stabilization phase.

### Remote verification note — blocker discovered

- Fix commit `de4a1a0` was pushed to `stabilize/ar-hardening-foundation` and draft PR
  [#1](https://github.com/robs46859-eng/PawsMemories/pull/1) was opened to obtain real
  GitHub Actions evidence.
- Actions run `29350629818` passed Type Check, IFC Tests, and Unit & AR Tests, but its
  Security Scan job failed. Production Build and Contract Tests were still running when
  this blocker was recorded.
- This failed check is a merge/deployment blocker until its log is diagnosed, any real
  finding is fixed without broad scanner exclusions, and a replacement run is green.

### Fix note — Gitleaks pull-request authentication

- **Diagnosed:** the Security Scan did not report a secret. `gitleaks-action@v2`
  stopped before scanning because its current release requires `GITHUB_TOKEN` for
  pull-request events.
- **Applied:** CI now grants only `contents: read` and `pull-requests: read`, then passes
  the standard ephemeral `${{ secrets.GITHUB_TOKEN }}` to the Gitleaks step. Default
  Gitleaks rules remain enabled and no path, value, finding, or fingerprint was
  allowlisted.
- **Required evidence:** the replacement GitHub Actions run must complete the actual
  secret scan successfully before this blocker is closed.

### Remote verification note — shallow-history blocker

- Replacement run `29350820825` authenticated Gitleaks, but the scanner failed closed
  after scanning zero bytes because the security job's default shallow checkout omitted
  the parent of the pull-request commit range (`50c120a^`). Its SARIF report contained
  zero findings because no repository content was scanned; this is not a green result.
- **Applied:** only the security job now uses `actions/checkout` with `fetch-depth: 0`,
  allowing Gitleaks to inspect the complete PR range. No detection rule or source path
  was excluded.
- **Required evidence:** a new run must show a completed, non-partial Gitleaks scan and
  all six CI jobs green.

### Remote verification note — blockers closed

- Commit `703dcbc` completed GitHub Actions run
  [29351042405](https://github.com/robs46859-eng/PawsMemories/actions/runs/29351042405)
  with all six gating jobs green: Type Check, Unit & AR Tests, IFC Tests, Security Scan,
  Contract Tests, and Production Build.
- The Security Scan completed `npm audit`, registry-signature verification, and a real
  full-history Gitleaks scan with default rules. It did not rely on a partial/zero-byte
  scan or a broad allowlist.
- The earlier Security Scan failures remain documented above as an audit trail. Their
  causes were missing pull-request authentication and shallow Git history; both workflow
  defects are corrected.
- GitHub's Node 20 action-runtime deprecation messages remain non-gating warnings in
  upstream `actions/*` dependencies; repository application jobs run on Node 22.

The stabilization fix set is now approved at the code-and-CI level for review. This does
not mark P0, P1, or P2 complete and does not authorize merge, production deployment, or
rigging enablement. Remaining owner actions are review/merge of draft PR #1 and enabling
`main` branch protection with the six CI jobs required and force-push disabled.

## Production Readiness Swarm Addendum (2026-07-14)

- The requested release scope now includes exact 10-second prompt-to-video outputs using
  owned models, objects, and optional BIM building models; full AR hardening with explicit
  human confirmation; production Pawprints templates/customization; global shell cleanup;
  and a complete route/action map for visible buttons and cards.
- The stabilization and hardening-plan changes are merged on protected `main` at
  `5085d0b`. The earlier branch-protection and CI owner actions in this handoff are closed.
- A first delegated P0 implementation on `swarm/p0-containment` was rejected during review
  because it replaced large production modules, mixed database access into pure guard
  configuration, broke zero-cap semantics, and did not reserve user/global capacity
  atomically. The branch is quarantined and must not be merged or cherry-picked. Canonical
  source and `main` were not modified by that patch.
- Clean isolated discovery lanes now exist for video, Pawprints/UI, and shell/release/AR
  evidence. Their output must be reviewed before implementation is accepted.
- `docs/PRODUCTION_READINESS_SWARM_PLAN.md` is the authoritative cross-workstream release
  plan. It supplements but does not weaken `AR_PET_SIM_HARDENING_PLAN_V2.md`.
- Production deployment remains on hold. `PETSIM_RIG_ENABLED=false` is mandatory, and a
  named human AR acceptance record is required before a production GO decision.
