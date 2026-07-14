# AR PET SIM HARDENING - PHASED BUILD PLAN

**Project:** Pawsome3D AR Pet Simulator Production Hardening  
**Base:** AR_PET_SIM_HARDENING_PLAN_V2.md (v2.1, audit date 2026-07-13)  
**Build Start:** 2026-07-13  
**Status:** Local development environment ready for phased implementation

---

## EXECUTIVE SUMMARY

The AR Pet Simulator hardening initiative addresses 8 critical production gaps (H1-H8) across testing, validation, authorization, performance, resilience, observability, cost controls, and privacy. The work is organized into 10 phases (P0-P9) plus a native mobile platform modernization phase (P5A).

**Current Baseline:**
- P0-P9: All marked "Not Started" in Evidence Register
- P1: Partial - broad `node:test` suites exist, but no GitHub Actions, contract tests, or coverage baseline
- P2: Partial - authenticated paid-route limiter exists, but no global body limits or MIME validation
- P3: Partial - pet profile queries by authenticated owner, but B2 uploads are `public-read` with permanent URLs
- P4: Partial - model budget helper exists but is reported rather than enforced
- P5: Partial - Tripo polling bounded, rigging feature flagged, but no device FPS evidence
- P6: Partial - fatal events logged, but no `/healthz` or structured metrics
- P7: Partial - cache, kill switches, caps exist, but no global provider budgets
- P8: Partial - derived zones stored, but no consent ledger or self-service export/delete

---

## PHASED IMPLEMENTATION PLAN

### PHASE P0: IMMEDIATE CONTAINMENT (Priority: CRITICAL - Start Now)

**Goal:** Reduce live abuse, cost, and privacy exposure before broader refactoring

#### Milestones & Tasks:

**Milestone P0.1: Feature Flag Control** (Estimated: 1 day)
- [ ] Confirm `PETSIM_RIG_ENABLED=false` in production env
- [ ] Document approved cap values in deployment config
- [ ] Add operator runbook for disabling paid endpoints

**Milestone P0.2: Daily Caps Implementation** (Estimated: 2 days)
- [ ] Add global daily caps for classify, rig, and semantic scan operations
- [ ] Configure conservative production daily caps with secrets redacted
- [ ] Test cap enforcement via staging abuse tests

**Milestone P0.3: Input Size Limits** (Estimated: 2 days)
- [ ] Lower global JSON body ceiling from 50 MB
- [ ] Add route-specific limits for image endpoints
- [ ] Temporarily reject arbitrary `imageUrl` input; accept direct uploads or approved object keys only

**Milestone P0.4: Storage Security** (Estimated: 1 day)
- [ ] Confirm media bucket cannot be listed publicly
- [ ] Rotate any provider/worker secret that appeared in logs or transcripts

**Exit Gate:** Single user/IP/request cannot create unbounded request memory, provider calls, or daily spend

**Required Evidence:**
- Staging responses for disabled endpoints
- Configured cap snapshot (secrets redacted)
- Abuse-test report

---

### PHASE P1: CI, CONTRACTS, AND SECURITY REGRESSION TESTS (Priority: HIGH)

**Goal:** Make hardening enforceable rather than advisory

#### Milestones & Tasks:

**Milestone P1.1: CI Pipeline Setup** (Estimated: 2 days)
- [ ] Create `.github/workflows/ci.yml` with steps:
  - `npm ci`
  - TypeScript typecheck (`tsc --noEmit`)
  - Unit tests (`npm test`, `npm run test:ar`)
  - Production build (`npm run build`)
  - IFC tests where supported
- [ ] Add coverage command and record initial line/branch baseline
- [ ] Protect `main` branch requiring CI before merge

**Milestone P1.2: Route Export & Contract Tests** (Estimated: 3 days)
- [ ] Export Express app separately from server startup for route testing
- [ ] Add HTTP contract tests for:
  - `/api/pets/classify`
  - `/api/pets/:id/rig`
  - `/api/ar/semantic-scan`
  - `/api/pets/:id/state`
  - `/api/commands`
  - `/api/buttons`
  - `/api/settings`
- [ ] Test scenarios: unauthenticated, invalid token, wrong owner, malformed body, oversized body, disabled endpoint, exhausted cap, provider failure, success

