# Phase 6 — Stabilization & Media Hardening

**Status:** Ready for implementation
**Owner:** coding agent
**Builds on:** Phase 5 (`PHASE5_AR_CAST_AND_SCENE_ENDPOINTS.md`) — scene endpoints +
AR multi-model cast. Parent spec: `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md`.

Phase 5 delivered the last major *feature*. Phase 6 is a **stabilization pass**: lock
in the fixes from the 2026-07-10 review (see `SESSION_ERROR_LOG_2026-07-10.md`), close
the storage-durability gaps that cause model/audio 404s, add regression guards so
these classes of bug cannot silently return, then pick up the deferred animator polish.

**Ground rules (unchanged from Phases 1–5):** preserve originals; no fakery; missing
clips skipped, never invented; CC0/owned-only assets; commit per step; tests run via
`tsx --test`; lint = `tsc --noEmit`.

---

## 6.1 Route-guard correctness (prevent 401 regressions)

The login 401 was caused by a blanket `requireAuth` on the whole `/api` prefix. The
fix scopes it to `/animator` + `/scenes`. Harden against recurrence.

- Audit every `app.use("/api", ...)` and every router mounted at a shared prefix;
  confirm no middleware unintentionally gates public routes (`/api/auth/*`, health,
  any public GET).
- Add a `tests/auth-routes.test.mjs` that boots the app and asserts:
  `POST /api/auth/login` and `POST /api/auth/signup` return non-401 without a token;
  a representative `/api/animator/*` and `/api/scenes/*` route returns 401 without a
  token and 200 with one.
- Document the mount-order rule in `server.ts` near the guard: public routes must be
  reachable regardless of registration order; prefix guards must be path-scoped.

## 6.2 Model URL durability (stop GLB 404s at the source)

Provider (Tripo) URLs are temporary; only Backblaze-mirrored URLs are durable.

- Audit ALL code paths that write `model_url` / `rigged_glb_url` / `lod_glb_url`.
  Every one must persist a mirrored Backblaze URL, never a raw provider URL. (The
  `/api/image-to-3d/:jobId/status` path was fixed this session; confirm no others
  remain — grep for `poll.glbUrl`, `result.glbUrl`, `rig.glbUrl` being stored
  without an `uploadBinaryFromUrl`/`uploadBase64Binary` first.)
- Backfill/repair job: scan `creations` for `model_url` values that (a) point to a
  non-Backblaze host, or (b) 404 on HEAD. For provider URLs still live, re-mirror;
  for dead ones, mark for regeneration. Output a report, do not silently delete.
- Decide + document the bucket retention/lifecycle policy (the current 404s suggest
  objects are disappearing — confirm no lifecycle rule is expiring `models/`).

## 6.3 Storage MIME + folder hardening (`storage.ts`)

- Add audio to `getExtensionFromMime`: `audio/webm → webm`, `audio/mpeg → mp3`,
  `audio/mp4 → m4a`, `audio/wav → wav`.
- Make `getFolderFromMime` audio-aware: `audio/* → "audio"`. Voiceover uploads
  currently land as `creations/<ts>.bin`.
- (Optional, non-breaking) introduce per-feature prefixes so assets are browsable:
  e.g. `models/`, `videos/`, `audio/`, `scenes/backgrounds/`, `creations/`. Keep the
  MIME default fallback so existing callers are unaffected; only add prefixes where a
  caller passes an explicit feature hint.
- Confirm the public-URL builder handles the new folders (it is prefix-agnostic, but
  add a test).

## 6.4 R3F hook-placement guard (prevent Canvas-hook regressions)

The animator crash came from an R3F hook (`useFrame`) called outside `<Canvas>`.

- Add the `@react-three/eslint-plugin` `no-clone-in-loop` + a project convention
  note, or at minimum a short doc in `src/animator/README` / `UI_MAP.md`: any hook
  from `@react-three/fiber` / `@react-three/drei` may only run inside a component
  rendered under `<Canvas>`.
- Sweep the 14 files using R3F hooks (see error log grep) for any other hook invoked
  from a screen-level/UI component; extract to an in-Canvas child as done for
  `SceneTicker`.

## 6.5 Deferred animator polish (carried from Phase 5 §4)

Architected-but-not-faked until built:

- Lossy **`optimize`** glTF preset (opt-in; resample/weld/KTX2/Draco;
  `manifest.lossless=false`; never rename animations or remove morph targets), then
  ungate the `POST /api/animator/jobs` `optimize` 400.
- Crossfades / blended sequencing.
- Morph-target UI.
- Camera-bookmark UI.
- Multiple brain-driven AR agents (currently one selected/idle brain; do not imply
  multi-brain in the UI until built).

## 6.6 Deploy / git workflow

- Document in `DEPLOYMENT_NOTES.md` that the Cowork sandbox mount blocks git `unlink`,
  so commits happen locally; the deploy zip can be built from `git ls-files` into a
  non-mount tmp dir when needed.
- Confirm the standard `scripts/build-deploy-zip.sh` (git-archive from HEAD) works on
  the local machine after committing this session's fixes.

---

## Checklist — rest of the buildout

### Phase 6 — Stabilization (this doc)

**6.1 Route guards**

- [ ] Audit all shared-prefix `app.use` mounts for accidental public gating
- [ ] Add `tests/auth-routes.test.mjs` (login/signup reachable; animator/scenes gated)
- [ ] Document the mount-order/path-scope rule in `server.ts`

**6.2 Model URL durability**

- [ ] Grep + audit every `model_url` write path mirrors to Backblaze first
- [ ] Build backfill/repair report job (provider URLs, 404s → re-mirror or flag)
- [ ] Confirm/document Backblaze retention & lifecycle policy for `models/`

**6.3 Storage MIME/folders**

- [ ] Add audio extensions to `getExtensionFromMime`
- [ ] Make `getFolderFromMime` audio-aware (`audio/*`)
- [ ] (Optional) per-feature prefixes behind an explicit hint, non-breaking
- [ ] Test: audio upload lands as `audio/<ts>.webm`, not `creations/<ts>.bin`

**6.4 R3F guard**

- [ ] Add lint rule / convention doc for R3F hooks only under `<Canvas>`
- [ ] Sweep the 14 R3F-hook files for other out-of-Canvas hook calls

**6.5 Animator polish (deferred from Phase 5)**

- [ ] `optimize` glTF preset + ungate the `optimize` 400
- [ ] Crossfades / blended sequencing
- [ ] Morph-target UI
- [ ] Camera-bookmark UI
- [ ] Multiple brain-driven AR agents

**6.6 Deploy/git**

- [ ] Update `DEPLOYMENT_NOTES.md` (sandbox mount limitation + zip fallback)
- [ ] Verify `scripts/build-deploy-zip.sh` works locally post-commit

### Cross-cutting definition of done (per step)

- [ ] `tsc --noEmit` clean
- [ ] `tsx --test tests/*.test.mjs` green
- [ ] Committed per step with a descriptive message
- [ ] Deployed zip verified to contain the change
- [ ] No fakery; originals preserved; missing assets skipped not invented
