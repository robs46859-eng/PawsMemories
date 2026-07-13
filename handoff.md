# Pawsome3D Project Handoff

Updated: 2026-07-13

## State

Phases 0-3 are implemented and their automated exit gates pass. The BIM builder is available from **My Models > Scaled BIM Builder**. It authors in meters, imports IFC through the worker, displays semantic properties, and exports IFC4 only after a server-side reopen and GLB conversion.

Paid builds use two verification gates. Pre-build verification is free and is repeated server-side before charging. Shell builds cost 60 credits and deliver a dimension-verified GLB without BIM semantics. IFC/BIM builds cost 300 credits and deliver IFC4 plus semantic GLB after schema, GlobalId, element-count, and dimensional verification. Failed post-build verification refunds the charge.

The current Animator plan is a separate phase sequence in `PHASED_IMPLEMENTATION.md`. Animator Phases 0–2 are complete. The committed Phase 5–8 work was reviewed on 2026-07-13 and is scaffold/partial work, not completed phase delivery. Phase 3 and Phase 4 dependencies are also not closed.

## Animator Handoff

### Current verified baseline

- `main`/`origin/main`: `0527711`; the deployed Phase 2 implementation is commit `765b7f5` plus the later documentation-only game-loop commit.
- Full verification at Phase 2 close: TypeScript clean, production client/server build clean, 471/471 tests passing.
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
