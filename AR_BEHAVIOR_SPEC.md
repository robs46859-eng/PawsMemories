# PawsMemories — Living Avatar & AR Objects Spec

Status: PLAN / not yet implemented
Author: drafted with Claude, 2026-07-03
Scope: (1) command the avatar, (2) autonomous "living pet" behaviors (active or idle: sleep, pee, poop, wander), (3) AR placement of pre-generated dog objects, (4) avatar interaction with those objects.

---

## 0. Why this is a real rebuild (current-state findings)

- **Rendering + AR today go through Google `<model-viewer>`** (`src/components/PetModelViewer.tsx`). It shows ONE model with its baked clips and hands AR off to the phone's native viewer (Scene Viewer / Quick Look). It cannot place multiple objects, run a behavior loop, move the avatar, or do object↔avatar interaction.
- **"Animations" today are 2D sprite sheets**, not skeletal clips. `AnimationMetadata` = `{ frameWidth, frameHeight, animations: Record<AvatarAction, {row, frames, fps}> }`; pipeline status includes `baking_sprites`. `AvatarPlaypen.tsx` / `Avatar3DPlaypen.tsx` animate sprites, not a rig.
- **`AvatarAction`** = `'eating' | 'drinking' | 'running' | 'playing' | 'sleeping' | 'photo'` (`src/types.ts:112`).
- **Needs foundation already exists**: `Avatar.food_level`, `water_level`, `last_fed`, `last_watered`. This is the seed for the ambient behavior system.
- **3D asset pipeline**: `tripo.ts` (image→mesh GLB), `blender-worker/server.js` + `agent/tools/blender_client.ts` (Blender rig/export), currently bakes sprites. Producing real skeletal clips for WebXR is a pipeline change.

### Decisions locked in (from product owner)
1. **AR**: Full WebXR world-AR (three.js + `@react-three/xr`).
2. **Objects**: Free assets from OpenGameArt.org / similar (license tracking required).
3. **Animations**: Author real clips in Blender (skeletal, retargetable).

### Hard constraints / risks to accept
- **iOS Safari has NO native WebXR AR** (as of 2025). Full WebXR AR works on Android Chrome. iOS needs a fallback: model-viewer Quick Look (single avatar only), a WebXR-polyfill runtime (e.g. 8th Wall / Variant Launch — paid), or a "non-AR 3D room" mode. **Decision needed** (see Phase 4).
- **Retargeting**: Tripo meshes vary in proportion. Authored clips must target a *canonical quadruped armature* and be retargeted onto each generated mesh, or clips won't fit. This is the hardest engineering item.
- **Asset licenses**: OpenGameArt mixes CC0 / CC-BY / GPL. Must record attribution per asset; CC-BY requires visible credit; avoid GPL for app assets. Track in `assets/objects/manifest.json`.
- **Payload/perf**: multiple GLBs + rigged avatar on mobile → use Draco/meshopt compression, texture downscale, and instancing.

---

## 1. Target architecture

```
                       ┌──────────────────────────────────────┐
                       │  React app (src/)                     │
                       │                                       │
  model-viewer  ──►    │  PetModelViewer.tsx (thumbnails,      │
  (keep, fallback)     │    iOS AR fallback, card previews)    │
                       │                                       │
  NEW three.js/r3f ──► │  three/PetScene.tsx      (in-app 3D)  │
                       │  three/ar/ARScene.tsx    (WebXR AR)   │
                       │  three/useAvatarBrain.ts (behavior FSM)│
                       │  three/objects/*         (object defs) │
                       │  three/store.ts          (zustand)    │
                       └───────────────┬───────────────────────┘
                                       │ REST
                       ┌───────────────▼───────────────────────┐
                       │ server.ts                              │
                       │  /api/avatars/:id/command   (queue)    │
                       │  /api/avatars/:id/state     (ambient)  │
                       │  /api/avatars/:id/objects   (CRUD)     │
                       │  needs decay simulation                │
                       └───────────────┬───────────────────────┘
             ┌─────────────────────────┼───────────────────────┐
             │ db.ts (SQLite)          │  blender-worker + tripo│
             │  + needs columns        │  canonical rig +       │
             │  + placed_objects table │  clip retarget +       │
             │  + object_catalog       │  rigged-GLB export     │
             └─────────────────────────┴───────────────────────┘
```

