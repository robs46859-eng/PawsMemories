# Phase P1 Status

**Status:** PARTIAL
**Updated:** 2026-07-14
**Branch:** `stabilize/ar-hardening-foundation`

## Current Evidence

| Area | Status | Evidence |
|---|---|---|
| CI definition | Local | Six real gating jobs in `.github/workflows/ci.yml`; placeholders and duplicate IFC execution removed |
| Combined coverage suite | Pass | 508/508 locally; dedicated AR suite 136/136 |
| Production route contracts | Partial pass | `tests/contracts/petsim.test.mjs`: 18/18 locally against `server/petSimRouter.ts` |
| Build/typecheck | Pass | `npm run lint` and `npm run build` locally |
| IFC | Workflow corrected | CI installs worker requirements and discovers `tests`; local execution requires `ifcopenshell` |
| Dependency/secret scanning | Configured | Gating audit and default gitleaks rules; no broad allowlists |
| Coverage baseline | Recorded locally | 73.39% lines, 83.94% branches, 72.45% functions |
| Branch protection | Missing | GitHub owner action |
| Green GitHub run | Missing | Branch has not been pushed by authorization |

The production contract surface currently covers classify, rig, and semantic scan. Pet
state, commands, buttons, and settings remain outside the contract inventory, so the P1
exit gate is not yet satisfied.
