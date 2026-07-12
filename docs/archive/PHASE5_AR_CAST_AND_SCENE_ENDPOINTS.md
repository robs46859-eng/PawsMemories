# Phase 5 — Scene Endpoints (backgrounds/templates/CRUD) + AR Multi-Model Cast

**Status:** Ready for implementation
**Owner:** coding agent
**Builds on:** Phase 4 (`8468e05`). Parent spec: `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md` §6.2–§6.5.

Phase 4 dressed the scene (environments, lighting, weather, sound, voiceover, sequence executor + UI). Two things
were left out and are Phase 5's first job; then Phase 5 delivers the last major feature — **bringing multiple
avatar models into the AR viewer** (Phase 3b).

**Ground rules (unchanged):** preserve originals; no fakery (no faked crossfades/volumetrics/multi-brain);
missing clips are skipped, never invented; CC0/owned-only assets; commit per step; tests run via **`tsx`**
(`npm run test`); keep `npm run lint` (`tsc --noEmit`) clean and all existing tests green.

---

## 0. CLOSE FIRST — Phase 4 scene gaps (spec §6 endpoints + a test)

Phase 4 shipped `GET /scenes/environments`, `/scenes/scripts`, and `POST /scenes/voiceover`, but **not** the scene
CRUD, templates, or custom backgrounds. Land these as the first Phase 5 commit.

### 0.1 `POST /api/scenes/backgrounds` — custom backdrops (a core original feature)
Prepare a backdrop from one of three sources (parent §6.3), store under `scenes/backgrounds/`, mirror to the
Backblaze bucket via `storage.ts`, return `{ bgId, imageUrl }`:
- **location** — reuse the existing `/api/landmarks?city=` data / `navigator.geolocation` lat-lng; resolve a
  landmark image. (If no landmark image provider is wired, accept a provided image URL — do not fabricate.)
- **upload** — validate mime/size, store, mirror.
- **prompt** — reuse the existing Gemini `generateImageWithFallback` path already in `server.ts` (no new model).
All `requireAuth`, owner-scoped, zod-validated. The backdrop feeds `EnvironmentSettings` as a `custom` preset.

### 0.2 Scene CRUD — `POST /api/scenes`, `GET /api/scenes/:id`
Persist a `SceneDescriptor` (`{ actors[], environment, steps, cameras }`, parent §6.1) as
`scenes/<id>.json` (workspace dir), zod-validated, **owner-scoped** (reuse the projects.ts / `userPhone` + 403
pattern). Optionally fold into the existing project persistence if cleaner — but the `POST /api/scenes` +
`GET /api/scenes/:id` routes must exist.

### 0.3 `GET /api/scenes/templates` — pre-scripted scene templates
Repo-bundled JSON (`server/animator/templates/*.json`), zod-validated, cached, read-only. Each template maps
generic clip names to the actor's real clips at load and **skips steps whose clips don't exist** (never invents a
clip). Ship 2–3 templates (e.g. "Idle → Walk → Idle with a slow camera push").

### 0.4 `tests/scene_sequence.test.mjs` (missing from Phase 4)
Test the `SceneSequence` executor: advances `SequenceStep[]` in order as **hard cuts**; a step whose clip is
absent is skipped (not invented); a camera bookmark is applied at the step boundary. Also assert a crossfade
request falls back to a hard cut (documented behavior — not faked).

---

## 1. AR multi-model cast (Phase 3b — the main Phase 5 feature)

Today the AR viewer (`LivingAvatarView` → `ARPetStage` / 8thWall `eighthWallAR.ts`) renders **one** avatar plus
placed **prop** objects (`placed_objects`, `PetObjectKind`). Phase 5 lets the user bring **additional avatar
models** into the AR scene as a **cast**, reusing the `SceneActor` model from the animator.