**Milestone P1.3: Isolation & Provider Fake Tests** (Estimated: 3 days)
- [ ] Add two-user isolation fixture; verify all pet IDs against both users
- [ ] Prove validation/ownership failures do not increment usage or contact providers
- [ ] Create deterministic provider fakes with call counters and controlled latency/failure modes
- [ ] Add dependency and secret scanning to CI

**Exit Gate:** Every relevant route has executable input/output and tenant-isolation tests; GitHub prevents merging when they fail

**Required Evidence:**
- CI run URL
- Coverage summary
- Branch-protection screenshot/export
- Contract-test inventory

---

### PHASE P2: INPUT, UPLOAD, AND REMOTE-FETCH SECURITY (Priority: HIGH)

**Goal:** Reject hostile or excessive input before it consumes memory, storage, or paid API capacity

#### Milestones & Tasks:

**Milestone P2.1: Zod Schema Foundation** (Estimated: 2 days)
- [ ] Define shared Zod schemas for all paid endpoint requests and responses
- [ ] Enforce JPEG, PNG, WebP for vision input (or approved types)
- [ ] Validate base64 decoding, file signatures, MIME labels

**Milestone P2.2: Input Validation Enforcement** (Estimated: 3 days)
- [ ] Enforce encoded bytes, decoded bytes, pixel dimensions, aspect ratio limits
- [ ] Implement decompression-bomb protection
- [ ] Reject malformed base64 and trailing/polyglot content
- [ ] Apply route-specific rate-limit buckets by authenticated user and hashed IP

**Milestone P2.3: Safe Remote Fetch** (Estimated: 3 days)
- [ ] Replace unrestricted `imageUrl` with owned-media object key
- [ ] If remote URLs necessary: HTTPS only, DNS/IP checks rejecting private ranges
- [ ] Add connection, header, total-request, and idle timeouts
- [ ] Stream remote responses with hard byte ceiling (no unbounded `arrayBuffer()`)
- [ ] Limit redirects and revalidate every destination
- [ ] Sanitize provider errors before returning to clients

**Exit Gate:** Invalid MIME, oversized input, decompression bombs, private-network URLs, redirect pivots, and slow responses return controlled 4xx/5xx before any paid provider call

**Required Evidence:**
- Adversarial test corpus
- Provider fake call counts at zero for rejected cases
- Memory profile for maximum accepted input

---

### PHASE P3: AUTHORIZATION AND PRIVATE ASSET DELIVERY (Priority: CRITICAL)

**Goal:** Enforce tenant boundaries for database rows and media objects

#### Milestones & Tasks:

**Milestone P3.1: Authorization Matrix** (Estimated: 3 days)
- [ ] Build route-by-route authorization matrix for users, resource owners, admins
- [ ] Centralize pet/avatar ownership lookup before all reads/mutations
- [ ] Remove implicit admin bypasses from normal user paths; use explicit audited admin middleware
- [ ] Add cross-tenant tests for every pet, scan, command, button, media, export route

**Milestone P3.2: Private Storage Migration** (Estimated: 4 days)
- [ ] Remove `public-read` ACLs from B2 bucket
- [ ] Store B2 object keys and metadata instead of permanent public URLs
- [ ] Serve short-lived signed download URLs only after ownership check
- [ ] Use short expirations and content disposition/type controls per asset
- [ ] Prevent bucket listing and direct predictable object enumeration

**Milestone P3.3: Legacy Migration & Audit** (Estimated: 2 days)
- [ ] Migrate existing public objects; update database references
- [ ] Invalidate legacy public access URLs
- [ ] Record admin access to user-owned pet data in immutable audit events

**Exit Gate:** Anonymous user or authenticated user A cannot retrieve, infer, or modify user B's AR data or media, including with previously issued expired URLs

**Required Evidence:**
- Automated isolation report
- Bucket policy export (secrets removed)
- Signed-URL expiry test
- Legacy migration report

---

### PHASE P4: PAID-OPERATION INTEGRITY AND COST CONTROLS (Priority: HIGH)

**Goal:** Make each chargeable operation bounded, idempotent, accountable, recoverable

#### Milestones & Tasks:

**Milestone P4.1: Idempotency & Quota Reservation** (Estimated: 3 days)
- [ ] Require idempotency key for classify, rig, semantic scan mutations
- [ ] Atomically reserve per-user and global quota before provider work begins
- [ ] Distinguish attempted, reserved, succeeded, failed, cached, refunded usage
- [ ] Do not increment usage for validation, authorization, cache-hit, or kill-switch rejection

