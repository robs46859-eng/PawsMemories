# Phase 2 — Animator: Inspect, Import & Lossless Convert (worker end-to-end)

**Status:** Ready for implementation
**Owner:** coding agent
**Builds on:** Phase 1 (`857deee`) — `src/animator/types.ts`, `server/animator/paths.ts`,
`server/animator/queue.ts`, recording/capture modules, `scripts/animator-doctor.mjs`.
**Parent spec:** `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md` (this is Phase 2 of §10).

Read the parent plan's §0 guarantees and §4 before starting. The hard rules still hold: **preserve every
original**, **the `safe` preset is strictly lossless**, **new files for every conversion**, **no fakery**.

---

## 0. What Phase 1 already gives you (reuse — do not re-create)

- **Types** (`src/animator/types.ts`): `AssetId`, `AssetMetadata`, `AnimationClipInfo`, `JobSpec`, `JobRecord`,
  `JobState`, `JobType`, `ConversionManifest`. Extend/import these; keep them the single source of truth.
- **Paths** (`server/animator/paths.ts`): `ANIMATOR_DATA_DIR`, `resolveWithinWorkspace(candidate, root?)`,
  `buildOutputName(originalFilename, op, params, inputBytes)`, `initializeWorkspace(root?)`. **All filesystem
  access in Phase 2 must go through `resolveWithinWorkspace`.**
- **Queue** (`server/animator/queue.ts`): `JobSpecSchema`, `JobRecordSchema`, `parseJobFile`, `enqueue`,
  `claimJob`, `completeJob`. The worker you build in Phase 2 consumes exactly these.
- **Deps present:** `@gltf-transform/core|extensions|functions|cli`, `mp4-muxer`, `uuid`, `zod`.

---

## 1. Goals (Phase 2 scope)

1. **Asset import** — register a `.glb`/`.gltf` (from an existing avatar `model_url` or an upload), copy it
   **immutably** to `originals/`, inspect it, persist metadata. Mirror the original to the bucket.
2. **Inspection** — `inspectAsset(path) → AssetMetadata` (clips, morph targets, meshes/materials/textures, skin,
   bbox) using `@gltf-transform/core` + `functions`.
3. **Lossless conversions (`safe` preset)** — `inspect`, GLB→glTF (`unpack`), glTF→GLB (`pack`), `dedup`,
   `prune`. Each emits **new** files under `outputs/` + a `ConversionManifest`; originals untouched.
4. **Worker** — a queue consumer that claims jobs, runs the preset, writes outputs + manifest, mirrors to the
   bucket, and moves the job to `done`/`failed`. Runs end-to-end.
5. **HTTP API** — the asset + job endpoints from the parent plan §11, mounted under `requireAuth`.

**Explicitly out of scope for Phase 2:** the `optimize` preset (lossy), scenes/environments/voiceover, multi-model
UI, AR cast. Those are Phase 3/3b/4.

---

## 2. Plan of work (ordered — so progress survives interruption)

1. **Housekeeping** (small, do first): add `data/` to `.gitignore`; make `animator-doctor.mjs` treat `sharp` as a
   warning, not a hard failure (§7).
2. `server/animator/gltf.ts` — `inspectAsset` + the `safe` preset op runners. Unit-test inspection against a
   fixture first.
3. `server/animator/manifest.ts` — build/write/read `ConversionManifest`; hashing helpers.
4. `server/animator/assets.ts` — import (copy to `originals/`, hash, inspect, persist metadata, bucket-mirror).
5. `server/animator/worker.ts` — queue loop: `claimJob` → run preset via `gltf.ts` → write outputs + manifest →
   bucket-mirror → `completeJob`. Crash-recovery for stale `running/`.
6. `server/animator/routes.ts` — Express router with the §5 endpoints; mount in `server.ts`.
7. Tests (§6): metadata extraction, manifest invariants, worker end-to-end, import path.
8. Verify: `node --test tests/animator_*`, `tsc --noEmit`, `animator-doctor`.

> Per the repo's test toolchain: write tests as `.mjs`, import server modules with **explicit `.ts` extensions**
> (e.g. `import { inspectAsset } from "../server/animator/gltf.ts"`), and **avoid TypeScript parameter
> properties** in any new `.ts` that tests import (Node's native strip-types loader rejects them — this is why
> the existing `tripo.ts`-based tests fail). Keep new modules loader-clean like Phase 1 did.

---

## 3. Inspection & presets — `server/animator/gltf.ts`

### 3.1 Inspection

```ts
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { bounds } from "@gltf-transform/functions";
import type { AssetMetadata, AnimationClipInfo } from "../../src/animator/types.ts";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export async function inspectAsset(absPath: string, originalFilename: string): Promise<AssetMetadata> {
  const doc = await io.read(absPath);              // never writes
  const root = doc.getRoot();
  // animations: name (NEVER renamed), index, duration (max channel input accessor max),
  //   channelCount, tracksMorph (any channel targets 'weights')
  // counts: meshes, primitives, materials, textures, morph targets (sum of primitive targets),
  //   hasSkin (root.listSkins().length > 0), bbox via bounds(doc scene)
  // format inferred from extension (.glb → 'glb', .gltf → 'gltf')
  // ...assemble AssetMetadata...
}
```

