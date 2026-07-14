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

## P0 Atomic Budget Fix Note (2026-07-14)

- **Applied on isolated branch:** `director/p0-atomic-budgets` adds a separate aggregate
  daily usage table and a single MySQL transaction that locks aggregate then per-user
  rows before reserving request count and estimated provider cost. A denied reservation
  changes neither counter and provider calls remain blocked.
- **Configuration:** user caps retain their existing keys. Aggregate request caps,
  positive per-call cost reservations, and aggregate cost ceilings use separate
  `PETSIM_<ENDPOINT>_*` variables documented in `.env.example`. Zero remains a valid hard
  stop for request/cost caps; a zero or invalid per-call cost estimate falls back to a
  conservative positive value so it cannot bypass the dollar ceiling.
- **Containment:** aggregate exhaustion returns 503, user exhaustion returns 429, and
  `PETSIM_RIG_ENABLED=false` remains the required default. Rig also has zero aggregate
  request and cost defaults.
- **Local verification:** TypeScript, production build, 486 unit tests, 139 dedicated AR
  tests, 23 production paid-route contracts, 8 hostile-input tests, 5 IFC tests, dependency
  audit, and Animator Doctor pass. IFC was run in an isolated environment containing
  `ifcopenshell`; Animator Doctor used a temporary runtime workspace. Rhubarb remains an
  optional degraded-mode warning.
- **Still open:** do not mark P0 complete. A real MySQL concurrent-abuse run, approved
  provider price estimates, actual-cost reconciliation, warning/critical alert evidence,
  redacted staging configuration, and operator kill-switch rehearsal are still required.
  No production deployment or rig enablement is authorized by this fix.
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

## Shell and Fido's Styles Fix Note (2026-07-14)

- **Applied:** the global shell now uses shared typed navigation registries. The top
  primary destinations are Furball3D, Pawprints, and Fido's Styles; shop and community
  are top-right icon actions. The desktop left panel contains Home, Fur Bin, Profile,
  Fido's Styles, and Help / Support. Fur Bin is also reachable from Pawprints.
- **Shape protection:** the header has a fixed height, the desktop sidebar has a fixed
  width below the header, the main viewport reserves that width, and the mobile bar uses
  fixed columns with truncation. Focused tests lock these layout and destination
  contracts against accidental collapse or reintroduction of removed navigation items.
- **Viewer fix:** the solid turntable floor that could appear as a horizontal rectangle
  through the model has been removed. The 360 viewer now uses transparent contact shadows
  with neutral studio lighting. The Edison bulb control, bulb prop, cord prop, and its
  persisted lighting preference have been removed from the live Fido's Styles feature.
- **Verification:** TypeScript, seven focused shell/viewer tests, the production build,
  and the whitespace check pass locally. Existing large-chunk build warnings remain.
  A temporary uncommitted harness rendered the real application and repository GLB
  fixture at 1440x900 and 390x844: both viewports had no horizontal overflow, the canvas
  rendered, the Edison feature was absent, and no solid slab crossed the model. The
  harness was removed after the check.
  Superseding post-merge verification passes TypeScript, 493/493 root tests, 139/139 AR
  tests, 23/23 production contracts, 8/8 security tests, 5/5 IFC tests in the pinned
  Python 3.11 environment, the production build, and Animator Doctor in a clean temporary
  runtime. Rhubarb remains an optional unavailable tier and the duplicate Sharp/libvips
  warning remains visible; neither was hidden or treated as a completed hardening gate.
  Desktop/mobile browser screenshots with an owned GLB are still required before the
  Shell evidence-register row can be marked verified.
- **Future work:** add a curated dog-and-human accessory library to Fido's Styles,
  including clothing, toys, beds, and related ready-to-use assets. The authoritative
  future-work requirements in `docs/PRODUCTION_READINESS_SWARM_PLAN.md` require explicit
  open-source license/provenance records and mesh, attachment, security, performance,
  and visual validation before any asset ships.

This note does not mark the complete UI action map, shell release gate, AR hardening, or
production deployment complete. It supplements all prior handoff entries without
superseding their unresolved blockers.

## Video Duration Scope Decision (2026-07-14)

- **Decision:** exact 10-second video output is deferred to a future add-on and is no
  longer an initial production release blocker.
- **Initial release contract:** prompt-to-video remains required, using a documented
  provider-supported duration selected server-side. The actual duration, codec,
  dimensions, integrity, ownership, and persistence must be validated and accurately
  exposed to the user. The release may not claim that a shorter output is 10 seconds.
- **Branch impact:** the unmerged `swarm/video-pipeline` prototype hardcodes exact
  10-second normalization. Preserve its work, but do not merge it unchanged; revise the
  contract around supported durations before opening an integration pull request.
- **Next dependency:** close P0 staging evidence first, then private-media ownership and
  signed delivery, followed by the supported-duration video route and provider-fake
  contracts. Pawprints, complete UI action mapping, AR device evidence/human acceptance,
  and staging deployment/rollback remain required after those foundations.

The authoritative future add-on requirements are recorded in
`docs/PRODUCTION_READINESS_SWARM_PLAN.md`. This scope decision removes only the exact
10-second requirement; it does not authorize deployment or weaken ownership, cost,
security, media-validation, AR, or human-approval gates.

## Data, Media, Video, and Pawprints Foundation Note (2026-07-14)

- **Database decision:** retain Hostinger MySQL for this release. The current schema and
  paid-usage reservations depend on MySQL transaction and row-lock behavior, so a
  PostgreSQL migration during AR hardening would add risk without removing a launch
  blocker. Render remains the recommended home for Blender, IFC, and other long-running
  workers; Backblaze B2 remains the media store.
