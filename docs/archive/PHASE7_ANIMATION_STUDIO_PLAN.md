# Phase 7 — Animation Studio Buildout (Coding-Agent Ready)

**Status:** Ready to implement
**Parent:** `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md`; builds on Phase 6.
**Theme:** Make the in-app Animation Studio usable and content-rich: fix the mobile crash, make scenes/environments actually work, make actors + objects one-click, tailor animations to each model, and ship pre-made 8–10s director scripts (camera, sound, lighting, cast direction).

## Ground rules (unchanged)
Preserve originals; no fakery (hide/disable unbuilt features, never stub). CC0/owned/generated assets only. **Commit per step** with tests. `npm run test` + `npm run test:ar` green; `npm run lint` (`tsc --noEmit`) clean; tests via `tsx --test`. Commits finalize on the Mac (`rm -f .git/*.lock`).

## Execution order
Bugs before features: **7.1 (mobile crash) → 7.2 (scenes/environments) → 7.3 (actor dropdown) → 7.4 (object palette) → 7.5 (animations) → 7.6 (director scripts)**.

---

## 7.1 — Fix the mobile crash 🔴 (studio unusable on phones)

**Root causes (all present in `src/animator/components/AnimatorScreen.tsx`):**
- The R3F `<Canvas>` has **no error boundary** — any WebGL context loss or unsupported feature crashes the whole SPA.
- No device-pixel-ratio cap or WebGL2 capability check — multiple GLBs + an HDRI blow mobile GPU memory.
- The recorder path uses **WebCodecs**, unsupported on iOS Safari; touching it throws.

