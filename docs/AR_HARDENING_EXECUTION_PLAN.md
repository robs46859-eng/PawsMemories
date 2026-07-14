# AR Hardening Blocker Exit and Execution Plan

**Created:** 2026-07-14

**Authority:** `AR_PET_SIM_HARDENING_PLAN_V2.md`

**Baseline:** `main` at merge commit `e1d86af`

**Status:** Approved stabilization foundation; P0, P1, and P2 remain partial

## 1. Purpose

This document turns the hardening plan into an ordered delivery sequence. It does not
replace or weaken any exit criterion in `AR_PET_SIM_HARDENING_PLAN_V2.md`. A phase is
complete only when its implementation, automated tests, operational evidence, and review
are all present.

The immediate objective is to close P0 and P1, complete P2, and then harden tenant
isolation and paid operations before enabling rigging or beginning native AR expansion.

## 2. Verified Starting Point

The stabilization branch was merged through PR #1. GitHub Actions run `29351490838`
passed Type Check, Unit & AR Tests, IFC Tests, Security Scan, Contract Tests, and
Production Build on `main`. Branch protection now requires those six checks, is enforced
for administrators, and disables force-pushes and branch deletion.

Implemented foundations include:

- Production paid-route app and deterministic provider injection.
- Authentication, ownership, kill-switch, cap, and provider-zero contract coverage.
- JPEG/PNG/WebP signature, MIME, byte, dimension, pixel, aspect, container, and bounded
  full-decode validation.
- Route-specific image JSON limits and a small global JSON default.
- Rigging disabled unless `PETSIM_RIG_ENABLED=true`.
- Default Gitleaks rules, dependency audit, IFC tests, and protected CI.

These controls reduce risk but do not satisfy every P0-P2 exit criterion.

## 3. Non-Negotiable Safety Gates

1. Keep `PETSIM_RIG_ENABLED=false` until P2, P3, P4, and P5 all pass their exit gates.
2. Do not begin native Unity/NSDK implementation until the web/API security contract,
   private asset model, consent model, and device evidence format are stable.
3. Do not accept arbitrary remote image URLs. Prefer direct bounded uploads or owned
   private-media object keys.
4. Do not call a paid provider before schema validation, authentication, ownership,
   quota reservation, idempotency establishment, and feature-gate evaluation.
5. Do not store new AR media under permanent public URLs.
6. Do not declare a phase complete from unit tests alone. Store its required staging,
   policy, device, cost, or incident evidence.
7. Do not combine Animator Phase 3 rig enablement with AR hardening. The two efforts may
   share contracts and test assets, but they have separate acceptance gates.

## 4. Current Blocker Register

| Priority | Blocker | Required closure |
|---|---|---|
| Critical | No global provider/dollar budget | Atomic global daily caps and an automatic kill switch for classify, semantic scan, and future rig work |
| Critical | Production containment lacks evidence | Redacted cap snapshot, staging kill-switch exercise, abuse test, bucket policy, and secret-rotation review |
| High | P1 route inventory is incomplete | Contracts for pet state, commands, buttons, settings, and remaining paid-route responses, including two-user isolation |
| High | Full server startup is not importable | Separate full Express app creation from listen/startup and remove the remaining spawned-server test dependency |
| High | P2 hostile-input evidence is incomplete | Adversarial corpus, maximum-input memory profile, response schemas, and trusted-proxy/user/IP rate-limit tests |
| High | Private media migration is not implemented | Private bucket policy, object-key persistence, ownership-gated signed URLs, expiry tests, and legacy migration |
| High | Paid mutations are not idempotent | Atomic reservation ledger, idempotency keys, concurrency limits, refunds, and cost reconciliation |
| High | Rig/model acceptance is incomplete | Bounded GLB validation, asynchronous jobs, cleanup, skeleton checks, and device performance gates |
| Medium | Provider resilience is fragmented | Shared timeouts, retries, circuit breakers, response validation, restart recovery, and immutable runtime assets |
| Medium | Operational tracing is incomplete | Request IDs, redacted structured logs, readiness, metrics, alerts, and incident drills |
| Medium | Consent and lifecycle controls are incomplete | Versioned camera/microphone consent, retention, export, deletion, and replay/spatial-data rules |

Every blocker must have a named owner when implementation begins. Critical and high
items cannot be waived without an owner, compensating control, expiration date, and
rollback trigger.

