# Phase 4 Evidence: Rigging, Facial Mesh, and Accessories

Status: Code complete; external acceptance pending
Branch: `fix/text-mode-reference-screen`
Release commit: recorded by the generated `release-manifest.json`
Feature flag: `RIG_PIPELINE_V4_ENABLED=false`
Migrations: 23 and 25

## Implemented Contract

- The API resolves the accepted canonical Phase 3 GLB, verifies ownership/version identity, mints a short-lived source URL, and sends expected hash/size plus a strict profile request to the authenticated Blender worker.
- The worker enforces HTTPS, source-host allowlisting, redirect refusal, download bounds, GLB signature/hash checks, profile/class compatibility, and request idempotency.
- Blender creates and validates body rig output. Facial capability requires exported A-H/X targets, jaw motion, bilateral blink, localized non-zero deformation, two validation renders, and successful GLB reopen.
- Accessory output records attachment/clearance evidence. Requested print fusion creates a separate neutral-pose private derivative and requires one finite watertight component, zero non-manifold edges, positive volume, budgets, and reopen.
- Canonical artifacts, hashes, validation manifests, lineage, retries, stale recovery, compensation cleanup, and exact manifest-hash acceptance are persisted. Display GLBs are never labeled print-ready.

## Automated Evidence

| Gate | Result |
|---|---|
| TypeScript | PASS |
| Phase 4 Node tests | 46/46 PASS |
| Rig worker Python tests | 8/8 PASS |
| Full Node suite, Node 24.18 | 1,031 PASS / 0 fail / 3 optional skips |
| Production build | PASS; 59 release files |
| Worker JavaScript syntax | PASS |
| Animator doctor | PASS; optional Rhubarb warning only |

## Remaining Exit Work

- Run representative biped, quadruped, malformed, multi-mesh, tail, ear, and accessory fixtures against the deployed Render worker.
- Inspect walk/run/emote and facial playback on desktop/mobile; confirm body-only degradation for uncertain faces.
- Open the fused derivative in a slicer and approve one physical print or equivalent authorized manufacturing review.
- Run private-storage expiry, timeout, retry, and compensation checks with production credentials.

Decision: merge/deploy default-off; do not enable until the external and human gates pass.
