# Phase 8 — Industry-Level Animation Tooling (Coding-Agent Ready)

**Status:** Ready to implement
**Parent:** `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md`; builds on Phase 7.
**Theme:** Raise the Animation Studio from "plays baked clips" to a real directing tool — proper blending, retargeted clip libraries, IK, a keyframe timeline — and close the two Phase-7 MVP gaps (multi-actor cast, lighting/sound direction). **Stack-native only** (JS/Three/R3F). See §8.0 for the ozz-animation decision.

## Ground rules (unchanged)
Preserve originals; no fakery (hide/disable unbuilt features). CC0/owned/generated assets only. **Commit per step** with tests. `npm run test` + `npm run test:ar` green; `npm run lint` (`tsc --noEmit`) clean; tests via `tsx --test`. Commits finalize on the Mac.

## Execution order
Close the gaps first (they're small and already-scoped), then add tooling by ROI: **8.1 → 8.2 → 8.3 → 8.4 → 8.5 → 8.6**.

---

## 8.0 — Decision: do NOT adopt ozz-animation (documented)

`ozz-animation` is an excellent **C++** data-oriented skeletal runtime (SIMD, blend trees, IK) built for native game engines; it compiles to WASM. We are **not** adopting it because:
- It's renderer-agnostic C++ — integrating means a WASM build in CI, and bridging ozz's model-space matrices into Three.js `SkinnedMesh` bones every frame across the JS↔WASM boundary (real cost + maintenance).
- Its advantage is performance at **scale** (hundreds+ of characters / heavy blend trees). The studio animates a handful of avatars, where Three.js `AnimationMixer` is already sufficient.
- **Revisit criteria:** only reconsider if we render crowds, need a shared deterministic sampler between a C++ service and the web, or hit a measured `AnimationMixer` performance wall. Record any such trigger here before reopening.

The industry-level wins for our stack are Three-native: real crossfade blending, retargeting, IK, and a keyframe timeline (Theatre.js). Those are §§8.3–8.6.

---

## 8.1 — Multi-actor cast assignment (Phase-7 gap #1)

Today the director executor drives only the first actor. Wire real role→avatar mapping.
- In the Director Scripts panel, when a script with `roles.length ≥ 1` is picked, render a cast-assignment row per role: each role → a dropdown of the user's ready avatars (reuse the §7.3 `filterReadyAvatars`/`resolveAvatarGlbUrl` helpers). Persist the mapping in `castAssignments: Record<roleId, actorId>` state.
- On "Apply", add/replace each assigned avatar as a `SceneController` actor tagged with its `roleId`.
- In the timeline loop, change the runScript consumption to iterate **all** `clipTargets` and drive each mapped actor's `SceneController` by `roleId` (not just `Object.values(...)[0]`).
- Missing/unassigned roles are skipped with a visible note (no fakery).
- **Acceptance:** a 2-cast script (e.g. "Two-Dog Play") drives both avatars with their own clips. **Test** `tests/director_cast.test.mjs`: role→actor resolution maps every role; unassigned roles are skipped, not defaulted.

## 8.2 — Lighting + sound direction from scripts (Phase-7 gap #2)

`runScript` already returns `lightTarget` and `soundTarget`, but the loop ignores them.
- Apply `lightTarget` through the existing `lightingRig` (set time-of-day/intensity overrides on the active lighting profile) and `soundTarget` through the `SoundSystem` (trigger the named cue at its gain).
- Add `weatherTarget` support to `runScript` (schema already allows a `weather` event type — add it) and apply it.
- **Acceptance:** a script's lighting/sound/weather cues visibly change the scene at their timestamps. **Test** extend `tests/scene_scripts_director.test.mjs`: `runScript` surfaces light/sound/weather at the right times.

---

## 8.3 — Real animation blending / crossfades (`AnimationMixer.crossFadeTo`)

Phase 1 deferred crossfades under "no fakery." Now build them for real using Three's native API.
- In `createAnimationController`/`SceneController`, add `crossfadeTo(clipName, duration)` using `AnimationAction.crossFadeTo`/`fadeIn`/`fadeOut` with proper `mixer.update(dt)` timing. Keep hard `selectClip` as the default; crossfade is opt-in.
- Extend the director script `clip` event with an optional `blend: seconds` so sequences transition smoothly instead of snapping.
- **Acceptance:** switching clips can smoothly blend; the transport still supports instant cut. **Test** `tests/animator_crossfade.test.mjs`: the controller schedules a crossfade of the requested duration and ends on the target action weight = 1.

## 8.4 — Retargeting + a curated clip library (grow "more accurate animations")

Give models a richer, shared motion set beyond what the Blender worker bakes.
- **Server:** a curated **CC0 clip library** per skeleton class (quadruped/biped), stored as GLB/animation-only assets in the bucket, served via `GET /api/scenes/clips?skeleton=…`. Only CC0/owned — license-checked like environments.
- **Client retarget:** use `SkeletonUtils.retargetClip` (three examples) to map a library clip onto the loaded avatar's skeleton. **Known issue to handle:** `retargetClip` is off-by-one frame and finicky with Mixamo naming — normalize bone names to the `SKELETON_CONTRACTS` map and pad the missing frame. Prefer the already-wired **Tripo `startRetarget`** path (server-side, tested) when a durable retargeted GLB is wanted; use client `retargetClip` for live preview only.
- Skip clips whose required bones aren't in the model (no fakery).
- **Acceptance:** a user can apply a library "run"/"sit" to an avatar that didn't bake it. **Test** `tests/clip_retarget.test.mjs`: bone-name normalization maps library→contract; incompatible skeletons are rejected, not silently mangled.

## 8.5 — IK polish in the studio (foot/ground + look-at)

You already have `buildLegIK`/`headLookAt`/`clampSlope` in `src/three/ar/ik.ts` (AR-tested). Port them to the studio so feet plant on the ground plane and the head can track the camera/a target.
- Add an optional per-actor "Ground IK" toggle (planted feet on the stage plane) and "Look at camera" toggle, reusing the AR IK utilities inside the Canvas.
- **Acceptance:** feet stop floating/clipping on uneven poses; head can face the camera. **Test** `tests/studio_ik.test.mjs`: reuse/extend the AR IK unit tests against a studio rig.

## 8.6 — Keyframe timeline tool: adopt Theatre.js (`@theatre/r3f`)

The industry-standard, R3F-native sequencer. Gives a real timeline/NLE with keyframes, easing, and scrubbing — turning the studio into an authoring tool, not just a player.
- Add `@theatre/core` + `@theatre/studio` + `@theatre/r3f`. Wrap the studio Canvas in Theatre's `SheetProvider`; expose camera + per-actor transforms/clip-weights as Theatre props.
- **Ship the studio editor behind an admin/advanced flag** (Theatre's UI is a pro tool); regular users keep the simple director-script flow. Persist authored sheets to the existing project store so a user's sequence saves/loads.
- Keep it additive — the existing `SceneSequence`/director scripts remain the simple path; Theatre is the "pro mode."
- **Acceptance:** an advanced user keyframes a camera move + clip change on a timeline and plays it back; regular UI unchanged. **Test** `tests/theatre_integration.test.mjs`: project save/load round-trips a Theatre sheet; the flag hides it by default.

---

## Checklist
- [ ] 8.0 Record the ozz decision + revisit criteria (this doc)
- [ ] 8.1 Cast assignment UI + per-role executor; `director_cast` test
- [ ] 8.2 Apply light/sound/weather from scripts; extend `scene_scripts_director` test
- [ ] 8.3 `crossfadeTo` blending + optional `blend` on clip events; `animator_crossfade` test
- [ ] 8.4 CC0 clip library endpoint + retarget (Tripo durable / `retargetClip` preview); `clip_retarget` test
- [ ] 8.5 Port AR IK (ground + look-at) into the studio; `studio_ik` test
- [ ] 8.6 Theatre.js pro-mode timeline behind a flag + project persistence; `theatre_integration` test

## Definition of done (per step)
`tsc --noEmit` clean · `npm run test` + `npm run test:ar` green · scoped commit with its test · no fakery · CC0/owned/generated assets only · new pro features gated, never forced on mobile/regular users.

## Dependencies to add (all JS, stack-native)
`@theatre/core`, `@theatre/studio`, `@theatre/r3f` (8.6). `SkeletonUtils` ships with three examples (no new dep). No native/WASM deps — see §8.0.
