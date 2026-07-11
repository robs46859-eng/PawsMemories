# Phase 8.1 — Theatre.js → Fiber-v9-Compatible (Migration Spec)

**Status:** Ready to implement
**Why:** `@theatre/r3f@0.7.x` peer-depends on `@react-three/fiber@^8`, but this project runs Fiber **v9** (React 19). It only installs via `legacy-peer-deps` (see `.npmrc`), and its `editable.*` bindings target Fiber v8's reconciler — so the §8.6 pro-mode timeline is **unverified/at-risk on v9**. This phase removes the `@theatre/r3f` dependency and drives Theatre **imperatively** with `@theatre/core` + `@theatre/studio` (neither peer-depends on R3F), which is fully Fiber-v9 compatible.

**Ground rules:** preserve originals; no fakery; `tsc --noEmit` clean (pre-commit hook enforces it); `npm run test` + `npm run test:ar` green; commit per step; pro-mode stays behind the admin/advanced flag; regular users keep the director-script flow.

## Current state (what's wired today)
- `package.json`: `@theatre/core`, `@theatre/r3f`, `@theatre/studio` all `^0.7.2`.
- `src/animator/components/TheatreWrapper.tsx`: lazy-inits `@theatre/studio`, and (r3f) `getProject(...).sheet("Scene")` + `<SheetProvider sheet={sheet}>`.
- `src/animator/components/AnimatorScreen.tsx`:
  - `import { editable } from "@theatre/r3f"` (line ~22)
  - `<editable.perspectiveCamera makeDefault theatreKey="Camera" position={[0,2,5]} fov={50} />` gated by `proMode` (line ~126)
  - `<TheatreWrapper active={proMode} projectId="PawsMemories">` wraps the studio (line ~488)
  - `proMode` state + checkbox toggle (lines ~201, ~1069)
- `.npmrc`: `legacy-peer-deps=true` (only needed because of `@theatre/r3f`).

## Steps

### 1 — Drop the `@theatre/r3f` dependency
- Remove `@theatre/r3f` from `package.json`. Keep `@theatre/core` + `@theatre/studio`.
- Remove `import { editable } from "@theatre/r3f"` and `import { SheetProvider } from "@theatre/r3f"`.

### 2 — Create the Theatre sheet/object imperatively (`@theatre/core`)
- In `TheatreWrapper` (or a small `useTheatreSheet` hook), build the project + sheet with core:
  ```ts
  import { getProject, types } from "@theatre/core";
  const sheet = getProject(projectId || "PawsMemories").sheet("Scene");
  const cameraObj = sheet.object("Camera", {
    position: types.compound({ x: types.number(0), y: types.number(2), z: types.number(5) }),
    fov: types.number(50, { range: [10, 120] }),
  });
  ```
- Keep the existing lazy `@theatre/studio` `initialize()` (it works without r3f). Remove `SheetProvider`; expose `sheet`/`cameraObj` to `AnimatorScreen` via a render prop, context, or return value — do **not** use the r3f provider.

### 3 — Apply Theatre values to the R3F camera each frame (in-Canvas)
- Replace `<editable.perspectiveCamera .../>` with an **in-Canvas** tick component (same pattern as `SceneTicker`, per §6.4 — R3F hooks only under `<Canvas>`):
  ```tsx
  function TheatreCameraRig({ cameraObj }: { cameraObj: any }) {
    const { camera } = useThree();
    useFrame(() => {
      const v = cameraObj.value;
      camera.position.set(v.position.x, v.position.y, v.position.z);
      if ((camera as THREE.PerspectiveCamera).fov !== v.fov) {
        (camera as THREE.PerspectiveCamera).fov = v.fov;
        camera.updateProjectionMatrix();
      }
    });
    return null;
  }
  ```
- Render `{proMode && <TheatreCameraRig cameraObj={cameraObj} />}` inside the existing `<Canvas>` (Viewport). When pro-mode is off, the normal `OrbitControls`/`cameraState` path drives the camera (unchanged).

### 4 — Persistence (unchanged contract)
- Keep saving/loading Theatre state to the existing project store. With core you can serialize via the project's state (`studio.createContentOfSaveFile(project.address.projectId)` when studio is loaded) or persist the `cameraObj.value` keyframes through the existing project-save path. Round-trip must still work (save → reload → same animation).

### 5 — Remove `legacy-peer-deps` if now clean
- After `@theatre/r3f` is gone, run a fresh `rm -rf node_modules package-lock.json && npm install` **without** `.npmrc`. If it resolves with **no ERESOLVE**, delete `.npmrc` (the conflict was solely `@theatre/r3f`). If any other peer conflict remains, keep `.npmrc` and note which package requires it.

### 6 — Verify
- `tsc --noEmit` clean; `npm run test` + `npm run test:ar` green.
- Production `vite build` succeeds; confirm the `three` + `r3f` chunks and `dedupe:['three']` are intact and the bundle didn't regain a Fiber-v8 copy.
- Manual: toggle pro-mode ON in the studio on a **Fiber-v9** build — the Theatre studio UI opens, the camera keyframes drive the R3F camera, no reconciler/runtime errors; toggle OFF — OrbitControls path works unchanged.
- Update `tests/theatre_integration.test.mjs` to cover the imperative sheet (object creation + save/load round-trip); it must not import `@theatre/r3f`.

## Acceptance
Pro-mode timeline works on Fiber v9 with `@theatre/core` + `@theatre/studio` only; `@theatre/r3f` is removed; `.npmrc` removed if install is clean; regular users unaffected; all gates green.

## Definition of done
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · `vite build` clean with chunking intact · scoped commit with its test · no `@theatre/r3f` import anywhere · pro-mode still flag-gated.
