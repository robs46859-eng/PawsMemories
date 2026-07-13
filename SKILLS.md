# SKILLS.md — Animator Build-Out Skill Definitions

**Purpose:** executable documentation for coding agents implementing `ANIMATOR_SPEC.md` via `PHASED_IMPLEMENTATION.md`. Each skill is a self-contained capability: what to build/run, exact inputs/outputs, the governing math or rules, and acceptance criteria. Reference these by `Skill_ID` in agent prompts (e.g. "implement ANIM-LIP-02 per SKILLS.md").

---

## 0. Global Ground Rules (ANIM-CORE-00) — applies to every skill

- `npx tsc --noEmit` must pass before any commit (pre-commit hook in `.githooks` enforces it).
- **Never break boot:** optional server/worker deps degrade to 200-with-empty-shape reads, never 503 on read paths (ANIMATOR_FIX_PLAN §1). No `undefined` property reads — guard and type every payload with zod (spec §12).
- **Bundle discipline:** every new client library is lazy-chunked; verify with `npx vite build` that no unexpected chunks ship (lesson of the IWER emulator, ANIMATOR_FIX_PLAN §3).
- **Validation doctrine:** treat outputs as hypotheses. Every job writes a manifest with `validation: [{rule, pass, detail}]`. On failure, adjust parameters and re-run; do not accept degraded output silently.
- Naming: AnimationSet v2 (`src/animator/controller/animationSets.ts`) is the single source of truth for clip names; `blender-worker` clip exports must match it exactly; `src/three/clipMap.ts` fuzzy matching is a safety net only.
- Tests: runtime logic uses `node:test` (NOT Vitest). Worker-side Python uses its existing conventions.
|- Paths referenced below: client `src/animator/`, `src/three/`; server `server/animator/`; worker `blender-worker/`.
|- **Skill docs:** `skills/animator/RIGGING.md` (RIG-01..08, MESH-01/02), `skills/animator/LIPSYNC.md` (LIP-01..05, AUD-01), `skills/animator/MESHOPS.md` (MESH-01..04). Canonical source of ANIM-* IDs and operational constraints.

---

## 1. Rigging Skills

### ANIM-RIG-01 — Canonical Rig Authoring
- **Use when:** creating/updating `assets/rigs/{quadruped,biped,winged}.blend`.
- **Inputs:** species archetype; bone naming contract.
- **Logic:** one armature per archetype with exact bone names: `spine`, `hip`, `chest`, `neck`, `head`, `jaw`, `tongue`, `eye.L/R`, `brow.L/R`, `ear.L/R`, `shoulder.L/R`, `leg_front.L/R`, `leg_back.L/R`, `tail.01..N`. Digitigrade legs get optional metatarsal joint. All clips (ANIM-RIG/RUN skills) are authored against these rigs only — "rig-once, apply-many".
- **Outputs:** `.blend` files + bone-name manifest JSON.
- **Constraints:** never rename bones without migrating every BoneDefinitionProfile and clip.
- **Accept:** worker imports rig, enumerates bones, names match manifest byte-for-byte.

### ANIM-RIG-02 — Profile-Based Auto-Rig
- **Use when:** rigging an uploaded/generated mesh via `POST /rig`.
- **Inputs:** mesh GLB; `BoneDefinitionProfile` (spec §4.1 schema: normalized-bbox joint positions, twistBones, boneMask, rigidAttachments, physics).
- **Logic:** (1) load profile → denormalize joints to mesh bounding box + landmark heuristics; (2) fit canonical armature; (3) auto-weight soft meshes (`ARMATURE_AUTO` heat map); (4) allocate twist bones per profile to prevent candy-wrapper deformation; (5) run ANIM-RIG-04 validation; (6) support **Rebind**: re-fit adjusted joints without redoing weights from scratch.
- **Outputs:** rigged GLB + rig job manifest `{state, profileId, validation[], stats}`.
- **Constraints:** profiles stored in `blender-worker/profiles/*.json`, versioned; unknown version → typed rejection.
- **Accept:** batch of 10 varied meshes → ≥ 8 pass validation unattended (Phase 3 exit).