- Duration per clip = max over its samplers of the input accessor's max time. Do not guess.
- `tracksMorph` = any animation channel whose target path is `weights`.
- Morph target count = sum of `primitive.listTargets().length` across meshes (report total; do not remove).

### 3.2 Presets (the safety contract — implement exactly)

```ts
import { dedup, prune } from "@gltf-transform/functions";

export type SafeOp = "inspect" | "pack" | "unpack" | "dedup" | "prune";

// SAFE = strictly lossless. NEVER include: weld, simplify, resample, draco, meshopt,
// textureCompress, resize, or any rename. Attempting a non-safe op under preset "safe" must throw.
export async function runSafe(op: SafeOp, inAbs: string, outAbs: string): Promise<string[]> {
  const doc = await io.read(inAbs);
  const opsApplied: string[] = [];
  switch (op) {
    case "dedup": await doc.transform(dedup());           opsApplied.push("dedup"); break;
    case "prune": await doc.transform(prune());           opsApplied.push("prune"); break; // unused only
    case "pack":  /* write as .glb */                      opsApplied.push("pack");  break;
    case "unpack":/* write as .gltf (+ resources) */       opsApplied.push("unpack");break;
    case "inspect": /* no write */                         return ["inspect"];
  }
  await io.write(outAbs, doc);   // outAbs extension decides GLB vs glTF container
  return opsApplied;
}
```

- `pack`/`unpack` are pure container conversions via `NodeIO.write` to a `.glb` vs `.gltf` target path.
- `prune` removes **unused** nodes/materials/textures/accessors only — nothing referenced is touched.
- `dedup` merges identical accessors/textures/materials (information-preserving).
- **Guard:** a `preset: "optimize"` job must NOT reach `runSafe`; keep `optimize` unimplemented in Phase 2 and
  have the worker reject it with a clear "optimize preset not available yet" error (do not silently run lossy ops).

---

## 4. Manifest — `server/animator/manifest.ts`

```ts
import crypto from "crypto"; import fs from "fs";
export function sha256File(absPath: string): string { /* hex */ }
export function buildManifest(args: {
  jobId: string; assetId: string; preset: "safe";
  inputs: { path: string }[];            // preserved originals
  outputs: { path: string; op: string; bucketUrl?: string }[];
  operations: string[];
}): ConversionManifest;                    // fills bytes+sha256, lossless=true for safe
export function writeManifest(m: ConversionManifest, root?: string): string;  // manifests/<jobId>.json
export function readManifest(jobId: string, root?: string): ConversionManifest;
```

**Invariants the manifest must guarantee (and tests assert):**
- Every `inputs[].preserved === true`; input file bytes are **unchanged** after the job (hash before == after).
- Every output has a distinct path + its own sha256; output sha256 ≠ input sha256 for content-changing ops.
- `lossless === true` for the `safe` preset.

---

## 5. Import & worker

### 5.1 Asset import — `server/animator/assets.ts`

`importAsset({ userPhone, source })` where `source` is a `model_url` (existing avatar) or an uploaded
data URL/bytes:
1. Fetch/decode bytes; validate it's `.glb`/`.gltf` (magic bytes / JSON parse); reject otherwise with a typed
   error (this feeds the "invalid model input" test).
2. `assetId = uuid()`. Copy bytes to `originals/<assetId>/<sanitized-original-filename>` via
   `resolveWithinWorkspace`. **This file is immutable from here on.**
3. `inspectAsset(...)` → `AssetMetadata`.
4. Persist metadata: write `originals/<assetId>/metadata.json` (source of truth on disk) **and** mirror the
   original to the bucket via `storage.ts` (`uploadBinaryFromUrl`/`uploadBase64Binary`). Store the bucket URL in
   metadata. (A DB table is optional in Phase 2 — disk metadata is sufficient; if you add one, keep it additive
   and follow the existing `db.ts` migration pattern.)
5. Return `AssetMetadata`.

### 5.2 Worker — `server/animator/worker.ts`

- Loop (interval scan of `jobs/pending/`, default `ANIMATOR_WORKER_CONCURRENCY=1`).
- For each pending job: `claimJob(id)` (atomic; skip if `null`). On claim:
  1. Resolve the asset's original path (never the bucket copy) for input.
  2. Compute `outAbs = outputs/<assetId>/<buildOutputName(originalFilename, op, params, inputBytes)>`.
  3. `runSafe(op, inAbs, outAbs)`; hash + bucket-mirror each output.
  4. `buildManifest(...)` + `writeManifest(...)`; set `manifestPath` on the record.
  5. `completeJob(id, "done", { manifestPath })` — or `completeJob(id, "failed", { error })` on any throw.
- **Crash recovery on boot:** scan `jobs/running/`; any record older than `ANIMATOR_STALE_MS` (default 10 min) is
  moved back to `pending/` (requeue) or to `failed/` with an explanatory error. Pick one policy and document it.
