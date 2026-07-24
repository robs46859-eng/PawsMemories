# Phase BO-2: Real Rigging & Facial (deliverables 1, 2-local, 4)

**Date:** 2026-07-23
**Branch:** `phase/bo-2-real-rigging` (worktree `PawsMemories-bo2`, based on `phase/bo-1-customizer-surfaces` @ `cd350d3`)
**Scope note:** Deliverable 3 (rerouting create-flow rigging purchases away from Tripo `startRig` in server.ts) is **explicitly deferred** until BO-0/BO-1 merge, per owner direction. No server.ts edits in this pass.

## Finding: deliverable 1 was already substantially complete

Contrary to the older handoff sections, the current tree already contains the full
authenticated worker integration — this pass verified it rather than rebuilding it:

- `server/rig-pipeline/worker.ts`: hardened `HttpRigWorkerClient` (HTTPS-in-prod,
  shared secret, 150 MB response cap, strict Zod result schema, independent
  re-hash/GLB-reopen verification, fused-print watertight inspection).
- `blender-worker/server.js`: `POST /rig-pipeline/process` mounted with worker auth
  and a route-scoped body limit, backed by `blender-worker/rig_pipeline/`
  (`index.js` 700 lines, `pipeline.py` 1080 lines, `validation.py`).
- `RigPipelineService` invokes `this.worker.process(request)`; the historical
  `RIG_WORKER_NOT_INTEGRATED` termination no longer exists anywhere in the tree.
- Router mounted at `/api/rig-pipeline` behind auth; `RIG_PIPELINE_V4_ENABLED`
  remains default **false**.

Existing Phase-4 suites verified in this worktree: `phase4_worker`,
`phase4_worker_contract`, `phase4_service`, `phase4_validation`,
`phase4_adversarial`, `phase4_accessory_print`, `facial_rig_disclosure` —
**42/42 pass**; Blender-worker Python rig tests **8/8 pass**.

## Deliverable 4 — facialVisemes demoted to truthful passthrough

Defect fixed: `agent/graph/nodes/finalize.ts` returned
`facialVisemeContract: "viseme_A..viseme_X"` **unconditionally** — a fabricated
capability claim stored into model metadata even when the passthrough found zero
provider morphs (every Tripo GLB) or the facial add-on was not purchased.

Changes:

- `facialVisemes.ts`: re-documented as a provider-morph **passthrough** (runs in
  addition to, never instead of, Phase-4 worker-synthesized targets); added
  `parseVisemeResult()` (reads the script's measured `VISEME_RESULT` line) and
  `facialPassthroughMetadata()` (truthful metadata: `source: none` when not
  purchased; `available: false, fallback: jaw_bone` when no morphs were measured;
  the exact sorted shape list only when shapes exist).
- `types.ts`: `BuildState.facialPassthrough` carries the measured result.
- `act.ts` and `finalize.ts`: capture `VISEME_RESULT` at both call sites;
  `finalize.ts` derives `animationMetadata.facial` from the measured result. The
  hardcoded contract claim is gone (single consumer verified by grep before the
  change).

## Deliverable 2 — fixtures

- **Local (executed):** all Phase-4 measured-evidence suites above, plus new
  `tests/bo2_facial_passthrough.test.mjs` (12 tests: parser truth table,
  metadata truthfulness incl. "never claims the contract range", and source
  guards that fail if the fabricated claim returns).
- **Live (deferred, one command ready):** `scripts/bo2-rig-fixtures.mjs` drives the
  real worker contract against the deployed Render worker and prints the measured
  rig-rule table, facial deformation/locality per target, and the independent
  reopen inspection. Run per fixture:

  ```bash
  BLENDER_WORKER_URL=https://<render-worker> WORKER_SHARED_SECRET=... \
  node scripts/bo2-rig-fixtures.mjs --source-url "<signed GLB url>" \
    --classification quadruped --facial
  ```

  Required corpus before enabling `RIG_PIPELINE_V4_ENABLED`: at least one human
  (biped, --facial), one quadruped (--facial), and one accessory-bearing run,
  with outputs appended to this file. Blender is not installed locally
  (per repo policy since schema-30 release notes), so these runs require the
  deployed worker.

## Gates (Node 24.18.0)

```
npm run lint                                   # PASS (tsc --noEmit, 0 errors)
npm run test                                   # PASS (1107 tests: 1104 pass, 0 fail, 3 skips)
npx tsx --test tests/bo2_facial_passthrough.test.mjs   # 12/12 PASS
python3 -m unittest discover -s blender-worker/rig_pipeline/tests  # 8/8 PASS
npm run build                                  # PASS (release manifest, 56 files)
node scripts/animator-doctor.mjs               # PASS (after --fix created gitignored jobs/rig dir in fresh worktree)
```

## Exit gate status

| Criterion | Status |
|---|---|
| Authenticated Phase-4 worker adapter integrated, NOT_INTEGRATED removed | Verified present in tree; round-trip covered by 42 Phase-4 tests with fakes |
| Acceptance fixtures with measured deformation/locality/reopen evidence | Local suites pass; **live Render corpus pending** — harness ready (`scripts/bo2-rig-fixtures.mjs`) |
| facialVisemes demoted to passthrough; no fabricated capability claims | Done; guarded by source-level regression tests |
| Create-flow rigging purchases routed internally (deliverable 3) | **Deferred by owner direction** to post-merge follow-up |
| `RIG_PIPELINE_V4_ENABLED=false` committed default | Verified |

## Remaining live gates (owner actions)

1. Deploy the current Blender worker to Render (it already contains
   `/rig-pipeline/process`); confirm `WORKER_SHARED_SECRET` byte-match.
2. Run the fixture harness for biped/quadruped/accessory sources; paste outputs here.
3. After BO-0/BO-1 merge: the deliverable-3 follow-up pass (reroute
   `startRig` purchases through `/api/rig-pipeline`), then flag enablement review.
