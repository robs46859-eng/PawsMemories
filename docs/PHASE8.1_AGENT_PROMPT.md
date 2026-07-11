# Coding-Agent Prompt — Phase 8.1 (paste this to the agent)

You are implementing **Phase 8.1 — migrate the Animation Studio's Theatre.js pro-mode off `@theatre/r3f` to a Fiber-v9-compatible imperative integration**. Read `docs/PHASE8.1_THEATRE_MIGRATION_PLAN.md` in full first; it is the source of truth with exact file/line references.

## First: activate the pre-commit hook
Run `npm install` (triggers the `prepare` script → `git config core.hooksPath .githooks`), or set it manually: `git config core.hooksPath .githooks`. The hook runs `tsc --noEmit` and **blocks any commit that fails**. Do NOT use `--no-verify`.

## Why
`@theatre/r3f@0.7.x` peer-depends on `@react-three/fiber@^8`; this project runs Fiber **v9** (React 19). It only installs via `legacy-peer-deps` (`.npmrc`), and its `editable.*` bindings target Fiber v8's reconciler — so the pro-mode timeline is unverified/at-risk on v9. `@theatre/core` + `@theatre/studio` do NOT peer-depend on R3F, so drive Theatre imperatively instead.

## Ground rules
- Preserve originals; **no fakery**. Pro-mode stays behind the admin/advanced flag; regular users keep the director-script flow.
- `tsc --noEmit` clean before every commit (hook-enforced). `npm run test` + `npm run test:ar` green before pushing. Production `vite build` must succeed with `three`/`r3f` chunking + `dedupe:['three']` intact.

## Steps
1. **Remove `@theatre/r3f`** from `package.json`; keep `@theatre/core` + `@theatre/studio`. Delete all `@theatre/r3f` imports (`editable`, `SheetProvider`) in `TheatreWrapper.tsx` and `AnimatorScreen.tsx`.
2. **Create the sheet/object imperatively** with `@theatre/core` (`getProject(...).sheet("Scene")`, `sheet.object("Camera", { position: types.compound{...}, fov: types.number(...) })`). Keep the existing lazy `@theatre/studio` `initialize()`. Remove `SheetProvider`; hand the `sheet`/`cameraObj` to `AnimatorScreen` via return value/context (not the r3f provider).
3. **Apply values to the camera in-Canvas**: replace `<editable.perspectiveCamera theatreKey="Camera" .../>` with an in-Canvas `TheatreCameraRig` (`useThree` + `useFrame`, same pattern as `SceneTicker` per §6.4) that reads `cameraObj.value` each frame and sets `camera.position`/`fov` + `updateProjectionMatrix()`. Render it only when `proMode` is on; the normal OrbitControls/`cameraState` path is unchanged when off.
4. **Persistence**: keep the save/load round-trip through the existing project store (serialize Theatre state/keyframes). Round-trip must still reproduce the animation.
5. **Drop `legacy-peer-deps` if clean**: after removing `@theatre/r3f`, run `rm -rf node_modules package-lock.json && npm install` WITHOUT `.npmrc`. If no ERESOLVE, delete `.npmrc`. If another peer conflict remains, keep it and note which package caused it.
6. **Verify**: `tsc` clean; tests green; `vite build` clean with chunking intact and no Fiber-v8 copy re-added; manual — toggle pro-mode ON on a Fiber-v9 build (studio UI opens, camera keyframes drive the R3F camera, no reconciler errors), toggle OFF (OrbitControls unchanged). Update `tests/theatre_integration.test.mjs` to cover the imperative sheet and **not** import `@theatre/r3f`.

## Definition of done
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · `vite build` clean, chunking intact · scoped commit with its test · zero `@theatre/r3f` imports · `.npmrc` removed if install is clean · pro-mode still flag-gated.

Report back after Step 3 (imperative camera rig working on v9) before finishing persistence + cleanup.
