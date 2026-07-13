# Pawsome3D BIM Handoff

Updated: 2026-07-13

## State

Phases 0-3 are implemented and their automated exit gates pass. The BIM builder is available from **My Models > Scaled BIM Builder**. It authors in meters, imports IFC through the worker, displays semantic properties, and exports IFC4 only after a server-side reopen and GLB conversion.

Paid builds use two verification gates. Pre-build verification is free and is repeated server-side before charging. Shell builds cost 60 credits and deliver a dimension-verified GLB without BIM semantics. IFC/BIM builds cost 300 credits and deliver IFC4 plus semantic GLB after schema, GlobalId, element-count, and dimensional verification. Failed post-build verification refunds the charge.

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
