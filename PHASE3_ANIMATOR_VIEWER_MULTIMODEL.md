# Phase 3 — Animator: Interactive Viewer, Animation Controller & Multi-Model

**Status:** Ready for implementation
**Owner:** coding agent
**Builds on:** Phase 1 (`857deee`) + Phase 2 (`8d1ee27`).
**Parent spec:** `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md` (§3 types, §5 client, §5.2b multi-model, §14 defaults).

Phase 1 = foundations (types, paths, queue, recording/capture primitives). Phase 2 = server-side inspect/convert.
**The interactive client — the actual on-screen animator — does not exist yet.** Phase 3 builds it: load a
model, play its animations with full transport, add more models, and record the real viewport. Environments,
weather, sound, and voiceover are **Phase 4** (you cannot dress a scene before the viewport + controller exist);
AR multi-model cast is **Phase 3b** (separate). Do not start those here.

---

## 0. FIX FIRST — Phase 2 blockers (do these before any Phase 3 work)

### 0.1 P0 — `sharp` eager-load crashes server boot (must fix)
`@gltf-transform/functions` loads `sharp` **at import time**. The chain `server.ts → server/animator/routes.ts →
gltf.ts → @gltf-transform/functions → sharp` runs at startup, so on any host without a matching `sharp` binary
the **entire server fails to boot**. `sharp` is not in `package.json`. (Symptom: `tests/animator_metadata`,
`_worker`, `_import` fail with *"Could not load the sharp module"* on platforms lacking the prebuilt binary.)

Do **both**:
1. **Declare it:** add `sharp` to `dependencies` (pin a version) so the deploy host installs the correct
   platform binary. Ensure the prebuilt-zip deploy step runs `npm rebuild sharp` / `npm install` on the host arch
   (note it in `DEPLOYMENT_NOTES.md`).
2. **Isolate it:** make the animator import chain **not crash boot**. Lazy-load `@gltf-transform/functions`
   *inside* the execution functions in `gltf.ts` (dynamic `await import("@gltf-transform/functions")` within
   `inspectAsset`/`runSafe`), not at module top-level. Wrap worker/route usage so a missing `sharp` disables only
   the animator (return `503 { code: "ANIMATOR_UNAVAILABLE" }`) instead of taking down the whole server.
3. **Doctor:** keep the `sharp` check, but now that it's a hard animator dependency, report it clearly (the
   animator conversion path is non-functional without it).
- **Verify:** on a box without a prebuilt sharp, importing `server.ts` must not throw; the 3 failing tests pass
  once sharp is installed for the arch.

### 0.2 P1 — enforce asset/job ownership
`routes.ts` does not scope assets/jobs by user (leftover comment: *"we didn't store userPhone in metadata"*).
Persist `userPhone` in the asset metadata (`originals/<assetId>/metadata.json`) and in each job record, and make
every `GET`/`POST` verify `req.user!.phone` owns the asset/job — return **403** otherwise. Add a test:
user B cannot read user A's asset/job.

### 0.3 P2 — gate the `optimize` preset
`POST /api/animator/jobs` must reject `preset: "optimize"` with `400 "optimize preset not available yet"` (it is
Phase 4). Do not let a non-safe op reach the worker.

