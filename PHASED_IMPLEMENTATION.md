# PHASED_IMPLEMENTATION.md — Animator Build-Out

Companion to `ANIMATOR_SPEC.md`. Phases are ordered by dependency, not time — no timelines. Each phase ends with working, shippable software and its own exit criteria. Section references (§) point at the spec.

---

## Phase 0 — Foundations & Hardening

**Goal:** the Animator never boots into a broken state, and the new pipeline has rails to run on.

- Complete `ANIMATOR_FIX_PLAN.md` item 1 (graceful 200-with-empty-shape reads, guarded `addActor`, visible degraded banner).
- Extend `server/animator/queue.ts` with new job types: `rig`, `retarget`, `repurpose`, `lipsync`, `reconstruct`, `bake` (stubs returning `not_implemented`).
- Add zod schemas for all §12 data contracts (BoneDefinitionProfile, VisemeTrack, rig manifest, LOD manifest, AnimationSet v2); version-checked parsing everywhere.
- Extend `scripts/animator-doctor.mjs` to probe: Rhubarb binary, meshoptimizer, worker reachability, profile directory.
- Create `skills/animator/` skeleton (RIGGING/LIPSYNC/MESHOPS.md) and AGENTS.md persona entries (§10) so agents can execute later phases against written standards.

**Exit:** studio boots with zero assets and with server deps missing; all contracts typed and validated; doctor green locally.

---

## Phase 1 — Layered Animation Runtime

**Goal:** replace single-action playback with the L0–L3 layer stack (§6.1) — the substrate every later phase drives.

- Layered mixer in `createAnimationController.ts`: base locomotion (exclusive, cross-fade), additive/masked overlay layer (`makeClipAdditive` + bone masks), face layer slot (reserved for LIP), procedural post-pass slot.
- AnimationSet v2: data-declared transitions, per-clip default layer, named bone masks, phase markers.
- 1D locomotion blend space (idle↔walk↔run by speed) with foot-phase-synced cross-fades.
- EmoteQueue (§6.3): priority queue, cooldowns, hold times, interruption rules; wired to the existing brain/needs behaviors for idle life.
- node:test coverage: layer priority, mask filtering, queue scheduling, blend phase sync.

**Exit:** a pet walks while wagging (`tail_wave` additive over `walk`), emotes fire from the queue without popping, all tests pass, no regression in existing behavior playback.

---

## Phase 2 — Lip-Sync Tier B (Rhubarb) End-to-End

**Goal:** phoneme-accurate speech for any avatar with a jaw, from any audio.

- `server/animator/lipsync.ts`: Rhubarb CLI job runner (recognizer selection, dialog-file mandate, `--extendedShapes GHX`), Rhubarb JSON → VisemeTrack v1 normalizer.
- Track post-processor implementing the transition rules (§5.1): A–C–D bridge, C–E–F rule, 2-frame anticipation shift, sub-frame cue merging.
- `LipSyncPlayer` on the face layer: samples track against `AudioContext.currentTime`, cross-fades morphs/jaw 50–80 ms; bone-only fallback mapping (jaw + lip corners) for current pet rigs; Tier A kept as final fallback.
- `speak()` pipeline integration: TTS → audio + transcript → lipsync job → cached VisemeTrack → synced playback via `audioMux.ts`.
- Golden-audio QA corpus + transition-rule linter (§13).

**Exit:** Randy and any rigged pet speak a scripted line with correct A–X shapes within ±1 frame of reference labels; non-English clip works via phonetic recognizer; player degrades tier C→B→A cleanly.

---

## Phase 3 — Auto-Rig v1 (Profiles + Selective Rigging)

**Goal:** any reasonable quadruped/biped/winged mesh gets rigged without hand work — the "rig-once, apply-many" milestone.

- Canonical rigs authored/finalized in `assets/rigs/*.blend` including facial bones (jaw, tongue, eyes, brows) per §4.1.
- BoneDefinitionProfile v1 loader in blender-worker; profile fitting (normalized bbox + landmark heuristics); **Rebind** operation.
- Selective rigging: soft/rigid classifier + rigid parent-attach path (§4.2); manual per-mesh override surfaced in the Animator asset inspector.
- Automated §4.3 validation suite (twist bones, neck∥jaw, silhouette probe poses, purlicue check for bipeds) with pass/fail manifest and probe screenshots.
- Bone masking for partial/asymmetric models; spring-bone attributes read from profile.
- Worker endpoints `/rig`, `/rig/:id`; server job orchestration → `updateAvatarRiggedModel` on success.

**Exit:** a batch of ≥ 10 varied Tripo pet meshes rig unattended with ≥ 8 passing all validation rules; a collar/tag accessory stays rigid through a run cycle; a three-legged test model rigs via bone mask.

---

## Phase 4 — Clip Library & Retargeting at Scale