**Fixes:**
1. Wrap the animator screen in a dedicated `AnimatorErrorBoundary` (reuse `src/components/ErrorBoundary.tsx` pattern) that renders a "Studio needs a desktop/WebGL2 browser" fallback + a Close button — never a white screen.
2. On the `<Canvas>`: set `dpr={[1, 1.5]}`, `gl={{ powerPreference: "high-performance", failIfMajorPerformanceCaveat: false, antialias: !isMobile }}`, and handle `onContextLost`/`onContextRestored` (pause the mixer, show a "tap to resume" overlay).
3. Add a `hasWebGL2()` + `isMobile()` capability check at mount. If WebGL2 is missing, show the fallback instead of mounting the Canvas.
4. **Gate the recorder UI on capability**: if `captureSession` reports no WebCodecs/MediaRecorder support, hide/disable Record (don't render a control that throws on tap). This matches §0 "no fakery / honest fallback."
5. Cap concurrent GLB actors on mobile (e.g. 2) and skip the HDRI in favor of a lightweight gradient/procedural backdrop when `isMobile`.

- **Acceptance:** studio opens on a phone without crashing the app; unsupported features are hidden, not fatal. **Test** `tests/animator_mobile_guard.test.mjs`: `hasWebGL2`/`isMobile`/recorder-capability helpers are pure and covered; the screen renders the fallback (not the Canvas) when WebGL2 is absent.

---

## 7.2 — Make scenes/environments actually work 🔴

**Bug A — field mismatch (definite).** `SceneEnvironment` reads `environment.hdriBucketUrl`, which does not exist. Presets provide `backdrop: { kind, url }` (`kind ∈ hdri|dome360|image|glb-scene|procedural`). Result: HDRIs always fall back to `preset="city"`, and **`image` backdrops render nothing** — so all 4 Arkham renders are invisible and the studio looks like it has "no environments."

Fix `SceneEnvironment` to switch on `backdrop.kind`:
- `hdri` / `dome360` → `<Environment files={backdrop.url} background />`.
- `image` → render a **billboard/backdrop**: a large curved plane or a `<mesh>` with the texture mapped behind the stage (and set scene background), so the Arkham renders appear. Keep the pet lit by fixed interior lights (indoor presets ignore the sun).
- `procedural` → drei `<Sky>`/gradient.
- `glb-scene` → keep disabled/hidden (unbuilt).
Map `defaultTimeOfDay`/`ground.color` through as already intended by `lightingFor`.

**Bug B — preset path fragility.** `loadEnvironments()` reads `path.join(process.cwd(), "server/animator/environments")`. On Hostinger the runtime cwd can differ from the source root (seen as `.builds/source`), so `readdirSync` throws → the route 500s → the toolbar is empty. Fix: resolve the dir relative to the module (`__dirname`/`import.meta`) with a `process.cwd()` fallback, and if the dir is missing, fall back to a small **bundled default preset array** (import the JSON) so the toolbar is never empty. Add a boot log of how many presets loaded.

**Bug C — verify the fetch.** Confirm `GET /api/scenes/environments` returns the array (it's mounted at `/api` → `/scenes/environments`; the auth wrapper must pass the token). Add a visible empty-state in the toolbar ("No environments loaded — check server") instead of silently showing nothing.

- **Acceptance:** all 8 presets list in the toolbar; selecting an Arkham `image` preset shows the render behind the pet; selecting an HDRI lights the pet. **Test** extend `tests/scene_environments.test.mjs`: every bundled preset resolves a render path for its `backdrop.kind`; loader falls back to bundled defaults when the dir is absent.

---

## 7.3 — Actor dropdown (one-click avatars)

Today "Add Actor" is a free-text Asset-ID box. Replace with a **dropdown auto-populated from the user's avatars**.
- On mount, `GET /api/avatars` (already exists) → list `{id, name, model_url, rigged_model_url, generation_status}`; show only `generation_status==='done'` with a usable GLB.
- Dropdown item → on select, resolve the durable GLB URL (prefer `rigged_model_url`, else `model_url`) and add the actor to the `SceneController` — no manual ID/URL paste. Keep a collapsed "Advanced: paste URL" for power users.
- Show a thumbnail + name per option; disable actors still generating.
- **Acceptance:** user picks an avatar by name and it drops onto the stage with its link auto-filled. **Test** `tests/animator_actor_source.test.mjs`: the avatar→GLB URL resolver prefers rigged, falls back to model_url, and skips non-done avatars.

## 7.4 — Object palette (unrigged static objects)

Expose the static object catalog (`src/three/objects/catalog.ts`, `/objects/*.glb`) the same way.
- Add an "Objects" dropdown/palette listing `OBJECT_CATALOG` (ball, bone, bowl, bed, hydrant, dog house, …), each with emoji + label.
- On select, add the GLB as a **non-animated actor** (no rig/brain) at a placement offset. Reuse `ObjectModel`.
- **Acceptance:** user adds a bowl/ball/tree to the scene from a menu. **Test** `tests/animator_object_palette.test.mjs`: every catalog kind maps to a resolvable `/objects/*.glb` and adds as a static (no-clip) actor.

---

## 7.5 — Tailor animations to each model (answering "how do I add more accurate animations?")

**How animation works today (so the agent and owner understand it):**
- A generated avatar is rigged by the **Blender worker**, which bakes **~15 skeletal clips** (idle, walk, run, tail_wave, sit, …) at 24-frame cycles into the GLB. The clip names + metadata travel in `clips_json`.
- In the studio, `createAnimationController` discovers clips from `gltf.animations` (the baked tracks) and lists them; the transport plays the selected clip.
- So "more accurate animations" = **improve what the Blender worker bakes** and **map the right clip set per subject class** (quadruped vs humanoid vs static).

**Work for this step:**
1. **Per-species clip sets.** Define clip manifests per `subjectClass` (dog/quadruped, human/biped, object=none) in a `animationSets.ts`, keyed to `SKELETON_CONTRACTS` (already exists). Quadruped: idle/walk/run/sit/lie/tail_wave/head_tilt/eat/play-bow. Biped: idle/walk/wave/sit/talk/celebrate. The studio should only offer clips the model actually has (skip missing — never invent).
2. **Retarget path for richer motion.** Tripo `startRetarget` (already in `tripo.ts`, tested) can apply preset animations to a rig. Add an opt-in "More animations" action in the studio that requests additional retargeted clips for an avatar, mirrored to B2 and appended to `clips_json`. Gate behind a credit cost + the existing job/poll pattern. Keep it hidden until wired.
3. **Clip quality.** Document in `BLENDER_RIG_PIPELINE.md` how to add/adjust a clip (keyframe count, root-motion handling, naming so the contract test matches). The owner adds accuracy by editing the worker's bake list, not the frontend.
4. Ensure the exported GLB actually carries its animation tracks (a static export = no clips = empty transport). Add a regression check.

- **Acceptance:** a rigged avatar shows its real per-species clip list in the transport; a static object shows none (no fake clips). **Test** `tests/animation_sets.test.mjs`: each subjectClass maps to a clip set that is a subset of its `SKELETON_CONTRACTS` bones; static → empty.

*Owner answer, short:* you add more accurate animations by expanding the **Blender worker's baked clip set** (per-species, in the rig pipeline) and/or enabling **Tripo retarget** for preset motions — both flow into the model's `clips_json`, which the studio reads automatically. The frontend doesn't author motion; it plays what the model ships.

---

## 7.6 — Pre-made director scripts (8–10s, cast + camera + sound + lighting)

Today `/scenes/scripts` returns only **voiceover** text, and `ANIMATOR_DEFAULTS.sequences` only holds camera cuts. Build a real **SceneScript**: a short, tuned timeline that directs everything.

1. **Schema** (`server/animator/sceneScripts.ts`, zod-validated, served at `GET /api/scenes/director-scripts`):
   ```
   SceneScript { id, title, durationSeconds (8–10, enforced),
     cast: [{ role, required, suggestedClipSet }],        // extra cast members
     steps: [{ atSeconds, camera?{position,fov,move:cut|dolly|orbit},
               direction?[{ role, clip }],                 // per-actor clip direction
               lighting?{ timeOfDay|preset, intensity },
               sound?{ cue, gain }, vo?{ text } }],
     recommendedEnvironment? }
   ```
   Enforce `durationSeconds ∈ [8,10]` in the schema (a test asserts it for every shipped script).
2. **Author 6 scripts** worded to harness the animator's strengths (hard cuts + dolly, the baked clips, weather/lighting, ambient sound): e.g. "Hero Turn" (single cast, orbit + tail_wave + golden lighting), "Two-Dog Play" (2 cast, fetch/play-bow, dolly-in, park ambient), "Spooky Reveal" (infirmary env, slow dolly, fog, low key light), "Roll Call" (approach-road env, walk-to-camera, overcast, wind). Each ≤10s, with camera + at least one lighting change + a sound cue + cast direction.
3. **Executor.** Extend `evaluateSequence`/`SceneSequence` to a `runScript(script, controllers[])` that, per step, drives: camera (`cut`/`dolly`/`orbit` — dolly/orbit via tweened camera, **cuts only if tween unbuilt** — no fake crossfades), each actor's clip via its `SceneController`, the lighting profile via `lightingRig`, weather, and sound cues. Missing roles/clips are skipped with a visible note, never invented.
4. **UI.** A "Director Scripts" panel: pick a script → it lists required/optional cast (map each role to one of the user's avatars via the 7.3 dropdown) → "Apply" runs it on the timeline; "Record" captures the 8–10s result. Auto-select the `recommendedEnvironment`.
5. **Cast members.** Scripts with `cast.length > 1` prompt the user to assign avatars to each role before Apply; single-cast scripts run immediately.

- **Acceptance:** user picks a script, assigns cast, hits Apply, and gets a directed 8–10s sequence (camera + clips + lighting + sound) ready to record. **Test** `tests/scene_scripts_director.test.mjs`: every shipped script validates the schema, is 8–10s, references only real clip/lighting/sound identifiers, and the executor skips missing roles without throwing.

---

## Checklist
- [ ] 7.1 ErrorBoundary + WebGL2/DPR guards + capability-gated recorder + mobile actor cap; `animator_mobile_guard` test
- [ ] 7.2 `SceneEnvironment` renders per `backdrop.kind` (incl. image billboard); robust preset loader w/ bundled fallback; toolbar empty-state; `scene_environments` test extended
- [ ] 7.3 Avatar dropdown from `/api/avatars`, auto link, rigged→model fallback; `animator_actor_source` test
- [ ] 7.4 Object palette from `OBJECT_CATALOG` as static actors; `animator_object_palette` test
- [ ] 7.5 Per-species clip sets + retarget hook + pipeline docs + GLB-carries-clips regression; `animation_sets` test
- [ ] 7.6 `SceneScript` schema + 6 scripts (8–10s) + executor + cast-assignment UI + `GET /api/scenes/director-scripts`; `scene_scripts_director` test

## Definition of done (per step)
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · scoped commit with its test · no fakery · originals preserved · unsupported features hidden, never fatal (esp. mobile).

## Deployability note
This markdown is self-contained and agent-ready: hand it (plus `PHASE7_AGENT_PROMPT.md`) to a fresh coding agent pointed at the repo. Every step names concrete files, the exact bug, the fix, an acceptance test, and the DoD — same format the Phase 6 agent executed successfully.
