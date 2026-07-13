# ANIMATOR_SPEC.md — Animator Build-Out Specification

**Status:** SPEC — authoritative design for the next-generation Animator.
**Companion doc:** `PHASED_IMPLEMENTATION.md` (phased goals, no timelines).
**Reference corpus:** AccuRIG Multi-Mesh Humanoid spec, Automated Rigging & Lip-Sync Integration plan, 2D Lip-Sync Primer, Animation Logic Formulae directory, Engineering Formula tables, SKILLS.md/AGENTS.md agentic framework.

---

## 1. Purpose & Scope

Evolve the current Animator (Theatre.js sequencer + R3F viewport + gltf-transform asset pipeline + blender-worker) into a full **animation production studio**: automated rigging for arbitrary uploaded meshes, phoneme-accurate lip-sync, layered/blended animation runtime, procedural motion, mesh optimization with formal quality metrics, and an agentic automation layer.

**In scope:** rigging automation, viseme/lip-sync engine, animation runtime & sequencing, asset/mesh processing, audio analysis, capture/export, agent skill definitions.
**Out of scope:** avatar generation itself (Tripo pipeline), billing, AR device features (covered by AR_PET_SIM_SPEC).

---

## 2. Current State (baseline being extended)

| Area | What exists today |
|---|---|
| Sequencer | `@theatre/core` + `@theatre/studio` via `TheatreWrapper.tsx`; `SceneSequence.ts` |
| Runtime | three.js `AnimationMixer` in `createAnimationController.ts`; fuzzy clip resolution in `src/three/clipMap.ts`; procedural fallback in `AvatarModel.tsx` |
| IK | `buildLegIK`, `headLookAt`, `pelvisHeightFromPaws` (`src/three/ar/ik.ts`) |
| Rigging | Manual/spec'd canonical quadruped rig (`BLENDER_RIG_PIPELINE.md`); `blender-worker` with `skeletal-clips.js` (quadruped), `skeletal-clips-human.js` (biped), `bonemap.json` |
| Clip sets | `animationSets.ts`: quadruped (9), biped (6), winged (4) expected clips |
| Lip-sync | Tier A only — amplitude sine-wave jaw via SpeechSynthesis (`randyVisemes.ts`) |
| Assets | `server/animator/` — gltf-transform inspect/convert/optimize jobs, environments, scene scripts, `audioMux.ts` |
| Capture | `src/animator/capture` + `recording` (MediaRecorder encoder, capability detection) |

Everything below is **additive**; the fuzzy clip resolver and `updateAvatarRiggedModel` contract mean new rigged assets light up without app changes.

---

## 3. Target Architecture

