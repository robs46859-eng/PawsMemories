# Animator + Scene Generation Subsystem — Implementation Plan

**Status:** Ready for phased implementation
**Owner:** coding agent
**Audience:** engineer implementing an in-app, production-quality glTF animator + scene generator for PawsMemories (Pawsome3D).

This plan adds two connected capabilities:

1. **Scene generation** — users assemble a "scene" from one of their 3D avatars plus a background sourced from
   **location data**, a **user-uploaded image**, or a **text prompt**, optionally driven by a **pre-scripted
   sequence** of animation steps and camera cuts.
2. **A production-quality animator** — import, view, animate, inspect, capture (PNG), record (H.264 MP4),
   optimize, and convert `.glb`/`.gltf` assets **entirely within the app**, preserving every original file and
   emitting new output files for all conversions.

The plan is deliberately concrete (no speculative abstraction layers) and matches existing repo conventions:
Express 4 monolith with `requireAuth`/`AuthedRequest`, `@react-three/fiber` + `drei` for rendering,
Backblaze/S3 via `storage.ts`, and `node --test` `.mjs` unit tests under `tests/`.

---

## 0. Non-negotiable guarantees (read first)

These constraints hold across every phase. A change that violates one is a bug, not a tradeoff.

- **Preserve every original.** Imported `.glb`/`.gltf` files are copied into an `originals/` store and are
  **never mutated, renamed, or deleted** by any operation. Every conversion/optimization writes **new** files.
- **The "safe" preset is strictly lossless.** It must NOT: simplify geometry, resize/re-encode textures,
  rename animations, remove morph targets, or apply lossy compression (no Draco/meshopt/KTX2 in safe mode).
  Only structural, information-preserving operations are allowed there (see §4.3).
- **Do not fake unsupported functionality.** Crossfades, clip sequencing beyond hard cuts, morph-target UI, and
  camera bookmarks are **architected** (interfaces + types) but any capability not yet implemented is **hidden
  or disabled in the UI**, never stubbed to look like it works.
- **Graceful fallback.** If a codec/config isn't supported, detect it and fall back (or clearly disable the
  option) — never crash the recorder or silently produce a broken file.
- **Clean viewport output.** Recording and screenshots capture the 3D viewport only — no UI chrome, overlays,
  gizmos, or transport controls in the frame.

---

## 1. Architecture overview

Two runtimes cooperate. Keep the boundary sharp; do not push glTF-transform work into the browser or encoding
work onto the server.

```
┌───────────────────────────── Client (browser, React + three) ─────────────────────────────┐
│ src/animator/                                                                              │
│   types.ts                 shared TS interfaces (single source of truth)                   │
│   controller/              pure animation state machine over three AnimationMixer          │
│   recording/               capability detection + encoder lifecycle (WebCodecs / fallback) │
│   capture/                 PNG screenshot + clean-viewport frame source                     │
│   scenes/                  scene descriptor model + background compositor                   │
│   components/              AnimatorScreen, Timeline, TransportControls, ClipSelector, …     │
│                                                                                            │
│ Renders GLB via useGLTF; encodes MP4 client-side; uploads outputs to the server.           │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │  HTTP (requireAuth)
                                   ▼
┌───────────────────────────── Server (Node, Express 4) ─────────────────────────────────────┐
│ server/animator/                                                                            │
│   paths.ts                 workspace layout + path validation + output naming               │
│   queue.ts                 FILE-BASED job queue (pending → running → done/failed)           │
│   worker.ts                queue consumer loop (runs gltf-transform ops)                     │
│   gltf.ts                  thin wrappers over @gltf-transform (inspect/pack/unpack/dedup…)   │
│   manifest.ts              conversion manifest (originals preserved + outputs produced)      │
│   projects.ts              project persistence (scene + animation state + bookmarks)         │
│   recordings.ts            accept uploaded MP4/PNG, write to app-accessible store + bucket   │
│   scenes.ts                scene templates + background preparation (location/upload/prompt) │
│   routes.ts                Express router, mounted at /api/animator and /api/scenes          │
│                                                                                            │
│ Workspace root: ANIMATOR_DATA_DIR (default <cwd>/data/animator), served read-only over HTTP │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Why a file-based queue** (per requirement): glTF-transform runs are CPU/IO heavy, must survive restarts, and
must be inspectable on disk. A directory-backed queue with atomic `rename()` state transitions gives durability
and observability without a broker. The existing DB `generation_jobs` table is left untouched (it serves the
Tripo/Blender pipeline); this subsystem uses its own file queue.

---

## 2. Workspace layout & the "application-accessible location"

This is a server-rendered web app (main app on Hostinger, worker on Render); the browser cannot write to an
arbitrary filesystem. "Application-accessible location" therefore means a **server-side workspace directory that
the app owns and serves**, mirrored to the existing Backblaze bucket for durability/CDN.

```
ANIMATOR_DATA_DIR/                      # env-configurable; default <cwd>/data/animator
  originals/<assetId>/<original-filename>    # immutable copies of imported models
  outputs/<assetId>/<name>.<op>.<hash>.<ext> # every conversion/optimize result (NEW files)
  jobs/
    pending/<jobId>.json
    running/<jobId>.json
    done/<jobId>.json
    failed/<jobId>.json
  manifests/<jobId>.json                     # conversion manifest
  projects/<projectId>.json                  # saved animator/scene projects
  recordings/<recordingId>.mp4               # uploaded recordings (app-accessible)
  screenshots/<shotId>.png                   # uploaded PNG screenshots
  scenes/backgrounds/<bgId>.<ext>            # prepared background images
  tmp/                                        # scratch; cleaned on job completion
```

- The directory is created on boot (idempotent `mkdir -p`), path configurable via `ANIMATOR_DATA_DIR`.
- A static mount exposes read-only artifacts: `app.use("/animator-files", express.static(ANIMATOR_DATA_DIR))`
  behind auth-aware URL signing OR simply mirror finished artifacts to the bucket and return bucket URLs
  (preferred, consistent with `storage.ts`). Recordings/outputs get uploaded via `uploadBinaryFromUrl`/
  `uploadBase64Binary` and the bucket URL is returned to the client.
- Originals are also mirrored to the bucket `models/` folder for durability, but the local `originals/` copy is
  the canonical "never touch" source for conversions.

---

## 3. Data model (shared types) — `src/animator/types.ts` (+ server mirror)

Define these once and import on both sides (server can re-declare or share via a small `shared/` module).

```ts
export type AssetId = string;      // uuid
export type JobId = string;        // uuid
export type ProjectId = string;    // uuid

export interface AssetMetadata {
  id: AssetId;
  originalFilename: string;        // preserved exactly
  format: "glb" | "gltf";
  sizeBytes: number;
  createdAt: string;               // ISO
  // From inspection (see §4.2):
  animations: AnimationClipInfo[];
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  morphTargetCount: number;        // total across meshes
  hasSkin: boolean;
  boundingBox?: { min: [number,number,number]; max: [number,number,number] };
}

export interface AnimationClipInfo {
  name: string;                    // NEVER renamed by any op
  index: number;                   // order in gltf.animations
  duration: number;                // seconds
  channelCount: number;
  tracksMorph: boolean;            // targets morph weights?
}

export type JobType = "inspect" | "convert" | "optimize";
export interface JobSpec {
  id: JobId;
  userPhone: string;               // owner (from requireAuth)
  assetId: AssetId;
  type: JobType;
  preset: "safe" | "optimize";     // "safe" is the only lossless default
  params: Record<string, unknown>; // op-specific; validated with zod
  createdAt: string;
}

export type JobState = "pending" | "running" | "done" | "failed";
export interface JobRecord extends JobSpec {
  state: JobState;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  manifestPath?: string;
}

export interface ConversionManifest {
  jobId: JobId;
  assetId: AssetId;
  preset: "safe" | "optimize";
  inputs: { path: string; sha256: string; bytes: number; preserved: true }[];
  outputs: { path: string; bucketUrl?: string; op: string; bytes: number; sha256: string }[];
  operations: string[];            // ordered list of ops applied
  lossless: boolean;               // true for safe preset
  createdAt: string;
}