### ANIM-RIG-03 — Selective Rigging (Soft vs Rigid)
- **Use when:** any multi-mesh asset enters ANIM-RIG-02.
- **Logic:** classify each sub-mesh: **soft** → skin weights; **rigid** (collars, tags, armor, accessories) → parent-attach to nearest bone, zero skinning. Classifier = material-name globs + probe-pose deformation variance test (internal edge-length variance beyond threshold ⇒ rigid). Expose manual per-mesh override in the Animator asset inspector.
- **Why:** prevents "stretchy armor" — rigid items must keep absolute structural integrity through articulation.
- **Accept:** collar/tag stays undeformed through a full run cycle; override toggle round-trips.

### ANIM-RIG-04 — Rig Validation Suite
- **Use when:** after every rig/rebind/repurpose; results go in the manifest.
- **Rules (each emits pass/fail + detail):**
  1. Twist bones present on limb chains flagged in profile.
  2. Neck joints parallel to jawline for protruding-head silhouettes (quadrupeds default true).
  3. Silhouette preservation: probe poses (limb raise) rendered; silhouette deviation vs bind pose < tolerance; on fail auto-nudge clavicle/shoulder X/Y/Z and re-test once.
  4. Biped purlicue: thumb base joint at index/thumb web intersection.
  5. Weight sanity: no vertex with > 4 influences after limit; no island with zero weights.
- **Outputs:** `validation[]` + probe-pose screenshots attached to manifest.
- **Accept:** deliberately mis-fit profile fails rules 2–3; correct profile passes all.

### ANIM-RIG-05 — Bone Masking / Partial Rigs
- **Use when:** asymmetric/incomplete/non-standard models (three-legged pets, birds, robots).
- **Logic:** `boneMask` in profile suppresses bones; retarget (ANIM-RUN-06) filters clip tracks to unmasked bones so the standard clip library still applies. No bespoke rigs.
- **Accept:** three-legged test model rigs and plays `walk` with masked leg tracks dropped, no errors.

### ANIM-RIG-06 — Character Repurposing (Facial Preservation)
- **Use when:** upgrading the body rig of an already-rigged avatar (`POST /repurpose`).
- **Logic:** rebuild body rig from target profile while **preserving facial bones (jaw/tongue/eyes/brows), morph targets, and their animation/viseme tracks untouched**. Re-rig from existing skeleton joints (higher accuracy than raw mesh rigging).
- **Accept:** a speaking avatar re-rigged for the body replays its existing VisemeTrack with identical mouth output.

### ANIM-RIG-07 — ML Rigger Fallback (UniRig / RigNet)
- **Use when:** landmark heuristics fail (irregular scan poses, sculpts) — gated, optional.
- **Logic:** UniRig primary (transformer skeleton-tree prediction + Bone-Point Cross Attention skinning; float16; OBJ/FBX/GLB). RigNet alternative (joint regression → BoneNet/RootNet → volumetric-geodesic skinning; requires remesh to 1K–5K verts via ANIM-MESH-01 first). Output accepted **only** if ANIM-RIG-04 passes; else job → `needs_manual`.
- **Constraints:** never a hard dependency; absence must not affect the standard path.

### ANIM-RIG-08 — Spring-Bone Physics Assignment
- **Use when:** profiles declare `physics[]` (tails, ears, hair, hanging gear).
- **Logic:** per chain `{bones glob, stiffness, damping, gravity}`. Runtime simulation lives in ANIM-RUN-04 (semi-implicit Euler, post-mixer). Optional worker-side baking for export targets needing baked secondary motion.
- **Accept:** tail chain follows locomotion with visible lag/overshoot, stable at 30 and 60 fps (dt-independent).

---

## 2. Lip-Sync Skills

### ANIM-LIP-01 — Rhubarb Tier B Job
- **Use when:** offline viseme generation for any recorded/TTS audio (`lipsync` job).
- **Inputs:** WAV/OGG audio; optional transcript; recognizer choice.
- **Logic:** invoke Rhubarb CLI with `--extendedShapes GHX`; recognizer `pocketSphinx` for English, `phonetic` for non-English/abstract; **always pass `-d dialogFile` when a transcript exists** (major accuracy win on uncommon words). Parse Rhubarb JSON → `VisemeTrack v1` (spec §5.3), then run ANIM-LIP-02.
- **Where:** `server/animator/lipsync.ts`; binary vendored in deploy + worker image backup executor; `animator:doctor` probes it.
- **Accept:** golden corpus (10 clips incl. non-English + jargon-with-dialog-file) within ±1 frame of hand labels.