```
┌──────────────────────────── Client (src/animator) ────────────────────────────┐
│  AnimatorScreen                                                               │
│  ├─ Sequencer (Theatre.js) ── timeline, keyframes, AI in-betweening           │
│  ├─ AnimationRuntime ──── mixer layers, blend tree, state machine, EmoteQueue │
│  ├─ LipSyncEngine ─────── viseme track player, morph/bone drivers, Tier A/B/C │
│  ├─ ProceduralLayer ───── IK, spring bones, look-at, secondary motion         │
│  └─ Capture ───────────── MediaRecorder / WebCodecs, sRGB-correct export      │
├──────────────────────────── Server (server/animator) ─────────────────────────┤
│  Asset pipeline (gltf-transform): inspect → validate → optimize → LOD chain   │
│  RigService: rig jobs → blender-worker;  LipSyncService: Rhubarb CLI jobs     │
│  Job queue (existing queue.ts, extended job types)                            │
├──────────────────────────── blender-worker (Render) ──────────────────────────┤
│  AutoRig module (Rigify-based canonical rigs, selective rigging, bone masks)  │
│  Retarget module (clip library → per-avatar armature)                         │
│  Bake/export (glTF animations, Draco, LODs)                                   │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Module RIG — Automated Rigging Framework

Implements the AccuRIG standards and the "rig-once, apply-many" doctrine on our own stack (Blender/Rigify inside `blender-worker`), with optional ML riggers for irregular meshes.

### 4.1 Canonical rigs & Savable Bone Definitions
- Author canonical armatures once: `assets/rigs/quadruped.blend`, `biped.blend`, `winged.blend` (bone names per `BLENDER_RIG_PIPELINE.md`: `spine`, `hip`, `shoulder.L/R`, `leg_front.L/R`, `neck`, `head`, `jaw`, `tail.01..`, `ear.L/R`, plus `tongue`, `eye.L/R`, `brow.L/R` for facial work).
- **Bone Definition Profiles** (JSON, stored per species/breed in `blender-worker/bonemap*.json` lineage): named joint positions relative to normalized bounding box + landmark heuristics. Profiles are savable and re-appliable → batch rigging of similar body types with a single profile, with a **Rebind** operation to adjust outliers without restarting.

```jsonc
// BoneDefinitionProfile v1
{
  "id": "quadruped.dog.medium",
  "skeleton": "quadruped",
  "version": 1,
  "joints": { "hip": [0.5, 0.62, 0.18], "head": [0.5, 0.78, 0.92], "...": "normalized bbox coords" },
  "twistBones": { "leg_front.L": 1, "leg_front.R": 1 },
  "boneMask": [],            // suppressed bones for partial/asymmetric models
  "rigidAttachments": [],    // mesh-name globs to parent-attach, not skin
  "physics": [ { "bones": ["tail.*"], "type": "spring", "stiffness": 0.35, "damping": 0.8 } ]
}
```

### 4.2 Selective Rigging (soft mesh vs rigid attachment)
- Classify sub-meshes at import: **soft** (body, cloth → auto skin weights) vs **rigid** (collars, tags, armor, accessories → parent-attach to nearest bone, *no* skin weights). Prevents the "stretchy armor" artifact.
- Heuristic classifier: material name globs + per-submesh deformation variance test (rig a probe pose; if internal edge-length variance would exceed threshold, flag rigid). Manual override in UI (per-mesh toggle in the Animator's asset inspector).

### 4.3 Joint placement standards (validation rules, enforced by worker)
Encoded as automated post-rig checks with warnings surfaced in the job manifest:
- **Thumb/purlicue rule** (biped): thumb base joint at index/thumb web intersection.
- **Neck ∥ jawline** for protruding-head silhouettes (most quadrupeds) to avoid facial distortion on head turn.
- **Clavicle/shoulder silhouette preservation**: post-rig probe pose (arm/leg raise) must keep silhouette deviation < tolerance; otherwise auto-nudge clavicle X/Y/Z and re-test.
- **Twist bone allocation** on limbs to prevent mesh wringing (candy-wrapper) on rotation.
- **Digitigrade support**: leg chains accept an extra metatarsal joint; enabled per profile.

### 4.4 Bone Masking & partial rigs
- Any profile may suppress bones (`boneMask`). Standard clip data is filtered to unmasked tracks at retarget time → humanoid/quadruped clip libraries apply to non-standard creatures (three-legged pets, birds, robots) without bespoke rigs.

### 4.5 Character Repurposing (re-rig with preservation)
- Re-rigging an already-rigged asset must **preserve facial bones and their animation tracks** (jaw/tongue/eye/brow + morph targets) while rebuilding the body rig. Guarantees existing lip-sync/viseme data survives body-rig upgrades.

### 4.6 ML rigger fallbacks (irregular scans/sculpts)
- **UniRig** (transformer skeleton prediction + Bone-Point Cross Attention skinning) as primary ML fallback when landmark heuristics fail (OBJ/FBX/GLB in, float16).
- **RigNet** (joint regression → BoneNet/RootNet connectivity → volumetric-geodesic skinning) as research alternative; requires remesh to 1K–5K verts first (see MESH module).
- Confidence gate: ML rig accepted only if it passes §4.3 validation; otherwise job falls back to `needs_manual` status.

### 4.7 Physics & secondary
- Spring-bone attributes assigned per profile (tails, ears, hair, hanging gear): stiffness/damping/gravity per chain. Runtime implementation in ProceduralLayer (§6.4); Blender-side baking optional for export targets that need baked secondary motion.

### 4.8 Worker API (extends existing `/retarget-and-export`)
```
POST /rig            { meshGlbUrl|base64, profileId?, options } → { rigJobId }
POST /retarget       { riggedGlb, clipSet, boneMask? }          → { glbBase64, clips[] }
POST /repurpose      { riggedGlb, targetProfileId }             → { glbBase64, preserved: {facial:true} }
GET  /rig/:id        → { state, validation: [{rule, pass, detail}], manifest }
```
Server orchestrates via new job types `rig`, `retarget`, `repurpose` in `server/animator/queue.ts`; statuses reuse `retargeting` / `baking_clips`; completion calls `updateAvatarRiggedModel`.

---

## 5. Module LIP — Lip-Sync & Viseme Engine

Three tiers, all emitting a single normalized **VisemeTrack** consumed by one runtime player.

### 5.1 Viseme standard: Preston Blair / Hanna-Barbera A–F + extended G, H, X
| Shape | Mouth | Phonemes | Notes |
|---|---|---|---|
| A | Closed, firm lip **pressure** | P, B, M | distinct from X |
| B | Slightly open, teeth clenched | K, S, T, EE | |
| C | Open neutral | EH, AE | bridge shape |
| D | Wide open | AA | |
| E | Slightly rounded (never wider than C) | AO, ER | bridge to F |
| F | Puckered pinch | UW, OW, W | |
| G | Upper teeth on lower lip | F, V | extended |
| H | Open w/ raised tongue | long L | extended; only if tongue visible |
| X | Relaxed closed (idle) | silence | **no** lip pressure |

**Transition rules (enforced by the track post-processor):**
1. **A–C–D bridge:** never jump A→D directly; insert C in-between.
2. **C–E–F rule:** pucker via E; E must not be wider than C.
3. **Anticipation:** shift each viseme onset **~2 frames (≈66–83 ms) earlier** than the audio event — the eye perceives shape before the ear resolves sound.
4. Cues shorter than 1 frame at target fps are merged into neighbors.

### 5.2 Tier A (existing, kept): amplitude jaw
`randyVisemes.ts` sine-wave jaw stays as zero-dependency fallback and for SpeechSynthesis voices.

### 5.3 Tier B (new, primary): offline **Rhubarb Lip Sync CLI** on the server
- New `server/animator/lipsync.ts` + job type `lipsync`. Binary vendored in the deploy (Linux x64) and in `blender-worker` image as backup executor.
- Recognizers: `pocketSphinx` (English), `phonetic` (non-English/abstract). Selected per request.
- **Dialog file always supplied when transcript is known** (`-d`), materially improving recognition of uncommon words.
- Output: Rhubarb JSON → normalized VisemeTrack; `--extendedShapes GHX` on by default.

```jsonc
// VisemeTrack v1 (stored alongside clips_json)
{
  "version": 1, "fps": 30, "source": "rhubarb|mfcc|provider",
  "audioUrl": "…", "durationSec": 4.2,
  "cues": [ { "t": 0.00, "v": "X" }, { "t": 0.35, "v": "D" }, { "t": 0.47, "v": "C" } ],
  "anticipationSec": 0.07
}
```

### 5.4 Tier C (new, realtime): MFCC classification (uLipSync approach)
- Client-side `AudioWorklet`: mono 16-bit input → power mel-spectrogram → **20 MFCCs** (50 ms FFT window, 10 ms hop; stats mean/std/min/max) → nearest-profile viseme classification against calibrated per-voice profiles.
- Used for live microphone input and streaming TTS where offline processing is impossible.
- Optional Tier C+ integration point: **NVIDIA Audio2Face** (regression v2.2 / diffusion v3.0) behind a provider interface for cinematic quality — audio in, full facial blendshape weights out. Provider-gated, never a hard dependency.

### 5.5 Rendering targets
- **3D morph targets:** avatar heads expose `viseme_A..viseme_X` morphs (15-target Oculus/MPEG-4 FBA superset acceptable — map A–X onto it); jaw bone co-driven for exaggeration.
- **Bone-only rigs** (current pets): map visemes to `jaw` open amount + lip corner bones via a per-species table; degrade gracefully to Tier A jaw curve.
- **2D sprite mode** (Randy 2D / future SnapGen): swap mouth sprites A–X directly.
- Player: `LipSyncPlayer` samples the VisemeTrack against `AudioContext.currentTime`, applies transition rules §5.1, cross-fades morphs over 50–80 ms.

### 5.6 TTS pipeline integration
`speak(text)` flow: TTS provider → audio + (transcript) → Tier B job (or provider visemes if available e.g. Azure/ElevenLabs timestamps) → VisemeTrack cached on the asset → playback synced via `audioMux.ts`.

---

## 6. Module RUN — Animation Runtime & Sequencer

### 6.1 Layered mixer (replaces single-action playback)
Formalize `createAnimationController.ts` into a layer stack on `THREE.AnimationMixer`:
- **L0 Base locomotion** (full-body, exclusive, cross-fade 0.25 s)
- **L1 Overlay/partial** (additive or masked-bone clips: `tail_wave`, `head_tilt`, `ear_flick`) via `AnimationUtils.makeClipAdditive` + per-layer bone masks (`PropertyBinding` filtering)
- **L2 Face/viseme** (LipSyncEngine writes morphs/jaw directly, wins over clip tracks on the same targets)
- **L3 Procedural** (IK, look-at, spring bones — applied post-mixer each frame)
Deterministic priority: higher layer overrides lower on overlapping tracks.

### 6.2 Blend tree & state machine
- Locomotion blend space: `idle ↔ walk ↔ run` blended by normalized speed parameter (1D blend), matching foot-cycle phase to avoid sliding (phase sync on cross-fade).
- Behavior state machine mirrors `BehaviorAction` set; transitions declared in data (`animationSets.ts` extended with `transitions: {from, to, fade, condition}`), driven by the existing brain/needs systems.

### 6.3 EmoteQueue (EmoteR concept)
- Queue-processing randomizer for idle life: schedules timed expressions/emotes with priorities, cooldowns, and seamless blending; can be linked to audio analysis (bark → `bark_speak` overlay). API: `emoteQueue.enqueue({clip, layer, priority, holdSec})`; starvation-safe; interrupts only same-or-lower priority.

### 6.4 ProceduralLayer
- Existing IK (`buildLegIK`, `headLookAt`, `pelvisHeightFromPaws`) formalized as post-mixer pass with foot-locking (paw pinning during ground contact windows derived from clip metadata).
- **Spring bones** runtime (tails/ears): semi-implicit Euler per chain, params from BoneDefinitionProfile §4.7.
- Look-at with clamped cone + lag for natural head tracking.

### 6.5 Sequencer (Theatre.js) extensions
- Multi-actor tracks: per-actor clip lanes + viseme lane + camera lane + FX lane; `SceneSequence.ts` grows into a project document (versioned JSON stored via `server/animator/projects.ts`).
- **AI in-betweening:** for keyframed object/camera props, offer AI-suggested interpolation (motion-aware easing / arc preservation) as an alternative to linear/bezier — implemented first as heuristic arc interpolation (Catmull-Rom through keys with velocity matching), with an optional model-backed provider later.

### 6.6 Clip library expansion & naming reconciliation
- **Reconcile names first:** `animationSets.ts` expects `tail_wave`/`head_tilt`/`play-bow` while `blender-worker/skeletal-clips.js` authors `tail_wag`/`bark_speak`/etc. Single source of truth becomes AnimationSet v2; worker clip names must match it exactly (the fuzzy `clipMap.ts` resolver stays as a safety net, not the contract).
- Target ≥ 15 quadruped clips: existing set + `ear_flick`, `paw_offer`, `roll_over`, `beg`; biped gains `talk_gesture`, `point`, `clap`; winged gains `hover`, `preen`. All authored on canonical rigs → retarget everywhere.

---

## 7. Module MESH — Asset & Mesh Processing

Extends `server/animator/gltf.ts` jobs with formally-grounded operations:

### 7.1 Simplification — Quadric Error Metrics (QEM)
- Error of vertex `v` (homogeneous column vector): **E(v) = vᵀ Q v**, `Q` = Σ fundamental quadrics `K_p` of incident planes. Iterative edge collapse ordered by minimal error; optimal vertex position from solving `∇E = 0`.
- Implementation: `meshoptimizer` (`simplify`) via gltf-transform `simplify()`; QEM math documented here is the acceptance basis: report max/mean quadric error per LOD in the job manifest.
- LOD chain generation: LOD0 (source), LOD1 (≈50%), LOD2 (≈15%), LOD3 (≈5%) with screen-space error thresholds; exported as separate GLBs or `MSFT_lod`.

### 7.2 Compression & packing
- Draco (already in worker) or **meshopt** (`EXT_meshopt_compression`) — pick per target (meshopt preferred for web runtime decode speed); KTX2/Basis texture transcode; `prune()`, `dedup()`, `palette()` steps standard.

### 7.3 Topology validation (pre-rig gate)
- **Euler characteristic** χ = V − E + F = 2(c − g) − b — verify expected genus/components before skinning; unexpected χ → warn.
- **Generalized winding number** w(p) = (1/4π) Σ Ω_t(p) for robust inside/outside tests on imperfect meshes (self-intersections, holes) — used to detect inverted normals and enclosed junk geometry.
- Non-manifold edge and flipped-normal detection + auto-repair pass (gltf-transform custom transform; heavy repairs delegated to worker using Blender's mesh cleanup ops).

### 7.4 Scan/photogrammetry input (SnapGen convergence)
- **Poisson Surface Reconstruction** for point-cloud → watertight mesh: solve ∆χ = ∇·V (indicator function whose Laplacian matches divergence of oriented normals), adaptive octree discretization (depth ≤ 10 default), Marching-Cubes isosurface extraction. Executor: Open3D in a worker job (`reconstruct`).
- **Moving Least Squares** smoothing for noisy clouds pre-Poisson.
- Deviation analysis: color-map distance between reconstructed surface and source points; tolerance gate before the asset enters the rig pipeline.

### 7.5 UVs & subdivision
- **LSCM** (least-squares conformal maps) for automatic UV atlas when source UVs are missing/degenerate (Blender `uv.unwrap` in worker).
- Optional **Catmull-Clark** subdivision (OpenSubdiv-compatible rules) for close-up hero shots; runtime stays on the base cage.

---

## 8. Module AUD — Audio Analysis

Shared client/server DSP utilities backing Tier C lip-sync, emote triggers, and the sequencer's audio lane:
- **Spectrogram script:** resample 22.05 kHz → STFT (512 Hann, 128 stride) → 128 mel bins → dB → uint8 224×224 (for any future ML classifiers, e.g. bark/meow detection driving EmoteQueue).
- **MFCC script:** 20 coefficients from power mel-spectrogram, 50 ms window/10 ms hop (Tier C features).
- Amplitude envelope + onset detection for beat-synced sequencer markers.
- Implementation: `meyda` (or hand-rolled AudioWorklet DSP) client-side; `librosa`-equivalent in worker for offline jobs.

---

## 9. Module CAP — Capture & Export

- Keep MediaRecorder path; add **WebCodecs** encoder when available (existing `capabilities.ts` gate) for frame-accurate export at fixed fps (no dropped frames on heavy scenes — render on demand, not realtime).
- **Color correctness:** capture in linear, encode with proper sRGB transfer (threshold 0.04045, exponent 2.4) — no double-gamma; verify with a ramp test asset.
- Export targets: WebM/MP4 (existing), image sequence (PNG/ZIP), and **GLB with baked animation** (scene → single exported clip via worker `bake` job) so animator scenes are reusable as assets.
- Audio: mux VisemeTrack-synced audio via existing `audioMux.ts`.

---

## 10. Module AGENT — Agentic Skill Layer (SKILLS.md / AGENTS.md)

Per the agentic framework doc, encode the pipeline as executable documentation so coding agents (and the Blender MCP) can operate it deterministically:

- `skills/animator/RIGGING.md` — canonical rig conventions, BoneDefinitionProfile schema, §4.3 validation rules as checklists, worker API.
- `skills/animator/LIPSYNC.md` — viseme table, transition rules, Rhubarb invocation (recognizer choice, dialog-file mandate), VisemeTrack schema.
- `skills/animator/MESHOPS.md` — QEM/LOD policy, topology gates (χ, winding number), Poisson parameters, deviation-analysis procedure.
- `AGENTS.md` additions — personas: **Rig Technician** (mapped: RIGGING, MESHOPS; constraints: octree depth ≤ 10, must pass §4.3 before completing), **Lip-Sync Director** (mapped: LIPSYNC; constraints: extended shapes on, anticipation 2 frames), **Asset Optimizer** (mapped: MESHOPS; constraints: LOD error budgets).
- Validation doctrine: agents treat outputs as hypotheses — every job manifest includes rule-by-rule pass/fail (`validation[]`), and agents must re-run with adjusted parameters on failure rather than accept degraded output.

---

## 11. Library & Tooling Matrix

| Library / Tool | Role | Where | Status |
|---|---|---|---|
| three.js + @react-three/fiber/drei | Runtime, viewport | client | existing |
| @theatre/core + studio | Sequencer/timeline | client | existing |
| @gltf-transform/* | Asset inspect/optimize | server | existing |
| **meshoptimizer** (+ EXT_meshopt) | QEM simplify, compression | server | add |
| **Rhubarb Lip Sync CLI** | Tier B viseme generation | server + worker | add |
| **meyda** (or custom AudioWorklet DSP) | MFCC/spectrogram (Tier C, triggers) | client | add |
| **Open3D** | Poisson reconstruction, MLS, cloud ops | worker | add |
| Blender + **Rigify** | Canonical rigs, auto-weight, retarget, LSCM, cleanup | worker | extend |
| **UniRig** | ML auto-rig fallback | worker (GPU opt.) | add (gated) |
| RigNet | Research alternative rigger | worker | optional |
| NVIDIA Audio2Face | Cinematic facial provider | external API | optional (provider iface) |
| KTX-Software (toktx/Basis) | Texture transcode | server | add |
| **WebCodecs** | Frame-accurate export | client | add (feature-gated) |
| draco3d | Geometry compression | worker | existing |
| MeshLab / CGAL | Offline mesh QA (Hausdorff, repair) | dev tooling | optional |

Hard rule: every new client library must be lazy-chunked (lesson of the IWER emulator bloat in `ANIMATOR_FIX_PLAN.md` §3); every optional server/worker dep must degrade to a 200-with-empty-shape read path, never a 503 boot failure (ibid. §1).

---

## 12. Data Contracts (new/changed)

1. **BoneDefinitionProfile v1** — §4.1. Stored: `blender-worker/profiles/*.json`, served via `GET /api/animator/rig-profiles`.
2. **VisemeTrack v1** — §5.3. Stored with asset metadata; referenced from `clips_json` as `{ visemeTracks: [...] }`.
3. **Rig job manifest** — `{ state, profileId, validation: [{rule, pass, detail}], stats: {boneCount, skinnedVerts, rigidAttachments} }`.
4. **LOD manifest** — `{ lods: [{level, triangles, maxQuadricError, sizeBytes, url}] }`.
5. **AnimationSet v2** — adds `transitions[]`, `layers` (default layer per clip), `masks` (named bone masks), `phaseMarkers` (foot contacts) to `animationSets.ts`.
All schemas versioned; server validates with zod; unknown-version payloads rejected with typed errors (never `undefined` reads — see ANIMATOR_FIX_PLAN root cause).

---

## 13. Validation & QA

- **Rig QA:** §4.3 rule suite automated in worker; probe-pose silhouette deviation screenshots attached to job manifest; χ/winding-number topology gate pre-rig.
- **Lip-sync QA:** golden-audio corpus (10 clips incl. non-English + jargon w/ dialog files); assert cue timing vs hand-labeled reference within ±1 frame; transition-rule linter over generated tracks (no A→D jumps, E ≤ C width).
- **Mesh QA:** per-LOD quadric error budget; optional Hausdorff distance check vs LOD0.
- **Runtime QA:** node:test units for layer priority, EmoteQueue scheduling, blend-space phase sync; Playwright smoke: load asset → play clip → speak line → capture 2 s → assert non-black frames and audio track present.
- **Capture QA:** sRGB ramp asset round-trip; fps accuracy assert with WebCodecs path.
- **Regression guard:** `tsc --noEmit` pre-commit hook stays authoritative; `animator:doctor` extended to check Rhubarb binary, meshoptimizer, and worker reachability.

---

## 14. Non-Goals

- No Character Creator / iClone / Mixamo runtime dependency — their **standards** (selective rigging, bone definitions, masking, repurposing) are implemented on our Blender/Rigify + web stack.
- No Unity/Unreal export targets in this spec (FBX/USD export may piggyback on Blender worker later).
- No fine-tuning of ML riggers; UniRig/RigNet used as published checkpoints behind a gate.
