# Phase 4 Evidence: Rigging, Facial Mesh, and Accessories

Status: Foundation corrected; not signed off
Branch: `fix/text-mode-reference-screen`
Release commit: `TBD`
Feature flag: `RIG_PIPELINE_V4_ENABLED` (server-authoritative, default `false`)
Migration: 23

## Review Decision

The agent implementation was not acceptable as complete. It fabricated dog classification inputs, skeleton metrics, nine visemes, successful deformation, accessory clearances, and a ready state without reading or producing a rigged asset. The UI then submitted a placeholder manifest hash. MySQL service tests were skipped locally and used columns that do not exist in schema 22.

The correction pass removed all fabricated-success paths. Until a real measured worker adapter is integrated, jobs fail durably with `RIG_WORKER_NOT_INTEGRATED`; no job can be accepted without a canonical output artifact and a non-empty all-pass validation manifest.

## Corrected Foundation

- Migration 23 canonical references use `BIGINT`, matching schemas 18-22.
- Foreign keys bind classifications to accepted model artifacts, rig jobs to model jobs/source artifacts/source versions, and current attempts to their owning jobs.
- Start requests verify owner, accepted Phase 3 state, current accepted `validated_glb`, and source version.
- Classification uses the persisted reference subject and Phase 3 dimensions/triangle metrics.
- Requested profiles must match the measured classification.
- Facial capability cannot be `full` or `partial` unless deformation evidence passes.
- Accessory fit validation consumes measured distance, penetration, sweep, and clearance values.
- Accessory registration resolves an owned canonical GLB/version and authoritative version rights.
- Public DTOs include the actual manifest hash and failure code without internal IDs or storage keys.
- Acceptance requires `ready`, an output artifact, a manifest, all rules passing, and an exact hash match.
- Corrected MySQL fixtures now create the complete schema 18-22 canonical lineage.

## Verification

| Gate | Result |
|---|---|
| TypeScript (`npm run lint`) | PASS |
| Combined Phase 4/5 focused tests | 28/28 PASS, 0 skips against isolated MySQL databases |
| Full repository suite (Node 24.18.0) | 871 total: 868 PASS, 0 fail, 3 unrelated opt-in skips |
| Production build | PASS; 57-file release manifest generated |
| Animator doctor | PASS; optional Rhubarb warning only |
| Live Blender worker | BLOCKED: measured adapter not implemented |
| Browser/mobile matrix | NOT RUN |

## Remaining Exit Work

- Implement an authenticated worker contract that consumes the exact source version and returns immutable rigged GLB, validation manifest, facial inventory, clips, deformation renders, and accessory derivatives.
- Register every output in private canonical storage with lineage and compensation cleanup.
- Add bounded retries and stale-lease recovery without duplicate provider spend.
- Validate representative biped/quadruped/static/malformed/multi-mesh/tail/ear/digitigrade fixtures.
- Add fused-print derivative validation separately from animation export.
- Connect the accepted Phase 3 product flow to explicit rig selection, progress, retry, review, and acceptance.
- Run MySQL 8, live worker, storage, light/dark, accessibility, and 320/360/390/430px evidence.

## Exit Decision

Decision: `BLOCKED - KEEP FEATURE FLAG OFF`

Phase 4 has a safer durable foundation but is not code complete and is not production-ready.