### ANIM-LIP-02 — VisemeTrack Post-Processor (Transition Rules)
- **Use when:** every VisemeTrack, regardless of source tier.
- **Rules (the craft, encoded):**
  1. **A–C–D bridge:** never A→D directly; insert C.
  2. **C–E–F rule:** pucker via E; E must never be wider than C.
  3. **Anticipation:** shift every cue onset ~2 frames (≈66–83 ms) earlier than audio — the eye perceives shape before the ear resolves sound.
  4. Merge cues shorter than 1 frame at target fps into neighbors.
  5. A = closed **with lip pressure** (P/B/M); X = relaxed idle, **no pressure** — never conflate.
- **Outputs:** normalized track + linter report (rule violations = hard fail).
- **Accept:** linter finds zero violations on processed tracks; injected A→D jump is caught.

### ANIM-LIP-03 — LipSyncPlayer Runtime
- **Use when:** playing any VisemeTrack on an avatar.
- **Logic:** sample track against `AudioContext.currentTime`; cross-fade viseme morphs over 50–80 ms; write to mixer face layer L2 (wins over clip tracks on same targets). Target mapping in priority order: (a) `viseme_A..viseme_X` morphs (map onto 15-target Oculus/MPEG-4 FBA set where present), (b) bone-only fallback: jaw open + lip-corner bones per species table, (c) Tier A amplitude jaw (`src/three/randyVisemes.ts`) as last resort. 2D sprite mode swaps mouth sprites A–X directly.
- **Accept:** tier degradation C→B→A is seamless at runtime; audio/mouth sync holds after seek/pause.

### ANIM-LIP-04 — Tier C Realtime MFCC Classifier
- **Use when:** live microphone or streaming TTS (no offline pass possible).
- **DSP contract:** mono 16-bit in → power mel-spectrogram → **20 MFCCs**, 50 ms FFT window, 10 ms hop; stats mean/std/min/max; nearest-profile classification against per-voice calibration profiles; runs in an `AudioWorklet`.
- **Calibration flow:** user records the vowel/consonant prompt set once per voice; profiles stored per user.
- **Optional Tier C+:** NVIDIA Audio2Face provider interface (regression v2.2 / diffusion v3.0) — audio in, blendshape weights out; provider-gated, never a hard dependency.
- **Accept:** live mic drives mouth with < 150 ms perceived latency; garbage input degrades to X, not flicker.

### ANIM-LIP-05 — speak() Pipeline Integration
- **Use when:** wiring TTS end-to-end.
- **Logic:** `speak(text)` → TTS provider audio (+ transcript) → provider visemes if available (Azure/ElevenLabs timestamps) else ANIM-LIP-01 → VisemeTrack cached on asset (`clips_json.visemeTracks[]`) → synced playback via `server/animator/audioMux.ts`.
- **Accept:** repeated speech of a cached line performs zero recomputation; cache invalidates on new audio.

---

## 3. Animation Runtime Skills

### ANIM-RUN-01 — Layered Mixer
- **Use when:** refactoring `createAnimationController.ts` (Phase 1 core).
- **Layer stack on `THREE.AnimationMixer`:** L0 base locomotion (exclusive, 0.25 s cross-fade) · L1 overlay/partial (additive via `AnimationUtils.makeClipAdditive` + named bone masks through `PropertyBinding` filtering) · L2 face/viseme (ANIM-LIP-03 writes directly, overrides clips) · L3 procedural post-pass (ANIM-RUN-04). Higher layer wins on overlapping tracks, deterministically.
- **Accept:** `tail_wave` additive plays over `walk` without hip pollution; node:test covers layer priority + mask filtering.

