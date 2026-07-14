# Phase P1 Audit Correction

**Status:** PARTIAL
**Updated:** 2026-07-14
**Branch:** `stabilize/ar-hardening-foundation` (local changes, not committed or pushed)

This file previously marked P1 complete using a separate mock Express app, placeholder
assertions, placeholder CI jobs, and an unverified branch-protection claim. Those items
do not satisfy the exit gate in `AR_PET_SIM_HARDENING_PLAN_V2.md`.

## Verified Locally

- CI now has six real gating jobs: TypeScript, unit/AR tests, build, IFC, security,
  and contract tests. Duplicate IFC execution and placeholder jobs were removed.
- `server/petSimRouter.ts` is the production router for classify, rig, and semantic
  scan. Contract tests import that router with deterministic database/provider fakes;
  the deleted `server/app-for-testing.ts` mock is no longer used.
- `tests/contracts/petsim.test.mjs` has 18 passing cases covering missing, malformed,
  and expired authentication; two-user ownership isolation; feature switches; daily
  caps; schema rejection; rig task ownership; and zero provider/storage calls for
  rejected requests.
- `npm run lint`, `npm test`, `npm run test:ar`, `npm run test:contracts`, and
  `npm run build` pass locally.
- The IFC workflow installs the pinned worker requirements and uses the corrected
  discovery path: `PYTHONPATH=. python3 -m unittest discover -s tests -v` from
  `blender-worker/ifc_worker`.
- The auth route test now gives its server child an explicitly DB-disabled environment
  and awaits bounded child teardown. The custom rate-limiter cleanup timer is unref'd.
- Dependency audit and default-rule gitleaks scanning are gating. There are no broad
  directory or value allowlists in `.gitleaks.toml`.
- The first local coverage baseline is recorded: 73.39% lines, 83.94% branches, and
  72.45% functions across 508 passing tests.

## Remaining P1 Exit-Gate Work

- Push the branch and retain a URL for a fully green GitHub Actions run.
- Enable `main` branch protection and require the gating jobs before merge.
- Extend production-router contracts to pet state, commands, buttons, and settings,
  including provider failures, oversized bodies, and both users against every pet ID.
- Record a complete route/contract inventory and the required branch-protection export.

P1 must remain **partial** until every item above and every P1 criterion in the hardening
plan is satisfied.