## 5. Execution Waves

### Wave 0: Reconcile Status and Evidence

**Goal:** make the merged baseline and every remaining checkbox auditable.

- Update the P0/P1/P2 evidence register to reference PR #1, merge `e1d86af`, current CI,
  and branch protection.
- Build a route inventory with method, schema, authentication, ownership rule, paid/free
  status, provider, object access, tests, and response schema.
- Create `docs/ar-hardening-evidence/` with an index and redacted evidence templates.
- Assign owners to active P0-P2 blockers.

**Exit:** no status document calls merged work local or uncommitted; every unchecked
P0-P2 item maps to an owner, implementation issue, test, and evidence location.

### Wave 1: Close P0 Containment

**Implementation**

- Add atomic global daily request and dollar budgets in addition to per-user caps.
- Add warning and critical thresholds; critical thresholds disable only the affected
  paid operation.
- Keep route-specific body limits and test all boundary values in the full app.
- Verify all remote URL inputs are rejected or replaced with owned object keys.
- Confirm bucket listing and anonymous object reads are denied.
- Review ZIPs, logs, documentation, CI artifacts, and chat-exposed credentials; rotate
  any potentially exposed provider, JWT, storage, worker, or webhook secret.
- Ensure every paid operation has a no-redeploy environment kill switch.

**Evidence**

- Redacted production/staging cap configuration.
- Staging 503/501 responses for each kill switch and successful restoration.
- Concurrent abuse test showing bounded memory, calls, and spend.
- Redacted bucket policy and anonymous list/read denial results.
- Secret-rotation register containing secret names and dates, never values.

**Exit:** a request, user, IP, or aggregate traffic spike cannot create unbounded memory,
provider calls, or spend, and an operator has rehearsed containment in staging.

### Wave 2: Close P1 Enforceability

**Implementation**

- Export the complete Express app separately from process startup and `listen()`.
- Convert the remaining full-server auth smoke tests to in-process tests.
- Add contracts for pet state, commands, buttons, settings, provider failures, sanitized
  response shapes, and every route in the inventory.
- Run each owned resource against user A, user B, anonymous, malformed, expired, and
  administrator contexts.
- Prove every rejected request leaves usage, storage, and provider counters unchanged.
- Record coverage as a non-decreasing baseline and add justified thresholds only after
  high-risk route coverage is measured.

**Evidence**

- Route-to-test inventory.
- Coverage report and current protected CI run.
- Branch protection API export or screenshot.
- Deterministic failure/latency-provider fake report.

**Exit:** every relevant route has executable request, response, failure, and tenant
contracts, and GitHub blocks merging when any required check fails.

### Wave 3: Complete P2 Hostile-Input Security

**Implementation**

- Add and enforce response schemas for all paid routes.
- Add an adversarial corpus: corrupt headers, truncated data, polyglots, malformed
  base64, oversized encoded/decoded data, extreme dimensions/aspect ratios, animated
  inputs, decompression bombs, slow bodies, and JSON boundary cases.
- Profile maximum accepted inputs under controlled concurrency and set a measured memory
  budget. Reduce the accepted size if the budget is not met.
- Key rate limits by authenticated user and privacy-preserving hashed IP; test Hostinger
  trusted-proxy behavior and spoofed forwarding headers.
- Use owned private-media keys for server-side image reuse.
- Keep `safe-fetch.ts` disconnected unless remote fetching becomes a documented product
  requirement. If enabled, first add DNS resolution, IPv4/IPv6 reserved-range denial,
  redirect revalidation, streaming byte limits, and connection/header/idle/total
  timeouts with rebinding and redirect-pivot tests.

**Evidence**

- Corpus manifest and results.
- Provider/storage/usage counters at zero for every rejected fixture.
- Peak heap/RSS measurements for one and concurrent maximum requests.
- Trusted-proxy and rate-bucket test matrix.
- Safe-fetch test report, or an explicit decision record that remote URLs remain off.

**Exit:** every hostile input class returns a controlled response before paid work, with
bounded memory and no private-network fetch path.

### Wave 4: P3 Tenant Isolation and Private Delivery

- Centralize ownership lookup for pets, avatars, scans, commands, buttons, jobs, exports,
  and media.
- Replace permanent public URLs with object keys and ownership-gated short-lived signed
  URLs.