**Milestone P4.2: Concurrency & Budget Controls** (Estimated: 3 days)
- [ ] Add maximum concurrent jobs per user and globally
- [ ] Add provider-specific daily request and dollar budgets
- [ ] Reconcile internal usage against Gemini/Tripo billing data or cost model
- [ ] Alert at warning/critical thresholds; critical thresholds auto-disable operation
- [ ] Prevent `force=true` from bypassing cache without explicit product rule

**Milestone P4.3: Admin Dashboard & Retention** (Estimated: 2 days)
- [ ] Add administrator view for current caps, usage, failures, circuit state
- [ ] Add retention policy for detailed usage records and aggregate cost metrics

**Exit Gate:** Replayed, concurrent, or forced requests cannot duplicate paid operation or exceed approved budgets

**Required Evidence:**
- Concurrency test
- Idempotency replay test
- Budget-exhaustion test
- Alert test
- One-day staging reconciliation

---

### PHASE P5: MODEL INTEGRITY, PERFORMANCE, AND DEVICE GATES (Priority: HIGH)

**Goal:** Accept only AR-safe models and prove runtime stays usable on target devices

#### Milestones & Tasks:

**Milestone P5.1: GLB Validation Pipeline** (Estimated: 4 days)
- [ ] Validate source/baked GLBs with bounded parser before storage or display
- [ ] Enforce maximum bytes, triangles, bones, materials, textures, dimensions, animation count/duration
- [ ] Treat model budget verdict as hard gate before upload and database persistence
- [ ] Persist rig URLs only after bake, validation, budget, ownership checks succeed
- [ ] Delete intermediate/failed objects or enqueue deterministic cleanup

