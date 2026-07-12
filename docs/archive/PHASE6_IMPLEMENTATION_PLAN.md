# Phase 6 — Implementation Plan (Coding-Agent Ready)

**Status:** Ready to implement
**Supersedes:** `docs/PHASE6_STABILIZATION_AND_MEDIA_HARDENING.md` (this expands it and folds in the pre-launch performance work as §6.7).
**Parent spec:** `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md`.

Phase 6 is a **stabilization + pre-launch hardening** pass — no new user-facing features. Lock in the 2026-07-10 review fixes, close the media-durability gaps that cause 404s, add regression guards, strip dead weight before traffic, then pick up the deferred animator polish.

## Ground rules (unchanged from Phases 1–5)
- Preserve originals; **no fakery** (architected-but-unbuilt stays hidden/disabled, never stubbed to look real).
- Missing clips are skipped, never invented. CC0/owned-only assets.
- **Commit per step** with its tests. Tests run via `tsx --test` (`npm run test`). Lint = `tsc --noEmit` must stay clean. Keep all existing animator tests green throughout.
- The Cowork sandbox can't `unlink` inside `.git`, so **commits happen on the local Mac** (`rm -f .git/*.lock` first).

## Execution order (dependency-aware)
Do stabilization before polish. Suggested sequence: **6.7 → 6.1 → 6.2 → 6.3 → 6.4 → 6.6 → 6.5**. (6.7 first because it's a launch-blocking payload win that's fully isolated; 6.5 last because it's additive polish.)

---

## 6.7 — Strip the WebXR emulator (IWER) from production  ⚡ *(the corrected "runtime asset" item)*

**Problem (measured).** The `music_room` (2.09 MB), `living_room` (1.50 MB), `meeting_room` (0.41 MB), `office_*`, and `emulate` (0.43 MB) chunks are **not** app scene assets — they come from `@iwer/sem` / `iwer` / `@iwer/devui`, the **IWER WebXR emulator** pulled in transitively by `@react-three/xr → @pmndrs/xr`. In `@pmndrs/xr/dist/store.js`, `createXRStore` defaults `emulate` to `'metaQuest3'` (line ~94) and, in any browser, runs `injectEmulator()` which dynamic-imports the emulator + synthetic room captures. Our two stores (`src/three/ar/ARPetStage.tsx:38`, `src/three/ar/ARScene.tsx:20`) never pass `emulate`, so **every real user who opens the 3D/AR path downloads ~4.7 MB of desktop-emulator data they can't use.**

**Fix (small, isolated, high-impact).**

**Step 6.7.1 — Disable the emulator in production, keep it in dev.**
In both `createXRStore({...})` calls add:
```ts
emulate: import.meta.env.DEV ? "metaQuest3" : false,
```
With `emulate: false`, the `if (emulate != false)` guard in the store never fires, `injectEmulator()` never runs, and the dynamic `import('./emulate.js')` chain is never fetched by a browser. Devs still get desktop AR emulation locally (`npm run dev`).

- Acceptance: real Android Chrome AR session still enters and places a pet (manual device test — the emulator was never used on real hardware, so behavior is unchanged). Desktop `npm run dev` still shows the emulated headset.
- Add a one-line comment citing this section so the default isn't "fixed" back later.

**Step 6.7.2 — (Optional hardening) drop the chunks from the build entirely.**
`emulate:false` stops users *fetching* the chunks, but Rollup still emits them (the dynamic import is statically reachable). To remove them from `dist/` too, alias the emulator packages to an empty module in the **production** build only:
```ts
// vite.config.ts — inside resolve.alias, guarded to build/prod
...(process.env.NODE_ENV === "production" ? {
  "iwer": path.resolve(__dirname, "src/shims/empty.ts"),
  "@iwer/sem": path.resolve(__dirname, "src/shims/empty.ts"),
  "@iwer/devui": path.resolve(__dirname, "src/shims/empty.ts"),
} : {}),
```
Create `src/shims/empty.ts` = `export default {}; export {};`. **Only do this if 6.7.1's build still shows the chunks and you want them gone.** Verify the prod build succeeds and AR still works; if the alias breaks resolution, keep just 6.7.1 (which already fixes the user-facing cost).

- Acceptance: `vite build` output no longer lists `music_room`/`living_room`/`meeting_room`/`emulate` chunks (6.7.2) **or** they exist but are provably unreferenced at runtime (6.7.1). Document which approach shipped.
- Test: add `tests/xr-emulate-guard.test.mjs` asserting both `createXRStore` call sites include an `emulate:` key set to `false` in production (simple source-string assertion, mirroring the existing lightweight guards).

**Step 6.7.3 — Verify the win.** Rebuild and record the initial-load numbers in `docs/WEBSITE_PERFORMANCE_IMPROVEMENTS.md` (before/after). Combined with the already-shipped compression + `React.lazy` split, the AR path should drop several MB.

---

## 6.1 — Route-guard correctness (prevent 401 regressions)
The login 401 was a blanket `requireAuth` on the whole `/api` prefix; the fix scoped it to `/animator` + `/scenes`. Harden against recurrence.
- Audit every `app.use("/api", ...)` and every router mounted at a shared prefix; confirm no middleware gates public routes (`/api/auth/*`, health, public GETs).
- **Add `tests/auth-routes.test.mjs`**: boot the app; assert `POST /api/auth/login` and `/api/auth/signup` return non-401 without a token; a representative `/api/animator/*` and `/api/scenes/*` returns 401 without a token and 200 with one.
- Document the mount-order rule in `server.ts` near the guard: public routes must be reachable regardless of registration order; prefix guards must be path-scoped.

## 6.2 — Model-URL durability (stop GLB 404s at the source)  🔴 *biggest stability risk under traffic*

Provider (Tripo) URLs are **ephemeral** — they expire, then the stored `model_url` 404s forever. Only Backblaze-mirrored URLs are durable. This section is a full audit (done below) + a fix + a backfill.

### 6.2.a Audit findings (from this session — concrete, not hypothetical)

The correct pattern already exists — **`POST /api/pets/:id/rig` (server.ts ~1812) is the reference**: it calls `uploadBinaryFromUrl(rig.glbUrl, "model/gltf-binary")` and `uploadBase64Binary(bakeJson.glb_base64, "model/gltf-binary")` before persisting. Every other path should match it. Storage helpers: `uploadBinaryFromUrl(url, mime)` mirrors a remote URL; `uploadBase64Binary(base64, mime)` mirrors raw bytes; both build a durable URL `https://<bucket>.<endpoint-host>/<folder>/<file>`. `uploadBase64Image(base64)` **infers** MIME from the data-URL prefix and is for images only.

| # | Location | Bug | Fix |
|---|----------|-----|-----|
| B1 | `server.ts` ~1341 (`POST /api/avatars`, `buildState.completed`) | GLB bytes uploaded via **`uploadBase64Image(riggedGlbBase64)`** → wrong MIME/folder (lands as an image, not `model/gltf-binary`) | `uploadBase64Binary(riggedGlbBase64, "model/gltf-binary")` |
| B2 | `server.ts` ~1368 (clip-bake upgrade) | Same: `riggedUrl = uploadBase64Image(riggedGlbBase64)` | `uploadBase64Binary(riggedGlbBase64, "model/gltf-binary")` |
| B3 | `server.ts` ~1338 | When `buildState.riggedGlbBase64` is falsy, `finalModelUrl` stays = **raw `glbUrl` (Tripo)** and is persisted by `updateAvatarModel` | Mirror first: `finalModelUrl = await uploadBinaryFromUrl(glbUrl, "model/gltf-binary")` |
| B4 | `server.ts` ~1256 (`POST /api/avatars`, other branch) | `try { finalModelUrl = await uploadBinaryFromUrl(glbUrl) } catch {}` leaves `finalModelUrl = raw glbUrl` on mirror failure → persists provider URL | On failure **do not persist a provider URL**: set `generation_status='failed'` (retryable) + return error; never store raw |
| B5 | `server.ts` ~3167 (`/api/image-to-3d/:jobId/status`) | Mirror-failure fallback `durableUrl = poll.glbUrl` (raw) is persisted + returned | Same as B4 — on mirror failure, mark retryable, don't store raw |
| ✅ | `server.ts` ~3248 (`/api/jobs/:id`) | `uploadBinaryFromUrl(result.glbUrl, "model/gltf-binary")` then persist — **correct**, leave as-is |
| ✅ | `server.ts` ~1812 (`/api/pets/:id/rig`) | **Reference implementation** — correct |

**Rule to enforce:** a raw provider URL (`*.tripo3d.*`, `*.meshy.*`, any non-bucket host) must **never** reach `updateAvatarModel` / `updateAvatarRiggedModel` / `setCreationModelUrl` / `savePetRigUrls`. Mirror first; on mirror failure, mark the row retryable rather than persisting the ephemeral URL. Use explicit `"model/gltf-binary"` MIME everywhere (ties into §6.3 folders → GLBs land in `models/`).

**Guard test** (`tests/model-url-durability.test.mjs`): source-string assert that none of the four persist calls receive a value that came directly from `poll.glbUrl` / `result.glbUrl` / `rig.glbUrl` / `glbUrl` without an intervening `uploadBinaryFromUrl`/`uploadBase64Binary`; and that GLB uploads never use `uploadBase64Image`.

### 6.2.b Backfill / repair job — `scripts/backfill-model-urls.mjs`

Idempotent, dry-run-by-default, batched. Never deletes.

1. **Select** candidates: `creations WHERE media_type='model' AND model_url IS NOT NULL`, plus `avatars WHERE model_url IS NOT NULL OR rigged_model_url IS NOT NULL`, plus `pet_profiles.rigged_glb_url/lod_glb_url`.
2. **Classify each URL:**
   - `durable` — host === `<bucket>.<MEDIA_BUCKET_URL host>` → **HEAD it**; 200 = OK (skip), 404 = `dead-durable` (bucket object missing → flag for regen).
   - `provider` — host matches tripo/meshy/other → **HEAD it**; 200 = still live → **re-mirror** via `uploadBinaryFromUrl(url, "model/gltf-binary")`, then UPDATE the row to the durable URL; 404 = `dead-provider` → flag `generation_status='needs_regen'`.
3. **Report** (write `docs/reports/model-url-backfill-<date>.json`): counts per bucket {ok, remirrored, dead}, and the list of ids needing regeneration. **No deletes.**
4. **Flags:** `--dry-run` (default true; `--apply` to write), `--limit N`, `--table creations|avatars|pets|all`.
5. Wrap DB writes in the existing pool; reuse `storage.ts` helpers; respect a small concurrency cap (e.g. 5) to avoid hammering the provider.

### 6.2.c Retention policy
Confirm no Backblaze lifecycle rule is expiring the `models/` prefix (the 404s suggest objects may be disappearing). Document the retention decision in `DEPLOYMENT_NOTES.md`.

## 6.3 — Storage MIME + folder hardening (`storage.ts`)
- Add audio to `getExtensionFromMime`: `audio/webm→webm`, `audio/mpeg→mp3`, `audio/mp4→m4a`, `audio/wav→wav`.
- Make `getFolderFromMime` audio-aware (`audio/* → "audio"`); voiceover currently lands as `creations/<ts>.bin`.
- (Optional, non-breaking) per-feature prefixes behind an explicit hint: `models/`, `videos/`, `audio/`, `scenes/backgrounds/`, `creations/`.
- Test: audio upload lands as `audio/<ts>.webm`, not `creations/<ts>.bin`.

## 6.4 — R3F hook-placement guard (prevent Canvas-hook regressions)
The animator crash came from `useFrame` called outside `<Canvas>`.
- Add the `@react-three/eslint-plugin` (or at minimum a convention doc): any `@react-three/fiber`/`drei` hook may only run inside a component rendered under `<Canvas>`.
- Sweep the R3F-hook files (see the 2026-07-10 error log grep) for any hook invoked from a screen/UI component; extract to an in-Canvas child (as done for `SceneTicker`).

## 6.5 — Deferred animator polish (carried from Phase 5 §4) — *do last*
Architected-but-not-faked until built:
- Lossy **`optimize`** glTF preset (opt-in; resample/weld/KTX2/Draco; `manifest.lossless=false`; never rename animations or remove morph targets), then ungate the `POST /api/animator/jobs` `optimize` 400.
- Crossfades / blended sequencing.
- Morph-target UI.
- Camera-bookmark UI.
- Multiple brain-driven AR agents (currently one selected/idle brain; don't imply multi-brain in the UI until built).

## 6.6 — Deploy / git workflow
- Document in `DEPLOYMENT_NOTES.md`: the Cowork sandbox mount blocks git `unlink`, so commits happen locally; the deploy zip can be built from `git ls-files` into a non-mount tmp dir when needed.
- Confirm `scripts/build-deploy-zip.sh` (git-archive from HEAD) works locally post-commit.

---

## Checklist

**6.7 Strip WebXR emulator (do first)**
- [ ] `emulate: import.meta.env.DEV ? "metaQuest3" : false` in `ARPetStage.tsx` + `ARScene.tsx` stores
- [ ] (optional) prod-only alias of `iwer`/`@iwer/sem`/`@iwer/devui` → `src/shims/empty.ts`
- [ ] `tests/xr-emulate-guard.test.mjs`
- [ ] Manual: Android AR enters + places; desktop dev emulation still works
- [ ] Record before/after bundle numbers in the perf doc

**6.1 Route guards**
- [ ] Audit shared-prefix `app.use` mounts for accidental public gating
- [ ] `tests/auth-routes.test.mjs` (login/signup reachable; animator/scenes gated)
- [ ] Document mount-order/path-scope rule in `server.ts`

**6.2 Model URL durability**
- [ ] Fix B1+B2: GLB uploads use `uploadBase64Binary(_, "model/gltf-binary")`, not `uploadBase64Image`
- [ ] Fix B3: mirror `glbUrl` when no rigged base64 (no raw provider URL persisted)
- [ ] Fix B4+B5: on mirror failure, mark row retryable — never persist a provider URL
- [ ] `tests/model-url-durability.test.mjs` (no raw provider URL reaches a persist call)
- [ ] `scripts/backfill-model-urls.mjs` (dry-run default, HEAD-check, re-mirror or flag, JSON report, no deletes)
- [ ] Run backfill in `--dry-run`, review report, then `--apply`
- [ ] Confirm/document Backblaze retention & lifecycle for `models/`

**6.3 Storage MIME/folders**
- [ ] Audio extensions in `getExtensionFromMime`
- [ ] `getFolderFromMime` audio-aware
- [ ] (optional) per-feature prefixes behind explicit hint
- [ ] Test: audio upload lands as `audio/<ts>.webm`

**6.4 R3F guard**
- [ ] Lint rule / convention doc for R3F hooks only under `<Canvas>`
- [ ] Sweep R3F-hook files for out-of-Canvas hooks

**6.5 Animator polish (last)**
- [ ] `optimize` glTF preset + ungate the `optimize` 400
- [ ] Crossfades / blended sequencing
- [ ] Morph-target UI
- [ ] Camera-bookmark UI
- [ ] Multiple brain-driven AR agents

**6.6 Deploy/git**
- [ ] Update `DEPLOYMENT_NOTES.md` (sandbox unlink limitation + zip fallback)
- [ ] Verify `scripts/build-deploy-zip.sh` locally post-commit

### Definition of done (per step)
- [ ] `tsc --noEmit` clean
- [ ] `npm run test` + `npm run test:ar` green
- [ ] Committed on the Mac with the step's tests
- [ ] No new fakery; originals preserved

---

## Optional perf follow-ons (not blocking Phase 6)
Tracked in `docs/WEBSITE_PERFORMANCE_IMPROVEMENTS.md`: hero images → WebP/AVIF + responsive `srcset`; Cloudflare CDN in front of Hostinger (brotli + edge cache); `preconnect` to the Backblaze origin; delete the working-tree deploy zips (`deploy.zip` is 197 MB). Do these opportunistically; none are launch-blocking after 6.7.
