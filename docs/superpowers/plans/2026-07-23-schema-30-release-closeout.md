# Schema 30 Release Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and validate a clean, coordinated schema-30 release of the Pawsome3D Hostinger application and Render Blender worker, then hand off exact deployment and live smoke-test evidence.

**Architecture:** The release has two coordinated production components: the Express/Vite application deployed to Hostinger and the authenticated Blender worker deployed to Render. The main application owns additive MySQL migration 30 and calls the worker through `BLENDER_WORKER_URL` with the shared `WORKER_SHARED_SECRET`; the worker must be deployed and healthy before the Hostinger archive is installed.

**Tech Stack:** Node.js 24.18, npm 11, React 19, Vite 6, Express 4, MySQL 8, Blender 5.1 worker, Python `unittest`, Docker/Render, Hostinger prebuilt ZIP.

## Global Constraints

- `handoff.md` is the controlling release directive.
- `README.md` and `PHASED_IMPLEMENTATION.md` provide supporting context.
- `INHOUSE_SPATIAL_GENERATOR_ARCHITECTURE.md`, `SKILLS.md`, and `SCALABLE_DIRECTION.md` are explicitly deferred until full end-to-end deployment acceptance succeeds.
- Use Node `>=24.15 <25`; run this closeout with the installed Node `v24.18.0`.
- Do not reuse any previously rejected deployment archive.
- Do not run manual SQL. The application applies additive migration 30 during startup.
- Deploy the Render Blender worker before the Hostinger application.
- `WORKER_SHARED_SECRET` must byte-match on Render and Hostinger.
- Keep `MODEL_BUILD_V3_ENABLED`, `RIG_PIPELINE_V4_ENABLED`, `FUR_BIN_V5_ENABLED`, `VITE_FUR_BIN_V5_ENABLED`, `STATIONERY_V2_ENABLED`, `WAGS_V2_ENABLED`, `BIM_V2_ENABLED`, and `VITE_BIM_V2_ENABLED` set to `false`.
- Preserve untracked user-owned files unless they are explicitly brought into scope.
- Do not claim live acceptance from local tests.

---

### Task 1: Establish Release Provenance

**Files:**
- Read: `handoff.md`
- Read: `README.md`
- Read: `PHASED_IMPLEMENTATION.md`
- Read: `RELEASE_DEPLOYMENT_INSTRUCTIONS.md`
- Verify: `package.json`
- Verify: `scripts/build-deploy-zip.sh`

**Interfaces:**
- Consumes: merged schema-30 correction commit on `main`
- Produces: an auditable branch, clean tracked diff, exact commit SHA, runtime version, and release scope

- [x] **Step 1: Confirm the merged correction baseline**

Run:

```bash
git status --short --branch
git log --oneline --decorate -15
git show --stat --oneline c793449
```

Expected: `main` contains merge commit `9b41936`, correction commit `c793449` is present, and only known user-owned untracked files exist.

- [x] **Step 2: Confirm the runtime contract**

Run:

```bash
/Users/robert/.nvm/versions/node/v24.18.0/bin/node --version
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" npm --version
```

Expected: Node `v24.18.0` and npm `>=11`.

- [x] **Step 3: Create the closeout branch**

Run:

```bash
git switch -c codex/release-closeout-2026-07-23
```

Expected: the current branch is `codex/release-closeout-2026-07-23`.

### Task 2: Run the Local Release Gate

**Files:**
- Test: `tests/*.test.mjs`
- Test: `blender-worker/bridge/tests/test_print_mesh_contract.py`
- Test: `x-dm-service/tests/*.test.ts`
- Verify: `server.ts`
- Verify: `blender-worker/server.js`
- Verify: `blender-worker/bridge/tcp_server.py`

**Interfaces:**
- Consumes: Node 24.18 dependency lock and merged schema-30 implementation
- Produces: exact pass/fail totals for TypeScript, main tests, print geometry, X-DM, and production build

- [ ] **Step 1: Verify formatting and TypeScript**

Run:

```bash
git diff --check
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" npm run lint
```

Expected: both commands exit `0`.

- [ ] **Step 2: Run the complete main-app test suite**

Run:

```bash
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" npm run test
```

Expected: zero failures; record total passes and intentional opt-in skips rather than copying historical totals.

- [ ] **Step 3: Run print-contract Python tests**

Run:

```bash
python3 -m unittest blender-worker.bridge.tests.test_print_mesh_contract -v
```

Expected: all print geometry contract tests pass. If the local Python module layout differs, use discovery against `blender-worker/bridge/tests` without modifying application code.

- [ ] **Step 4: Run the X-DM suite and build**

Run:

```bash
cd x-dm-service
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" npm test
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" npm run build
```

Expected: all X-DM tests pass and TypeScript build exits `0`.

- [ ] **Step 5: Run the production build and Animator doctor**

Run:

```bash
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" npm run build
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" npm run animator:doctor
```

Expected: Vite/server build succeeds. Animator doctor may report the documented optional Rhubarb warning, but no required check may fail.

- [ ] **Step 6: Stop and diagnose any failure before editing**

For each failure, capture the complete error, identify the first failing component boundary, reproduce with the narrowest relevant test, and add a regression test before changing production code. Do not bundle unrelated repairs.

### Task 3: Verify the Coordinated Worker Contract

**Files:**
- Verify: `agent/tools/blender_client.ts`
- Verify: `agent/tools/blender_mcp.ts`
- Verify: `blender-worker/server.js`
- Verify: `blender-worker/bridge/tcp_server.py`
- Test: `tests/worker_physics_validate.test.mjs`
- Test: `tests/print_mesh_repair.test.mjs`