// ── Multi-model scene (client) ───────────────────────────────────────────────
// A scene hosts N actors. Each actor is one imported model instance with its own
// transform, its own AnimationController, and its own selected clip. The animator
// and the AR stage BOTH consume this model.
export interface SceneActor {
  actorId: string;                 // uuid, unique within the scene (an asset may appear twice)
  assetId: AssetId;                // which imported model
  label: string;                   // user-facing name (defaults to the avatar's name)
  transform: { position: [number,number,number]; rotation: [number,number,number]; scale: number };
  selectedClip?: string;           // clip name for this actor (never renamed)
  visible: boolean;
}

// Orchestrates many AnimationControllers under one global transport. Per-actor
// clip selection is independent; global play/pause/stop/seek fan out to all.
export interface SceneController {
  listActors(): SceneActor[];
  addActor(assetId: AssetId, opts?: Partial<SceneActor>): Promise<string>;   // returns actorId
  removeActor(actorId: string): void;
  getActorController(actorId: string): AnimationController | undefined;
  setActiveActor(actorId: string): void;        // which actor the inspector/timeline edits
  // Global transport (fans out to every actor's controller):
  playAll(): void; pauseAll(): void; stopAll(): void;
  seekAll(seconds: number): void;               // scrub all actors to the same wall-clock time
  setGlobalSpeed(multiplier: number): void;
  update(delta: number): void;                  // advances every actor's mixer once per frame
  dispose(): void;
}

// ── Animation controller (client, per actor) ─────────────────────────────────
export interface AnimationController {
  listClips(): AnimationClipInfo[];
  selectClip(name: string): void;
  play(): void;
  pause(): void;                   // preserves current pose/time
  stop(): void;                    // returns to clip start, does not play
  setLoop(loop: boolean): void;
  setSpeed(multiplier: number): void;   // playbackRate
  seek(seconds: number): void;          // timeline scrubbing
  getCurrentTime(): number;
  getDuration(): number;
  resetToBindPose(): void;              // T/bind pose, stops all actions
  dispose(): void;
  // Prepared but NOT implemented in v1 — throw NotImplemented; UI hides these:
  crossFadeTo?(name: string, seconds: number): void;
  playSequence?(steps: SequenceStep[]): void;
  setMorphInfluence?(meshName: string, targetIndex: number, weight: number): void;
}