> These three are small and localized; land them as the first commit of Phase 3 ("fix: Phase 2 sharp/ownership/
> optimize-gate") so the deploy is safe before new surface area is added.

---

## 1. What you can reuse (already built)

- **Types** (`src/animator/types.ts`): `AnimationController`, `SceneController`, `SceneActor`, `SequenceStep`,
  `CameraBookmark`, `AssetMetadata`, `AnimationClipInfo`. These are the seams to implement — do not redefine.
- **Recording primitives:** `src/animator/recording/capabilities.ts` (`selectEncoder`),
  `recording/encoder.ts` (`createMp4Encoder`), `capture/capture.ts` (`captureVideoFrame`).
- **Server:** asset/job/convert endpoints + workspace (`recordings/`, `projects/` dirs already created by
  `initializeWorkspace`). Bucket mirror via `storage.ts` (`uploadBase64Binary`).
- **Stack:** `three@0.171`, `@react-three/fiber@9`, `@react-three/drei@10` (`useGLTF`, `useAnimations`,
  `OrbitControls`, `ContactShadows`). `AvatarModel.tsx` already shows the `useGLTF`/`useAnimations` pattern.

---

## 2. Goals (Phase 3 scope)

1. **Animation controller** — a concrete `AnimationController` over three's `AnimationMixer`: clip discovery,
   select/play/pause/stop/loop/speed/seek, current-time & duration, bind-pose reset, pose preserved on pause.
2. **Interactive viewer** — `AnimatorScreen` (full-screen `Screen.ANIMATOR`) reached from the Models grid + Live
   3D view (parent §5.3): Canvas, model, transport, timeline, clip selector.
3. **Multi-model** — `SceneController` managing N actors, the **"+ Add model"** picker (reusing
   `GET /api/avatars`), actor list/transform, one global transport.
4. **Real-viewport recording** — wire the Phase 1 encoder to a **clean offscreen render** of the scene at the
   preset resolution; upload the MP4 + PNG screenshots to the server (`recordings/`/`screenshots/` + bucket).
5. **Project persistence** — save/load an animator project (actors + transforms + selected clips + camera).
6. **Defaults (parent §14)** — a single `src/animator/defaults.ts`; opening on a fresh model auto-frames,
   auto-selects an idle clip, loops, and a zero-input record yields a good clip.

**Deferred (do NOT build here):** environments/lighting/weather/sound (Phase 4, parent §6.7), voiceover (Phase 4,
parent §6.6), scene sequence executor beyond a single active clip per actor, AR cast (Phase 3b, parent §6.5).

---

## 3. Animation controller — `src/animator/controller/createAnimationController.ts`

Concrete implementation of the `AnimationController` type, decoupled from React so it is unit-testable.
Construct with `(root: THREE.Object3D, clips: THREE.AnimationClip[])`; internally owns one `THREE.AnimationMixer`.

| Method | Implementation |
| --- | --- |
| `listClips()` | Map clips → `AnimationClipInfo` (name **read-only**, index, `duration`, channelCount, `tracksMorph` = any track name ends `.morphTargetInfluences`). |
| `selectClip(name)` | Resolve `AnimationAction` by clip name; make active. |
| `play()` | `action.paused=false; action.play()`. |
| `pause()` | `action.paused=true` — **preserves current pose + time**. |
| `stop()` | `action.stop()`, set `time=0`, do not play. |
| `setLoop(loop)` | `LoopRepeat`/`LoopOnce`; `clampWhenFinished=true` when not looping. |
| `setSpeed(m)` | `action.timeScale=m`. |
| `seek(sec)` | `action.time=clamp(0,dur)`, `mixer.update(0)` to flush pose without advancing (scrubbing). |
| `getCurrentTime()/getDuration()` | `action.time` / `clip.duration`. |
| `resetToBindPose()` | `mixer.stopAllAction()`, restore captured bind transforms (snapshot per-bone `position/quaternion/scale` at load) and reapply. |
| `update(delta)` | `mixer.update(delta)` — called once per frame by the hook. |
| `dispose()` | stop actions, uncache clips, free. |

**Not implemented (declared on the type, throw `NotImplemented`, UI hides):** `crossFadeTo`, `playSequence`
(beyond a single active clip), `setMorphInfluence`.

**Empty/static models:** `listClips()` returns `[]`; the UI shows a "no embedded animations" state — never
fabricate a clip.

---

## 4. Multi-model — `src/animator/controller/createSceneController.ts`

Implements `SceneController` (parent §3/§5.2b): a map `actorId → AnimationController`.

- `addActor(assetId)`: load the GLB (`useGLTF`/loader); **`SkeletonUtils.clone`** the scene graph so the same
  asset can appear twice without sharing a skeleton; build an `AnimationController` over the clone's clips; place
  at a non-overlapping default transform (parent §14); return a fresh `actorId` (distinct from `assetId`).
- `removeActor` / `setActiveActor` (active = the actor the clip selector/timeline/transform inspector edit).
- Global transport: `playAll/pauseAll/stopAll/seekAll/setGlobalSpeed` fan out to each controller. `update(delta)`
  advances **every** actor's mixer once per frame under one shared clock (so recording stays frame-synced).
- Dispose each actor's mixer/geometry/material on remove (reuse `src/three/ar/dispose.ts` patterns).
- **Honest scope:** per-actor clip selection + transform are real; per-actor start offsets / crossfades are
  deferred.

Hook: `src/animator/controller/useSceneController.ts` — owns the `SceneController`, wires one
`useFrame((_, d) => scene.update(d))`, mirrors state into React (throttled) for the timeline/actor-list readouts.

---

## 5. UI — `src/animator/components/`

Per parent §5.3 (UI placement, decided):

- **Entry:** add an **"Animate/Studio"** button to each model card in `AvatarDashboard` (next to "Live 3D") and
  inside `LivingAvatarView`. Add `ANIMATOR = "ANIMATOR"` to `Screen` (`src/types.ts`); render
  `case Screen.ANIMATOR:` in `App.tsx` alongside `Screen.MODELS`; add it to the authed-screen guard lists. Pass
  the chosen avatar's `model_url` as the first actor (import via `POST /api/animator/assets`).
- `AnimatorScreen.tsx` — `<Canvas>` (fiber) with the actor(s), `OrbitControls`, `ContactShadows`; hosts the
  panels below. Auto-frames the camera to the model bounding box on load (defaults §14).
- `TransportControls.tsx` — play/pause/stop, loop toggle, speed (0.25×–2×), reflecting controller state.
- `Timeline.tsx` — scrubber bound to `seekAll()`; `current-time / duration` readout (mm:ss.cs).
- `ClipSelector.tsx` — dropdown of the active actor's clips; empty state for static models.
- `ActorList.tsx` + `AddModelPicker.tsx` — cast panel (add/remove/rename/select/visibility/transform). The picker
  is a grid from **`GET /api/avatars`** (`fetchAvatars()`), filtered to `generation_status==="done"` && `model_url`.
- `RecordPanel.tsx` — resolution/fps/bitrate (defaults 1080p/30/16 Mbps), Record/Stop, Screenshot; disable
  options that `selectEncoder` reports unsupported (never crash).

---

## 6. Recording & capture (wire the real viewport)

- `src/animator/capture/viewportSource.ts` — render the scene to a **dedicated offscreen render target / canvas**
  sized to the preset (1280×720 / 1920×1080) containing **only** model(s) + backdrop + lighting (no
  OrbitControls gizmo, no HTML overlay). Drive the animation deterministically during capture: advance
  `scene.update(1/fps)` per captured frame → frame-accurate, refresh-rate independent.
- Feed frames through `capture/capture.ts` `captureVideoFrame` into `recording/encoder.ts` `createMp4Encoder`
  (selected via `selectEncoder`); `finish()` → MP4 `Blob`.
- Upload: `POST /api/animator/recordings` (server writes `recordings/<id>.mp4` + bucket mirror, returns URL). PNG
  screenshot via `capturePng()` → `POST /api/animator/screenshots`. Client "Download" is secondary; the
  server-side store is canonical (parent decision).
- Enforce `MAX_CLIP_SECONDS = 10`; default record length 8 s (defaults §14).

New server endpoints to add now (parent §11): `POST/GET /api/animator/recordings`,
`POST /api/animator/screenshots` (multipart or base64 → `storage.ts`).

---

## 7. Project persistence — `server/animator/projects.ts` + endpoints

- `ProjectRecord` = `{ id, userPhone, name, actors: SceneActor[], activeActorId, camera?: CameraBookmark,
  recordSettings, createdAt, updatedAt }`. Persist as `projects/<id>.json` (workspace dir already exists);
  validate with zod; **owner-scoped** (§0.2 pattern).
- Endpoints (parent §11, all `requireAuth`, ownership-checked):
  `POST /api/animator/projects`, `GET /api/animator/projects`, `GET /api/animator/projects/:id`,
  `PUT /api/animator/projects/:id`, `DELETE /api/animator/projects/:id` (never deletes originals/outputs).
- Default project name `"<AvatarName> — <date>"`; autosave draft on edit (defaults §14).

---

## 8. Defaults — `src/animator/defaults.ts` (single source of truth, parent §14)

Bake in the §14 table: auto-frame ¾-front eye-level ~40° FOV; feet snapped to `y=0`; auto-pick idle clip
(`idle`/`stand`/`breath` heuristic, else first) with **loop on**, speed 1.0; new actors placed non-overlapping
facing camera; ACES Filmic tone-mapping + sRGB + `PCFSoft` shadows + soft contact shadow + `dpr=min(devicePixelRatio,2)`;
record preset 1080p/30/16 Mbps H.264 MP4 with capability downgrade; `MAX_CLIP_SECONDS=10`, default 8 s. No inline
magic numbers elsewhere — components read from here.

---

## 9. Tests (node:test `.mjs`, extensionful `.ts` imports, no TS parameter properties)

Keep controller logic pure so it tests without a browser (inject three objects or test the pure state math).

- `tests/animator_controller.test.mjs` — clip discovery (names preserved, `[]` for static), `selectClip`,
  loop on/off, `setSpeed`, `seek` clamping to `[0,duration]`, `pause` preserves time, `resetToBindPose` restores
  captured transforms.
- `tests/animator_scene_controller.test.mjs` — `addActor` unique `actorId`s (same asset twice → two actors),
  `removeActor` prunes, non-overlapping default placement deterministic, `seekAll` clamps per-actor.
- `tests/animator_defaults.test.mjs` — a scene built purely from `defaults.ts` passes the scene zod schema,
  selects a clip, resolves a valid record preset from a capable capability set, stays within `MAX_CLIP_SECONDS`.
- `tests/animator_projects.test.mjs` — save→load round-trip with a **multi-actor** project (≥2 actors, same
  asset twice); rejects corrupt JSON; user B cannot load user A's project (403).
- **Smoke:** importing `AnimatorScreen` module + constructing the controller with `[]` clips does not throw;
  invalid/missing model URL to the import path yields a typed error (no crash).
- Keep Phase 1/2 animator tests green; the unrelated `brain_*`/`tripo`/`x-dm-service` failures remain
  out of scope.

---

## 10. Definition of done (Phase 3)

- [ ] **§0 fixes landed:** server boots without a prebuilt `sharp` (animator degrades to 503, not a boot crash);
      `sharp` in `dependencies`; asset/job/project ownership enforced (403 cross-user); `optimize` preset gated.
- [ ] `AnimationController` fully implemented over `AnimationMixer`; pause preserves pose; bind-pose reset works;
      static models show an empty-clip state (no fabricated clips).
- [ ] `Screen.ANIMATOR` reachable from Models cards + Live 3D; opens on the chosen avatar auto-framed with an
      idle clip looping (zero user input).
- [ ] Multi-model: **"+ Add model"** (from `GET /api/avatars`) adds actors (same asset twice OK); global
      transport plays all; per-actor clip + transform edit works.
- [ ] Real-viewport recording: clean offscreen frames → MP4 via WebCodecs (capability-downgrade, never crash) →
      uploaded to `recordings/` + bucket; PNG screenshot works; ≤10 s enforced.
- [ ] Projects save/load/list/delete, owner-scoped; autosave draft.
- [ ] `defaults.ts` is the single source of truth; §9 tests pass under `node --test`; `tsc --noEmit` clean.

---

## 11. After Phase 3
- **Phase 3b — AR multi-model cast** (parent §6.5): "+ Add model" in the AR viewer, hit-test placement,
  companion clip-players, `scene_actors` + `/api/ar/:avatarId/cast`.
- **Phase 4 — Scene dressing** (parent §6.6/§6.7): environment presets (ambientCG/OpenHDRI + `.blend`→HDRI),
  time-of-day lighting rig, weather, sound + audio-bed mux, pre-made voiceover scripts (HeyGen, 8–10 s), the
  multi-step sequence executor + camera cuts + templates, and the opt-in `optimize` glTF preset.
