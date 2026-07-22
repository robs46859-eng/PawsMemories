# Pawsome3D AR Pet Simulator Production Hardening Plan V2

**Version:** 2.1

**Audit date:** 2026-07-13

**Supersedes:** `AR_PET_SIM_HARDENING_PLAN.md` for future hardening work

**Companion:** `AR_PET_SIM_SPEC.md`

## 1. Audit Conclusion

The original hardening plan has **not** been fully implemented. Several important controls were added after its last status update, but none of H1-H8 currently meets every documented exit criterion.

This plan does not accept a source comment, a unit-tested helper, or a configured environment variable as proof that a production control works. A phase is complete only when:

1. The control is enforced on every applicable path.
2. Automated tests exercise success, rejection, and failure behavior.
3. Operational evidence is recorded in the phase evidence table.
4. The exit gate is reviewed and checked off.

## 2. Verified Implementation Baseline

Status legend: `[x]` verified in source, `[~]` partial, `[ ]` missing.

| Original phase | Current status | Verified implementation | Remaining gap |
| --- | --- | --- | --- |
| H1 Tests and CI | Partial | Broad `node:test` suites and deterministic helper tests exist | No GitHub Actions workflow, HTTP route contract tests, coverage baseline, or required branch check |
| H2 Validation and abuse | Partial | Authenticated paid-route limiter exists; paid-call config is unit tested | Global body limit is 50 MB; paid route bodies are not comprehensively schema-validated; MIME, decoded-size, dimensions, and remote URL safety are not enforced |
| H3 Auth and isolation | Partial | Pet profile and paid pet routes query by authenticated owner | B2 uploads use `public-read`; URLs do not expire; no automated cross-tenant route matrix was found |
| H4 Performance and memory | Partial | Model budget helper, object disposal, and disposal unit tests exist | Budget result is reported rather than consistently enforced; rig URLs can be persisted before rejection; no heap or physical-device FPS evidence |
| H5 Dependency resilience | Partial | Tripo polling is bounded and rigging is feature flagged | Remote fetches lack consistent timeout/byte ceilings; no circuit breakers; 8th Wall URL uses mutable `@1` and no integrity hash; upload retry/rollback is incomplete |
| H6 Observability | Partial | Fatal process events and route errors are logged | No `/healthz` or readiness check, request IDs, structured event schema, paid-call latency metrics, alerting, or graceful fatal shutdown |
| H7 Cost controls | Partial | Cache, endpoint kill switches, per-user daily caps, and rate limiting exist | No global provider budgets, reservation/idempotency, spend reconciliation, alert thresholds, or administrator usage dashboard |
| H8 Privacy | Partial | Semantic scan persists derived zones rather than raw frames; aging defaults are conservative; legal copy describes requests | No in-product consent ledger, self-service export/delete, retention job, audio lifecycle test, or permission revocation UX |

### Highest-risk findings

1. **Unbounded expensive input path:** Express accepts JSON bodies up to 50 MB before paid-route checks. Base64 payloads are not decoded and bounded before provider calls.
2. **Server-side request forgery and memory risk:** `imageUrl` is fetched server-side without an allowlist, private-network rejection, redirect policy, timeout, or streamed byte ceiling.
3. **Public user media:** storage uploads explicitly request `public-read` and return permanent public URLs. This does not satisfy the original signed-URL requirement.
4. **Budget enforcement occurs too late:** the rig flow uploads and persists generated assets before treating the model-budget verdict as an acceptance gate.
5. **No release gate:** there is no tracked CI workflow or HTTP contract-test suite to stop regressions.
6. **No production readiness signal:** health, dependency state, paid-provider outcomes, and request traces cannot be correlated reliably.
7. **Mutable AR runtime dependency:** the 8th Wall script uses a major-version CDN alias and no integrity verification.

## Mobile AR Technology Baseline (2026)

