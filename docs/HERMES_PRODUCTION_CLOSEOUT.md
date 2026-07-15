# Hermes Production Close-Out

Date opened: 2026-07-15

This is the binary finish contract for the Hermes relay, Pixel worker, Pawsome3D, and
Judy integration. Passing one application or a local test suite is not enough. The final
marker is appended only after every gate below has durable evidence and the owner gives
human acceptance.

## Final marker

When all gates pass, append this exact line with the approval date, deployed revisions,
and evidence links:

`FINAL FINISH MARKER: HERMES_EDGE_PRODUCTION_READY`

Current marker:

`FINAL FINISH MARKER: NOT REACHED`

## Gate 1 - Relay boundary and durability

Status: **PASS with deployment evidence recorded**

- Public HTTPS health is `200`.
- Judy, Pawsome3D, and worker credentials are distinct.
- Producer cross-tenant reads return `404`.
- Public worker routes return `404`.
- Idempotent create, lease recovery, exactly-once completion, input budgets, and
  restart/network/thermal behavior have recorded tests.
- Deployment and rollback commands include both the base and Traefik compose files.

## Gate 2 - Signed Pixel production worker

Status: **PARTIAL**

- The privately signed release APK installs, verifies, and cold-launches.
- The configured debug package has passed real Gemma translation, grounded knowledge,
  process restart, and exactly-once completion.
- Remaining: provision the signed release package with the bridge URL, worker secret,
  and selected model; run one translation and one knowledge job; restart during one job;
  confirm exactly one committed result; then leave the signed release worker running.

## Gate 3 - Pawsome3D production integration

Status: **IN PROGRESS**

- The Hermes-only branch must pass the full local suite and GitHub Actions.
- The production migration must be applied before enablement.
- Hostinger must receive only the server-side Paws credential and HTTPS relay URL.
- Live tests must prove unauthenticated rejection, owner isolation, translation,
  grounded `pawsome3d-ar` knowledge, minute limits, daily limits, and disabled rollback.
- The paused UI work must not be present in the deployment artifact.

## Gate 4 - Judy production integration

Status: **BLOCKED - fixes and isolated verification in progress**

- The Hermes-only change set must use shared database limits and monotonic terminal
  updates, then pass tests, TypeScript, lint, Prisma validation, and production build.
- Apply only the pending production migration through Prisma's migration ledger.
- Configure the server-only Judy credential and HTTPS relay URL.
- Run live auth, owner-isolation, translation, knowledge, quota, and rollback tests.
- The paused UI work must not be present in the deployment artifact.

## Gate 5 - Release evidence and human acceptance

Status: **NOT STARTED**

- Review exact commits, artifacts, migrations, environment variable names, and rollback
  commands without exposing secret values.
- Confirm Paws and Judy deployment logs are clean and both sites retain their existing
  non-Hermes functionality.
- Confirm no secret, generated artifact, backup file, or paused UI change entered either
  release.
- Record green CI/deployment evidence and the final signed APK hash.
- Obtain the owner's explicit human acceptance after the live smoke tests.

## Close-out record format

Append, never replace, a final record containing:

1. UTC approval timestamp.
2. Relay image/revision and health evidence.
3. Signed APK SHA-256 and signer certificate SHA-256.
4. Paws and Judy commit IDs and deployment IDs.
5. Migration versions applied.
6. Live smoke-test job IDs with no private bridge IDs or secrets.
7. Rollback test result.
8. Owner acceptance statement.
9. `FINAL FINISH MARKER: HERMES_EDGE_PRODUCTION_READY`.

## Scope amendment: 2026-07-15

The owner changed the stopping boundary to the privately signed Android release. The
full production marker above remains intentionally **not reached** and is preserved for
future Paws/Judy deployment work. This task closes with the narrower, verified marker:

`FINAL FINISH MARKER: HERMES_EDGE_SIGNED_RELEASE_READY`

Evidence and resume instructions are recorded in
`/Users/robert/Projects/HermesEdgeWorker/handoff.md`. No Paws/Judy environment variable,
migration, enablement, or deployment action is implied by this marker.