**Goal:** one authored clip library animating every rigged avatar; ≥ 15 quadruped clips in production.

- Reconcile clip naming between `animationSets.ts` and `blender-worker/skeletal-clips.js` under AnimationSet v2 (§6.6), then author the expanded sets: quadruped +`ear_flick`, `paw_offer`, `roll_over`, `beg`; biped +`talk_gesture`, `point`, `clap`; winged +`hover`, `preen`. All with phase markers (foot contacts) and layer/mask annotations.
- Worker retarget module: canonical actions → per-avatar armature, bone-mask filtered, batch mode over a profile group; Draco/meshopt export with all tracks.
- Character Repurposing (§4.5): body re-rig preserving facial bones and viseme morph tracks — proven by re-rigging a Phase 2 speaking avatar and replaying its VisemeTrack unchanged.
- Clip QA: automated playback sweep per avatar (every clip, screenshot strip, foot-slide metric from phase markers).

**Exit:** full clip set retargets to every Phase 3 avatar in one batch job; repurposed legacy avatar keeps working lip-sync; foot-slide metric under threshold on locomotion clips.

---

## Phase 5 — Mesh Processing & Quality Gates

**Goal:** every asset that enters the animator is validated, optimized, and LOD'd with formal metrics.

- QEM simplification via meshoptimizer in the server pipeline; LOD chain LOD0–LOD3 with per-LOD max/mean quadric error in the manifest (§7.1); runtime LOD switching by screen-space error.
- Topology gate pre-rig: Euler characteristic check, generalized-winding-number normal/junk detection, non-manifold + flipped-normal auto-repair (§7.3).
- Compression standardization: meshopt vs Draco per target, KTX2/Basis textures, prune/dedup/palette passes.
- Optional dev tooling: Hausdorff distance QA (MeshLab/CGAL) against LOD0.

**Exit:** pipeline rejects/repairs a corpus of deliberately broken meshes; LOD3 of a hero pet renders under budget with reported quadric error inside tolerance; bundle/asset sizes reported per job.

---

## Phase 6 — Sequencer Pro & Capture Upgrade

**Goal:** the Animator becomes a multi-actor mini-studio with frame-accurate export.

- Theatre.js project documents: multi-actor lanes (clips, viseme, camera, FX), versioned scene JSON via `projects.ts` (§6.5).
- AI in-betweening v1: heuristic arc-preserving interpolation (Catmull-Rom with velocity matching) selectable per keyframe pair; provider hook for model-backed interpolation later.
- WebCodecs render-on-demand export (fixed fps, no dropped frames), sRGB-correct encode verified by ramp asset (§9); image-sequence export; `bake` job producing a GLB with the scene's animation baked as clips.
- Audio lane: amplitude/onset markers (§8) for beat-synced keyframing.

**Exit:** a two-actor scene (pet + Randy) with dialogue, camera moves, and music exports a frame-perfect MP4 and a replayable baked GLB.

---

## Phase 7 — Realtime & ML Frontier

**Goal:** live performance and hard-mesh coverage — the ambitious tail.

- Tier C lip-sync: AudioWorklet MFCC classifier (20 MFCCs, 50 ms/10 ms) with per-voice calibration flow; live mic → avatar speech (§5.4).
- Audio2Face provider interface (optional, gated): audio → full blendshape performance for cinematic renders.
- UniRig ML rigger fallback for irregular scans/sculpts, confidence-gated by the Phase 3 validation suite; RigNet evaluation spike (§4.6).
- Poisson reconstruction job (`reconstruct`): point cloud → watertight mesh (adaptive octree ≤ 10) + MLS pre-smooth + deviation color-map gate — the SnapGen photogrammetry on-ramp (§7.4).
- Spectrogram-based sound-event classifier (bark/meow) driving EmoteQueue reactions.

**Exit:** live mic drives a pet's mouth convincingly; one "impossible" scan (non-standard pose) rigs via UniRig and passes validation; a scanned point cloud becomes an animated avatar end-to-end.

---

## Phase 8 — Agentic Operations & Batch Production

**Goal:** the pipeline runs itself; agents are the operators.

- Complete `skills/animator/*.md` with every schema, rule table, and invocation recipe from the spec; AGENTS.md personas (Rig Technician, Lip-Sync Director, Asset Optimizer) with operational constraints (§10).
- Validation doctrine wired in: agents re-run failed jobs with adjusted parameters (octree depth, decimation ratio, recognizer choice) instead of accepting degraded output.
- Batch production tooling: rig + retarget + LOD + lipsync an entire catalog from one manifest; per-batch QA report (validation pass rates, error budgets, sizes).
- Blender MCP integration recipes: interactive profile authoring and rig debugging driven by an agent against the live Blender instance.

**Exit:** a single command (or agent instruction) takes N raw meshes to fully rigged, animated, lip-sync-ready, LOD'd catalog entries with a QA report and zero manual steps on the happy path.