### ANIM-RUN-02 — Blend Tree & State Machine
- **Use when:** locomotion + behavior transitions.
- **Logic:** 1D blend space idle↔walk↔run parameterized by normalized speed; cross-fades sync foot-cycle phase (from clip `phaseMarkers`) to kill foot-sliding. Behavior FSM mirrors `BehaviorAction`; transitions declared as data in AnimationSet v2 `transitions: [{from, to, fade, condition}]`; driven by existing brain/needs systems.
- **Accept:** speed sweep 0→1 shows no slide/pop; illegal transitions are unreachable.

### ANIM-RUN-03 — EmoteQueue
- **Use when:** idle life / reactive expressions (EmoteR concept).
- **API:** `emoteQueue.enqueue({clip, layer, priority, holdSec, cooldownSec})`. Queue-processing with priorities; interrupts only same-or-lower priority; starvation-safe; per-emote cooldowns; seamless blend in/out; can be triggered by audio events (ANIM-AUD-01 bark detection → `bark_speak` overlay).
- **Accept:** node:test for scheduling, priority interruption, cooldown; 10-minute idle soak shows varied, non-repeating emotes.

### ANIM-RUN-04 — Procedural Layer (IK + Springs + Look-At)
- **Use when:** post-mixer per-frame pass.
- **Logic:** formalize existing `buildLegIK`, `headLookAt`, `pelvisHeightFromPaws` (`src/three/ar/ik.ts`) as L3; add foot-locking (paw pinned during ground-contact windows from `phaseMarkers`); spring bones per ANIM-RIG-08 (semi-implicit Euler, dt-clamped); look-at with clamped cone + lag.
- **Accept:** paws don't skate on slopes; head tracking never exceeds anatomical cone; springs stable under frame-rate changes.

### ANIM-RUN-05 — Sequencer Extensions & AI In-Betweening
- **Use when:** growing `SceneSequence.ts` / `TheatreWrapper.tsx` into multi-actor projects.
- **Logic:** per-actor lanes (clips, viseme, camera, FX); versioned scene JSON via `server/animator/projects.ts`. In-betweening v1 = heuristic arc-preserving interpolation (Catmull-Rom through keys with velocity matching) selectable per keyframe pair, alongside linear/bezier; provider hook reserved for model-backed interpolation.
- **Accept:** two-actor scene saves/loads losslessly; arc interpolation visibly rounds a linear camera move without overshooting keys.

### ANIM-RUN-06 — Clip Retargeting at Scale
- **Use when:** worker `POST /retarget` / batch production.
- **Logic:** copy canonical actions onto per-avatar armature (NLA/action retarget); filter tracks by `boneMask`; export ONE GLB with all actions as glTF animation tracks (`export_animations=True`, `export_nla_strips=True`), Draco or meshopt compressed; clip names exactly per AnimationSet v2. Server flow: status `retargeting` → `baking_clips` → upload → `updateAvatarRiggedModel(avatarId, phone, url, clips)` → `done`.
- **Accept:** full clip set retargets to every rigged avatar in one batch job; automated playback sweep (every clip, screenshot strip, foot-slide metric) passes.

---

## 4. Mesh Processing Skills

### ANIM-MESH-01 — QEM Simplification & LOD Chain
- **Use when:** every asset optimize job; pre-remesh for ANIM-RIG-07.
- **Math:** vertex error **E(v) = vᵀQv**, Q = Σ fundamental quadrics of incident planes; collapse edges by minimal error; optimal position from ∇E = 0.
- **Implementation:** meshoptimizer via gltf-transform `simplify()`. LOD0 (src) / LOD1 ≈ 50% / LOD2 ≈ 15% / LOD3 ≈ 5%, switched by screen-space error.
- **Outputs:** LOD manifest `{lods: [{level, triangles, maxQuadricError, sizeBytes, url}]}` — errors reported, budgets enforced.
- **Accept:** LOD3 hero pet renders within error budget; manifest numbers reproducible.

### ANIM-MESH-02 — Topology Validation & Repair (pre-rig gate)
- **Use when:** before any rig job.
- **Checks:** Euler characteristic **χ = V − E + F = 2(c − g) − b** vs expected genus/components; **generalized winding number** w(p) = (1/4π) Σ Ω_t(p) for inside/outside on imperfect meshes → detect flipped normals + enclosed junk; non-manifold edge detection.
- **Repair:** gltf-transform custom transform for light fixes; Blender mesh-cleanup ops in worker for heavy repairs. Unfixable → job fails with rule detail, never a silent pass.
- **Accept:** corpus of deliberately broken meshes is rejected/repaired with correct rule attributions.