export interface SequenceStep { actorId: string; clip: string; loops?: number; hardCut?: boolean; }
export interface CameraBookmark { id: string; name: string; position: [number,number,number]; target: [number,number,number]; fov: number; }
```

`AnimationController` is the seam. v1 implements the concrete methods on top of three's `AnimationMixer`; the
optional methods are declared for forward-compatibility and are **absent/disabled** in the UI until built.

---

## 4. Server: glTF inspection, conversion, optimization

### 4.1 Packages

Add (server `dependencies`):

```
@gltf-transform/core
@gltf-transform/extensions
@gltf-transform/functions
@gltf-transform/cli        # invoked for parity/one-off ops; core/functions used programmatically
```

Programmatic use (`@gltf-transform/functions`) is preferred for queue jobs (typed, testable). The CLI is
available for the diagnostic script and manual parity checks.

### 4.2 Inspection — `server/animator/gltf.ts`

`inspectAsset(path): Promise<AssetMetadata>` loads the document with `@gltf-transform/core` `WebIO`/`NodeIO`,
then reads: `doc.getRoot().listAnimations()` (name, index, duration = max channel input, channel count, whether
any channel targets `weights` → `tracksMorph`), mesh/primitive/material/texture counts, skin presence, and the
scene bounding box (`@gltf-transform/functions` `bounds()`). Never writes.

### 4.3 Presets (the core safety contract)

Implement two presets as explicit, ordered operation lists. Do not expose a free-form op runner to clients.

**`safe` (default, strictly lossless):**
- `dedup()` — merge identical accessors/textures/materials (information-preserving).
- `prune()` — remove **unused** nodes/materials/textures/accessors only (nothing referenced is touched).
- `unpartition()`/repack — normalize buffer layout.
- Format conversion GLB↔glTF (pack/unpack) via IO write.
- **Explicitly excluded:** `weld`, `simplify`, `resample`, `draco`, `meshopt`, `textureCompress`, `resize`,
  any rename. (Even though `weld`/`resample` are often "safe," they can alter vertex counts / keyframes, so
  they are barred from `safe`.)

**`optimize` (opt-in, later phase, clearly labeled potentially-lossy):**
- May add `resample({ tolerance })` (keyframe reduction, names preserved), `weld({ tolerance })`,
  `textureCompress` (KTX2), `draco`/`meshopt`. **Never default.** Each op recorded in the manifest;
  `manifest.lossless=false`.
- Even here: never rename animations, never delete morph targets. Geometry simplification (`simplify`) stays
  behind an explicit, separately-gated flag and is out of scope for the first optimize release.

**Conversions covered in v1:** `inspect`, GLB→glTF (`unpack`), glTF→GLB (`pack`), `dedup`, `prune`. Each emits a
new file under `outputs/` and a manifest; originals untouched.

### 4.4 Output naming — `server/animator/paths.ts`

Deterministic, collision-safe, reversible:

```
<originalStem>.<op>.<shortHash>.<ext>
# e.g. bubba.pack.9f2a1c.glb , bubba.unpack.9f2a1c.gltf
```

- `originalStem` = original filename without extension (sanitized: strip path separators, control chars).
- `op` = operation id (`pack`,`unpack`,`dedup`,`prune`,`optimize`).
- `shortHash` = first 6 hex of sha256(input bytes + params) → stable for identical inputs, avoids clobber.
- Pure function `buildOutputName(originalFilename, op, hash)` — unit tested (§8).

### 4.5 Path validation — `server/animator/paths.ts`

`resolveWithinWorkspace(candidate): string` — resolves against `ANIMATOR_DATA_DIR`, rejects if the normalized
real path escapes the workspace (path traversal), rejects symlinks, and enforces an extension allowlist
(`.glb`, `.gltf` for models; `.mp4`,`.png` for media). Every filesystem op goes through this. Pure/deterministic
→ unit tested with traversal vectors (`../`, absolute paths, encoded separators).

### 4.6 File-based queue — `server/animator/queue.ts` + `worker.ts`

- `enqueue(spec: JobSpec)`: validate with zod, write `jobs/pending/<id>.json` atomically (write to `tmp/` then
  `rename`).
- `worker.ts`: single-consumer loop (interval scan or `fs.watch` on `pending/`). Claims a job by
  `rename(pending/<id>.json → running/<id>.json)` (atomic claim; if rename fails, another worker took it).
  Runs the preset ops, writes outputs + manifest, then `rename` to `done/` or `failed/` with `error` populated.
- Concurrency: default 1 worker (configurable `ANIMATOR_WORKER_CONCURRENCY`). Jobs are independent; no shared
  mutable state beyond the filesystem.
- Crash-safety: on boot, any stale `running/*.json` older than a threshold is requeued (moved back to
  `pending/`) or failed. Document the chosen policy.
- Job parsing: `parseJobFile(json): JobRecord` with a zod schema — unit tested against valid/invalid fixtures.

### 4.7 Conversion manifest — `server/animator/manifest.ts`

After a job, write `manifests/<jobId>.json` (`ConversionManifest`): hashes + byte sizes of the **preserved
inputs** and every **output**, ordered `operations`, and `lossless` flag. This is the auditable proof that
originals were preserved and what was produced. Unit tested (round-trip + "inputs marked preserved" invariant).

---

## 5. Client: animation subsystem

### 5.1 Controller — `src/animator/controller/createAnimationController.ts`

A **pure-ish state machine** wrapping three's `AnimationMixer`, decoupled from React so it is unit-friendly and
reusable by the scene executor. Construction takes `(root: THREE.Object3D, clips: THREE.AnimationClip[])`.

Implements, on `AnimationMixer` + `AnimationAction`:

- **Clip discovery:** from `useGLTF(url).animations` — expose `listClips()` (name/index/duration/channelCount/
  tracksMorph). Names are read-only and never mutated.
- **selectClip(name):** resolve action by clip name; make it the active action.
- **play / pause / stop:** `play()` → `action.paused=false; action.play()`. `pause()` → `action.paused=true`
  (this **preserves the current pose and time** — the required behavior). `stop()` → `action.stop()` then set
  time 0 without playing.
- **setLoop(loop):** `action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity/1)`; when not looping, clamp at end
  (`clampWhenFinished = true`).
- **setSpeed(mult):** `action.timeScale = mult` (or `mixer.timeScale`). Playback speed.
- **seek(sec):** timeline scrubbing → set `action.time = clamp(sec, 0, duration)` and `mixer.update(0)` to flush
  the pose without advancing.
- **getCurrentTime()/getDuration():** `action.time` / `clip.duration` → drive the current-time & duration
  displays.
- **resetToBindPose():** `mixer.stopAllAction()`, then restore the skeleton to bind pose. Capture bind
  transforms at load (per-bone `position/quaternion/scale`) and reapply; or use `SkeletonUtils`/`skeleton.pose()`
  where a bind pose exists. This is a real reset, not a hidden clip.
- **Driving updates:** a single `mixer.update(delta)` in the render loop (`useFrame`) advances the active action;
  the controller exposes `update(delta)` the frame loop calls.

**Prepared-but-not-faked (v1 = hidden UI, methods throw `NotImplemented`):** `crossFadeTo`, `playSequence`
(beyond hard-cut — see §6), `setMorphInfluence`. Their types exist so later work is additive, but the UI does
not render controls for them until implemented.

### 5.2 React hook — `src/animator/controller/useSceneController.ts`

Thin adapter: owns the **`SceneController`** (which in turn owns one `AnimationController` per actor), wires a
single `useFrame((_, d) => sceneController.update(d))` that advances every actor's mixer, and mirrors state into
React at a throttled cadence for the timeline/actor-list readouts. No animation logic lives here — only glue.
(A per-actor `useAnimationController` may still exist internally, but the screen consumes the scene-level hook.)

### 5.2b Multi-model orchestration — `src/animator/controller/createSceneController.ts`

`SceneController` (§3) manages a map of `actorId → AnimationController`. Responsibilities:

- **addActor(assetId):** load the GLB (`useGLTF`/loader), instance its scene graph (use `SkeletonUtils.clone` so
  the same asset can appear as multiple independent actors without sharing skeletons), build an
  `AnimationController` over that instance's clips, place it at a non-overlapping default transform, return a new
  `actorId`.
- **removeActor / setActiveActor:** the active actor is the one the clip selector, timeline, and transform
  inspector edit.
- **Global transport:** `playAll/pauseAll/stopAll/seekAll/setGlobalSpeed` fan out to each `AnimationController`.
  `seekAll(t)` scrubs every actor to the same wall-clock `t` (each clamped to its own clip duration). A single
  shared clock keeps them frame-synced during recording (advance every mixer by `1/fps` per captured frame).
- **Honest scope (v1):** all actors share one global play/pause/stop and speed; **per-actor start offsets,
  crossfades, and blended multi-actor choreography are deferred** and not exposed. Per-actor *clip selection* and
  *transform* are fully supported now.
- Memory: dispose each actor's mixer/geometry/material on `removeActor`/`dispose` (reuse the existing AR
  `dispose.ts` patterns).

### 5.3 Components — `src/animator/components/`

- `AnimatorScreen.tsx` — hosts the `Canvas`, the model, `TransportControls`, `Timeline`, `ClipSelector`, and the
  record/screenshot panel. New `Screen.ANIMATOR` enum value + route in `App.tsx` (mirrors how `Screen.MODELS`
  renders `AvatarDashboard`).

#### UI placement (decided)

The animator is **not** a new top-level nav tab. It operates on one specific model in context, so a global tab
would open to an empty screen. Instead it is reached **per-model**, mirroring the existing "Live 3D" pattern:

- Add an **"Animate" / "Studio"** action on each model card in the **Models** screen (`AvatarDashboard`), next to
  the existing "Live 3D" button, and a matching entry inside the Live 3D view (`LivingAvatarView`).
- The action routes to a **full-screen `Screen.ANIMATOR`** carrying the selected `assetId` (add
  `ANIMATOR = "ANIMATOR"` to the `Screen` enum in `src/types.ts`; add the `case Screen.ANIMATOR:` render in
  `App.tsx` alongside `Screen.MODELS`; include it in the authed-screen guards/lists). Pass the chosen avatar's
  model URL/assetId in as the import source (`POST /api/animator/assets`).
- The **scene generator is a mode _inside_ the animator** (actors + background + script), not a separate
  destination — e.g. a "Viewer / Scene" segmented control within `AnimatorScreen`.
- **Deferred (optional):** a top-level **"Studio"** tab that lands on a model-picker grid and then routes into the
  same `Screen.ANIMATOR`. Only worth adding once users commonly have many models; not part of the initial build.

The primary nav stays **Home · Models · Store · Community · Profile**; no new tab is added in this work.

#### Multi-model: "Add model" flow (decided)

Clicking **Animate/Studio** on a card opens the animator seeded with **that avatar as the first actor** — but the
animator is a **multi-model** stage, so the user can add more:

- `AnimatorScreen` renders an **Actor list / cast panel** (add, remove, rename, select-to-edit, toggle
  visibility, per-actor transform) alongside the clip/transport controls.
- An **"+ Add model"** button opens an **asset picker** — a grid of the user's completed avatars. This **reuses
  the existing `GET /api/avatars`** list (`fetchAvatars()`); no new picker endpoint. Only avatars with
  `generation_status === "done"` and a `model_url` are selectable. Selecting one calls
  `sceneController.addActor(assetId)`, which imports it (`POST /api/animator/assets` if not already imported) and
  drops a new `SceneActor` into the scene at a non-overlapping default position.
- The same asset may be added twice (two instances of one avatar) — that's why `actorId` is distinct from
  `assetId`.
- Each actor keeps its **own selected clip and transform**; the global transport plays them together (§5.2b).
- Recording/scene export capture **all visible actors** + background as one clean frame.
- `TransportControls.tsx` — play/pause/stop/loop toggle/speed selector (0.25×–2×). Buttons reflect controller
  state.
- `Timeline.tsx` — scrubber bound to `seek()`, with `current-time / duration` readout (mm:ss.cs).
- `ClipSelector.tsx` — dropdown of discovered clips; `selectClip()`. Shows "no embedded animations" empty state
  for static models (do not fabricate clips).
- `RecordPanel.tsx` — preset pickers (resolution/fps/bitrate), Record/Stop, Screenshot. Disabled options for
  unsupported configs (from capability detection, §7).

---

## 6. Pre-scripted scenes + scene generation

### 6.1 Scene descriptor — `src/animator/scenes/sceneTypes.ts`

```ts
export interface SceneDescriptor {
  id: string;
  actors: SceneActor[];             // ONE OR MORE models (see §3). First actor added is the lead.
  environment: EnvironmentSettings; // preset OR custom backdrop + time-of-day + weather + sound (see §6.7)
  steps: SequenceStep[];            // ordered animation steps; each targets an actorId + clip
  cameras?: CameraBookmark[];       // optional camera cuts aligned to steps
  createdAt: string;
}
// Note: SequenceStep (§3) carries an `actorId` so a step drives a specific actor.
// v1 plays each actor's selected clip under the global transport; multi-actor
// choreography (staggered starts, crossfades) is deferred and never faked.

// A backdrop can come from a curated environment preset OR a custom image source.
export type BackgroundRef =
  | { source: "location"; lat?: number; lng?: number; city?: string; landmarkId?: string; imageUrl: string }
  | { source: "upload"; imageUrl: string }
  | { source: "prompt"; prompt: string; imageUrl: string };

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type Weather = "clear" | "rain" | "snow" | "fog" | "overcast";

export interface EnvironmentSettings {
  presetId: string | "custom";     // a curated EnvironmentPreset (§6.7) or a custom backdrop
  background?: BackgroundRef;       // required when presetId === "custom"; else preset supplies it
  timeOfDay: TimeOfDay;             // drives the lighting rig automatically (§6.7)
  weather: Weather;                 // particle/overlay effect (§6.7); "clear" = none
  sound: { ambient: boolean; weatherSfx: boolean; volume: number }; // audio bed (§6.7)
}
```

### 6.2 Scene executor (v1 = honest, no fakery)

v1 plays the scene as an **ordered sequence of clips with hard cuts** at boundaries (switch active action at each
step). Hard-cut sequencing is fully supported by `AnimationMixer` today, so `playSequence` for `hardCut:true`
steps is real. **Crossfades between steps are deferred** — if a step requests a crossfade, the executor either
falls back to a hard cut (documented) or the option is not offered. Camera cuts jump the camera to the step's
bookmark (also real). This lets "pre-scripted scenes" ship without faking crossfades/blending.

### 6.3 Background sources (server) — `server/animator/scenes.ts`

`prepareBackground(req): { bgId, imageUrl }` for three sources:

- **location** — reuse the existing `/api/landmarks?city=` data and/or `navigator.geolocation` lat/lng. Resolve a
  landmark image for the location and store it under `scenes/backgrounds/`. (If a landmark image provider isn't
  wired, accept a provided landmark image URL; do not fabricate imagery.)
- **upload** — user posts an image; validate (mime/size), store under `scenes/backgrounds/`, mirror to bucket.
- **prompt** — reuse the existing `generateImageWithFallback` (Gemini) path already in `server.ts` to render a
  background image from text, then store it. (No new image model; reuse the proven pipeline.)

The background image is composited in the viewport as a backdrop (textured plane / equirect dome behind the
model) so recordings capture avatar + background as one clean frame.

### 6.4 Pre-scripted templates

Ship a few JSON templates under `ANIMATOR_DATA_DIR/scenes/templates/` (or `server/animator/templates/*.json`):
e.g. "Landmark Stroll" (idle → walk → idle with a slow camera push). Templates reference clip names generically;
the executor maps them to the asset's actual clips and **skips steps whose clips don't exist** (never invents a
clip). `GET /api/scenes/templates` lists them.

### 6.5 AR viewer — multi-model cast (decided)

The AR viewer (`LivingAvatarView` → `ARPetStage` / 8thWall `eighthWallAR.ts`) today renders **one** avatar plus
placed **prop** objects (`placed_objects`, `PetObjectKind`). Extend it so the user can bring **additional avatar
models** into the AR scene as a **cast**, reusing the same `SceneActor` model as the animator.

**UI entry (mirrors the animator):** in `LivingAvatarView`, add an **"+ Add model"** action next to the existing
object palette / "Live 3D" controls. It opens the **same avatar asset picker** (reusing `GET /api/avatars`,
`done` + `model_url` only). Selecting an avatar adds it to the AR cast.

**Placement:** a newly added avatar enters "placement" mode and is positioned by the existing AR **hit-test /
tap-to-place** flow (the same mechanism `eighthWallAR.ts` uses for objects — `buildObjectNode` / `syncObjects`),
then anchored. Each cast member gets its own transform on the detected plane.

**Animation (honest v1 scope):**
- The **lead** avatar keeps its full brain (`useAvatarBrain`) exactly as today.
- **Added companions are clip-players**, not full brain agents in v1: each companion loads its GLB, is cloned
  with `SkeletonUtils.clone`, gets its own `AnimationController`, and loops a selected/idle embedded clip. This is
  real (AnimationMixer per companion) and does not fake multi-agent AI. **Multiple brain-driven agents are a
  later phase** and must not be implied in the UI.
- Reuse `src/three/ar/dispose.ts` to tear down companion mixers/graphs on removal or session end.

**Persistence:** cast membership + per-actor transforms persist per avatar-scene via the existing placement
store pattern. Extend the `placed_objects` concept with an **actor kind** that references a source `avatarId`/
`assetId` and a full transform, OR add a sibling `scene_actors` table (recommended — keeps prop objects and
avatar actors cleanly separated). New endpoints in §11 (`/api/ar/:avatarId/cast`). Loading an AR session
rehydrates the lead avatar + saved cast.

**Shared code:** the AR cast and the animator both consume `SceneActor` (§3) and the per-actor
`AnimationController`, so clip discovery, selection, and disposal are one implementation used by both surfaces.
Keep that logic in `src/animator/controller/` and import it from the AR stage — do not duplicate.

**Cost & sizing (`scene_actors` table):** a thin reference table — `id`, `owner_avatar_id` (the AR scene it
belongs to), `source_avatar_id` (which avatar model), `transform` JSON, `selected_clip` varchar, timestamps.
≈200–400 bytes/row; it references existing avatar GLBs (no media duplication). Storage is negligible (100k rows
≈ ~40 MB in the existing MySQL); no new third-party cost. Engineering ≈ 0.5–1 day (one additive migration + 4
CRUD endpoints + a store slice). The meaningful runtime cost of multi-model is **client-side** (each added avatar
is another GLB to download + render), not the table.

### 6.6 Pre-made scripts + voiceover (HeyGen, 8–10 s cap) — reuses existing infra

Scenes can carry a short **voiceover** driven by a **curated, pre-made script**. This reuses the app's existing
HeyGen integration (`heygen.ts` `startTalkingVideo`, env `HEYGEN_API_KEY` + `HEYGEN_DEFAULT_VOICE_ID`, already
deployed) and the `generation_jobs` table — do **not** build a parallel voice pipeline.

**How pre-made scripts are loaded.** Curated scripts are **JSON bundled in the repo** (e.g.
`server/animator/scripts/*.json`), NOT user-authored server-side. On boot the server loads + validates them with
zod, caches them in memory, and serves them read-only via `GET /api/scenes/scripts`. Each entry:

```jsonc
{ "id": "birthday-hello", "title": "Birthday Hello", "category": "greeting",
  "text": "Happy birthday! I can't wait to celebrate with you today.",  // the spoken line
  "estimatedSeconds": 6.5,          // precomputed from word count
  "suggestedClip": "wave" }         // optional; mapped to the actor's real clip or skipped
```

The client renders them as pickable cards. A user may lightly edit the text but stays inside the length cap.

**8–10 second cap (enforced in two places).**
- **Script length:** at ≈2.5 words/sec, cap the spoken line so it fits the window — **≈20 words for 8 s, ≈25 for
  10 s** (a shared `estimateSpeechSeconds(text)` util used client + server; reject/trim over-length text server
  side). Pre-made scripts are pre-validated to fit.
- **Recording duration:** the recorder hard-stops at a configurable `MAX_CLIP_SECONDS` (default **10**), and the
  scene executor caps total step duration to the same. The final muxed clip is trimmed to ≤10 s.

**Voiceover generation + mux (server-side job).** HeyGen returns a talking-photo **video** (720×720, with audio),
not an audio-only stream. So the voiced-scene flow is:
1. Client records the **silent** 3D scene MP4 (§7) and uploads it (`POST /api/animator/recordings`).
2. Client requests voiceover: `POST /api/scenes/voiceover { recordingId, scriptId | text, voiceId? }`
   (`voiceId` defaults to `HEYGEN_DEFAULT_VOICE_ID`).
3. A server job calls `startTalkingVideo({ script, voiceId })`, polls it via the existing HeyGen poller, then uses
   **ffmpeg** to (a) **extract the audio track** from the HeyGen render and (b) **mux** it onto the silent scene
   MP4, trimming to ≤`MAX_CLIP_SECONDS`. Output is a new voiced MP4 saved to `recordings/` + bucket. Originals
   (silent scene + HeyGen render) are preserved.
4. If HeyGen later exposes an **audio-only/TTS** endpoint, swap step 3a to fetch audio directly (skip the video
   render) — the mux stays identical. Do not assume audio-only until confirmed against the account.

**Graceful fallback:** if HeyGen fails or is unconfigured, the scene still produces a **silent** clip (voiceover
is optional, never blocks the recording). Surface the failure; refund reserved credits (mirror the existing
`/api/create-talking-video` refund logic).

**Cost/limits:** each voiced clip = one HeyGen render → your existing `VIDEO_COST` (250 cr) and
`MAX_DAILY_VIDEOS` (5/day) apply; HeyGen also bills per video on their side (verify against your HeyGen plan).
ffmpeg mux is local/free.

### 6.7 Environment presets — settings, time-of-day, weather, sound

Beyond a raw backdrop image, the animator offers **curated environment presets** the user picks from, plus
independent **time-of-day**, **weather**, and **sound** controls that layer on top. All of it is data-driven and
loaded like the scripts/templates (repo-bundled JSON, zod-validated, cached, served read-only via
`GET /api/scenes/environments`).

#### 6.7.1 Preset library (three tiers)

```jsonc
// server/animator/environments/*.json  → EnvironmentPreset
{ "id": "city-park", "tier": "generic", "label": "City Park",
  "backdrop": { "kind": "hdri", "url": "<bucket>/env/city-park.hdr" }, // hdri | dome360 | image | procedural
  "ground": "grass",                                         // ambientCG PBR material id (CC0)
  "allowedWeather": ["clear","rain","fog","overcast"],
  "ambientSound": "park-birds",                              // maps to a CC0 audio asset id
  "defaultTimeOfDay": "afternoon",
  "cameraStart": { "position":[0,1.4,4], "target":[0,0.8,0], "fov":40 },
  "license": "CC0", "source": "ambientcg",                   // provenance (see sourcing note)
  "sourceUrl": "https://ambientcg.com/view?id=..." }
```

- **Basic / simple** (`tier:"basic"`): neutral studio, seamless color cyclorama, plain gradient — cheap,
  fast, distraction-free (reuses the existing studio look; `procedural` backdrop, no external asset).
- **Generic** (`tier:"generic"`): parks, playrooms, backyard, beach, street — everyday settings, backed by a
  matching **CC0 HDRI** from the libraries below (or procedural sky when no HDRI is needed).
- **Captured environments** (`tier:"hdri"`): real, image-based-lit locations sourced **directly from open CC0
  HDRI libraries** — this replaces the earlier "famous sites" idea (which carried copyright risk). The user
  browses/imports from these, and each becomes a preset that lights the model realistically.

**Open-source asset sources (primary):**
- **ambientCG** — <https://ambientcg.com/list?sort=popular> — CC0 HDRIs **and** PBR materials (ground surfaces),
  with a JSON API (`https://ambientcg.com/api/v2/full_json?type=HDRI`). License: **CC0 1.0 (public domain)**.
- **OpenHDRI** — <https://openhdri.org/> — CC0 HDRI collection. License: **CC0**.
- **Your own `.blend` environment library** (`source: "blend"`) — see §6.7.1a. Owned assets, no CC0 constraint.
- Optional: assets generated via the existing prompt pipeline (already license-clean).

**Backdrop kinds:** `hdri`/`dome360` (equirect HDRI → drei `<Environment>` + skybox → real image-based lighting;
default for `generic`/`hdri` tiers), `image` (flat billboard plane, for a user upload/prompt),
`glb-scene` (a 3D environment **mesh** the avatar stands inside — depth/parallax, grounding, occlusion; heavier),
or `procedural` (drei `<Sky>` + `<Stars>` + `<Cloud>` for the `basic` tier and pure sky looks).

**Ground/material surfaces:** ambientCG PBR **Material** sets (albedo/normal/roughness) back the `ground` field
(e.g. `grass`, `sand`, `wood-floor`) so a scene has a matching floor under the HDRI — also CC0.

> **Sourcing & licensing (hard requirement, now low-risk):** ship **only CC0** assets from ambientCG / OpenHDRI,
> **your own `.blend`-derived** assets, or prompt-generated ones. Every preset JSON records `license`
> (`"CC0"` | `"owned"` | `"generated"`), `source` (`"ambientcg"` | `"openhdri"` | `"blend"` | `"prompt"`), and the
> origin `sourceUrl`/asset id or `.blend` filename for provenance. A preset with unknown license must not ship —
> the environment test (§8) asserts a valid `license` on every bundled preset.

**Importing assets (build-time, not runtime):** add `scripts/import-environments.mjs` — pulls a **curated subset**
of CC0 HDRIs/materials from the ambientCG API (and hand-picked OpenHDRI files), downscales/renames to the app's
convention, uploads them to the Backblaze bucket (`storage.ts`), and emits the matching
`server/animator/environments/*.json` preset with `source`/`sourceUrl`/`license` filled in. Do **not** hotlink
the libraries at runtime; mirror to the bucket. This keeps the curated set explicit and offline-safe.

#### 6.7.1a Your own `.blend` environments (via the existing blender-worker)

`.blend` is Blender-native and **cannot be loaded in the browser** (three.js loads glTF/GLB + images/HDRIs, not
`.blend`). But the repo already runs a **headless blender-worker** (`blender-worker/server.js`: `/execute` runs
arbitrary `bpy`, plus `/export-glb`, `/import-glb`, and `.blend` checkpoint load/save). So a small DB of `.blend`
scenes **can** back environments — through a **build-time (or worker) conversion**, never at runtime. Two output
modes, both feeding backdrop kinds that already exist:

- **Render → HDRI / backdrop image** (DEFAULT — a `.blend` is rendered to an HDRI unless the preset explicitly
  sets `backdrop.kind: "glb-scene"`; see the defaults in §14): open the `.blend`
  (`bpy.ops.wm.open_mainfile`), set an equirectangular panoramic camera, render to a 360° `.hdr`/`.exr` (or a flat
  camera render to `.png`), upload to the bucket → preset `backdrop.kind = "hdri"` (or `"image"`). Lightest,
  identical to the ambientCG/OpenHDRI path, mobile-safe, and it lights the model.
- **Export → GLB environment mesh** (`bpy.ops.export_scene.gltf`): the `.blend`'s geometry becomes a `glb-scene`
  backdrop the avatar stands inside (depth/parallax, grounding, occlusion). Heavier — run the export through the
  **lossless glTF-transform `safe` preset** (dedup/prune) and keep the poly/texture budget small for mobile.

**Pipeline & provenance:** add a worker job (e.g. `POST /export-environment` or a `render-equirect` bpy script)
alongside the existing ones. `scripts/import-environments.mjs` gains a `.blend` ingest path: send each `.blend`
to the worker, receive the GLB/HDRI/PNG, mirror to the bucket, and emit the preset JSON with
`source: "blend"`, `license: "owned"` (or whatever you assign), and the source `.blend` filename. The **`.blend`
files are preserved as the source** (store them in the environments DB / bucket, untouched); the GLB/HDRI are the
generated outputs — same preserve-original + new-output contract as the rest of the animator.

> The environment test (§8) accepts `license` ∈ {`"CC0"`, `"generated"`, `"owned"`}; `source: "blend"` presets
> must carry `license: "owned"` (or an explicit license you set) and a `sourceUrl`/source filename.

#### 6.7.2 Time-of-day → automatic lighting — `src/animator/scenes/lightingRig.ts`

A **pure mapping** `timeOfDay → LightingProfile` so lighting adjusts automatically when the user switches
morning/afternoon/evening/night (and it is unit-testable):

```ts
export interface LightingProfile {
  sunElevationDeg: number; sunAzimuthDeg: number;   // drives drei <Sky> + directional light
  sunColor: string; sunIntensity: number;
  ambientColor: string; ambientIntensity: number;   // hemisphere/ambient fill
  exposure: number;                                  // renderer tone-mapping exposure
  showStars: boolean;                                // night
  fogColor?: string; fogDensity?: number;            // dusk/night haze
}
export function lightingFor(timeOfDay: TimeOfDay, preset: EnvironmentPreset): LightingProfile;
```

- **morning** low warm sun, soft fill; **afternoon** high neutral sun, bright; **evening** low golden, long
  shadows, warm; **night** sun off, cool moonlight + `showStars`, low exposure. Applied to a directional light,
  hemisphere/ambient light, `<Sky>` sun position, and renderer exposure — one rig, four presets.
- Preset may bias the profile (e.g. an indoor playroom ignores sun elevation and uses fixed interior lights);
  `lightingFor` merges preset overrides. HDRI presets rotate/dim the environment map per time-of-day instead of
  moving a sun.

#### 6.7.3 Weather animation — `src/animator/scenes/weather/`

Real, GPU-cheap effects only — no faked volumetrics:

- **rain / snow:** instanced `THREE.Points` (or a small InstancedMesh) particle field with a looping shader;
  density + fall speed per intensity. Bounded particle count for mobile.
- **fog / overcast:** scene `fog`/`fogExp2` + reduced sun intensity + desaturated ambient (from the lighting
  profile). Overcast also hides `<Sky>` sun disc / swaps to a flat sky.
- Weather is constrained to each preset's `allowedWeather` (no snow inside a playroom). "clear" renders nothing.
- **Deferred/not faked:** volumetric clouds, lightning, wet-surface reflections, puddles — architected as an
  extensible `WeatherEffect` interface but not shipped until real.

#### 6.7.4 Sound — ambient bed + weather SFX

- **Live preview:** a WebAudio loop (`THREE.AudioListener` + `Audio`) plays the preset's `ambientSound`
  (park birds, room tone, waves) and a weather SFX loop (rain/wind) when weather ≠ clear, mixed at
  `sound.volume`. Curated, license-cleared audio assets bundled/hosted like the backdrops.
- **In the exported clip:** the WebCodecs recorder is video-only, so the scene's **audio bed** (ambient +
  weather SFX + any voiceover from §6.6) is assembled and muxed **server-side with ffmpeg** in the same
  post-record job (§6.6). Generalize that job from "voiceover mux" to "audio-bed mux": layer ambient loop +
  weather SFX (trimmed/looped to clip length) under the voiceover, then mux onto the silent MP4 (≤`MAX_CLIP_SECONDS`).
- Sound is fully optional; muting or missing assets never blocks the render.

#### 6.7.5 Wiring

`EnvironmentSettings` (§6.1) on the scene carries `presetId`, `timeOfDay`, `weather`, and `sound`. The
`AnimatorScreen` "Scene" mode exposes: environment picker (grouped by tier: Basic / Generic / Famous), a
time-of-day segmented control, a weather selector (filtered to `allowedWeather`), and sound toggles + volume.
Changing time-of-day re-runs `lightingFor` live; changing weather swaps the effect; all captured in the
recording (video) + audio-bed mux (audio).

---

## 7. Recording & capture (client)

### 7.1 Capability detection — `src/animator/recording/capabilities.ts`

Pure, injectable detection so selection logic is testable without a browser:

```ts
export interface RecordingCapabilities {
  webCodecs: boolean;                 // 'VideoEncoder' in window
  h264: boolean;                      // isConfigSupported avc1 at target
  supportedResolutions: ("720p"|"1080p")[];
  supportedFps: (24|30|60)[];
  mediaRecorderMp4: boolean;          // MediaRecorder 'video/mp4;codecs=avc1' support
  mediaRecorderWebm: boolean;         // fallback container
}
export async function detectCapabilities(env = globalThis): Promise<RecordingCapabilities>;
```

Uses `VideoEncoder.isConfigSupported({ codec: "avc1.640028"/"avc1.42E01F", width, height, framerate, bitrate })`
for each preset; `MediaRecorder.isTypeSupported(...)` for the fallback.

### 7.2 Encoder selection — `src/animator/recording/selectEncoder.ts` (PURE, unit-tested)

```ts
export interface RecordRequest { resolution:"720p"|"1080p"; fps:24|30|60; bitrateKbps:number; }
export type EncoderChoice =
  | { kind:"webcodecs-mp4"; codec:string }
  | { kind:"mediarecorder-mp4" }
  | { kind:"mediarecorder-webm"; note:string }   // fallback container, documented
  | { kind:"unsupported"; reason:string };
export function selectEncoder(caps: RecordingCapabilities, req: RecordRequest): EncoderChoice;
```

Decision order: WebCodecs H.264 MP4 (preferred, frame-accurate) → MediaRecorder MP4 → MediaRecorder WebM
(clearly flagged as fallback) → `unsupported` (UI disables the exact offending config, never crashes). This
function is a pure mapping and is the primary unit test target for "recording capability selection."

### 7.3 Encoder lifecycle — `src/animator/recording/recorder.ts`

Interface first, one concrete implementation to start:

```ts
export interface Recorder {
  start(): Promise<void>;
  addFrame(bitmap: ImageBitmap | HTMLCanvasElement, timestampUs: number): void;
  stop(): Promise<Blob>;            // finalized MP4 (or fallback) blob
  dispose(): void;
}
```

- **WebCodecsRecorder** (v1 minimal working path): create `VideoEncoder`, configure with the chosen H.264 config,
  mux encoded chunks with `mp4-muxer` (add dep) into an MP4 `Blob`. Frames come from the clean-viewport source
  (§7.4) at a fixed cadence derived from `fps`; drive the animation deterministically (advance `mixer` by
  `1/fps` per captured frame) so the recording is frame-accurate and independent of display refresh.
- **MediaRecorderRecorder** (fallback): wrap `canvas.captureStream(fps)` + `MediaRecorder`.
- Lifecycle is explicit: `start → addFrame* → stop(): Blob → dispose`. Errors in `configure()` surface as an
  `unsupported` result upstream (caught, mapped, UI disables the option).

### 7.4 Clean viewport frame source — `src/animator/capture/viewportSource.ts`

Render the three scene to an **offscreen render target / dedicated canvas** sized to the preset resolution
(1280×720 / 1920×1080), containing **only** the model + background + lighting — no OrbitControls gizmos, no HTML
overlay. `readFrame()` returns an `ImageBitmap`/canvas for the encoder. Because it's a separate render pass, the
on-screen UI never leaks into the frame.

### 7.5 PNG screenshot — `src/animator/capture/screenshot.ts`

`capturePng(): Blob` renders one clean-viewport frame and `canvas.toBlob(_, "image/png")`. Independent of the
recording path so screenshots work even when video encoding is unsupported.

### 7.6 Saving to an application-accessible location

Client uploads the finalized `Blob` to `POST /api/animator/recordings` (and PNG to
`POST /api/animator/screenshots`). The server writes it under `recordings/`/`screenshots/` (the app-accessible
store) and mirrors to the Backblaze bucket via `storage.ts`, returning a URL. A client-side "Download" is offered
as a secondary convenience but the canonical save is server-side.

### 7.7 Presets (exact)

- Resolution: **720p (1280×720)**, **1080p (1920×1080)**.
- FPS: **24 / 30 / 60** — offered only when `isConfigSupported` returns true for that framerate.
- Bitrate: **configurable** (default suggestions: 720p≈8 Mbps, 1080p≈16 Mbps; user-adjustable Kbps field).
- Codec: H.264 (`avc1.640028` High, fallback `avc1.42E01F` Baseline). MP4 container preferred.

---

## 8. Tests (node:test `.mjs` under `tests/`)

Match the existing convention (e.g. `tests/avatar_prompts.test.mjs`, run via `node --test`). Keep logic in pure
modules so tests need no browser/three runtime.

**Unit tests (required):**
- `tests/animator_paths.test.mjs` — **path validation** (traversal `../`, absolute paths, encoded separators,
  symlink rejection, extension allowlist) and **output naming** (`buildOutputName` determinism + collision
  behavior).
- `tests/animator_jobs.test.mjs` — **job parsing** (`parseJobFile` accepts valid, rejects malformed/oversized/
  wrong-type via zod).
- `tests/animator_metadata.test.mjs` — **metadata extraction** where testable: run `inspectAsset` on a tiny
  committed fixture `.glb` (with ≥1 named animation and ≥1 morph target) and assert clip names/count/duration>0,
  morphTargetCount>0. (Fixture kept small; if a fixture is impractical, test the pure metadata-shaping function
  with a synthetic glTF-transform Document.)
- `tests/animator_manifest.test.mjs` — **conversion manifests**: round-trip serialize/parse; invariant that all
  `inputs[].preserved === true` and that output hashes differ from input while input file bytes are unchanged.
- `tests/animator_projects.test.mjs` — **project persistence**: save→load round-trip equality with a
  **multi-actor** scene (≥2 actors, distinct `actorId`s, one asset used twice); rejects corrupt project JSON.
- `tests/animator_scene_actors.test.mjs` — **cast/actor logic** (pure parts): `addActor` assigns unique
  `actorId`s (same `assetId` twice → two actors), `removeActor` prunes correctly, and non-overlapping default
  placement is deterministic. AR cast payload parsing (`scene_actors` row ↔ `SceneActor`) round-trips.
- `tests/scene_scripts.test.mjs` — **voiceover length cap + script loading**: `estimateSpeechSeconds(text)`
  monotonic in word count; the 8–10 s cap accepts ~20–25-word lines and rejects/trims over-length text; bundled
  script JSON validates against the zod schema and every pre-made script's `estimatedSeconds ≤ MAX_CLIP_SECONDS`.
- `tests/scene_environments.test.mjs` — **environment presets + lighting**: every bundled environment JSON passes
  the zod schema and has `license` ∈ {`"CC0"`,`"owned"`,`"generated"`} plus a `source`/`sourceUrl`;
  `lightingFor(timeOfDay, preset)` returns distinct, sane
  profiles for morning/afternoon/evening/night (e.g. night → `sunIntensity` low + `showStars` true, afternoon →
  high sun); weather requested outside a preset's `allowedWeather` is rejected/normalized to "clear".
- `tests/animator_encoder_selection.test.mjs` — **recording capability selection**: `selectEncoder` across a
  matrix of capability objects (WebCodecs on/off, H.264 on/off, fps subsets) yields the documented choice and a
  clean `unsupported` with reason when nothing fits.

**Instrumentation / smoke tests:**
- `tests/animator_viewer_smoke.test.mjs` — importing the viewer screen module and constructing the controller
  with an empty clip list does not throw; a static model (no animations) yields an empty clip list and the
  "no embedded animations" state (not a fabricated clip).
- **Invalid model input** — feeding a non-glTF / truncated file to `inspectAsset` and to the client import path
  produces a graceful typed error, never a crash. (Server side is straightforward node:test; the client screen
  smoke can be a lightweight module-load + reducer test rather than a full DOM render, to avoid heavy tooling.)

---

## 9. Diagnostic script

`scripts/animator-doctor.mjs` (repo-root `scripts/`, consistent with `build-deploy-zip.sh`). Reports:
- Node version + platform.
- `@gltf-transform/cli` availability (`npx gltf-transform --version`) and core/functions import check.
- `ANIMATOR_DATA_DIR` existence + writability + free disk space; creates the tree if missing (`--fix`).
- Presence/writability of `originals/`, `outputs/`, `jobs/*`, `recordings/`, `screenshots/`.
- Bucket env (`MEDIA_BUCKET_*`) presence (mirrors `storage.ts` check).
- Notes that WebCodecs/H.264 support is **browser-side** and validated at runtime by capability detection (the
  script prints the target configs so they can be checked in a browser console snippet it emits).
- Exit non-zero if any hard requirement is missing; human-readable ✓/✗ lines.

Add `"animator:doctor": "node scripts/animator-doctor.mjs"` to `package.json` scripts.

---

## 10. Phasing (ship order)

**Phase 1 — Foundations (this PR):** interfaces/types (§3), `paths.ts` (validation + naming), file queue
skeleton (`enqueue`/`parseJobFile`/state transitions), workspace bootstrap, capability detection + `selectEncoder`,
encoder **lifecycle interfaces**, output-file creation, PNG screenshot, and a **minimal working recording path**
(WebCodecs→MP4 if supported, else graceful disable). Diagnostic script. All §8 unit tests + smoke tests. No
optimize/lossy ops yet.

**Phase 2 — Inspect & lossless convert:** `gltf.ts` inspect + `safe` preset (dedup/prune/pack/unpack),
manifests, asset import, job worker running end-to-end, outputs mirrored to bucket.

**Phase 3 — Scenes & multi-model:** `SceneController` (multi-actor), the **"+ Add model" picker** (reusing
`GET /api/avatars`), actor list/transform UI, scene descriptor with `actors[]`, background prep
(location/upload/prompt), **environment presets** (basic/generic/captured-HDRI, CC0 from ambientCG + OpenHDRI),
**time-of-day lighting rig**,
**weather effects**, **ambient/weather sound + audio-bed mux**, **pre-made voiceover scripts** (HeyGen, 8–10 s
cap), hard-cut sequence executor, camera cuts, templates, project persistence.

**Phase 3b — AR multi-model cast:** "+ Add model" in the AR viewer, hit-test placement of companion avatars,
per-companion clip playback (`SkeletonUtils.clone` + `AnimationController`), `scene_actors` persistence + the
`/api/ar/:avatarId/cast` endpoints. Lead avatar keeps its brain; companions are clip-players (v1).

**Phase 4 — Later (architected, not faked):** crossfades, blended/staggered multi-actor sequencing, multiple
brain-driven AR agents, morph-target UI, camera-bookmark UI, and the opt-in `optimize` preset
(resample/weld/KTX2/Draco) with explicit lossy labeling.

---

## 11. New API calls (endpoints introduced)

All under `requireAuth`, mounted from `server/animator/routes.ts` as `app.use("/api", requireAuth, animatorRouter)`
to match existing conventions. **Assets & jobs**

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/animator/assets` | Import a `.glb`/`.gltf` (from an existing avatar model URL or an upload); copies to `originals/`, returns `AssetMetadata`. Original preserved. |
| `GET` | `/api/animator/assets` | List the user's imported assets. |
| `GET` | `/api/animator/assets/:id` | Asset metadata. |
| `GET` | `/api/animator/assets/:id/inspect` | Full inspection (clips, morph targets, meshes, materials). |
| `POST` | `/api/animator/jobs` | Enqueue a file-queue job `{ assetId, type, preset, params }` → `{ jobId }`. |
| `GET` | `/api/animator/jobs` | List the user's jobs + states. |
| `GET` | `/api/animator/jobs/:id` | Job state (pending/running/done/failed) + error. |
| `GET` | `/api/animator/jobs/:id/manifest` | Conversion manifest (preserved inputs + produced outputs). |
| `GET` | `/api/animator/outputs/:assetId` | List output files for an asset (with bucket URLs). |

**Recordings & screenshots**

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/animator/recordings` | Upload a finalized MP4/WebM blob; saved to `recordings/` + bucket; returns URL. |
| `GET` | `/api/animator/recordings` | List the user's recordings. |
| `POST` | `/api/animator/screenshots` | Upload a PNG screenshot; saved to `screenshots/` + bucket; returns URL. |

**Projects (persistence)**

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/animator/projects` | Create/save a project (scene + animation state + camera bookmarks). |
| `GET` | `/api/animator/projects` | List projects. |
| `GET` | `/api/animator/projects/:id` | Load a project. |
| `PUT` | `/api/animator/projects/:id` | Update a project. |
| `DELETE` | `/api/animator/projects/:id` | Delete a project (never deletes originals/outputs). |

**Scenes & backgrounds**

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/scenes/templates` | List pre-scripted scene templates. |
| `GET` | `/api/scenes/environments` | List curated CC0 environment presets (basic / generic / captured-HDRI, sourced from ambientCG + OpenHDRI), with allowed weather, ambient sound id, default time-of-day, and `source`/`sourceUrl`/`license`. Repo-bundled JSON, read-only. |
| `GET` | `/api/scenes/scripts` | List curated pre-made voiceover scripts (repo-bundled JSON, read-only). |
| `POST` | `/api/scenes/backgrounds` | Prepare a background `{ source: "location"\|"upload"\|"prompt", … }` → `{ bgId, imageUrl }`. |
| `POST` | `/api/scenes` | Create a scene descriptor `{ actors[], background, steps, cameras }` (multi-actor). |
| `GET` | `/api/scenes/:id` | Load a scene descriptor. |
| `POST` | `/api/scenes/voiceover` | Add HeyGen voiceover to a recorded scene `{ recordingId, scriptId\|text, voiceId? }`; server generates audio + ffmpeg-muxes onto the silent clip (≤`MAX_CLIP_SECONDS`); returns voiced MP4 URL. Reuses `generation_jobs` + HeyGen poller + credit/refund logic. |

**AR multi-model cast** (persist companions added in the AR viewer)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/ar/:avatarId/cast` | List cast members (added avatar actors) for this AR scene. |
| `POST` | `/api/ar/:avatarId/cast` | Add a cast member `{ sourceAvatarId, transform, selectedClip? }` → returns `actorId`. |
| `PUT` | `/api/ar/:avatarId/cast/:actorId` | Update a cast member's transform / selected clip. |
| `DELETE` | `/api/ar/:avatarId/cast/:actorId` | Remove a cast member (never deletes the source avatar or its files). |

**Reused (no change):**
- **`GET /api/avatars`** (`fetchAvatars()`) — powers the **"+ Add model" asset picker** in BOTH the animator and
  the AR viewer; no dedicated picker endpoint is added. Only `generation_status === "done"` + `model_url` avatars
  are selectable.
- `/api/landmarks?city=` (location backgrounds), the existing Gemini `generateImageWithFallback` path (prompt
  backgrounds), `storage.ts` uploaders, `requireAuth`/`AuthedRequest`.
- DB: adds a **`scene_actors`** table (recommended) for AR cast persistence; leaves `placed_objects` (prop
  objects) unchanged.

---

## 12. Dependencies to add

- **Server:** `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`,
  `@gltf-transform/cli`.
- **Client:** `mp4-muxer` (WebCodecs→MP4 muxing); optionally `webm-muxer` for the fallback container. three /
  fiber / drei already present. No ffmpeg on the client path (the recorder is video-only).
- **Server:** `ffmpeg` (system binary — already present in the environment) for the **audio-bed mux** step
  (§6.6/§6.7: voiceover + ambient + weather SFX). No new npm package required for muxing; invoke ffmpeg as a
  child process from the post-record job. HeyGen (`heygen.ts`) and `HEYGEN_API_KEY`/`HEYGEN_DEFAULT_VOICE_ID`
  are already wired — reused, not added.
- **Environments:** no new npm — reuse `@react-three/drei`'s `<Sky>`, `<Stars>`, `<Cloud>`, `<Environment>`
  (already installed) for sky/time-of-day/HDRI, and `THREE.Points`/`AudioListener` for weather/sound. Assets are
  **CC0 HDRIs/materials from ambientCG (<https://ambientcg.com>) and OpenHDRI (<https://openhdri.org>)**, imported
  build-time via `scripts/import-environments.mjs` and mirrored to the Backblaze bucket — not code dependencies,
  and not hotlinked at runtime. Each preset records `source`/`sourceUrl`/`license: "CC0"`.

---

## 13. Definition of done (Phase 1)

- [ ] `src/animator/types.ts` + server type mirror compile; `AnimationController` **and `SceneController`** seams
      defined (multi-actor from day one; single actor is just N=1).
- [ ] `paths.ts`: path validation + `buildOutputName` implemented and unit-tested.
- [ ] File queue: `enqueue` + `parseJobFile` + atomic state transitions; unit-tested job parsing.
- [ ] Capability detection + `selectEncoder` (pure) + encoder lifecycle interfaces; unit-tested selection matrix.
- [ ] Minimal WebCodecs→MP4 recording path OR graceful disable when unsupported; PNG screenshot works.
- [ ] Recordings/screenshots saved to the app-accessible store (+ bucket) via new endpoints.
- [ ] `scripts/animator-doctor.mjs` runs and reports environment status.
- [ ] All §8 unit + smoke tests pass under `node --test`; `tsc --noEmit` clean.
- [ ] No original file is mutated; safe preset performs no lossy/geometry/texture/rename/morph-removal changes.
- [ ] Multi-model: the animator opens with the chosen avatar as actor 1 and the **"+ Add model"** picker adds
      more actors (same asset can appear twice); global transport plays all; recording captures all visible actors.
- [ ] AR: **"+ Add model"** adds companion avatars via hit-test placement, each playing its own clip; cast
      persists via `scene_actors` / `/api/ar/:avatarId/cast`; lead avatar's brain is unaffected.
- [ ] Voiceover: pre-made scripts load from repo JSON (`GET /api/scenes/scripts`); the 8–10 s cap is enforced on
      script length and recording duration; `POST /api/scenes/voiceover` produces a voiced MP4 (HeyGen audio +
      ffmpeg mux) reusing existing HeyGen/credit logic, with graceful silent fallback on HeyGen failure.
- [ ] Environments: `GET /api/scenes/environments` lists basic/generic/captured-HDRI presets, all **CC0** from
      ambientCG/OpenHDRI (imported via `scripts/import-environments.mjs`, mirrored to the bucket, `license`
      recorded); selecting a preset sets the backdrop; time-of-day (morning/afternoon/evening/night) auto-adjusts lighting
      via `lightingFor`; weather (rain/snow/fog/overcast) renders real particle/fog effects within
      `allowedWeather`; ambient + weather sound preview live and are muxed into the exported clip.
- [ ] Defaults (§14): a single `defaults.ts` is the source of truth; opening the animator on a fresh model and
      immediately recording — with **zero** user adjustments — yields a well-framed, well-lit, looping, clean clip.

---

## 14. Sensible defaults (baked in)

**Principle: the animator must produce a strong result with zero user input.** Every knob ships with a
default chosen so the *out-of-the-box* clip looks good; the UI only *overrides* defaults. Centralize them in one
source of truth — `src/animator/defaults.ts` (client) and a small `server/animator/defaults.ts` (server) — so
they are testable and tunable in one place, never scattered as magic numbers. A DoD test asserts a fresh scene
built purely from defaults is valid and renderable.

### 14.1 Defaults table

| Area | Default | Why it strengthens the animation |
| --- | --- | --- |
| **Camera framing** | Auto-frame to the model's bounding box on load; ¾-front angle, eye-level, ~14 % headroom; FOV ~40° (35 mm-ish, low distortion) | Subject is always correctly sized and flatteringly angled regardless of model scale. |
| **Model grounding** | Feet snapped to `y=0` (drop to floor via bounding box); centered on origin | No floating/half-sunk models; consistent contact with ground + shadow. |
| **Clip selection** | Auto-pick an **idle** clip by name heuristic (`idle`/`stand`/`breath`); else first clip. **Loop ON**, speed **1.0** | Scene reads as "alive" immediately; looping avoids a dead first/last frame. |
| **New actor placement** | Non-overlapping offset beside existing actors, facing camera, auto-selected idle clip | Added models never spawn inside each other or T-posing. |
| **Environment** | Neutral **studio** (`basic`) for a clean first render; templates may set a richer preset | Predictable, fast, flattering baseline; no asset dependency to start. |
| **Time of day** | **Afternoon** (high neutral sun, bright, soft shadows) unless the preset overrides | Brightest, most universally flattering light. |
| **Weather** | **Clear** (none) | No distracting particles unless intended; best perf. |
| **Backdrop from `.blend`** | **Render→HDRI** unless the preset opts into `glb-scene` (§6.7.1a) | Cheap, mobile-safe, lights the model; heavy mesh only when deliberately chosen. |
| **Renderer** | ACES Filmic tone-mapping, sRGB output, `PCFSoft` shadows, soft contact shadow under model, `antialias:true`, `dpr = min(devicePixelRatio, 2)` | Filmic, anti-aliased look; capped DPR protects mobile perf. |
| **Lighting rig** | Three-light baseline (key/fill/rim) derived from the time-of-day profile even without an HDRI | Never flat or single-lit; readable form on every model. |
| **Sound** | Ambient **on** at ~0.5 volume; weather SFX follow the weather selection | Scenes feel inhabited; SFX stay consistent with visuals. |
| **Voiceover** | **Off** until a script is chosen; when a template supplies a script, on with `HEYGEN_DEFAULT_VOICE_ID`; target ~8 s | No surprise TTS/credits; templates that intend speech just work. |
| **Recording preset** | **1080p / 30 fps / ~16 Mbps**, H.264 High, MP4, clean viewport; **auto-downgrade** 1080p→720p→MediaRecorder→disable per capability (§7.2) | A high-quality default that always degrades gracefully, never errors. |
| **Clip length** | `MAX_CLIP_SECONDS = 10`; default record length = scene length clamped to **8 s** | Enforces the 8–10 s product rule; short, shareable clips. |
| **glTF conversion** | Preset **`safe`** (lossless); `optimize` is always opt-in | Originals never degraded by default. |
| **`.blend`/mesh export** | Auto-run the `safe` prune/dedup on any `glb-scene` export | Keeps environment meshes lean without manual tuning. |
| **Performance tier** | Detect low-power devices; cap weather particle count, shadow-map size, and texture resolution on mobile | Smooth playback + reliable recording on phones. |
| **Project autosave** | Draft autosaved on edit; default name `"<AvatarName> — <date>"` | No lost work; sensible titles. |

### 14.2 Rules

- **One source of truth.** All values above live in `defaults.ts`; components read from it. No inline magic numbers.
- **Defaults are overrides-only.** UI controls change a default, never introduce behavior that only works when a
  user touches them.
- **Honest fallbacks.** Where a default can't be honored (e.g. 1080p H.264 unsupported), the documented
  capability-based downgrade applies (§7.2) — the default degrades, it does not fail.
- **Test:** `tests/animator_defaults.test.mjs` — a scene built solely from `defaults.ts` passes the scene zod
  schema, selects a clip, resolves a valid recording preset from a capable capability set, and stays within
  `MAX_CLIP_SECONDS`.