New deps: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/xr`, `zustand`, `three-stdlib` (GLTF/Draco/skeleton utils).

---

## 2. Data model changes

### 2.1 `src/types.ts`
- Extend actions:
  ```ts
  export type AvatarAction =
    | 'eating' | 'drinking' | 'running' | 'playing' | 'sleeping' | 'photo' // existing
    | 'idle' | 'walking' | 'sitting' | 'peeing' | 'pooping' | 'interacting'; // new
  ```
- New skeletal clip metadata (parallel to sprite metadata; keep both during migration):
  ```ts
  export interface SkeletalClip { name: string; loop: boolean; durationSec: number; }
  export interface RiggedModelData { modelUrl: string; clips: SkeletalClip[]; }
  ```
- Needs model:
  ```ts
  export interface AvatarNeeds {
    food: number; water: number; energy: number; bladder: number; bowel: number; // 0..100
    lastSeen: string; // ISO — for offline ambient simulation
  }
  ```
- Placed objects:
  ```ts
  export type PetObjectKind = 'dog_house' | 'food_bowl' | 'water_bowl' | 'ball' | 'bone' | 'bed' | 'hydrant' | 'chew_toy';
  export interface PlacedObject {
    id: string; kind: PetObjectKind;
    position: [number,number,number]; rotationY: number; scale: number;
    createdAt: string;
  }
  ```

### 2.2 `db.ts`
- ALTER `avatars`: add `energy`, `bladder`, `bowel` (REAL, default 100/0/0), `last_seen` (TEXT), `rigged_model_url` (TEXT), `clips_json` (TEXT).
- NEW `placed_objects(id TEXT PK, avatar_id INT FK, kind TEXT, pos_x/y/z REAL, rot_y REAL, scale REAL, created_at TEXT)`.
- NEW `object_catalog(kind TEXT PK, name TEXT, glb_url TEXT, license TEXT, attribution TEXT, default_scale REAL)`.

---

## 3. Behavior system (the "living pet")

### 3.1 Needs decay (server-authoritative, offline-aware)
- Each need decays per hour: food −X, water −Y, energy −Z (recovers while sleeping), bladder +B (fills), bowel +C.
- On any `GET /api/avatars/:id/state`, server computes elapsed since `last_seen`, applies decay, clamps 0..100, writes back, updates `last_seen`. This makes the pet "have lived" while the app was closed → it can greet the user needing to pee, hungry, etc.

### 3.2 Behavior director (client FSM) — `three/useAvatarBrain.ts`
- Inputs: current needs, command queue, nearby placed objects.
- Priority resolution each tick:
  1. **Command queue** (user-issued) wins unless a critical need overrides (e.g., bladder ≥ 95 → must pee).
  2. **Needs-driven autonomous**: bladder high → walk to hydrant/edge → `peeing`; bowel high → `pooping` (spawn+auto-cleanup prop); energy low → walk to `bed`/`dog_house` → `sleeping` (recovers energy); food low + `food_bowl` present → walk → `eating`.
  3. **Idle ambient**: wander, sniff, sit, look around, tail wag — Perlin/timer driven so it looks alive when the user is just watching.
- "User active vs not": when app focused → richer idle + responds instantly to commands; when returning after absence → play a "backlog" (e.g., pees immediately if bladder maxed) based on simulated state.
- Locomotion: simple steering (seek target, arrive, obstacle-avoid placed objects) + foot-lock via the walk clip.

### 3.3 Command system
- UI: a command bar in the playpen/AR view (buttons + optional text/voice later): Sit, Come, Lay down, Sleep, Play, Eat, Roll over, Speak.
- Client: pushes onto command queue in `three/store.ts`; FSM consumes.
- Server: `POST /api/avatars/:id/command { action }` for persistence/telemetry and so ambient logic knows recent commands. (Execution is client-side for latency.)

---

## 4. Objects & interaction

### 4.1 Asset pipeline (OpenGameArt → app)
- Curate a starter pack: dog house, food bowl, water bowl, ball, bone, bed, fire hydrant, chew toy.
- Normalize each: convert to `.glb`, Y-up, real-world scale (meters), origin at base, Draco-compress, downscale textures.
- Store under `assets/objects/<kind>.glb` + `assets/objects/manifest.json` recording `name, source_url, author, license, attribution`. Render CC-BY credits on an in-app "Credits" screen.
- Seed `object_catalog` from the manifest.

### 4.2 Placement (in-app 3D and AR)
- In-app: tap a ground plane to place selected object; drag to move, twist to rotate, pinch to scale; persist via `POST /api/avatars/:id/objects`.
- AR: WebXR hit-test on detected real-world planes → place at hit pose (Phase 4).

### 4.3 Interaction
- Each object kind exposes interaction anchors + an action mapping:
  - `food_bowl` → walk to eat anchor → `eating` (raises food, empties bowl, refill tap).
  - `water_bowl` → `drinking` (raises water).
  - `ball` / `chew_toy` → `playing`/fetch loop (raises "happiness", lowers energy).
  - `bed` / `dog_house` → `sleeping` (recovers energy).
  - `hydrant` → `peeing` target (empties bladder).
- The behavior director treats present objects as available "affordances," so the autonomous pet uses whatever you've placed.

---

## 5. Blender clip authoring pipeline (the fidelity path you chose)

Goal: a shared set of high-quality skeletal clips that retarget onto any generated pet mesh.

1. **Canonical quadruped armature** (one rig) authored once in Blender.
2. **Auto-rig / retarget** the Tripo mesh to the canonical armature (weight transfer / Meshy-style retarget) in `blender-worker`.
3. **Author clips** against the canonical rig: `idle`, `walk`, `run`, `sit`, `sleep`, `eat`, `drink`, `play`, `pee` (leg-lift), `poop` (squat), `roll_over`, `speak/bark`.
4. **Export** one rigged GLB per avatar with all clips as glTF animation tracks + a `clips_json` manifest. Replaces (or supplements) sprite baking.
5. New pipeline stage: `generation_status` gains `retargeting` / `baking_clips`; `rigged_model_url` + `clips_json` populated.
6. Endpoints in `agent/tools/blender_client.ts` / `blender-worker/server.js` to trigger retarget+export; reuse the existing GLB import/export guards (the data-URL-prefix strip, no-`quad` rules — see commit history).

> Bridge option: while clips are being authored, the r3f scene + behavior FSM can run on **procedural** motion so the feature is demoable before every clip exists. (Not chosen as the end state, but useful for parallelizing.)

---

## 6. Phasing & sequencing

| Phase | Deliverable | Depends on | Rough effort |
|------|-------------|-----------|--------------|
| **P1. Engine** | three.js/r3f `PetScene` renders the rigged GLB in-app, plays named clips, camera controls. model-viewer kept for thumbnails/fallback. | new deps | M |
| **P2. Behavior + commands** | Needs decay (server, offline-aware), behavior FSM (idle/wander/sleep/pee/poop), command bar. | P1 | L |
| **P3. Objects** | Asset pack + manifest, catalog, placement UI, avatar navigates to & interacts with objects. | P1, P2 | L |
| **P4. WebXR AR** | `@react-three/xr` world-AR: plane hit-test placement, avatar+objects anchored in real room. **iOS fallback decision.** | P1–P3 | L |
| **P5. Blender clips** | Canonical rig + retarget + authored clip set exported as rigged GLB; pipeline stages. | parallel; feeds P1/P2 | XL |

Recommended start: **P1 + P2** (biggest visible value — a pet that obeys commands and acts alive — and everything else builds on the r3f scene). AR (P4) after the scene and behaviors are solid.

---

## 7. Open decisions before coding
1. **iOS AR fallback**: (a) accept Android-only WebXR + iOS uses model-viewer Quick Look for single-avatar view, (b) pay for an iOS WebXR runtime (8th Wall / Variant Launch), or (c) add a non-AR "3D room" mode for iOS. Recommend (a) for v1.
2. **Needs decay rates & which needs are visible** to the user (bars) vs. purely ambient.
3. **Command surface** for v1 (button set) and whether voice/text is in scope later.
4. **Starter object list** final set + any brand-specific ones you want generated instead of sourced.
5. **Server-authoritative vs client** for behavior execution (recommend client for latency, server for needs/state).

---

## 8. First concrete step (P1) — files to create/change
- `package.json`: add `three @react-three/fiber @react-three/drei @react-three/xr zustand three-stdlib`.
- `src/three/PetScene.tsx`: r3f `<Canvas>`, GLTF load of `rigged_model_url` (fallback `model_url`), `useAnimations` clip playback, ground + lighting.
- `src/three/store.ts`: zustand store (current clip, command queue, placed objects, needs).
- `src/types.ts`: add new `AvatarAction`s, `SkeletalClip`, `RiggedModelData`, `AvatarNeeds`, `PlacedObject`.
- Wire `PetScene` into `AvatarDashboard`/playpen behind a feature flag so the sprite path keeps working during migration.
- No server change required for P1 (renders existing `model_url`); needs/commands land in P2.