- Make the bucket private, disable listing, control content type/disposition, and test
  expiry plus replay of expired URLs.
- Migrate legacy public objects and database references with reconciliation and rollback.
- Remove implicit admin bypasses and record explicit admin access in an audit event.

**Exit:** anonymous users and user A cannot retrieve, infer, mutate, or reuse user B's
records or media, including after a signed URL expires.

### Wave 5: P4 Paid-Operation Integrity

- Require idempotency keys for classify, semantic scan, and future rig requests.
- Atomically reserve user and global quota before provider work.
- Track attempted, reserved, succeeded, failed, cached, cancelled, and refunded states.
- Add per-user/global concurrency limits and provider-specific dollar budgets.
- Prevent `force=true` from bypassing product policy or normal cost controls.
- Reconcile a staging day against provider billing or a reviewed cost model.

**Exit:** replayed, concurrent, retried, or forced requests cannot duplicate charges,
work, or budget consumption.

### Wave 6: P5 Model Integrity and Web Device Gates

- Move rigging to asynchronous, resumable jobs; never hold an HTTP request through long
  provider polling.
- Validate GLB/glTF bytes, structure, external URIs, extensions, triangles, bones,
  materials, textures, animations, skeleton contract, and asset budgets before storage.
- Persist accepted outputs only after all gates pass; clean up every failed intermediate.
- Exercise cancellation, restart, tracking loss, foreground/background, orientation,
  interrupted downloads, and low-memory behavior.
- Run 10 open/close cycles and capture heap, GPU growth, load time, p50/p95 frame time,
  FPS, drift, and placement repeatability on the reference Android/iPhone matrix.
- Define automatic quality degradation tiers and tracking-state coaching.

**Exit:** invalid assets never become active, resource use does not grow monotonically,
and every supported reference device meets the documented performance floor.

Only after Waves 3-6 pass may a separate release decision consider setting
`PETSIM_RIG_ENABLED=true` in staging. Production enablement requires P9 acceptance.

### Wave 7: P6-P8 Operational and Privacy Hardening

These workstreams can proceed in parallel after their data contracts are stable.

**P6 resilience**

- Shared timeout/retry/circuit wrapper for Gemini, Tripo, storage, Blender, and XR8.
- Retry only idempotent work; validate responses; resume jobs after restart.
- Pin/self-host runtime assets and record versions, hashes, and licenses.
- Fault-inject each dependency independently.

**P7 observability**

- Request IDs, redacted structured logs, separate liveness/readiness, cached probes,
  metrics, dashboards, alerts, and incident runbooks.
- Prohibit raw media, tokens, signed URLs, phone numbers, email, and provider payloads in
  logs.

**P8 consent and lifecycle**

- Versioned pre-permission explanations and consent records for camera, microphone,
  cloud processing, spatial maps, location, RoomPlan, replay, and voice data.
- Retention schedules, automated deletion, self-service export, account deletion, and
  provider/storage reconciliation.

**Exit:** dependency failures recover safely, one redacted request ID traces an incident,
and users can grant, revoke, export, and delete data under tested lifecycle rules.

### Wave 8: P5A Native AR Modernization

Start only after the shared API, privacy, spatial-coordinate, private-media, and rollback
contracts are versioned and stable.

- Build Unity 6 + AR Foundation 6 with approved NSDK/ARCore/ARKit versions.
- Prefer bounded local depth, meshing, and semantics over cloud scene analysis.
- Preserve meter-based coordinates, source measurements, confidence, and conversion
  provenance through RoomPlan/mesh capture and BIM export.
- Separate same-device, household, and public/geospatial persistence policies.
- Add deterministic replay datasets and retain real-device thermal, sensor, battery,
  drift, privacy, and performance gates.
- Keep the hardened web tier as the rollback path.

**Exit:** native contracts, privacy, replay, physical-device, persistence, and measured
spatial/BIM accuracy gates all pass without weakening the web fallback.

### Wave 9: P9 Staged Release

- Deploy staging with provider sandboxes or the smallest approved budgets.
- Rehearse kill switches, rollback, schema rollback, job recovery, bucket rollback, and
  incident communication.
- Roll out by internal accounts, allowlist, 1%, 5%, 25%, 50%, then 100% only when each
  observation window remains within cost, error, latency, privacy, and device limits.
- Require signed evidence for P0-P8 and P5A and no unwaived critical/high findings.