- **Paid-operation controls applied:** classification, semantic scan, video, talking
  video, 3D model, and Pawprints now have conservative per-user request, global request,
  and global estimated-dollar ceilings. Rigging stays disabled with zero request and cost
  capacity. The limits and staging-only concurrency test are documented in
  `docs/DAILY_LIMITS.md`.
- **Private-media foundation applied:** new generated video and Pawprints outputs use
  owner-bound MySQL media records, private B2 object keys, and short-lived signed URLs.
  Legacy public images, models, recordings, and existing creation rows remain a separate
  migration and must not be described as private yet.
- **Video contract applied:** the launch route accepts the provider-supported 8-second
  duration only, supports 16:9 and 9:16, validates source ownership before spending,
  measures the downloaded MP4 duration, fails closed on mismatch, and records provider,
  model, request, result, size, and digest metadata. Exact 10-second output remains the
  previously documented future add-on.
- **Video completion hardening:** provider downloads are streamed through a 100 MB hard
  ceiling, malformed or unverifiable MP4 output fails closed, and a per-job MySQL
  advisory lock prevents the request poller and background poller from publishing or
  notifying twice for the same completed generation.
- **Pawprints templates applied:** Hero, Split Screen, Polaroid/Floating Card, and
  Grid/Collage are source-controlled in `content/pawprints/templates/`. Their registry
  fails closed on invalid definitions; the editor exposes text, color, date, RSVP, and
  media fields; and the renderer creates distinct responsive compositions. User media
  and rendered output belong in private B2, while template definitions stay in Git.
- **Pawprints launch format:** the current renderer accepts JPEG, PNG, and WebP photos
  and creates a static PNG card. Animated or looping-video stationery remains future
  work; unsupported video MIME types were removed from the publishable definitions.
- **Known coverage boundary:** older paid image, scene, background, and reference-image
  routes still use legacy credit controls and have not all been moved behind aggregate
  provider-dollar ceilings. This is now called out in `docs/DAILY_LIMITS.md` and remains
  release work rather than being silently treated as complete.
- **Production blockers still open:** configure a dedicated private B2 bucket and
  restricted key; apply the additive schema in staging; drain or resolve pre-deployment
  running generation jobs; run and retain the real MySQL concurrency-abuse evidence;
  generate and inspect one landscape and one portrait video; prove two-user media
  isolation and signed-link expiry; rehearse global-budget blocking and credit recovery;
  migrate or explicitly contain legacy public media; and record named human acceptance
  for video, Pawprints, mobile/desktop playback, prompt safety, and the AR evidence gates.

This note records implementation and blockers without changing any earlier P0, P1, P2,
AR, deployment, or human-approval status. Production rigging remains disabled.

## Paid Provider Coverage Update (2026-07-14)

- **Step 3 fix:** added the `image_generation` paid endpoint with per-user,
  aggregate-request, and aggregate-cost limits. It now covers legacy memory-image,
  scene-background prompt, avatar-reference, and text-to-reference workflows as one
  logical request with bounded provider fallbacks.
- **Avatar provider coverage:** avatar creation and avatar retry now reserve the shared
  `model_3d` budget before starting Tripo. Credit checks remain separate from provider
  reservations, and administrator credit bypass does not bypass global provider caps.
- **Documentation:** the authoritative table and staging-only abuse procedure remain in
  `docs/DAILY_LIMITS.md`. The previous coverage-boundary wording is retained here as
  history; this update narrows that boundary to non-AI storage/community work and any
  future provider route not yet added to `PaidEndpoint`.
- **Verification:** after this change, TypeScript, the complete unit suite (526/526),
  contracts (23/23), security tests (8/8), production build, dependency audit, pinned
  IFC discovery (5/5), and Animator Doctor all passed. The local Animator Doctor still
  reports optional Rhubarb unavailable and duplicate Sharp/libvips versions; both remain
  visible warnings. A real concurrency-abuse result still requires an isolated staging
  MySQL database; no production database was touched.

This is an additive handoff entry. It does not mark staging, deployment, AR human
acceptance, Rhubarb, private-media migration, or the exact 10-second add-on complete.

## Hostinger Model Upload 413 Fix Note (2026-07-14)

- **Observed blocker:** release `hostinger-studio-hotfix-20260714-1` reached production,
  but avatar and image-to-3D requests carrying base64 photos were rejected by the global
  1 MiB JSON parser before authentication, validation, credit checks, or provider calls.
- **Applied fix:** ordinary JSON routes retain the 1 MiB ceiling. Exact media routes now
  use bounded scoped parsers: avatar creation 40 MiB, image-to-3D 24 MiB, existing
  Pawprints 16 MiB, binary/IFC uploads 36 MiB, and single-image routes 8 MiB. Oversized
  bodies return a sanitized `REQUEST_TOO_LARGE` JSON response instead of a stack trace.
- **Payload reduction:** the browser now consistently resizes/re-encodes reference
  photos and sends the face image once with a boolean role marker instead of duplicating
  its base64 data.
- **Paid-call boundary:** avatar reference images are fully validated and normalized
  before model caps, credits, storage, or Gemini/Tripo calls.
- **Verification:** TypeScript, unit tests (528/528), contracts (23/23), security tests
  (8/8), production build, dependency audit, and diff checks pass. A full production
  model generation still requires redeploying and human confirmation; this note does
  not mark that external acceptance complete.
