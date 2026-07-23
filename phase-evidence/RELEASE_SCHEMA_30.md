# Schema 30 Release Closeout Evidence

Status: local automated gate passed; coordinated deployment and live acceptance pending

Date: 2026-07-23

## Provenance

- Baseline branch: `main`
- Baseline commit: `9b41936` (`Merge pull request #15 from robs46859-eng/codex/release-acceptance-fixes`)
- Correction commit: `c793449` (`fix(release): close production acceptance blockers`)
- Closeout branch: `codex/release-closeout-2026-07-23`
- Managed schema: `30`
- Runtime used: Node `v24.18.0`, npm `11.11.0`
- Default shell Node `v25.8.1` was deliberately not used because the release contract is `>=24.15 <25`.

## Scope

This pass follows `handoff.md`, `README.md`, `PHASED_IMPLEMENTATION.md`, and
`RELEASE_DEPLOYMENT_INSTRUCTIONS.md`. It does not implement
`INHOUSE_SPATIAL_GENERATOR_ARCHITECTURE.md`, `SKILLS.md`, or
`SCALABLE_DIRECTION.md`.

## Local Automated Gate

| Gate | Result |
| --- | --- |
| `git diff --check` | Pass |
| `npm run lint` | Pass |
| Focused schema-30 worker/recovery/UI tests | 43 pass, 0 fail, 0 skip |
| Complete `npm run test` | 1,067 total; 1,064 pass; 0 fail; 3 intentional skips |
| Print mesh Python contract | 8 pass, 0 fail |
| X-DM tests | 131 pass, 0 fail |
| X-DM TypeScript build | Pass |
| Main production build | Pass |
| Release manifest | Generated with 58 files |
| Animator doctor | All required server checks pass |

The Animator doctor reported only the documented optional Rhubarb warning. Tier A
jaw animation remains the supported fallback when `RHUBARB_BIN` is not installed.

The complete suite emitted expected local warnings for absent object-storage
credentials. Tests exercising storage use fakes or verify fail-closed behavior;
there were no test failures.

## Worker Container Gate

The repository-level worker contract is green:

- `physics_validate` registration and authentication boundary tests pass.
- Gravity and named rig-safety guards pass.
- Exact STL repair and post-export validation tests pass.
- Main application and worker tool names match.

The local Docker image build was not run because the `docker` executable is not
available on this machine. Render must provide the container-build evidence when
deploying service `PawsMemories` from the exact release commit.

## Packaging

- Hostinger archive: pending clean closeout commit
- Archive SHA-256: pending
- Manifest commit/branch verification: pending

## Coordinated Deployment Gate

- [ ] Render deploys the Blender worker from the exact release commit.
- [ ] Render `/health` succeeds.
- [ ] Unauthenticated Render `/physics-validate` returns `401`.
- [ ] Render and Hostinger `WORKER_SHARED_SECRET` values byte-match.
- [ ] Hostinger deploys the newly generated verified archive.
- [ ] Hostinger `/readyz` reports ready.
- [ ] Hostinger `/version` reports the packaged commit and schema `30`.
- [ ] Startup logs contain no migration, storage, or worker-configuration failure.
- [ ] X-DM is suspended or runs with `X_DM_POLLING_ENABLED=false`.
- [ ] No repeated stale create/rig recovery traffic appears.

## Live Product Smoke Gate

- [ ] Sign-in and Home load.
- [ ] Cropped or ambiguous human reference fails before a paid build.
- [ ] A new full-body human model reaches durable build progress and Fur Bin once.
- [ ] Physical checkout validates the exact repaired STL and fails closed with measured diagnostics when invalid.
- [ ] Voice Test discloses its charge, returns playable audio, shows mouth cues, and replay does not charge twice.
- [ ] Scaled BIM is visible as a non-billable Shell-versus-IFC preview.
- [ ] Shop does not expose legacy marketplace or manual print-request panels.
- [ ] Render, Hostinger, and X-DM logs remain free of restart, stale-recovery, and unauthorized-polling loops.

## Remaining Risks

- Live Blender 5.1 behavior, Render resource limits, and exact worker repair output require the deployed worker.
- B2 object storage and signed delivery require production credentials and cannot be inferred from local tests.
- Stripe/provider sandbox behavior and physical slicer review remain external acceptance work.
- Phase 2-9 dark-launch features remain disabled and are not approved by this release.

