# AR Handoff — Phases 3–5 (Planes · Depth · Light)

**Continues:** `ARCORE_BUILD_SPEC.md`
**Prereq status:** ✅ Phase 1 (oriented hit-test reticle) and ✅ Phase 2 (real `XRAnchor` placement, drift-free) are **implemented** in `src/three/ar/ARScene.tsx`. The session already requests `hitTest` + `anchors` via `createXRStore`.
**Stack:** `@react-three/xr` **v6.6.30** (WebXR path, Android/ARCore), `@react-three/fiber`, `three`. iOS uses the separate 8th Wall path (`eighthWallAR.ts`) — Phases 3–5 target the **WebXR path only**; leave the 8th Wall path untouched.

> Golden rule for all three phases: **request as optional, degrade silently.** No feature here is available on every device. If the session doesn't grant it, the AR experience must still work exactly as it does today.

---

## Where to plug in

All three phases extend `ARContent()` in `src/three/ar/ARScene.tsx`. The per-frame hook to reuse:

```ts
useFrame((state, _delta, frame?: XRFrame) => {
  if (!frame) return;
  const refSpace = state.gl.xr.getReferenceSpace();
  // ... phase logic reads from `frame` + `refSpace`
});
```

Enable the new features in the shared store (they're optional, so this is safe):

```ts
const store = createXRStore({
  domOverlay: true, hitTest: true, anchors: true,
  planeDetection: true,        // Phase 3
  depthSensing: true,          // Phase 4
  // light estimation is enabled via session init below (see Phase 5)
});
```

Keep new logic in dedicated modules to avoid bloating `ARScene.tsx`:
`src/three/ar/planeGrid.tsx`, `src/three/ar/occlusion.ts`, `src/three/ar/lightProbe.ts`.

---

## Phase 3 — Plane detection & visualization

**Goal:** show the user where real surfaces are found, and prefer them for placement.

**API:** `frame.detectedPlanes` (a `XRPlaneSet`). Each `XRPlane` has `.polygon` (array of `{x,y,z}` in the plane space), `.orientation` (`'horizontal' | 'vertical'`), and a pose via `frame.getPose(plane.planeSpace, refSpace)`.

**Implementation (`planeGrid.tsx`):**
1. Each frame, iterate `frame.detectedPlanes`. Track a `Map<XRPlane, Mesh>` so meshes persist and update instead of recreating.
2. For each plane, build/refresh a thin translucent mesh from `.polygon` (triangulate the boundary) positioned at the plane pose. Use a soft material (e.g. `meshBasicMaterial`, opacity ~0.15, additive) so it reads as a subtle grid/glow.
3. Remove meshes for planes no longer in the set (they get pruned as ARCore updates).
4. Gate placement: when planes exist, restrict the reticle/anchor to hits whose `hitTestResult` lies on a detected plane (hit-test already supports `trackableType: 'plane'`); otherwise fall back to the current behavior.

**Feature check:** wrap in `if ('detectedPlanes' in frame)`. Some Android devices report no planes even with ARCore — that's fine, just render nothing.

**Accept:** a faint surface indicator appears on the floor/table within ~2s of scanning; placement snaps onto it; nothing breaks when no planes are found.

---

## Phase 4 — Depth (occlusion)

**Goal:** real objects (a chair, a person) correctly hide the parts of the pet behind them.

**Session init:** depth needs config beyond a boolean. Request via the store's `depthSensing`:

```ts
depthSensing: { usagePreference: ['gpu-optimized'], dataFormatPreference: ['luminance-alpha'] }
```

**API:** per view, `const depth = frame.getDepthInformation(view)` (CPU) or `glBinding.getDepthInformation(view)` (GPU). For occlusion you want the **GPU** path: bind the depth texture and, in the avatar material's fragment shader, compare each fragment's camera-space depth against the sampled real-world depth; `discard` fragments that are behind real geometry.

**Implementation (`occlusion.ts`):**
1. Get the WebXR GPU binding: `const binding = new XRWebGLBinding(session, gl.getContext())`.
2. Each frame, for the current view, `binding.getDepthInformation(view)` → `depthInfo.texture` + `depthInfo.normDepthBufferFromNormView` matrix + `rawValueToMeters`.
3. Inject a depth-test snippet into `AvatarModel`'s material via `material.onBeforeCompile` (patch the fragment shader): sample the depth texture at the fragment's screen UV, convert to meters, and `if (realDepth < fragDepth) discard;`.
4. Provide a **quality toggle** and disable on devices where `getDepthInformation` is unavailable or fps drops below ~25.

**Perf:** GPU-optimized only; do not read depth back to CPU per frame. Expect this to be the heaviest phase — profile on a mid-range Pixel.

**Accept:** walking a real object between camera and pet hides the occluded parts; no-ops cleanly on devices without depth; ≥30 fps maintained.

---

## Phase 5 — Light estimation

**Goal:** the pet's lighting and reflections match the room.

**Session init:** add `'light-estimation'` to optional features (the store may expose this as `lightEstimation: true`; if not present in the v6 store options, request it by extending the session init options — pass it through `createXRStore`'s `sessionInit`/`optionalFeatures` escape hatch, or request the probe directly: `session.requestLightProbe()`).

**API:**
1. `const lightProbe = await session.requestLightProbe()`.
2. Each frame: `const estimate = frame.getLightEstimate(lightProbe)`. It exposes `primaryLightDirection`, `primaryLightIntensity`, and `sphericalHarmonicsCoefficients` (ambient).
3. Optional reflections: `XRWebGLBinding.getReflectionCubeMap(lightProbe)` → an environment cube map for PBR reflections on the pet.

**Implementation (`lightProbe.ts`):**
1. Drive the scene's `directionalLight` from `primaryLightDirection` + `primaryLightIntensity`.
2. Feed `sphericalHarmonicsCoefficients` into a `THREE.LightProbe` for ambient, or map to the hemisphere light intensity/colors.
3. If reflections are used, set `scene.environment` from the cube map and give the avatar material a modest `envMapIntensity`.
4. Smooth values frame-to-frame (small lerp) to avoid flicker.

**Accept:** in a dim room the pet is dim; near a window the lit side faces the window; no harsh popping as lighting updates.

---

## Cross-phase testing

- Real device required (ARCore-certified Android + Chrome). Emulators don't provide planes/depth/light.
- Regression each phase: non-AR viewer unaffected; enter/exit AR leaves no WebGL context leak; Phase 1/2 anchor stability still holds.
- Capability matrix to record per test device: planes? depth? light? fps with all-on.
- Keep every feature behind a runtime check; ship a settings toggle to force-disable depth (the most likely perf offender).

## Suggested order & effort

1. **Phase 5 (light)** — cheapest, biggest realism-per-effort win, lowest risk. Do first.
2. **Phase 3 (planes)** — moderate; improves placement confidence.
3. **Phase 4 (depth)** — highest effort/risk (shader + perf). Do last, behind a toggle.

## New files checklist
- `src/three/ar/planeGrid.tsx`
- `src/three/ar/occlusion.ts`
- `src/three/ar/lightProbe.ts`
- (edits) `src/three/ar/ARScene.tsx` — store options + mount the three modules inside `ARContent`.
