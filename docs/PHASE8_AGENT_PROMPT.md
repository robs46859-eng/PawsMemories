# Coding-Agent Prompt — Phase 8 (paste this to the agent)

You are implementing **Phase 8 — Industry-Level Animation Tooling** for the Pawsome3D repo. Read `docs/PHASE8_ANIMATION_TOOLING_PLAN.md` in full first; it is the source of truth. Also skim the Phase 7 plan for the studio's current shape (`SceneController`, `runScript`, director scripts, `filterReadyAvatars`/`resolveAvatarGlbUrl`, `src/three/ar/ik.ts`).

## First: activate the pre-commit hook (once per clone)
Before doing anything else, run `npm install` (this triggers the `prepare` script that sets `git config core.hooksPath .githooks`), or set it manually: `git config core.hooksPath .githooks`. The hook runs `tsc --noEmit` and **blocks any commit that doesn't type-check**. Do NOT bypass it with `--no-verify`. Every commit must pass `tsc` (broken builds were pushed to `main` twice before this hook existed).

## Ground rules
- **Stack-native only** — JS/Three/R3F. Do **NOT** add ozz-animation or any C++/WASM animation runtime (see §8.0; Three's `AnimationMixer` is sufficient at our scale).
- **`tsc --noEmit` must be clean before every commit** (the hook enforces it). Run `npm run test` + `npm run test:ar` before pushing.
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
⚠️ **Known incompatibility (must fix):** `@theatre/r3f@0.7.x` peer-depends on `@react-three/fiber@^8`, but this project runs Fiber **v9** (React 19). Installing it currently only works via `legacy-peer-deps` (see `.npmrc`), and its `editable.*` bindings target Fiber v8's reconciler — so the pro-mode timeline is **not verified on v9** and is a runtime risk.
- **Preferred fix:** drop `@theatre/r3f` and integrate `@theatre/core` + `@theatre/studio` **imperatively** (no R3F peer): create Theatre objects/sheets, read their values in a `useFrame` tick, and apply them to the R3F camera + actors manually. This is fully Fiber-v9 compatible.
- Until that migration is done and verified, **keep pro-mode OFF by default** behind the admin/advanced flag (regular users use the director-script flow), and do not rely on `editable.*`.
- Persist sheets to the existing project store (save/load round-trip). Verify the build still succeeds and the three/r3f chunking + `dedupe:['three']` are intact. Test `tests/theatre_integration.test.mjs`.

## Definition of done (every step)
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · scoped commit with its test · no fakery · assets CC0/owned/generated + license-checked · pro features gated.

Report back after Steps 1 and 2 (both director gaps closed) before starting the tooling additions (3–6). For Step 6, confirm the added deps didn't regress bundle chunking before proceeding.
