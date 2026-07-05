# ARCore / WebXR AR — Build Spec

**Project:** Pawsome3D (pawsome3d.com)
**Scope:** Harden and extend the in-app AR experience so a user's generated 3D pet avatar can be placed convincingly on real surfaces, stay anchored, respect real-world lighting and occlusion, and (stretch) respond to printed marker images.
**Status:** Draft v1 — implementation not started.

---

## 0. Framing: "ARCore" in a web app

Pawsome3D is a **web app**, not a native Android app. Google's native ARCore SDK (Java/Kotlin/NDK) cannot be embedded in a website. On Android, **ARCore is the engine that powers WebXR** in Chrome — so we get ARCore's motion tracking, plane detection, hit-testing, depth, and light estimation **through the WebXR Device API**, not through the native SDK.

Therefore this spec = **"implement the ARCore feature set via WebXR, with a non-WebXR fallback for iOS."**

Platform strategy (already partially in place):

| Platform | Path | Engine | File |
|---|---|---|---|
| Android Chrome (+ ARCore-supported device) | WebXR `immersive-ar` | ARCore (via browser) | `src/three/ar/ARScene.tsx` (`@react-three/xr`) |
| iOS Safari (no WebXR AR) | 8th Wall (XR8) SLAM | 8th Wall engine | `src/three/ar/eighthWallAR.ts`, `EighthWallARView.tsx` |
| Desktop / unsupported | Non-AR 3D viewer | three.js orbit | `src/three/PetScene.tsx` |

The goal of this build is to bring the **WebXR path to feature parity with ARCore's core capabilities** and make placement robust, then keep the 8th Wall path as the iOS fallback.

---

## 1. ARCore concept → WebXR API mapping

| ARCore concept (Google docs) | WebXR mechanism | Notes |
|---|---|---|
| Motion tracking (SLAM, 6DoF pose) | `immersive-ar` session + `XRFrame.getViewerPose()` | Provided automatically by ARCore under Chrome. |
| Environmental understanding — **planes** | `plane-detection` feature → `XRFrame.detectedPlanes` | Optional feature; not on all devices. |
| **Hit testing** (tap → ray → surface) | `hit-test` feature → `XRSession.requestHitTestSource()` | Already used via `useXRHitTest` in `ARScene.tsx`. |
| **Anchors / trackables** | `anchors` feature → `XRHitTestResult.createAnchor()` / `XRAnchor` | Core hardening item — placements must anchor, not just sit at a static matrix. |
| Oriented points (angled surfaces) | Hit-test pose orientation | Use the full pose quaternion from the hit result, not just position. |
| **Depth understanding** (occlusion) | `depth-sensing` feature → `XRFrame.getDepthInformation()` | Enables real objects to occlude the pet. Device-dependent. |
| **Light estimation** | `light-estimation` feature → `XRLightProbe` / `XRFrame.getLightEstimate()` | Match avatar lighting + reflections to the room. |
| **Augmented Images** | No native WebXR equivalent | Implement via marker tracking (8th Wall image targets) or a JS CV lib; Android WebXR has no image-tracking module. Stretch goal. |

**Feature-detection rule:** every feature above must be requested as `optionalFeatures` and gracefully degraded if `XRSession` doesn't grant it. Never hard-require anything beyond `hit-test`.

---

## 2. Current state (audit)

- `ARScene.tsx` — WebXR via `@react-three/xr`: `createXRStore`, `useXR`, `useXRHitTest`. Has a hit-test reticle and tap-to-place. Checks `isSessionSupported("immersive-ar")`; falls back to 8th Wall when unsupported.
- `eighthWallAR.ts` / `EighthWallARView.tsx` — 8th Wall (XR8) engine loaded from CDN (`@8thwall/engine-binary`) for iOS; custom pipeline module with hit-test reticle and per-frame updates.
- `ARCommandOverlay.tsx`, `ARObjectOverlay.tsx` — DOM overlay UI for in-AR commands and object palette.
- `src/three/objects/placement.ts`, `catalog.ts` — object placement math + catalog.
- **Persistence:** `placed_objects` table (`id, avatar_id, user_phone, kind, pos_x/y/z, rot_y, scale`) with `GET/POST/DELETE /api/avatars/:id/objects`.

