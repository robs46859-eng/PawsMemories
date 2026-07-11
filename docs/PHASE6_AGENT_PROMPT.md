# Coding-Agent Prompt — Phase 6 (paste this to the agent)

You are implementing **Phase 6** of the Pawsome3D repo. Read `docs/PHASE6_IMPLEMENTATION_PLAN.md` in full before writing any code; it is the source of truth. Also skim `docs/PHASE6_STABILIZATION_AND_MEDIA_HARDENING.md`, `SESSION_ERROR_LOG_2026-07-10.md`, and `DEPLOYMENT_NOTES.md`.

## Ground rules (do not violate)
- **Preserve originals; no fakery.** Anything architected-but-unbuilt stays hidden/disabled — never stub it to look real. Missing clips are skipped, never invented. CC0/owned/generated assets only.
- **Commit per step**, each with its own tests. `npm run test` and `npm run test:ar` must be green; `npm run lint` (`tsc --noEmit`) must be clean. Tests run via `tsx --test` — write new `.mjs` tests to pass under `tsx`.
- Do **not** touch working code that the plan marks correct (e.g. `POST /api/pets/:id/rig`, `/api/jobs/:id`). Do not refactor beyond the step.
- Note: the dev/CI sandbox can't `unlink` inside `.git`; commits are finalized on the Mac. Just stage logically-scoped commits.

## Do the steps in this order

### Step 1 — §6.7 Strip the WebXR emulator (start here; fully isolated)
In `src/three/ar/ARPetStage.tsx` (~line 38) and `src/three/ar/ARScene.tsx` (~line 20), the `createXRStore({...})` calls omit `emulate`, so `@pmndrs/xr` defaults it to `'metaQuest3'` and ships ~4.7 MB of IWER emulator + synthetic rooms (`music_room`/`living_room`/`meeting_room`/`emulate` chunks) to every real user.
- Add `emulate: import.meta.env.DEV ? "metaQuest3" : false,` to both stores. Add a one-line comment referencing §6.7 so it isn't reverted.
- Add `tests/xr-emulate-guard.test.mjs`: assert both call sites set `emulate` to `false` in production.
- Rebuild; record the before/after chunk sizes in `docs/WEBSITE_PERFORMANCE_IMPROVEMENTS.md`.
- (Optional, only if you want the chunks gone from `dist/`) add a prod-only Vite `resolve.alias` mapping `iwer`, `@iwer/sem`, `@iwer/devui` → a new `src/shims/empty.ts`. Verify the build still succeeds and, if you can, that AR still initializes. If aliasing breaks resolution, keep only the `emulate:false` change.
- Manual check to note in the commit: desktop `npm run dev` still shows emulation; real Android AR path is unchanged.

### Step 2 — §6.2 Model-URL durability (highest stability priority)
Follow the audit table (B1–B5) in the plan exactly. The reference implementation is `POST /api/pets/:id/rig`.
- **B1/B2** (`server.ts` ~1341, ~1368): replace `uploadBase64Image(<glb base64>)` with `uploadBase64Binary(<glb base64>, "model/gltf-binary")`. (Leave the sprite-sheet PNG upload on `uploadBase64Image`.)
- **B3** (`server.ts` ~1338): when there's no `riggedGlbBase64`, mirror first — `finalModelUrl = await uploadBinaryFromUrl(glbUrl, "model/gltf-binary")` — never persist raw `glbUrl`.
- **B4** (`server.ts` ~1256) and **B5** (`server.ts` ~3167): on mirror failure, do **not** persist the provider URL. Set `generation_status='failed'` (retryable) and return an error; leave `model_url` null.
- **Enforce the rule:** no raw provider host (`*.tripo3d.*`, `*.meshy.*`, any non-bucket host) may reach `updateAvatarModel` / `updateAvatarRiggedModel` / `setCreationModelUrl` / `savePetRigUrls`.
- **Test** `tests/model-url-durability.test.mjs`: assert no persist call receives a value taken directly from `poll.glbUrl`/`result.glbUrl`/`rig.glbUrl`/`glbUrl` without an intervening mirror, and that GLB uploads never use `uploadBase64Image`.
- **Backfill** `scripts/backfill-model-urls.mjs` per §6.2.b: dry-run by default (`--apply` to write), HEAD-check each URL, re-mirror live provider URLs, flag dead ones `needs_regen`, write a JSON report to `docs/reports/`, never delete. Flags: `--dry-run/--apply`, `--limit N`, `--table creations|avatars|pets|all`.
- Confirm no Backblaze lifecycle rule expires `models/`; document retention in `DEPLOYMENT_NOTES.md`.

### Step 3 — §6.1 Route guards
Audit shared-prefix `app.use` mounts for accidental gating of public routes. Add `tests/auth-routes.test.mjs` (login/signup reachable without a token; a representative `/api/animator/*` and `/api/scenes/*` returns 401 without a token, 200 with one). Document the mount-order/path-scope rule in `server.ts`.

### Step 4 — §6.3 Storage MIME/folders
In `storage.ts`: add audio to `getExtensionFromMime` (`audio/webm→webm`, `audio/mpeg→mp3`, `audio/mp4→m4a`, `audio/wav→wav`) and make `getFolderFromMime` audio-aware (`audio/* → "audio"`). Test that an audio upload lands as `audio/<ts>.webm`, not `creations/<ts>.bin`.

### Step 5 — §6.4 R3F hook guard
Add the `@react-three/eslint-plugin` (or a documented convention) enforcing that `@react-three/fiber`/`drei` hooks only run under `<Canvas>`. Sweep the R3F-hook files (see the 2026-07-10 error log) for any out-of-Canvas hook and extract to an in-Canvas child.

### Step 6 — §6.6 Deploy/git docs
Update `DEPLOYMENT_NOTES.md` (sandbox `.git` unlink limitation + zip-from-`git ls-files` fallback). Verify `scripts/build-deploy-zip.sh` works locally post-commit.

### Step 7 — §6.5 Deferred animator polish (last; additive only)
`optimize` glTF preset (opt-in; `manifest.lossless=false`; never rename animations or drop morph targets) then ungate the `optimize` 400; crossfades/blended sequencing; morph-target UI; camera-bookmark UI; multi-brain AR. Keep each hidden/disabled until actually working.

## Definition of done (every step)
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · scoped commit with its tests · no new fakery · originals preserved · no raw provider URL ever persisted.

Report back after Steps 1 and 2 with the bundle-size delta (Step 1) and the backfill dry-run report summary (Step 2) before continuing.