**Interfaces:**
- Consumes: `WORKER_SHARED_SECRET`, `physics_validate`, and exact STL repair/validation contract
- Produces: evidence that the main application and worker expose matching authenticated operations

- [ ] **Step 1: Run the focused worker contract tests**

Run:

```bash
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" \
  npx tsx --test tests/worker_physics_validate.test.mjs tests/print_mesh_repair.test.mjs tests/create_flow_rigging.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Verify the worker container can build**

Run the repository’s existing Blender-worker Docker build using its checked-in Dockerfile. Do not change the Blender, Python, IfcOpenShell, or NumPy pins during release closeout.

Expected: Docker image construction exits `0`.

- [ ] **Step 3: Record external acceptance limitations**

Record that local tests cannot prove Render’s installed Blender behavior, B2 connectivity, signed storage, or live model repair. Those remain deployment smoke checks.

### Task 4: Build and Verify the Hostinger Archive

**Files:**
- Execute: `scripts/build-deploy-zip.sh`
- Verify: `scripts/verify-release-directory.mjs`
- Produce: `pawsome3d-deploy.zip`
- Produce: `dist/release-manifest.json`

**Interfaces:**
- Consumes: a clean committed branch under Node 24.18
- Produces: a verified Hostinger archive with `server.cjs`, prebuilt `dist/`, locked package metadata, exact commit provenance, and SHA-256

- [ ] **Step 1: Commit plan/evidence changes before packaging**

Run:

```bash
git add docs/superpowers/plans/2026-07-23-schema-30-release-closeout.md
git commit -m "docs: add schema 30 release closeout plan"
```

Expected: the tracked worktree is clean after the commit; known untracked user files remain untouched.

- [ ] **Step 2: Build from the clean committed state**

Run:

```bash
PATH="/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH" bash scripts/build-deploy-zip.sh
```

Expected: `pawsome3d-deploy.zip` is created, both staged and extracted manifest verification pass, and the script prints the archive SHA-256.

- [ ] **Step 3: Independently inspect archive structure**

Run:

```bash
unzip -t pawsome3d-deploy.zip
unzip -l pawsome3d-deploy.zip
shasum -a 256 pawsome3d-deploy.zip
```

Expected: archive test passes; root includes `server.cjs`, `package.json`, `package-lock.json`, and `dist/`; it contains no `.env*`, `.git`, `node_modules`, coverage output, or source-only deployment entrypoint.

### Task 5: Prepare Deployment and Live Acceptance

**Files:**
- Update: `phase-evidence/RELEASE_SCHEMA_30.md`
- Read: `RELEASE_DEPLOYMENT_INSTRUCTIONS.md`

**Interfaces:**
- Consumes: worker image, Hostinger archive SHA, release commit, and configured production environment
- Produces: a single deployment evidence record with objective pass/fail results

- [ ] **Step 1: Create the release evidence record**

The record must include:

```markdown
# Schema 30 Live Release Evidence

- Branch:
- Commit:
- Archive:
- Archive SHA-256:
- Node/npm:
- Main test totals:
- Print-contract totals:
- X-DM totals:
- Worker image build:
- Render deployment:
- Hostinger deployment:
- `/health`:
- unauthenticated `/physics-validate`:
- `/readyz`:
- `/version`:
- schema:
- outstanding risks:
```

- [ ] **Step 2: Confirm production environment without exposing values**

Confirm presence and equality rules only. Never print secret values. Required checks:

- Render and Hostinger both have `WORKER_SHARED_SECRET`, and the values match.
- Hostinger uses `BLENDER_WORKER_URL=https://pawsmemories.onrender.com/render`.
- Hostinger uses `DB_HOST=127.0.0.1`.
- All Phase 2-9 dark-launch flags listed in Global Constraints remain `false`.
- `ELEVENLABS_API_KEY` exists for Voice Test.
- No new schema-30 environment variable is required.

- [ ] **Step 3: Deploy the Blender worker first**

Deploy Render service `PawsMemories` from the exact release commit. Wait for `Live`, confirm `/health` succeeds, and confirm an unauthenticated `/physics-validate` request returns `401`.

- [ ] **Step 4: Quiet the unused X-DM service**

Suspend `pawsmemories-1`, or deploy it with `X_DM_POLLING_ENABLED=false`. Confirm the one-minute unauthorized polling noise stops.

- [ ] **Step 5: Deploy the Hostinger archive**

Upload the newly generated `pawsome3d-deploy.zip`, redeploy, then verify:

- `/readyz` reports ready.
- `/version` reports the packaged commit and schema version `30`.
- startup logs contain no migration, storage, or worker configuration failure.
- the server does not repeatedly recover stale rig jobs.

- [ ] **Step 6: Run the deferred live product smoke matrix**

Use fresh test data and record actual results:

1. Sign in and load Home.
2. Generate a new full-body human reference; cropped/ambiguous input must fail before a paid build.
3. Start one new create-to-model build and confirm one charge, durable progress, and Fur Bin visibility.
4. Open physical checkout and verify exact STL repair/validation blocks invalid manufacturing output with measured diagnostics.
5. Run Voice Test once, confirm disclosed charge, playable returned audio, visible mouth cues, and no second charge on replay.
6. Open Scaled BIM and confirm it is a non-billable preview explaining Shell versus IFC/BIM and both verification stages.
7. Open Shop and confirm legacy marketplace/manual print-request panels are absent.
8. Confirm no repeated X-DM 401/403 polling and no stale recovery loop.

- [ ] **Step 7: Close or roll back based on evidence**

If both services pass, mark the release accepted and record remaining external feature gates separately. If Hostinger fails, roll back Hostinger while leaving additive schema 30 in place. If the worker fails, roll back Render and do not deploy the schema-30 Hostinger package until the worker is healthy.