**Milestone P5.2: Skeleton & Animation Compatibility** (Estimated: 2 days)
- [ ] Verify skeleton contracts and animation compatibility for quadrupeds/bipeds
- [ ] Reject external URIs and unsafe extensions in GLB/glTF assets
- [ ] Add cancellation and job status for long Tripo polling (don't hold HTTP request)

**Milestone P5.3: Device Performance Baseline** (Estimated: 5 days)
- [ ] Measure 10 AR open/close cycles for heap/GPU-resource growth
- [ ] Capture p50/p95 FPS, frame time, load time, memory on reference device matrix:
  - Mid-range Android WebXR device
  - Current Android device
  - Supported iPhone using XR8
  - Older supported iPhone
- [ ] Define automatic degradation tiers for depth, mesh detection, lighting, shadows, texture resolution, LOD
- [ ] Test loss/restoration of tracking, background/foreground, orientation changes, low memory, interrupted downloads

**Milestone P5.4: AR Coaching & Drift Measurement** (Estimated: 2 days)
- [ ] Surface tracking-state coaching for low light, excessive motion, insufficient features
- [ ] Measure anchor drift and placement repeatability against known distances
- [ ] Record active AR backend and capability tier with every device result

**Exit Gate:** Invalid/over-budget models never become active; 10 session cycles show no monotonic resource growth; median FPS >=30 with documented p95 frame-time limits on every supported reference device

**Required Evidence:**
- GLB validation report
- Cleanup test
- Device/build identifiers
- Profiler captures
- Signed device acceptance checklist

---

### PHASE P5A: MOBILE AR PLATFORM MODERNIZATION (Priority: MEDIUM - Plan First)

**Goal:** Add current native mobile AR capabilities without weakening web fallback

#### Milestones & Tasks:

**Milestone P5A.1: Native Foundation** (Estimated: 10 days)
- [ ] Create native client on Unity 6 + AR Foundation 6 with NSDK 4.1
- [ ] Install/validate ARCore XR and ARKit XR providers through Unity XR Plug-in Management
- [ ] Run NSDK, ARKit, ARCore project validation; store reports with release evidence
- [ ] Define shared coordinate contract: meters, right-handed canonical transforms

**Milestone P5A.2: Local Scene Intelligence** (Estimated: 10 days)
- [ ] Use device depth/meshing for occlusion, collision, grounding, hit testing
- [ ] Use local semantic segmentation for walkable ground identification
- [ ] Build pet navigation mesh from bounded, decimated mesh chunks
- [ ] Throttle mesh/semantic/collider/navigation updates independently from rendering
- [ ] Apply semantic mesh filtering and confidence thresholds
- [ ] Preload depth/semantic models; show progress; support fast/balanced/quality modes

**Milestone P5A.3: Persistent Spaces** (Estimated: 8 days)
- [ ] Define requirement for same-device/household/public geospatial sharing
- [ ] Use ARCore Cloud Anchors or NSDK VPS2/Device Mapping for approved modes
- [ ] Store anchor provider, opaque identifier, coordinate version, creation time, expiration
- [ ] Handle unresolved/expired/moved/low-confidence anchors without teleporting
- [ ] Provide reset/re-scan controls and unambiguous local-only mode

**Milestone P5A.4: Scaled Rooms & BIM Integration** (Estimated: 8 days)
- [ ] Add RoomPlan capture path on supported LiDAR iPhone/iPad
- [ ] Import RoomPlan dimensions into canonical meter-based spatial schema
- [ ] Preserve source measurements, confidence, transforms separately from GLB/IFC output
- [ ] Verify three independent room dimensions before conversion
- [ ] Use existing IFC verification pipeline; do not infer dimensions from normalized geometry

**Milestone P5A.5: Capture Features** (Estimated: 5 days)
- [ ] Offer RealityKit Object Capture only for static objects (beds, bowls, toys)
- [ ] Do not use photogrammetry as primary living-pet capture path
- [ ] Evaluate new iOS object tracking only behind experimental feature flag

**Milestone P5A.6: Replay & Field Validation** (Estimated: 7 days)
- [ ] Capture consented, sanitized replay datasets for various conditions
- [ ] Run deterministic replay tests for every supported native release
- [ ] Track cold-start time, model-preload time, time to first stable placement, relocalization time

**Exit Gate:** Native tier passes contract, privacy, replay, and physical-device gates; local scene intelligence preferred over cloud vision; persistence fails safely; scaled captures preserve verifiable measurements

**Required Evidence:**
- Package/version lock
- Project-validation report
- Capability matrix
- Replay dataset manifest
- Room-scale accuracy report
- Anchor persistence report
- Signed physical-device results

---

### PHASE P6: DEPENDENCY AND PROVIDER RESILIENCE (Priority: MEDIUM)

**Goal:** Keep app responsive when external dependencies are slow, malformed, or unavailable

#### Milestones & Tasks:

**Milestone P6.1: Shared External-Call Wrapper** (Estimated: 3 days)
- [ ] Create wrapper with timeout, retry policy, request ID, telemetry, error normalization
- [ ] Retry only safe/idempotent failures with exponential backoff and jitter
- [ ] Add circuit breakers for Gemini, Tripo, B2, Blender worker, XR8 bootstrap
- [ ] Define fallback behavior and user copy for each circuit state
- [ ] Validate every provider response before reading nested fields/persisting results

**Milestone P6.2: Job Resumption & Idempotency** (Estimated: 2 days)
- [ ] Make provider jobs resumable after application restart
- [ ] Make B2 uploads idempotent; verify object existence/size before committing DB state
- [ ] Pin exact XR8 package version; self-host reviewed asset or enforce immutable URL/integrity hash

**Milestone P6.3: Dependency Pinning & Fallback** (Estimated: 3 days)
- [ ] Self-host/integrity-pin other runtime decoder assets required by AR
- [ ] Record licenses and hashes for XR8 binary, decoder WASM, native AR packages
- [ ] Remove mutable `@1` XR8 CDN path before production; test self-hosted package offline
- [ ] Add tested non-AR fallback for XR8 bootstrap/license/browser incompatibility failures
- [ ] Add dependency update cadence with staging device regression tests
- [ ] Gracefully drain work and exit non-zero after fatal process errors

**Exit Gate:** Fault-injection tests show no hung requests, partial active records, duplicate paid work, or unusable pets when each dependency fails independently

**Required Evidence:**
- Dependency fault matrix
- Circuit-state logs
- Restart/recovery test
- Pinned-asset manifest with hashes

---

### PHASE P7: OBSERVABILITY, HEALTH, AND INCIDENT RESPONSE (Priority: MEDIUM)

**Goal:** Trace every failure and paid call without logging sensitive content

#### Milestones & Tasks:

**Milestone P7.1: Structured Logging** (Estimated: 3 days)
- [ ] Generate/accept validated request ID; return in response headers
- [ ] Use structured JSON logs with event name, request ID, anonymized user ID, route, latency, outcome, provider, job ID
- [ ] Never log raw images, audio, tokens, signed URLs, phone numbers, emails, provider payloads, secrets

**Milestone P7.2: Health & Readiness Endpoints** (Estimated: 2 days)
- [ ] Add liveness and readiness endpoints separately
- [ ] Readiness must test database and required configuration without paid calls
- [ ] Report B2 and worker status through cached background probes

**Milestone P7.3: Metrics & Alerts** (Estimated: 4 days)
- [ ] Add metrics for request count/latency/error, validation rejection, rate limiting, quota, provider calls, circuit state, job duration, cleanup failures
- [ ] Add client AR error reporting with release, device capability, backend choice, redacted context
- [ ] Add dashboards and alerts with named owners and response thresholds

**Milestone P7.4: Runbooks & Testing** (Estimated: 2 days)
- [ ] Write runbooks for provider outage, spend spike, storage exposure, stuck jobs, AR-runtime failure
- [ ] Test alert delivery and incident rollback before release

**Exit Gate:** Operator can trace failed paid request from client report through API, provider/job, storage, final state using one request ID without exposing PII

**Required Evidence:**
- Sample redacted trace
- Dashboard links
- Readiness failure tests
- Alert drill
- Runbook review

---

### PHASE P8: CONSENT, RETENTION, EXPORT, AND DELETION (Priority: MEDIUM)

**Goal:** Give users explicit control over camera, microphone, derived scans, voice data, pet records

#### Milestones & Tasks:

**Milestone P8.1: Pre-Permission UX** (Estimated: 3 days)
- [ ] Show pre-permission explanation before browser/AR permission prompts
- [ ] Explain separately what camera/microphone does, what leaves device, what is stored, for how long
- [ ] Record consent version, purpose, timestamp, revocation without storing unnecessary device identifiers
- [ ] Require user gesture before camera/microphone activation
- [ ] Provide non-camera/microphone fallback where feature allows

**Milestone P8.2: User Data Controls** (Estimated: 5 days)
- [ ] Add in-product controls to revoke consent and delete stored audio/voice assets
- [ ] Define retention periods for raw uploads, generated models, derived semantic zones, audio, logs, usage events
- [ ] Define separate consent/retention for spatial maps, cloud anchors, VPS localization, RoomPlan scans
- [ ] Disclose when on-device scene processing escalates to cloud vision request; allow decline
- [ ] Strip or separately protect camera imagery, location, device fingerprints in AR replay datasets

**Milestone P8.3: Export & Deletion** (Estimated: 5 days)
- [ ] Add automated retention deletion with dry-run and auditable result
- [ ] Implement authenticated self-service export with async generation and short-lived private download
- [ ] Implement authenticated account/data deletion with reauthentication, grace period, cancellation
- [ ] Prevent deletion from silently bypassing legally required billing/audit retention
- [ ] Test export/deletion with multi-pet account containing every asset type

**Exit Gate:** Users can understand, grant, revoke, export, and delete their data in-product; automated tests prove raw/derived artifacts follow documented lifecycle

**Required Evidence:**
- Consent screens
- Retention schedule
- Export manifest
- Deletion reconciliation report
- Privacy review approval

---

### PHASE P9: STAGED RELEASE AND OPERATIONAL ACCEPTANCE (Priority: LOW - Final Phase)

**Goal:** Release gradually with measurable rollback criteria

#### Milestones & Tasks:

**Milestone P9.1: Environment Setup** (Estimated: 2 days)
- [ ] Create separate dev, staging, production provider credentials and buckets
- [ ] Deploy schema and private-storage migrations with tested rollback/roll-forward procedures
- [ ] Run complete CI and security suite against release commit

**Milestone P9.2: Device Validation** (Estimated: 5 days)
- [ ] Complete physical-device matrix using exact production build
- [ ] Run Unity/NSDK project validation; archive result for exact native production build
- [ ] Run approved deterministic replay suite before physical-device signoff
- [ ] Verify web tier, iOS XR8 fallback, native tier can be independently disabled without breaking account/pet data

**Milestone P9.3: Cohort Rollout** (Estimated: 5 days)
- [ ] Run limited internal cohort with low global budgets and all alerts enabled
- [ ] Expand through percentage/cohort flags only after error, latency, spend, device thresholds remain within limits
- [ ] Define automatic rollback criteria for auth isolation, storage exposure, crash rate, provider spend, model rejection, FPS
- [ ] Perform backup restore and job-recovery drills

**Milestone P9.4: Release Finalization** (Estimated: 2 days)
- [ ] Record release owner, incident owner, rollback operator, provider contacts
- [ ] Remove temporary debug access; verify production log redaction

**Exit Gate:** Release review has signed evidence for P0-P8 and P5A, rollback rehearsed, no open critical/high finding lacks owner and dated waiver

---

## TEST MATRIX REQUIREMENTS

Each area must have minimum automated test cases:

| Area | Minimum Automated Cases |
|------|------------------------|
| Authentication | Missing, expired, malformed token; correct owner; wrong owner; explicit admin path |
| Input | Missing fields, wrong types, invalid base64, MIME mismatch, oversized bytes/pixels, decompression bomb |
| Remote fetch | HTTP rejection, private IP, DNS rebinding defense, redirect pivot, timeout, slow stream, oversized stream |
| Paid operations | Cache hit, disabled flag, per-user cap, global cap, concurrent requests, idempotent replay, provider failure/refund |
| Storage | Private upload, ownership check, signed URL expiry, missing object, interrupted upload, orphan cleanup |
| Model | Malformed GLB, external URI, too many tris/bones/textures, oversized animation, valid quadruped/biped |
| Resilience | Gemini, Tripo, B2, worker, DB, XR8 independently slow/down/malformed |
| Privacy | Consent denied/revoked, audio delete, complete export, complete deletion, retention job |
| AR runtime | Session denial, tracking loss, background/resume, repeated open/close, degradation tier, both AR backends |
| Native awareness | Depth unavailable, model preload failure, low semantic confidence, mesh churn, navigation rebuild, thermal degradation |
| Persistence | First localization, repeat localization, wrong room, expired anchor, low confidence, offline mode, reset/re-scan |
| Scaled capture | Known-distance checks, unit conversion, RoomPlan import, calibrated Android capture, GLB/IFC round trip |
| Replay | Sanitized dataset compatibility, deterministic outcome, SDK upgrade regression, dataset retention/deletion |

---

## EVIDENCE REGISTER

| Phase | Owner | Release/Commit | Automated Evidence | Operational/Device Evidence | Review Date | Status |
|-------|-------|----------------|-------------------|---------------------------|-------------|--------|
| P0 | Unassigned | | | | | Not Started |
| P1 | Unassigned | | | | | Not Started |
| P2 | Unassigned | | | | | Not Started |
| P3 | Unassigned | | | | | Not Started |
| P4 | Unassigned | | | | | Not Started |
| P5 | Unassigned | | | | | Not Started |
| P5A | Unassigned | | | | | Not Started |
| P6 | Unassigned | | | | | Not Started |
| P7 | Unassigned | | | | | Not Started |
| P8 | Unassigned | | | | | Not Started |
| P9 | Unassigned | | | | | Not Started |

---

## EXECUTION ORDER RECOMMENDATION

1. **P0 immediately** - contain cost, request-size, remote-fetch exposure
2. **P1 next** - make every later control regression-testable and merge-blocking
3. **P2-P4** - close hostile-input, privacy/isolation, paid-operation risks before enabling rigging
4. **P5** - enforce model quality and establish physical-device baseline
5. **P5A** - build Unity 6/AR Foundation 6/NSDK 4.x native tier
6. **P6-P7** - enforce dependency recovery and operational visibility
7. **P8 before public beta** - complete consent and user data rights
8. **P9 for production rollout** - require evidence-based go/no-go and rehearsed rollback

---

## VERIFICATION COMMANDS

Run before each deployment:
```
npm run lint
npm run test
npm run test:ar
npm run build
```

For BIM changes, also validate IFC:
```
PYTHONPATH=blender-worker/ifc_worker python3 -m unittest discover -s blender-worker/ifc_worker/tests -v
```

---

## DEFINITION OF PRODUCTION-HARDENED

The AR pet simulator is production-hardened only when:
- All P0-P9 and P5A exit gates are satisfied for every shipped tier
- All required evidence is linked in Evidence Register
- Release commit passes protected CI
- No open critical/high finding lacks an owner and dated waiver

A waiver must identify:
- Risk owner
- Compensating control
- Expiration date
- Rollback trigger

---

**Document Created:** 2026-07-13  
**Next Update:** After P0 milestone completion  
**Status:** Ready for local implementation