The product must use a tiered architecture. Browser AR remains the broad-access entry point, but advanced environment understanding, persistent spaces, and scaled-room capture require a native tier.

| Tier | Required platform | Intended capability |
| --- | --- | --- |
| Web AR | WebXR on supported Android Chrome devices | Basic anchors, hit testing, optional depth/planes/meshes, and immediate no-install access |
| Web iOS fallback | Self-hosted, exact-version XR8 engine binary | Camera/SLAM fallback where immersive WebXR is unavailable; not the long-term advanced-AR foundation |
| Native cross-platform | Unity 6, AR Foundation 6, and Niantic Spatial SDK 4.1 or newer compatible release | Depth, meshing, semantics, navigation, persistence, playback, and consistent Android/iOS capability management |
| Native Apple extension | ARKit/RealityKit with optional RoomPlan and Object Capture | LiDAR room scanning, scaled room/BIM inputs, and supported Apple-only capture features |

### Platform decisions

- [ ] New Unity development must target Unity 6 + AR Foundation 6 and **NSDK 4.x**, not ARDK 3.x.
- [ ] Use NSDK 4.1's VPS2/Scaniverse/Enterprise Authentication workflow for new persistent-location work.
- [ ] Do not design new functionality around Lightship.dev, legacy Geospatial Browser workflows, ARDK 3 Shared AR, or API-key authentication.
- [ ] Keep the existing web client as the entry/fallback tier while sharing pet state, asset contracts, scale metadata, privacy controls, and backend APIs with the native client.
- [ ] Treat browser depth, anchors, planes, meshes, and light estimation as optional capabilities and degrade safely when absent.
- [ ] Self-host the reviewed XR8 binary and dependencies at immutable, integrity-verified URLs; the retired hosted 8th Wall platform is not a production dependency.
- [ ] Prefer on-device depth, meshing, and semantic segmentation over uploading camera frames.
- [ ] Use Gemini semantic scanning only when local inference is unavailable or insufficient, with explicit consent and cost/privacy controls.
- [ ] Keep geospatial/VPS features optional unless an outdoor, shared-location, or community-pet use case is approved.
- [ ] Treat announced but not broadly deployed OS features, including new iOS object tracking, as experimental until the production device matrix passes.

### Authoritative platform references

