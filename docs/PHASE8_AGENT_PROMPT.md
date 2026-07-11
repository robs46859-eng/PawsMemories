# Coding-Agent Prompt — Phase 8 (paste this to the agent)

You are implementing **Phase 8 — Industry-Level Animation Tooling** for the Pawsome3D repo. Read `docs/PHASE8_ANIMATION_TOOLING_PLAN.md` in full first; it is the source of truth. Also skim the Phase 7 plan for the studio's current shape (`SceneController`, `runScript`, director scripts, `filterReadyAvatars`/`resolveAvatarGlbUrl`, `src/three/ar/ik.ts`).

## Ground rules
- **Stack-native only** — JS/Three/R3F. Do **NOT** add ozz-animation or any C++/WASM animation runtime (see §8.0; Three's `AnimationMixer` is sufficient at our scale).
- Preserve originals; **no fakery** — hide/disable unbuilt features, skip missing clips/roles with a visible note. CC0/owned/generated assets only, license-checked.
- **Commit per step** with its test. `npm run test` + `npm run test:ar` green; `npm run lint` (`tsc --noEmit`) clean. Tests via `tsx --test`. Verify a production `vite build` after any dependency addition. Commits finalize on the Mac (`rm -f .git/*.lock`).
- New "pro" features must be gated behind a flag and never forced on mobile or regular users.

## Order — close the Phase 7 gaps first

### Step 1 — §8.1 Multi-actor cast assignment
Director executor currently drives only the first actor. Add a cast-assignment UI (role → user-avatar dropdown, reuse §7.3 helpers) storing `castAssignments: Record<roleId, actorId>`; on Apply, add each avatar as a `SceneController` actor tagged with `roleId`; in the timeline loop iterate **all** `clipTargets` and drive each mapped actor by `roleId`. Skip unassigned roles visibly. Test `tests/director_cast.test.mjs`.

### Step 2 — §8.2 Lighting + sound + weather direction
`runScript` returns `lightTarget`/`soundTarget` that the loop ignores. Apply `lightTarget` via `lightingRig`, `soundTarget` via `SoundSystem`, and add + apply a `weather` event type. Extend `tests/scene_scripts_director.test.mjs`.

### Step 3 — §8.3 Crossfade blending
Add `crossfadeTo(clipName, duration)` to the controller using `AnimationAction.crossFadeTo`/`fadeIn`/`fadeOut` (keep hard `selectClip` as default). Add optional `blend: seconds` to director `clip` events. Test `tests/animator_crossfade.test.mjs`.

### Step 4 — §8.4 Retargeting + CC0 clip library
Server: `GET /api/scenes/clips?skeleton=…` serving a curated CC0/owned clip library per skeleton class (license-checked). Client: retarget a library clip onto the avatar via `SkeletonUtils.retargetClip` (normalize bone names to `SKELETON_CONTRACTS`; handle the known off-by-one frame) for live preview; prefer the existing server-side Tripo `startRetarget` for a durable retargeted GLB. Reject incompatible skeletons (no silent mangling). Test `tests/clip_retarget.test.mjs`.

### Step 5 — §8.5 Studio IK (ground + look-at)
Port `buildLegIK`/`headLookAt`/`clampSlope` from `src/three/ar/ik.ts` into the studio as optional per-actor "Ground IK" and "Look at camera" toggles (inside the Canvas). Test `tests/studio_ik.test.mjs`.

### Step 6 — §8.6 Theatre.js pro-mode timeline
Add `@theatre/core`, `@theatre/studio`, `@theatre/r3f`. Wrap the studio Canvas in Theatre's `SheetProvider`; expose camera + per-actor transforms/clip-weights as props. Gate the Theatre editor behind an admin/advanced flag (regular users keep the director-script flow). Persist sheets to the existing project store (save/load round-trip). Verify the build still succeeds and the three/r3f chunking + `dedupe:['three']` are intact. Test `tests/theatre_integration.test.mjs`.

## Definition of done (every step)
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · scoped commit with its test · no fakery · assets CC0/owned/generated + license-checked · pro features gated.

Report back after Steps 1 and 2 (both director gaps closed) before starting the tooling additions (3–6). For Step 6, confirm the added deps didn't regress bundle chunking before proceeding.