- The worker starts with the server process (import + `startWorker()` in the server bootstrap), guarded by an env
  flag `ANIMATOR_WORKER_ENABLED` (default on) so it can be disabled per-host.

---

## 6. HTTP API — `server/animator/routes.ts`

Mount in `server.ts` next to the other routers: `app.use("/api", requireAuth, animatorRouter)` (match the
existing `AuthedRequest` pattern; every handler uses `req.user!.phone`). Endpoints (parent plan §11):

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/api/animator/assets` | Import `{ modelUrl }` or an uploaded file → `AssetMetadata`. Original preserved + bucket-mirrored. |
| `GET` | `/api/animator/assets` | List the caller's assets (from disk metadata). |
| `GET` | `/api/animator/assets/:id` | One asset's `AssetMetadata`. |
| `GET` | `/api/animator/assets/:id/inspect` | Full inspection (re-run or cached). |
| `POST` | `/api/animator/jobs` | Validate `{ assetId, type, preset, params }` with `JobSpecSchema` (minus id/createdAt) → `enqueue` → `{ jobId }`. Reject `preset:"optimize"` with 400 "not available yet". |
| `GET` | `/api/animator/jobs/:id` | Job state + error (read from `jobs/*/<id>.json`). |
| `GET` | `/api/animator/jobs` | List the caller's jobs. |
| `GET` | `/api/animator/jobs/:id/manifest` | The `ConversionManifest`. |
| `GET` | `/api/animator/outputs/:assetId` | List output files (+ bucket URLs) for an asset. |

- **Ownership:** every asset/job records `userPhone`; handlers must reject access to another user's asset/job
  (403). Do not leak cross-tenant paths.
- **Validation:** all bodies validated with zod; malformed → 400. Reuse `JobSpecSchema`.

---

## 7. Phase 1 follow-ups to fold in (small)

- **`.gitignore`:** add `data/` (the runtime `ANIMATOR_DATA_DIR`). It must never be committed.
- **`animator-doctor.mjs`:** downgrade the `sharp` check to a **warning** (don't exit non-zero if `sharp` is
  absent — it's optional); keep the workspace writability + `@gltf-transform/cli` checks as hard checks. Note the
  sandbox EPERM on `unlink` is environmental; on the real host the writability check should pass.

---

## 8. Tests (node:test `.mjs`, extensionful `.ts` imports)

- `tests/animator_metadata.test.mjs` — **metadata extraction**: commit a tiny fixture `.glb`
  (`tests/fixtures/`) with ≥1 **named** animation and ≥1 morph target; assert clip names preserved, count,
  `duration > 0`, `morphTargetCount > 0`, `hasSkin` correct. (If a binary fixture is impractical, build a
  `@gltf-transform/core` `Document` in-memory and test the metadata-shaping function.)
- `tests/animator_manifest.test.mjs` — **manifest invariants**: `inputs[].preserved === true`; input bytes hash
  identical before/after a `dedup` job; output hash ≠ input hash; `lossless === true`.
- `tests/animator_worker.test.mjs` — **end-to-end**: `enqueue` a `dedup`/`pack` job against a fixture asset in a
  temp workspace, run one worker tick, assert the job lands in `done/`, the output file exists under `outputs/`,
  the **original is byte-identical**, and a manifest was written.
- `tests/animator_import.test.mjs` — **import + invalid input**: valid `.glb` imports and inspects; a truncated/
  non-glTF buffer yields a typed error (no throw/crash); path stays inside the workspace.
- **Safe-preset guard test:** a job with `preset:"optimize"` (or a non-safe op) is rejected, never executed.

Keep the Phase 1 tests green. Full-suite note: the repo's unrelated `brain_*`/`tripo`/`x-dm-service` tests fail
under Node's strip-types loader — that's pre-existing and out of scope; do not "fix" them here, just don't add to
them.

---

## 9. Definition of done (Phase 2)

- [ ] `inspectAsset` returns correct clips (names preserved), counts, morph totals, bbox; never writes.
- [ ] `safe` preset implements inspect/pack/unpack/dedup/prune only; `optimize` is rejected, not faked.
- [ ] Import copies originals immutably, inspects, persists metadata, mirrors to bucket.
- [ ] Worker runs a queued job end-to-end: output(s) under `outputs/`, manifest written, job → `done`/`failed`,
      **original byte-identical afterward**.
- [ ] All §6 API endpoints work under `requireAuth` with ownership checks + zod validation.
- [ ] `data/` gitignored; doctor treats `sharp` as a warning.
- [ ] New `tests/animator_*` pass under `node --test`; `tsc --noEmit` clean; Phase 1 tests still green.
- [ ] No original mutated; safe preset applies no lossy/geometry/texture/rename/morph-removal changes.

---

## 10. After Phase 2

Phase 3 (scenes, environments incl. ambientCG/OpenHDRI + `.blend`→HDRI, time-of-day, weather, sound, multi-model
`SceneController`, voiceover) and Phase 3b (AR cast) follow, per the parent plan. Do not start them here.