- [Google WebXR and ARCore](https://developers.google.com/ar/develop/webxr)
- [Google ARCore feature and release overview](https://developers.google.com/ar/whatsnew-arcore)
- [Google ARCore Depth](https://developers.google.com/ar/develop/depth)
- [Google ARCore Recording and Playback](https://developers.google.com/ar/develop/recording-and-playback)
- [Google ARCore Cloud Anchors](https://developers.google.com/ar/develop/cloud-anchors)
- [Niantic NSDK 4 migration guide](https://www.nianticspatial.com/docs/ardk/migration_guide/)
- [Niantic NSDK release notes](https://nianticspatial.com/docs/nsdk/release_notes/)
- [Niantic NSDK meshing](https://nianticspatial.com/docs/nsdk/features/meshing/index.html)
- [Niantic NSDK model preloading](https://nianticspatial.com/docs/nsdk/how-to/ar/use_model_preloading/index.html)
- [Apple RoomPlan](https://developer.apple.com/augmented-reality/roomplan/)
- [Apple RealityKit Object Capture](https://developer.apple.com/documentation/realitykit/realitykit-object-capture)
- [Apple world-tracking guidance](https://developer.apple.com/documentation/arkit/understanding-world-tracking)
- [Official community-driven 8th Wall repository](https://github.com/8thwall/8thwall)

## 3. Completion Rules

- Every new endpoint must have a shared request and response schema.
- Every paid operation must validate, authorize, reserve quota, and establish idempotency **before** contacting a provider.
- Every remote fetch must use the shared safe-fetch policy.
- Every stored private asset must be addressed by an object key, not a permanent public URL.
- Every external call must have a timeout, bounded retries, a circuit breaker, and structured telemetry.
- Every release must pass CI, security tests, dependency review, and the device acceptance matrix.
- Production defaults must fail closed for missing security configuration.

## 4. Phase P0: Immediate Containment

**Goal:** Reduce live abuse, cost, and privacy exposure before broader refactoring.

- [ ] Keep `PETSIM_RIG_ENABLED=false` until P2-P5 gates pass.
- [ ] Set conservative production daily caps and document their approved values.
- [ ] Add global daily caps for classify, rig, and semantic scan.
- [ ] Lower the general JSON body ceiling and use smaller route-specific limits for image endpoints.
- [ ] Temporarily reject arbitrary `imageUrl` input; accept direct uploads or approved owned-media object keys only.
- [ ] Confirm the media bucket cannot be listed publicly.
- [ ] Rotate any provider or worker secret that has appeared in logs, ZIP files, or chat transcripts.
- [ ] Add an operator runbook for disabling each paid endpoint without redeployment.

**Exit gate:** A single user, IP, or request cannot create unbounded request memory, provider calls, or daily spend. Operators have tested each kill switch in staging.

**Required evidence:** staging responses for disabled endpoints, configured cap snapshot with secrets redacted, and an abuse-test report.

## 5. Phase P1: CI, Contracts, and Security Regression Tests

**Goal:** Make hardening enforceable rather than advisory.

- [ ] Add `.github/workflows/ci.yml` for `npm ci`, typecheck, unit tests, production build, and IFC tests where supported.
- [ ] Add a coverage command and record an initial line/branch baseline without weakening thresholds later.
- [ ] Export the Express app separately from server startup so route tests can run without binding a port.
- [ ] Add HTTP contract tests for classify, rig, semantic scan, pet state, commands, buttons, and settings.
- [ ] Test unauthenticated, invalid token, wrong owner, malformed body, oversized body, disabled endpoint, exhausted cap, provider failure, and success cases.
- [ ] Add a two-user isolation fixture and verify all pet IDs against both users.
- [ ] Add tests proving validation and ownership failures do not increment usage or contact providers.
- [ ] Add deterministic provider fakes with call counters and controlled latency/failure modes.
- [ ] Add dependency and secret scanning to CI; fail on high-severity production dependency findings unless an expiring waiver exists.
- [ ] Protect `main` so CI is required before merge.

**Exit gate:** Every relevant route has executable input/output and tenant-isolation tests, and GitHub prevents merging when they fail.

**Required evidence:** CI run URL, coverage summary, branch-protection screenshot/export, and contract-test inventory.

## 6. Phase P2: Input, Upload, and Remote-Fetch Security

**Goal:** Reject hostile or excessive input before it consumes memory, storage, or paid API capacity.

- [ ] Define shared Zod schemas for all paid endpoint requests and responses.
- [ ] Allow only JPEG, PNG, and WebP for vision input unless a new type is explicitly approved.
- [ ] Decode and verify file signatures; never trust the data-URL MIME label alone.
- [ ] Enforce encoded bytes, decoded bytes, pixel dimensions, aspect ratio, and decompression-bomb limits.
- [ ] Reject malformed base64 and trailing/polyglot content.
- [ ] Replace unrestricted `imageUrl` with an owned-media object key when possible.
- [ ] If remote URLs remain necessary, allow HTTPS only and implement DNS/IP checks that reject loopback, link-local, private, metadata, and reserved ranges on every redirect.
- [ ] Add connection, header, total-request, and idle timeouts to remote fetches.
- [ ] Stream remote responses with a hard byte ceiling instead of buffering unbounded `arrayBuffer()` content.
- [ ] Limit redirects and revalidate every redirect destination.
- [ ] Sanitize provider errors before returning them to clients.
- [ ] Apply route-specific rate-limit buckets by authenticated user and hashed IP, with trusted-proxy tests.

**Exit gate:** Invalid MIME, oversized input, decompression bombs, private-network URLs, redirect pivots, and slow responses return controlled 4xx/5xx results before any paid provider call.

**Required evidence:** adversarial test corpus, provider fake call counts at zero for rejected cases, and memory profile for maximum accepted input.

## 7. Phase P3: Authorization and Private Asset Delivery

**Goal:** Enforce tenant boundaries for database rows and media objects.

- [ ] Build a route-by-route authorization matrix for users, resource owners, and administrators.
- [ ] Centralize pet/avatar ownership lookup and use it before all reads and mutations.
- [ ] Remove implicit administrator bypasses from normal user paths; use explicit audited admin middleware.
- [ ] Store B2 object keys and metadata instead of permanent public URLs.
- [ ] Remove `public-read` ACLs and migrate the bucket to private access.
- [ ] Serve short-lived signed download URLs only after an ownership check.
- [ ] Use short expirations and content disposition/type controls appropriate to each asset.
- [ ] Prevent bucket listing and direct predictable object enumeration.
- [ ] Migrate existing public objects, update database references, and invalidate legacy public access.
- [ ] Record admin access to user-owned pet data in an immutable audit event.
- [ ] Add cross-tenant tests for every pet, scan, command, button, media, and export route.

**Exit gate:** Neither an anonymous user nor authenticated user A can retrieve, infer, or modify user B's AR data or media, including with a previously issued expired URL.

**Required evidence:** automated isolation report, bucket policy export with secrets removed, signed-URL expiry test, and legacy migration report.

## 8. Phase P4: Paid-Operation Integrity and Cost Controls

**Goal:** Make each chargeable operation bounded, idempotent, accountable, and recoverable.

- [ ] Require an idempotency key for classify, rig, and semantic scan mutations.
- [ ] Atomically reserve per-user and global quota before provider work begins.
- [ ] Distinguish attempted, reserved, succeeded, failed, cached, and refunded usage.
- [ ] Do not permanently increment usage for validation, authorization, cache-hit, or kill-switch rejection.
- [ ] Add maximum concurrent jobs per user and globally.
- [ ] Add provider-specific daily request and dollar budgets.
- [ ] Reconcile internal usage against Gemini/Tripo billing data or a documented cost model.
- [ ] Alert at warning and critical thresholds; critical thresholds automatically disable the affected operation.
- [ ] Prevent `force=true` from bypassing cache without an explicit product rule and stricter quota.
- [ ] Add an administrator view for current caps, usage, failures, and circuit state without exposing provider secrets.
- [ ] Add a retention policy for detailed usage records and aggregate long-term cost metrics.

**Exit gate:** Replayed, concurrent, or forced requests cannot duplicate a paid operation or exceed approved per-user/global budgets.

**Required evidence:** concurrency test, idempotency replay test, budget-exhaustion test, alert test, and one-day staging reconciliation.

## 9. Phase P5: Model Integrity, Performance, and Device Gates

**Goal:** Accept only AR-safe models and prove the runtime stays usable on target devices.

- [ ] Validate source and baked GLBs with a bounded parser before storage or display.
- [ ] Enforce maximum bytes, triangles, bones, materials, textures, texture dimensions, animation count, and animation duration.
- [ ] Treat the model budget verdict as a hard gate before upload and database persistence.
- [ ] Persist rig URLs only after bake, validation, budget, and ownership checks all succeed.
- [ ] Delete intermediate/failed objects or enqueue deterministic cleanup.
- [ ] Verify skeleton contracts and animation compatibility for quadrupeds and bipeds.
- [ ] Reject external URIs and unsafe extensions embedded in GLB/glTF assets.
- [ ] Add cancellation and job status rather than holding an HTTP request during long Tripo polling.
- [ ] Measure 10 AR open/close cycles for heap and GPU-resource growth.
- [ ] Capture p50/p95 FPS, frame time, load time, and memory on the reference device matrix.
- [ ] Define automatic degradation tiers for depth, mesh detection, lighting, shadows, texture resolution, and LOD.
- [ ] Test loss/restoration of tracking, background/foreground, orientation changes, low memory, and interrupted downloads.
- [ ] Surface tracking-state coaching for low light, excessive motion, insufficient features, incomplete floor coverage, and relocalization failure.
- [ ] Measure anchor drift and placement repeatability against known distances and reference markers.
- [ ] Record the active AR backend and capability tier with every device result.

**Reference device matrix:** one mid-range Android WebXR device, one current Android device, one supported iPhone using XR8, and one older supported iPhone.

**Exit gate:** Invalid or over-budget models never become active; 10 session cycles show no monotonic resource growth; median FPS is at least 30 with documented p95 frame-time limits on every supported reference device.

**Required evidence:** GLB validation report, cleanup test, device/build identifiers, profiler captures, and signed device acceptance checklist.

## Phase P5A: Mobile AR Platform Modernization

**Goal:** Add current native mobile AR capabilities without weakening the hardened web fallback.

### Native foundation

- [ ] Create the native client on Unity 6 + AR Foundation 6 with NSDK 4.1 or a later explicitly approved compatible version.
- [ ] Install and validate the ARCore XR and ARKit XR providers through Unity XR Plug-in Management.
- [ ] Run NSDK, ARKit, and ARCore project validation and store the reports with release evidence.
- [ ] Keep a shared coordinate contract: meters, right-handed canonical transforms, explicit source coordinate system, origin, confidence, and conversion version.
- [ ] Version the native/web pet-state and asset API contracts so either client can roll back independently.

### Local scene intelligence

- [ ] Use device depth and meshing for occlusion, collision, grounding, obstacle avoidance, and improved hit testing.
- [ ] Use local semantic segmentation to identify walkable ground and exclude sky, vegetation, walls, and unsafe surfaces from navigation.
- [ ] Build or update the pet navigation mesh from bounded, decimated mesh chunks rather than raw per-frame geometry.
- [ ] Throttle mesh, semantic, collider, and navigation updates independently from rendering.
- [ ] Apply semantic mesh filtering and confidence thresholds; never treat an uncertain label as a safe walking surface.
- [ ] Preload required depth/semantic models before entering AR, show progress, and support fast/balanced/quality modes.
- [ ] Fall back in order: meshing + semantics, depth + planes, planes only, static placement, then non-AR pet view.

### Persistent spaces

- [ ] Define the product requirement for same-device persistence, household sharing, and public/geospatial sharing separately.
- [ ] Use ARCore Cloud Anchors or NSDK VPS2/Device Mapping only for approved persistence modes.
- [ ] Store anchor provider, opaque anchor identifier, coordinate version, creation time, expiration, localization confidence, and last successful resolution.
- [ ] Handle unresolved, expired, moved, and low-confidence anchors without teleporting the pet or silently rewriting placement.
- [ ] Provide reset/re-scan controls and an unambiguous local-only mode.
- [ ] Encrypt private spatial-map metadata and never expose anchor identifiers as public resources.

### Scaled rooms and BIM

- [ ] Add an optional RoomPlan capture path on supported LiDAR iPhone/iPad devices.
- [ ] Import RoomPlan dimensions and component types into the canonical meter-based spatial schema before geometry conversion.
- [ ] Preserve source measurements, confidence, transforms, and source USD/USDZ separately from derived GLB/IFC output.
- [ ] Verify at least three independent room dimensions before conversion and after GLB/IFC export.
- [ ] Use the existing IFC verification pipeline for BIM output; do not infer authoritative dimensions from normalized display geometry.
- [ ] For Android/non-LiDAR devices, require depth/mesh capture plus user-entered reference measurements or another explicit scale calibration.
- [ ] Report expected accuracy by capture method and prevent low-confidence scans from being labeled survey-grade.

### Capture features

- [ ] Offer RealityKit Object Capture only for static objects such as beds, bowls, toys, and furniture.
- [ ] Do not use photogrammetry as the primary living-pet capture path because subject motion invalidates reconstruction assumptions.
- [ ] Evaluate new iOS object tracking for known toys or markers only behind an experimental feature flag.

### Replay and field validation

- [ ] Capture consented, sanitized ARCore/NSDK replay datasets for low light, reflective floors, blank walls, clutter, outdoor ground, tracking loss, and fast motion.
- [ ] Run deterministic replay tests for every supported native release.
- [ ] Maintain separate real-device gates because simulation/replay cannot prove camera, thermal, sensor, or driver behavior.
- [ ] Track cold-start time, model-preload time, time to first stable placement, relocalization time, anchor drift, FPS, frame-time percentiles, memory, and battery/thermal state.

**Exit gate:** The native tier passes contract, privacy, replay, and physical-device gates; local scene intelligence is preferred over cloud vision; persistence fails safely; and scaled captures preserve verifiable measurements through BIM export.

**Required evidence:** package/version lock, project-validation report, capability matrix, replay dataset manifest, room-scale accuracy report, anchor persistence report, and signed physical-device results.

## 10. Phase P6: Dependency and Provider Resilience

**Goal:** Keep the app responsive and consistent when any external dependency is slow, malformed, or unavailable.

- [ ] Create one shared external-call wrapper with timeout, retry policy, request ID, telemetry, and error normalization.
- [ ] Retry only safe/idempotent failures with exponential backoff and jitter.
- [ ] Add circuit breakers for Gemini, Tripo, B2, Blender worker, and XR8 bootstrap.
- [ ] Define fallback behavior and user copy for each open, half-open, and unavailable circuit state.
- [ ] Validate every provider response before reading nested fields or persisting results.
- [ ] Make provider jobs resumable after application restart.
- [ ] Make B2 uploads idempotent and verify object existence/size before committing database state.
- [ ] Pin the exact XR8 package version; self-host the reviewed asset or enforce an immutable URL and integrity hash.
- [ ] Self-host or integrity-pin other runtime decoder assets required by AR.
- [ ] Record licenses and hashes for the XR8 binary, decoder WASM, native AR packages, and downloaded awareness models.
- [ ] Remove the mutable `@1` XR8 CDN path before production and test the self-hosted package offline from third-party CDNs.
- [ ] Add a tested non-AR fallback for XR8 bootstrap, license, binary, or browser incompatibility failures.
- [ ] Add a dependency update cadence with staging device regression tests.
- [ ] Gracefully drain work and exit non-zero after fatal process errors instead of continuing in an unknown state.

**Exit gate:** Fault-injection tests show no hung requests, partial active records, duplicate paid work, or unusable pets when each dependency fails independently.

**Required evidence:** dependency fault matrix, circuit-state logs, restart/recovery test, and pinned-asset manifest with hashes.

## 11. Phase P7: Observability, Health, and Incident Response

**Goal:** Trace every failure and paid call without logging sensitive content.

- [ ] Generate or accept a validated request ID and return it in response headers.
- [ ] Use structured JSON logs with event name, request ID, anonymized user ID, route, latency, outcome, provider, and job ID.
- [ ] Never log raw images, audio, tokens, signed URLs, phone numbers, email addresses, provider payloads, or secrets.
- [ ] Add liveness and readiness endpoints separately.
- [ ] Readiness must test the database and required configuration without making a paid call.
- [ ] Report B2 and worker status through cached background probes so health requests cannot amplify outages.
- [ ] Add metrics for request count/latency/error, validation rejection, rate limiting, quota, provider calls, tokens/tasks, circuit state, job duration, and cleanup failures.
- [ ] Add client AR error reporting with release, device capability, backend choice, and redacted context.
- [ ] Add dashboards and alerts with named owners and response thresholds.
- [ ] Write runbooks for provider outage, spend spike, storage exposure, stuck jobs, and AR-runtime failure.
- [ ] Test alert delivery and incident rollback before release.

**Exit gate:** An operator can trace a failed paid request from client report through API, provider/job, storage, and final state using one request ID, without exposing PII.

**Required evidence:** sample redacted trace, dashboard links, readiness failure tests, alert drill, and runbook review.

## 12. Phase P8: Consent, Retention, Export, and Deletion

**Goal:** Give users explicit control over camera, microphone, derived scans, voice data, and pet records.

- [ ] Show a pre-permission explanation before invoking browser/AR permission prompts.
- [ ] Explain separately what the camera/microphone does, what leaves the device, what is stored, and for how long.
- [ ] Record consent version, purpose, timestamp, and revocation without storing unnecessary device identifiers.
- [ ] Require a user gesture before camera or microphone activation.
- [ ] Provide a non-camera/non-microphone fallback where the feature allows it.
- [ ] Add in-product controls to revoke consent and delete stored audio/voice assets.
- [ ] Define retention periods for raw uploads, generated models, derived semantic zones, audio, logs, and usage events.
- [ ] Define separate consent and retention for spatial maps, cloud anchors, VPS localization, RoomPlan scans, replay recordings, and geolocation.
- [ ] Disclose when on-device scene processing escalates to a cloud vision request and allow users to decline that escalation.
- [ ] Strip or separately protect camera imagery, location, device fingerprints, and sensor metadata in AR replay datasets.
- [ ] Add automated retention deletion with a dry-run and auditable result.
- [ ] Implement authenticated self-service export with asynchronous generation and short-lived private download.
- [ ] Implement authenticated account/data deletion with reauthentication, grace period, cancellation, and deletion across DB/B2/providers.
- [ ] Prevent deletion from silently bypassing legally required billing/audit retention; document the narrow retained fields.
- [ ] Test export and deletion with a multi-pet account containing every asset type.
- [ ] Keep aging and mortality off by default and test memorial behavior independently from deletion.

**Exit gate:** Users can understand, grant, revoke, export, and delete their data in-product; automated tests prove raw/derived artifacts follow the documented lifecycle.

**Required evidence:** consent screens, retention schedule, export manifest, deletion reconciliation report, and privacy review approval.

## 13. Phase P9: Staged Release and Operational Acceptance

**Goal:** Release gradually with measurable rollback criteria.

- [ ] Create separate development, staging, and production provider credentials and buckets.
- [ ] Deploy schema and private-storage migrations with tested rollback/roll-forward procedures.
- [ ] Run the complete CI and security suite against the release commit.
- [ ] Complete the physical-device matrix using the exact production build.
- [ ] Run Unity/NSDK project validation and archive the result for the exact native production build.
- [ ] Run the approved deterministic replay suite before physical-device signoff.
- [ ] Verify the web tier, iOS XR8 fallback, and native tier can be independently disabled without breaking account or pet data.
- [ ] Run a limited internal cohort with low global budgets and all alerts enabled.
- [ ] Expand through percentage/cohort flags only after error, latency, spend, and device thresholds remain within limits.
- [ ] Define automatic rollback criteria for auth isolation, storage exposure, crash rate, provider spend, model rejection, and FPS.
- [ ] Perform backup restore and job-recovery drills.
- [ ] Record release owner, incident owner, rollback operator, and provider contacts.
- [ ] Remove temporary debug access and verify production log redaction.

**Exit gate:** The release review has signed evidence for P0-P8 and P5A, rollback has been rehearsed, and no open critical/high finding lacks an owner and dated waiver.

## 14. Required Test Matrix

| Area | Minimum automated cases |
| --- | --- |
| Authentication | Missing, expired, malformed token; correct owner; wrong owner; explicit admin path |
| Input | Missing fields, wrong types, invalid base64, MIME mismatch, oversized bytes/pixels, decompression bomb |
| Remote fetch | HTTP rejection, private IP, DNS rebinding defense, redirect pivot, timeout, slow stream, oversized stream |
| Paid operations | Cache hit, disabled flag, per-user cap, global cap, concurrent requests, idempotent replay, provider failure/refund |
| Storage | Private upload, ownership check, signed URL expiry, missing object, interrupted upload, orphan cleanup |
| Model | Malformed GLB, external URI, too many tris/bones/textures, oversized animation, valid quadruped/biped |
| Resilience | Gemini, Tripo, B2, worker, DB, and XR8 independently slow/down/malformed |
| Privacy | Consent denied/revoked, audio delete, complete export, complete deletion, retention job |
| AR runtime | Session denial, tracking loss, background/resume, repeated open/close, degradation tier, both AR backends |
| Native awareness | Depth unavailable, model preload failure, low semantic confidence, mesh churn, navigation rebuild, thermal degradation |
| Persistence | First localization, repeat localization, wrong room, expired anchor, low confidence, offline mode, reset/re-scan |
| Scaled capture | Known-distance checks, unit conversion, RoomPlan import, calibrated Android capture, GLB/IFC round trip |
| Replay | Sanitized dataset compatibility, deterministic outcome, SDK upgrade regression, dataset retention/deletion |

## 15. Evidence Register

Update this table as work lands. Do not mark a phase complete without durable evidence.

| Phase | Owner | Release/commit | Automated evidence | Operational/device evidence | Review date | Status |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Unassigned | `stabilize/ar-hardening-foundation` (local, uncommitted) | Rig default off; `imageUrl` rejection and paid-route guard contracts | Production cap/bucket/kill-switch evidence pending | Not run | Partial |
| P1 | Unassigned | `stabilize/ar-hardening-foundation` (local, uncommitted) | 508 tests; 18 production-router contracts; 73.39% line coverage baseline; typecheck/build; corrected IFC workflow | Green GitHub run, full route inventory, branch protection pending | 2026-07-14 local | Partial |
| P2 | Unassigned | `stabilize/ar-hardening-foundation` (local, uncommitted) | Paid-route schemas; seven image signature/MIME/size/dimension tests; provider-zero rejection cases | Full adversarial corpus, trusted network/rate-bucket tests, response enforcement, memory profile pending | 2026-07-14 local | Partial |
| P3 | Unassigned | | | | | Not started |
| P4 | Unassigned | | | | | Not started |
| P5 | Unassigned | | | | | Not started |
| P5A | Unassigned | | | | | Not started |
| P6 | Unassigned | | | | | Not started |
| P7 | Unassigned | | | | | Not started |
| P8 | Unassigned | | | | | Not started |
| P9 | Unassigned | | | | | Not started |

## 16. Recommended Execution Order

1. **P0 immediately:** contain cost, request-size, and remote-fetch exposure.
2. **P1 next:** make every later control regression-testable and merge-blocking.
3. **P2-P4:** close hostile-input, privacy/isolation, and paid-operation risks before enabling rigging.
4. **P5:** enforce model quality and establish the physical-device baseline.
5. **P5A:** build the Unity 6/AR Foundation 6/NSDK 4.x native tier, local scene intelligence, persistence, replay, and scaled capture.
6. **P6-P7:** enforce dependency recovery and operational visibility across web and native tiers.
7. **P8 before public beta:** complete consent and user data rights, including spatial data and recordings.
8. **P9 for production rollout:** require evidence-based go/no-go and rehearsed rollback.

## 17. Definition of Production-Hardened

The AR pet simulator is production-hardened only when all P0-P9 and P5A exit gates are satisfied for every shipped tier, all required evidence is linked above, the release commit passes protected CI, and there are no unwaived critical or high findings. A waiver must identify the risk owner, compensating control, expiration date, and rollback trigger.