### 1.1 Persistence — new `scene_actors` table (parent §6.5)
Add an additive migration in `db.ts` (follow the existing `initDb` migration pattern; do NOT overload
`placed_objects`):
```
scene_actors(
  id            VARCHAR/uuid PK,
  owner_phone   VARCHAR(32),     -- the user
  scene_avatar_id INT,           -- the AR scene this cast belongs to (the lead avatar)
  source_avatar_id INT,          -- which avatar model is placed
  transform_json JSON,           -- position/rotation/scale
  selected_clip VARCHAR NULL,
  created_at, updated_at
)
```
Reference existing avatar GLBs — never copy model files.

### 1.2 Endpoints — `/api/ar/:avatarId/cast` (all `requireAuth`, owner-scoped, 403 on cross-user)
- `GET  /api/ar/:avatarId/cast` — list cast members for this AR scene.
- `POST /api/ar/:avatarId/cast` — add `{ sourceAvatarId, transform, selectedClip? }` → returns `actorId`.
- `PUT  /api/ar/:avatarId/cast/:actorId` — update transform / selected clip.
- `DELETE /api/ar/:avatarId/cast/:actorId` — remove (never deletes the source avatar or its files).

### 1.3 AR UI + placement
- Add a **"+ Add model"** action in `LivingAvatarView` (next to the object palette / Live-3D controls) that opens
  the **same avatar picker** used by the animator — reuse `GET /api/avatars` (`fetchAvatars()`), `done` +
  `model_url` only. No new picker endpoint.
- A newly added avatar enters **hit-test / tap-to-place** using the existing 8thWall mechanism
  (`eighthWallAR.ts` `buildObjectNode` / `syncObjects`), then anchors on the detected plane with its own transform.

### 1.4 Animation (honest v1 scope)
- The **lead** avatar keeps its full brain (`useAvatarBrain`) exactly as today.
- **Added companions are clip-players, not brain agents:** each companion loads its GLB, is cloned with
  `SkeletonUtils.clone`, gets its own `AnimationController` (reuse `src/animator/controller/`), and loops a
  selected/idle clip. **Multiple brain-driven agents are deferred** and must not be implied in the UI.
- Reuse `src/three/ar/dispose.ts` to tear down companion mixers/graphs on removal or session end.

### 1.5 Shared code
The AR cast and the animator both consume `SceneActor` + the per-actor `AnimationController`. Keep that logic in
`src/animator/controller/` and import it from the AR stage — **do not duplicate** clip discovery/selection/disposal.

---

## 2. Tests
- `tests/scene_sequence.test.mjs` (§0.4).
- `tests/scene_actors.test.mjs` — `scene_actors` row ↔ `SceneActor` round-trip; add/remove; cross-user access
  rejected (403); same source avatar can appear twice (two distinct `actorId`s).
- `tests/scene_backgrounds.test.mjs` — background source validation (location/upload/prompt), owner-scoping.
- Keep all existing animator/scene tests green; `tsc --noEmit` clean.

## 3. Definition of done (Phase 5)
- [ ] `POST /api/scenes/backgrounds` prepares location/upload/prompt backdrops (bucket-mirrored, owner-scoped).
- [ ] `POST /api/scenes` + `GET /api/scenes/:id` persist/load a multi-actor `SceneDescriptor`, owner-scoped.
- [ ] `GET /api/scenes/templates` serves 2–3 templates; missing clips skipped, never invented; `scene_sequence`
      test passes.
- [ ] AR "+ Add model" adds companion avatars via hit-test placement; each plays its own clip; the lead avatar's
      brain is unaffected; cast persists via `scene_actors` + `/api/ar/:avatarId/cast`; removal disposes cleanly.
- [ ] New tests pass under `tsx`; `tsc --noEmit` clean; no original mutated; no faked crossfades/multi-brain.

## 4. After Phase 5 (deferred / optional)
- Lossy **`optimize`** glTF preset (opt-in; resample/weld/KTX2/Draco; `manifest.lossless=false`; never rename
  animations or remove morph targets) — then ungate the `POST /api/animator/jobs` `optimize` 400.
- Polish: crossfades / blended sequencing, morph-target UI, camera-bookmark UI, multiple brain-driven AR agents —
  all architected-but-not-faked until built.