### ANIM-MESH-03 — Poisson Reconstruction (scan on-ramp)
- **Use when:** point cloud → animatable mesh (`reconstruct` job; SnapGen convergence).
- **Math/procedure:** solve **∆χ = ∇·V** (indicator function Laplacian = divergence of oriented normals); adaptive octree discretization, **depth ≤ 10 default**; Marching-Cubes isosurface → watertight mesh. Pre-smooth noisy clouds with Moving Least Squares.
- **Executor:** Open3D in worker.
- **QA:** deviation color-map (reconstructed surface vs source points); tolerance gate before rigging; on breach, refine local octree depth or interpolation weights and re-run (validation doctrine).
- **Accept:** scanned cloud → watertight mesh → passes ANIM-MESH-02 → rigs via ANIM-RIG-02.

### ANIM-MESH-04 — Compression & Packing Standard
- **Use when:** every export.
- **Logic:** meshopt (`EXT_meshopt_compression`, preferred for web decode speed) or Draco per target; KTX2/Basis textures; standard passes `prune()`, `dedup()`, `palette()`; LSCM UV unwrap in worker when source UVs missing/degenerate; optional Catmull-Clark subdivision for hero close-ups (runtime stays on base cage).
- **Accept:** size deltas reported per job; decoded asset visually identical (no UV seams introduced).

---

## 5. Audio & Capture Skills

### ANIM-AUD-01 — Audio Analysis DSP
- **Use when:** Tier C features, emote triggers, sequencer audio lane.
- **Contracts:** *Spectrogram:* resample 22.05 kHz → STFT (512 Hann, 128 stride) → 128 mel bins → dB → uint8 224×224 (feeds future classifiers, e.g. bark/meow → EmoteQueue). *MFCC:* per ANIM-LIP-04. *Envelope/onset:* amplitude + onset detection for beat-synced sequencer markers.
- **Implementation:** meyda or hand-rolled AudioWorklet client-side; librosa-equivalent in worker offline.
- **Accept:** onsets on a click track land within ±1 frame; spectrogram output matches reference fixture hash.

### ANIM-CAP-01 — Capture & Export
- **Use when:** exporting scenes.
- **Logic:** keep MediaRecorder; add WebCodecs render-on-demand path (fixed fps, render per frame, never realtime-drop) behind `capabilities.ts` gate. **Color:** render linear, encode sRGB once (threshold 0.04045, exponent 2.4) — no double gamma; verify with ramp asset. Targets: WebM/MP4, PNG sequence (ZIP), and `bake` job → GLB with scene animation baked as clips. Audio muxed via `audioMux.ts`, VisemeTrack-synced.
- **Accept:** frame-count exact at target fps on a heavy scene; ramp asset round-trips within tolerance; baked GLB replays the scene.

---

## 6. Agent Personas (map into AGENTS.md)

| Persona | Mapped skills | Operational constraints |
|---|---|---|
| **Rig Technician** | ANIM-RIG-01..08, ANIM-MESH-01/02 | Must pass ANIM-RIG-04 before completing; octree depth ≤ 10; never rename canonical bones |
| **Lip-Sync Director** | ANIM-LIP-01..05, ANIM-AUD-01 | Extended shapes GHX always on; anticipation 2 frames; dialog file mandatory when transcript exists |
| **Asset Optimizer** | ANIM-MESH-01..04 | LOD error budgets enforced; report sizes; no silent quality loss |
| **Runtime Engineer** | ANIM-RUN-01..06, ANIM-CAP-01 | node:test coverage for all scheduling/blending logic; tsc clean; lazy-chunk new deps |

**Prompt recipe:** "Acting as {Persona}, implement {Skill_ID(s)} per SKILLS.md and ANIMATOR_SPEC.md §{n}, within Phase {k} scope of PHASED_IMPLEMENTATION.md. Honor ANIM-CORE-00. Deliver the acceptance evidence listed on each skill."