**Exit:** production acceptance is signed, rollback is rehearsed, and every release gate
has durable evidence.

## 6. Recommended Pull-Request Sequence

1. **Evidence reconciliation:** route inventory, evidence index, merged CI/protection
   references, and owner assignments.
2. **P0 budgets and operator proof:** global caps, dollar ceilings, kill-switch tests,
   bucket/secret evidence templates.
3. **Full app factory and route contracts:** remove spawned startup tests and finish P1
   route inventory.
4. **P2 response schemas and adversarial corpus:** add provider-zero and memory evidence.
5. **Trusted proxy/rate buckets and owned-media input:** keep remote URLs disabled.
6. **Private storage migration design and dual-read rollout:** complete P3 before removing
   legacy paths.
7. **Idempotency ledger and atomic budgets:** complete P4.
8. **Asynchronous rig/model validation and cleanup:** complete P5 with rig still off.
9. **Resilience, observability, and privacy workstreams:** P6-P8.
10. **Native foundation and staged release:** P5A, then P9.

Each PR must be narrowly scoped, preserve `PETSIM_RIG_ENABLED=false`, update the evidence
index, and pass protected CI.

## 7. Rhubarb Impact and Decision

### Current impact while Rhubarb is missing

Rhubarb is optional in the current runtime. Its absence produces an Animator Doctor
warning but does not fail the doctor or any AR hardening gate. Speech remains available
through Tier A jaw animation. Therefore:

- It does not block P0-P9 API, storage, privacy, spend, model, or mobile AR hardening.
- It does not make camera frames, semantic scans, placement, tracking, or AR persistence
  less secure.
- It does reduce mouth-shape accuracy and expressiveness for generated speech.
- It prevents production proof of the highest-fidelity Tier B path and weakens the later
  Animator Phase 4 demonstration that a repurposed avatar preserves lip-sync.

### Impact after Rhubarb is installed correctly

A correct Linux production installation, including its adjacent resource files, a pinned
version/hash, and `RHUBARB_BIN`, enables:

- Audio/transcript-derived A-X viseme timing instead of amplitude-only jaw motion.
- English PocketSphinx recognition and phonetic recognition for non-English audio.
- Existing anticipation, bridge, cue-merge, validation, and cache behavior.
- Better speech quality for Randy and rigged pets with morph targets or jaw/lip bones.
- Stronger Animator Phase 2 evidence and the lip-sync-preservation fixture needed by
  Animator Phase 4.

It does **not** enable auto-rigging, create facial bones/morph targets, improve AR tracking,
or satisfy any AR hardening exit gate by itself. Assets without suitable face controls
still use the bone/jaw fallback.

### Safe Rhubarb closure checklist

- [ ] Pin the exact Linux-compatible release, checksum, source URL, and license.
- [ ] Package the executable and required resources outside user-writable directories.
- [ ] Set an absolute `RHUBARB_BIN` and verify the service user cannot replace it.
- [ ] Confirm no shell invocation, path traversal, unbounded output, or orphan process.
- [ ] Keep the existing timeout, output cap, typed errors, and temp-file cleanup.
- [ ] Verify WAV/OGG and ffmpeg-conversion limits under concurrent jobs.
- [ ] Run golden English and non-English audio fixtures and compare cues within one frame.
- [ ] Verify Tier B failure degrades to Tier A without failing speech playback.
- [ ] Record CPU, memory, duration, cache-hit, and cleanup behavior in staging.
- [ ] Add the version/hash and doctor output to deployment evidence.

**Recommendation:** fix and pin Rhubarb as a small, separate Animator reliability PR. Do
not place it on the critical path for P0-P4 AR hardening and do not bundle it with rig
enablement.

## 8. Verification Commands

```bash
npm ci
npm run lint
npm run test
npm run test:security
npm run test:contracts
npm run test:coverage
npm run build
npm run test:ifc
npm run animator:doctor
```

Staging/device/evidence gates cannot be replaced by local commands. Store their redacted
outputs under the evidence index and link the reviewed release commit and CI run.

## 9. Immediate Next Action

Begin PR 1 from the sequence above: reconcile the evidence register and build the full
route authorization/test inventory. In parallel, assign the P0 budget owner and obtain
the redacted production cap, bucket-policy, and secret-rotation inputs needed for Wave 1.
Do not start Animator Phase 3 or enable rigging during this work.
