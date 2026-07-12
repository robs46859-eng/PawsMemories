# Coding-Agent Prompt — Phase 7 (paste this to the agent)

You are implementing **Phase 7 — Animation Studio Buildout** for the Pawsome3D repo. Read `docs/PHASE7_ANIMATION_STUDIO_PLAN.md` in full first; it is the source of truth (concrete files, bugs, fixes, tests per step). Also skim `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md` and `docs/PHASE6_IMPLEMENTATION_PLAN.md` for conventions.

## Ground rules
- Preserve originals; **no fakery** — hide/disable anything unbuilt (no fake crossfades, no invented clips, no controls that throw). Missing clips/roles are skipped with a visible note. CC0/owned/generated assets only.
- **Commit per step** with its test. `npm run test` + `npm run test:ar` green; `npm run lint` (`tsc --noEmit`) clean. Tests via `tsx --test tests/*.test.mjs`. Commits finalize on the Mac (`rm -f .git/*.lock`).
- Don't refactor beyond the step. Verify with a production `vite build` after 7.1 and 7.2.

## Already done — do NOT redo
**§7.2 is complete** (committed): `SceneBackdrop` in `src/animator/components/AnimatorScreen.tsx` renders by `backdrop.kind` (HDRI + image billboard via `scene.background` + procedural), and `server/animator/environments.ts` has a resilient loader with a built-in fallback. Skip §7.2. If you touch the animator, keep `SceneBackdrop` intact. (Remaining §7.2 nicety, optional: a visible toolbar empty-state — low priority since the loader now always returns ≥1 preset.)

## Order — bugs first (start at §7.1)

### Step 1 — §7.1 Fix the mobile crash (studio is unusable on phones)
In `src/animator/components/AnimatorScreen.tsx`: wrap the screen in an `AnimatorErrorBoundary` (reuse `src/components/ErrorBoundary.tsx`) with a non-white-screen fallback; on `<Canvas>` set `dpr={[1,1.5]}`, `gl={{ powerPreference:"high-performance", failIfMajorPerformanceCaveat:false }}`, handle `onContextLost`/`onContextRestored`; add `hasWebGL2()`/`isMobile()` checks and render the fallback if WebGL2 is missing; **gate the recorder UI** on WebCodecs/MediaRecorder support (hide if unsupported — iOS Safari has no WebCodecs); cap mobile to ~2 GLB actors and skip the HDRI on mobile. Test `tests/animator_mobile_guard.test.mjs`.

### Step 2 — §7.2 Make scenes/environments work
Two real bugs: (A) `SceneEnvironment` reads `environment.hdriBucketUrl` which doesn't exist — presets use `backdrop:{kind,url}`. Rewrite it to switch on `backdrop.kind`: `hdri`/`dome360` → drei `<Environment files={url} background/>`; `image` → render a **billboard/backdrop mesh** with the texture (this is why the 4 Arkham `image` presets show nothing today) + fixed interior lights; `procedural` → `<Sky>`/gradient; `glb-scene` → hidden. (B) `loadEnvironments()` reads `process.cwd()/server/animator/environments`, which is fragile on Hostinger — resolve relative to the module with a cwd fallback, and fall back to a **bundled default preset array** if the dir is missing; log preset count at boot. Add a toolbar empty-state. Extend `tests/scene_environments.test.mjs`.

### Step 3 — §7.3 Actor dropdown
Replace the free-text Asset-ID "Add Actor" box with a dropdown populated from `GET /api/avatars` (done avatars only); on select resolve GLB URL (`rigged_model_url` → `model_url`) and add to `SceneController` automatically; keep an "Advanced: paste URL" fallback. Test `tests/animator_actor_source.test.mjs`.

### Step 4 — §7.4 Object palette
Expose `src/three/objects/catalog.ts` (`OBJECT_CATALOG`, `/objects/*.glb`) as an "Objects" menu; selecting adds a static (no rig/brain/clips) actor via `ObjectModel`. Test `tests/animator_object_palette.test.mjs`.

### Step 5 — §7.5 Tailor animations
Add `animationSets.ts` mapping each `subjectClass` to a clip set keyed to `SKELETON_CONTRACTS` (studio offers only clips the model has; static → none). Wire an opt-in "More animations" action using Tripo `startRetarget` (append retargeted clips to `clips_json`, mirror to B2, credit-gated, hidden until wired). Document adding/adjusting clips in `BLENDER_RIG_PIPELINE.md`. Add a regression that a rigged GLB carries its animation tracks. Test `tests/animation_sets.test.mjs`.

### Step 6 — §7.6 Director scripts (8–10s, cast + camera + sound + lighting)
Add `server/animator/sceneScripts.ts` with a zod `SceneScript` schema (enforce `durationSeconds ∈ [8,10]`, `cast[]`, `steps[]` with camera move/per-actor clip direction/lighting/sound/vo), served at `GET /api/scenes/director-scripts`. Author **6 scripts** tuned to the animator's strengths (hard cuts + dolly/orbit, baked clips, weather/lighting, ambient sound), each ≤10s with camera + a lighting change + a sound cue + cast direction; include multi-cast scripts. Extend `evaluateSequence`/`SceneSequence` into a `runScript(script, controllers[])` executor (dolly/orbit via tweened camera, cuts otherwise — no fake crossfades; skip missing roles/clips visibly). Build a "Director Scripts" panel: pick script → assign avatars to cast roles (via the 7.3 dropdown) → Apply → Record; auto-select `recommendedEnvironment`. Test `tests/scene_scripts_director.test.mjs`.

## Definition of done (every step)
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · scoped commit with its test · no fakery · unsupported features hidden (never fatal, esp. mobile).

Report back after Steps 1 and 2 (mobile no longer crashes; environments list + apply) before continuing to features.