**Gaps to close:**
1. Placements use a static world matrix, not a real **XRAnchor** → drift as ARCore refines its map.
2. No **plane visualization** (users can't see where surfaces are detected).
3. No **depth occlusion** → pet renders "in front of" real furniture.
4. No **light estimation** → pet lighting doesn't match the room.
5. Reticle uses position only; **surface orientation** (oriented points) not applied on angled surfaces.
6. No graceful capability messaging (why AR is/ isn't available on this device).
7. Augmented Images not implemented.

---

## 3. Target architecture

```
AR entry (Avatars screen → "AR Mode")
        │
        ▼
  capability probe  ──► not supported ──► non-AR PetScene + guidance card
        │ supported
        ▼
  Platform router
    ├─ Android/WebXR ──► ARScene (immersive-ar)
    │       session optionalFeatures: [hit-test, anchors, plane-detection,
    │                                   depth-sensing, light-estimation, dom-overlay]
    │       frame loop: hit-test → reticle(pose) → tap → createAnchor → attach avatar
    │                   plane update → optional plane grid
    │                   depth → occlusion material
    │                   light estimate → env intensity + SH
    └─ iOS ──► EighthWallARView (8th Wall SLAM + image targets for Augmented Images)
        │
        ▼
  Persistence: placed_objects (+ new anchor metadata) via /api/avatars/:id/objects
```

Single shared **AR state store** (extend `src/three/store.ts`) holds: session status, granted features, active avatar, placed objects, and per-object anchor handles.

---

## 4. Implementation phases

Each phase ships independently and must degrade gracefully. Acceptance criteria are testable on a Pixel-class Android device.

### Phase 1 — Session + hit-test + oriented placement (hardening)
- Request session with `requiredFeatures: ['hit-test']`, `optionalFeatures: ['anchors','plane-detection','depth-sensing','light-estimation','dom-overlay']`.
- Reticle follows hit-test result using **full pose** (position + orientation) so it lies flat on angled surfaces (oriented points).
- Tap places the avatar at the reticle pose.
- **Files:** `ARScene.tsx`, `placement.ts`.
- **Accept:** reticle hugs floor and a tilted surface (e.g., a ramp/sofa cushion); tap drops the pet at the correct spot and orientation.

### Phase 2 — Anchors (stop the drift) *(highest-value hardening)*
- On tap, call `hitTestResult.createAnchor()`; store the returned `XRAnchor`.
- Each frame, read the anchor's pose from `XRFrame.getPose(anchor.anchorSpace, refSpace)` and drive the avatar's transform from it (not a frozen matrix).
- Detach anchors on object removal (ARCore cost note: reuse/free anchors).
- Persist a placement record to `placed_objects`; anchors themselves are session-scoped (WebXR has no cross-session persistent anchors without a cloud anchor service — see §6).
- **Files:** `ARScene.tsx`, `store.ts`, `db.ts` (optional new columns), `server.ts` objects endpoints.
- **Accept:** placed pet stays locked to the same real-world spot when the user walks around and back; no visible sliding.

### Phase 3 — Plane detection & visualization
- Consume `frame.detectedPlanes`; render a subtle grid/shadow where horizontal planes are found.
- Only allow placement on detected planes when available (fall back to raw hit-test otherwise).
- **Accept:** a faint surface indicator appears on the floor/table; placement snaps to it.

### Phase 4 — Depth (occlusion)
- Enable `depth-sensing` (`usage: ['gpu-optimized']`, `dataFormat: ['luminance-alpha']`).
- Sample `frame.getDepthInformation(view)` in a shader; discard/oclude avatar fragments behind real geometry.
- **Accept:** walking a real chair between camera and pet correctly hides the pet's occluded parts. Gracefully no-op on devices without depth.

### Phase 5 — Light estimation
- Enable `light-estimation`; each frame read `XRLightProbe` primary light direction/intensity + spherical-harmonics ambient.
- Drive the three.js scene's ambient + directional light and (if present) environment intensity so the pet matches room lighting.
- **Accept:** in a dim room the pet is dim; near a window the lit side matches the window direction.

### Phase 6 — DOM overlay controls polish
- Keep `ARCommandOverlay`/`ARObjectOverlay` via `dom-overlay`; ensure buttons (place, remove, scale, rotate, exit) work in-session and don't intercept placement taps.
- **Accept:** all overlay actions function during an active AR session on Android + iOS.

### Phase 7 — Augmented Images (stretch)
- **iOS/8th Wall:** use 8th Wall Image Targets — compile a target set (e.g., a printed Pawsome3D card / product packaging), trigger the pet to "pop out" of the image.
- **Android/WebXR:** no native image tracking; either (a) skip, or (b) use a lightweight JS marker lib as a separate mode. Recommend **iOS-only via 8th Wall** for v1.
- **Accept:** pointing the camera at the registered image spawns/animates the pet anchored to the image.

---

## 5. Data model & persistence

Reuse `placed_objects` for the pet + accessory placements. Optional additions:

```sql
ALTER TABLE placed_objects ADD COLUMN surface_type VARCHAR(16) NULL;  -- 'plane' | 'point'
ALTER TABLE placed_objects ADD COLUMN rot_x FLOAT NOT NULL DEFAULT 0; -- full orientation
ALTER TABLE placed_objects ADD COLUMN rot_z FLOAT NOT NULL DEFAULT 0;
```

Note: WebXR **anchors are session-local**. Persisting a placement across sessions stores the *relative transform* only; the pet reappears in the non-AR viewer at that transform, and re-anchors fresh each AR session. True cross-session world persistence requires a **Cloud Anchors**–style service (out of scope for v1; see §6).

---

## 6. Out of scope / future

- **Cloud/persistent anchors** across sessions and users (would need ARCore Cloud Anchors or 8th Wall VPS — a paid, server-backed feature).
- **Shared/multiplayer AR** (the "virtual dog park" Community coming-soon card).
- Android WebXR image tracking (no browser API today).

---

## 7. Device & browser support matrix

| Device | AR available? | Path | Depth | Light est. | Planes |
|---|---|---|---|---|---|
| Pixel / modern Android + Chrome (ARCore-certified) | Yes | WebXR | Usually | Yes | Yes |
| Older/uncertified Android | No WebXR AR | 8th Wall or non-AR | — | — | — |
| iPhone (Safari/Chrome) | No WebXR AR | 8th Wall SLAM | No | Limited | No |
| Desktop | No | Non-AR PetScene | — | — | — |

Gate every feature behind runtime detection; show a clear "AR not supported on this device — here's the 3D viewer instead" card.

---

## 8. Testing plan

1. **Capability probe unit test:** mock `navigator.xr.isSessionSupported` and `requestSession` grant/deny for each optional feature → correct UI branch.
2. **On-device (Android):** floor + table + angled-surface placement; walk-around anchor stability; occlusion behind a real object; lighting match in bright vs dim rooms.
3. **On-device (iOS):** 8th Wall session boots, reticle + tap-to-place work, overlay controls function; (Phase 7) image target triggers.
4. **Regression:** non-AR viewer unaffected; exiting AR returns cleanly; no WebGL context leaks across enter/exit cycles.
5. **Performance:** sustained ≥30 fps with avatar + depth occlusion on a mid-range Pixel; watch GPU memory across repeated place/remove.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Feature not granted on device | All non-essential features optional; degrade silently. |
| Anchor drift / jitter | Read anchor pose every frame; smooth with a small low-pass filter. |
| Depth occlusion perf cost | GPU-optimized depth; allow a quality toggle; disable on low-end. |
| iOS has no WebXR | Keep 8th Wall path (already present) as the iOS engine. |
| 8th Wall licensing/quota | Confirm the free `@8thwall/engine-binary` tier limits before launch. |
| Cross-session persistence expectations | Document that v1 re-anchors per session; cloud anchors are a future paid add-on. |

---

## 10. Acceptance criteria (v1 "done")

- On a supported Android device: enter AR, see a reticle that lies flat on floor and angled surfaces, tap to place the user's own generated pet, and the pet **stays anchored** as you move around.
- Lighting on the pet roughly matches the room; real objects occlude it where depth is available.
- Overlay controls (place / remove / scale / rotate / exit) work in-session on Android and iOS.
- Unsupported devices get a clear fallback to the 3D viewer with an explanation.
- No regressions to the non-AR experience; clean enter/exit with no context leaks.

---

## 11. File-change checklist

- `src/three/ar/ARScene.tsx` — session feature requests; anchor lifecycle; oriented reticle; depth + light hooks.
- `src/three/store.ts` — AR session/feature/anchor state.
- `src/three/ar/planeGrid.tsx` *(new)* — plane visualization.
- `src/three/ar/occlusion.ts` *(new)* — depth-sensing material/shader.
- `src/three/ar/lightProbe.ts` *(new)* — light-estimation → scene lights.
- `src/three/ar/eighthWallAR.ts` — image-target support (Phase 7).
- `src/components/ARCommandOverlay.tsx`, `ARObjectOverlay.tsx` — control polish.
- `db.ts` / `server.ts` — optional `placed_objects` orientation columns.
- Capability-probe + branch UI on the Avatars screen ("AR Mode" entry).

---

*Cross-reference: `AR_BEHAVIOR_SPEC.md` (existing behavior spec) and `BLENDER_RIG_PIPELINE.md` (how the rigged GLB the AR scene loads is produced).*
