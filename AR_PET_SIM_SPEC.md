# AR_PET_SIM_SPEC.md
# Pawsome3D — Vision-Driven Articulated AR Virtual Pet Simulator
# (Photo → Breed-Aware Rigged Avatar → Living AR Companion)

**Version:** 1.0 · **Date:** 2026-07-06 · **Status:** Ready for implementation
**Supersedes:** the current AR feature set in `src/three/ar/` and the Phase 1–5 living-avatar
behavior in `src/three/useAvatarBrain.ts` / `src/three/needs.ts` (reused where noted, overwritten where noted).

---

## 0. Platform Decision (read first)

The research doc this spec implements assumes **Unity + Niantic Lightship ARDK**. That is a
full native-app rewrite. Reality check (verified July 2026):

| | Option A — Web (RECOMMENDED NOW) | Option B — Unity + Lightship (LATER) |
|---|---|---|
| Stack | Existing: React + three.js + WebXR (Android) + open-source 8th Wall engine (iOS) | New: Unity 6 + ARDK UPM package, C# |
| Occlusion | WebXR Depth API on Android Chrome; iOS fallback = footprint shadows + no occlusion | Real per-pixel depth occlusion, no LiDAR needed |
| Semantic surfaces (grass/water/furniture) | Approximated: vision-LLM snapshot classification (§6.4) | Native 20-channel semantic segmentation |
| Multiplayer shared space | Defer | VPS + shared AR (up to 10 players) |
| Distribution | Instant — it's your existing website | App Store review, $99/yr Apple + $25 Google |
| Coding-agent friendliness | High (TS/React — agents excel) | Low (Unity scenes don't diff well; agents struggle) |
| New accounts needed | None | Unity ID, Lightship key, Apple Dev, Google Play |
| Cost | $0 platform | Lightship core free; multiplayer free <50k MAU; store fees |

**Decision: build Option A now** (Milestones AR1–AR9), keeping the behavior engine, breed
profiles, and all backend endpoints **platform-agnostic** so an Option B Unity client can be
added later without redoing the brain. 8th Wall's hosted service shut down Feb 2026; the
open-source engine binary the repo already loads is the supported path — pin the version.

---

## 1. Existing Code: Reuse vs Overwrite

| File | Verdict |
|---|---|
| `src/three/ar/eighthWallAR.ts` (256 ln) | REUSE — camera/SLAM bootstrap stays; pin engine version; add hooks for lighting + reticle |
| `src/three/ar/ARScene.tsx`, `EighthWallARView.tsx` | OVERWRITE — replaced by `ARPetStage` (§6) with occlusion, IK, semantic zones |
| `src/three/useAvatarBrain.ts` (181 ln) | OVERWRITE — priority-if/else brain replaced by Utility AI + Behavior Tree (§4). Keep its rAF-loop + zustand + offline-sync patterns |
| `src/three/needs.ts` | EXTEND — 2→5 drives, personality weights, breed modifiers |
| `src/three/AvatarModel.tsx`, `clipMap.ts`, 15 skeletal clips incl. tail_wave engine | REUSE — clips become Behavior-Tree leaf actions |
| `src/three/objects/*` (catalog, placement) | REUSE — objects gain `utilityTags` (§4.3) |
| `src/components/ARCommandOverlay.tsx`, `ARObjectOverlay.tsx` | OVERWRITE — new gesture + voice + button UI (§7) |
| Tripo multiview pipeline + palette-lock (server) | REUSE — extended with rigging + breed stage (§3) |
| blender-worker | REUSE — adds a `bake-lod` job for mobile-budget GLBs |
| MySQL avatars/credits/ledger | REUSE — new tables §8 |

---

## 2. Research-Concept → Buildable-Equivalent Map

Be honest about what the academic doc describes vs what one dev + cheap coding agents can ship.
Every §-reference below is to this spec.

| Research concept | What we actually build | Why |
|---|---|---|
| SMAL parametric model + SDF refinement + CDOG LoRAs | **Tripo image→3D (existing) + Tripo Rigging v2.5 auto-quadruped-rig** (§3.1). Tripo's UniRig handles quadrupeds natively | Training SMAL/LoRA pipelines is a research project; Tripo gives rigged quadruped GLBs via the API key you already have |
| 3D Gaussian Splatting mobile avatar | **Rigged GLB + blender-worker LOD bake** (≤30k tris, 1024² atlas, ≤40 bones) (§3.3) | 3DGS animation on mobile web is bleeding-edge; glTF skinning is proven in your engine |
| CNN+SIFT+PCA+GWO+SVM 120-breed classifier | **One multimodal-LLM call returns breed + physical + temperament JSON** (§3.2) | The 2015-era SIFT/SVM stack is obsolete; a vision LLM matches or beats it with zero training |
| Facial keypoints (Columbia 8-landmark) | Same LLM call returns approximate landmark boxes; used only for ear/snout scale hints | Dedicated keypoint model = optional Phase 2 |
| Neural-endocrine lobes + Hebbian synapses | **5 drives + hormone-style global modifiers + reinforcement table** (§4.2, §5) | Captures the observable behavior (mood shifts, learned tricks) without a fake neural net |
| Utility AI ∏Cᵢ(xᵢ)^pᵢ | Implemented exactly as specified (§4.1) | Cheap, testable, right tool |
| Behavior Trees | Implemented (§4.4) via a tiny hand-rolled BT (~150 lines), not a library | Keeps agent-editable |
| Lightship semantic segmentation | **Semantic snapshot**: 1 camera frame → vision LLM → zone polygons (grass/floor/furniture/water) cached per session (§6.4) | No per-pixel realtime segmentation on web; snapshot is 90% of the gameplay value |
| Depth occlusion | WebXR Depth API (Android); iOS: soft-shadow grounding + "behind-furniture = fade" heuristic from semantic zones (§6.2) | iOS Safari/WebXR has no depth access |
| Lighting estimation | WebXR Lighting Estimation API (Android); iOS: average camera-frame luminance + color temperature sampling (§6.3) | Good-enough grounding |
| IK paw placement | three.js CCDIKSolver on 4 leg chains + raycast to AR mesh/floor plane (§6.5) | Supported by the rigs Tripo produces |
| VPS shared multiplayer | DEFERRED to Option B | Requires Lightship/native |
| ASR voice training | **Web Speech API** (free, on-device) + Double-Metaphone + Levenshtein phonetic matching (§7.2) | No new account; works Chrome+Safari |
| FluentPet-style spatial buttons | AR-anchored button entities + recorded audio blobs in B2 (§7.3) | Straight-forward |
| Aging/mortality toggles | Settings-driven aging with OFF default (§5.4) | Wobbledogs-style grief management |

---

## 3. Pipeline: Photo → Breed-Aware Rigged Avatar

### 3.1 Generation & rigging (server, extends existing Tripo flow)

```
[user photo] → existing multiview Tripo task (palette-lock preserved)
            → NEW: Tripo Rigging v2.5 request on the generated model
              POST platform.tripo3d.ai /v2/openapi/task
              { "type": "animate_rig", "original_model_task_id": "<gen task id>",
                "out_format": "glb", "spec": "tripo" }        // verify exact body in Tripo docs
            → poll task → rigged GLB (quadruped skeleton via UniRig)
            → blender-worker job "bake-lod": decimate ≤30k tris, atlas 1024²,
              rename bones to canonical map (spine.001.., leg.FL.upper.. etc),
              validate 4 leg chains exist → upload GLB to B2
```

- Retarget check: the 15 existing clips must play on the new skeleton. blender-worker
  `bake-lod` includes a retarget step mapping Tripo bone names → the clip skeleton
  (Blender Rokoko-style bone mapping table checked into `worker/bonemap.json`).
  If retarget confidence < threshold, fall back to Tripo's own animation presets
  (walk/run/idle available from their animate tasks) and log for manual review.

### 3.2 Breed & profile classification (server, one LLM call)

`POST /api/pets/classify` (called right after photo upload, parallel to Tripo):

```
LLM (LLM_MODEL via OpenRouter, image input) system prompt:
"Identify the dog. Return STRICT JSON:
{ breed: string, breed_confidence: 0-1, breed_top3: [...],
  size_class: 'toy|small|medium|large|giant',
  build: { legLengthRatio: n, snoutLengthRatio: n, earType: 'erect|floppy|semi',
           tailType: 'curly|straight|docked|plume', coat: 'short|medium|long|double' },
  temperament: { energy: 0-1, sociability: 0-1, stubbornness: 0-1,
                 foodMotivation: 0-1, vocality: 0-1 },
  faceLandmarks: { leftEye:[x,y], rightEye:[x,y], nose:[x,y] }  // normalized 0-1
}"
Validate with zod; on parse failure retry once at temperature 0.
```

Breed → gameplay parameter table (`server/breedProfiles.ts`): a static map for the ~60
most common breeds + a `size_class` fallback for everything else. Each profile sets:
skeleton scale, drive decay multipliers (hunger/thirst/tiredness), exercise requirement,
compliance base rate, mouth-hitbox radius for catch minigames, bark audio set.
Examples per the design doc: Pug → scale 0.7, tiredDecay ×1.5, mouthHitbox ×0.8;
Husky → scale 1.15, exerciseNeed ×1.6, hungerDecay ×1.3.

### 3.3 Asset budget (hard limits enforced by bake-lod)

≤30k triangles, ≤40 bones, 1×1024² texture, ≤4 MB GLB, clips resampled to 24 fps.
Reject-and-retry at higher decimation if over budget.

---

## 4. Behavior Engine (overwrites useAvatarBrain)

New module tree `src/brain/` (framework-agnostic TS — no React imports, so Option B can
port it to C# mechanically):

```
src/brain/
  drives.ts        // 5 drives + decay/recovery + breed modifiers
  hormones.ts      // global modifiers (§4.2)
  utility.ts       // scorer (§4.1)
  considerations.ts// curve library: linear, quadratic, logistic, inverse
  actions.ts       // action catalog with per-action considerations
  behaviorTree.ts  // tiny BT: Sequence/Selector/Parallel/Decorator + leaf registry
  trees/*.ts       // one BT per action (eat, drink, nap, fetch, dig, greet, ...)
  reinforcement.ts // touch reward/punish → weight updates (§4.5)
  brain.ts         // tick(dt): decay → utility select → BT execute; exposes events
```

### 4.1 Utility selection — exactly the doc's formula

`U_a = w_a · Π C_i(x_i)^{p_i}` with `w_a` = personality weight (from temperament §3.2),
considerations in [0,1], exponents `p_i` tuning sensitivity. Add fuzzy noise:
final `U'_a = U_a · (1 + rand(-0.08, +0.08))`; re-select at most every 1.5 s or on event.
Player-interacted stimuli (thrown ball) get a bonus consideration that decays
`e^(-t/20s)`; ambient objects use a flat low bonus — per the design doc.

### 4.2 Drives & hormones

Drives (0–100): hunger, thirst, tiredness, playfulness, happiness. Decay/gain rules per
the design doc §Behavioral Dynamics, multiplied by breed modifiers. Extreme states create
override considerations (starving → may "eat" a real-world object flagged in the semantic
snapshot; very thirsty → seeks water zone; both mirror the doc's misbehavior rules).
Hormones = 3 slow global scalars — excitement, stress, affection — raised/lowered by events
(play, scolding, neglect) with exponential return-to-baseline; they multiply into
consideration curves (e.g. high stress flattens compliance).

### 4.3 Object tags

Every catalog object gains `utilityTags: ('food'|'water'|'toy'|'rest'|'dig'|'social')[]`
so considerations can query "nearest object with tag X" — reuses the existing placement
store; walk-to-object logic ported from the old brain.

### 4.4 Behavior Trees

Utility picks the GOAL; a per-goal BT executes it: pathfind (steer around un-walkable
semantic zones §6.4) → orient → play clip(s) → apply drive recovery → emit vocalization.
BT leaves are the existing 15 clips + new composite sequences. No diagnostic bars in the
UI (doc requirement): needs are communicated via body language mapping table
(`drives→idle-clip variants + ear/tail poses + whine/bark`).

### 4.5 Reinforcement (Hebbian-lite) + gestures

Touch gestures on the pet (§7.1): long-slow drag = stroke → reward; fast flick = "slap"
→ punish. Reward/punish adjusts (a) per-action `w_a` at the moment of the gesture
(credit assignment to current/last action, ±0.05 clamped [0.2, 2.0]) and (b) per-command
compliance probability (§7.2). This is stored per-pet (§8) — the "synaptic weights" of the
doc, minus the neural cosplay.

### 4.6 Aging & mortality (§5.4 settings)

`aging: off | slow | realistic` (default **off**), lifespan slider, mortality toggle
(default off). Life stages puppy/adult/senior scale energy + clip playback speed.
Death (if enabled) → memorial album entry in existing Albums feature; never delete data.

### 4.7 Dual-loop progression + adaptive pacing

Inner loop: daily care (feed/water/groom/play) → trainer points. Outer loop: points +
credits unlock decor, toys, trials, extra pets. `pacing.ts` implements the AI-storyteller
rule: neglect penalties disabled until trainer score > S1; new mechanics
(voice training → buttons → trials) unlock in fixed order gated by score, so complexity
ramps with familiarity. All thresholds in one tunable config.

---

## 5. (merged into §4.2/§4.5/§4.6 above)

---

## 6. AR Stage (overwrites ARScene)

`src/three/ar/ARPetStage.tsx` — one component, two backends (WebXR / XR8), shared scene graph.

### 6.1 Tracking & floor
Android: WebXR immersive-ar + hit-test + anchors + (if available) plane detection &
scene mesh. iOS: XR8 SLAM (existing bootstrap) + horizontal plane estimate. Reticle
placement flow reused from current code.

### 6.2 Occlusion
Android: WebXR Depth API → depth texture → `occlusionMaterial` depth-test pass (three.js
`onBeforeRender` compare). iOS fallback: none per-pixel — instead (a) soft contact shadows
(THREE.ShadowMaterial on floor plane), (b) semantic-zone fade: if pet path crosses a
furniture zone from the snapshot, fade pet opacity 1→0.85 (sells depth cheaply).
Capability-detect and degrade silently.

### 6.3 Lighting
Android: WebXR Lighting Estimation (spherical harmonics → three.js LightProbe +
directional). iOS/fallback: sample camera frame每 2 s → average luminance + RGB color
temperature → lerp ambient + key light. (Camera frames accessible from XR8 pipeline.)

### 6.4 Semantic snapshot (replaces Lightship segmentation)
On session start (and on user "rescan" button): capture 1 camera frame → send to
`POST /api/ar/semantic-scan` → vision LLM returns zone polygons in screen space with
classes {natural_ground, artificial_ground, water, seating, vegetation, obstacle} →
project onto floor plane using current camera pose → store as 2D navmesh cost regions:
grass 1.0, artificial 1.2, water 5.0, seating 2.5, vegetation ∞ — the doc's exact cost
table, including its behavior triggers (dig/roll on grass, drink at water, jump-rest on
seating if tired, perimeter-sniff vegetation). Zones are static per placement; that's fine
because sessions are minutes long. Cache result per anchor to avoid repeat LLM cost.

### 6.5 IK & grounding
CCDIKSolver chains for 4 legs + head-look-at (at user camera or active object).
Paw raycast to plane/mesh, pelvis height adjust, max slope clamp. Walls/furniture
zones act as nav obstacles (no clipping per doc).

---

## 7. Interaction Layer

### 7.1 Touch gestures
Pointer-events on pet raycast hit: classify by velocity + duration → stroke | slap | tap
(tap = get attention). Feed/water/groom via existing object placement UI.

### 7.2 Voice command training (Web Speech API — no new account)
- Teach mode: gesture-guide the pet into pose (drag down = sit, per doc) → lightbulb
  icon → user records phrase (3 samples) → store normalized phonetic key:
  `doubleMetaphone(transcript)` per sample.
- Runtime: continuous `SpeechRecognition` while AR session open (user toggle, mic
  permission). Match incoming transcript by min Levenshtein over stored metaphone keys.
  distance ≤ T → compliant perform (probability = compliance weight §4.5, breed
  stubbornness-modified); T < distance ≤ 2T → confusion action (head tilt clip);
  else ignore. 15-second response window after any command (doc's Increased Wait Time)
  during which utility re-eval runs with a "commanded" consideration boost.
- Commands decay: unreinforced commands lose compliance weight over days (forgetting).
- iOS Safari note: SpeechRecognition is webkit-prefixed and requires user gesture to
  start; wrap in feature detect, fall back to on-screen command buttons.

### 7.3 Spatial speech buttons (FluentPet-style)
Place recordable button entities on the floor via existing placement flow. Recording →
MediaRecorder → upload B2 → `pet_buttons` row. Owner taps button = Aided Language Input
(association event links buttonId ↔ following action). Pet stepping on button (nav
target reachable) plays the audio and fires its linked action's utility boost. Hand-signal
steering: on-screen drag draws a path the pet's nav follows (approximates the doc's
camera hand-signals without a hand-tracking model; Option B upgrade).

### 7.4 Walks & trials (outer-loop minigames)
- Walk mode: non-AR map-lite mode reusing existing Community page geo APIs; hidden-present
  freeze mechanic per doc; NPC dog encounters as scripted utility stimuli.
- Disc-throwing trial: AR throw (swipe vector) → ballistic arc → catch check =
  mouthHitbox (breed) ∩ disc path; larger breeds faster run speed, smaller turn radius
  tighter — pull constants from breedProfiles.
- Agility course: prefab obstacle set placed on floor; guided touch cues steer over jumps;
  scored by time + compliance; awards trainer points + credits (existing ledger).

---

## 8. Data Model (MySQL migrations, main app DB)

```sql
CREATE TABLE pet_profiles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  avatar_id BIGINT NOT NULL,             -- FK existing avatars
  breed VARCHAR(64), breed_confidence DOUBLE, size_class VARCHAR(16),
  build JSON, temperament JSON,          -- §3.2 outputs
  personality_weights JSON,              -- w_a per action (§4.5)
  hormones JSON, drives JSON,            -- persisted state
  life_stage ENUM('puppy','adult','senior') DEFAULT 'adult',
  aging_mode ENUM('off','slow','realistic') DEFAULT 'off',
  mortality_enabled TINYINT DEFAULT 0,
  trainer_score INT DEFAULT 0,
  rigged_glb_url TEXT, lod_glb_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE pet_commands (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pet_id BIGINT, phrase VARCHAR(120), metaphone_keys JSON,
  action VARCHAR(48), compliance DOUBLE DEFAULT 0.5,
  last_reinforced DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE pet_buttons (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pet_id BIGINT, label VARCHAR(48), audio_url TEXT,
  linked_action VARCHAR(48), association_strength DOUBLE DEFAULT 0,
  anchor JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE semantic_scans (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT, anchor_hash VARCHAR(64), zones JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

New API endpoints (Express, existing server.ts patterns + JWT):
`POST /api/pets/classify`, `POST /api/pets/:id/rig` (kicks Tripo rig + bake-lod),
`GET/PATCH /api/pets/:id/state` (drives/hormones sync, offline-aware like current needs
sync), `POST /api/ar/semantic-scan`, `POST/GET /api/pets/:id/commands`, `.../buttons`,
`POST /api/trials/:type/result`.

---

## 9. Accounts & API Keys — what you need and what you already have

| Need | Account/Key | Status |
|---|---|---|
| Image→3D + auto-rig (quadruped) | Tripo API key | **HAVE** — rigging uses same key; verify your plan includes `animate_rig` tasks; if metered, budget ~1 rig per avatar |
| Breed classify + semantic scan LLM | OpenRouter key | **HAVE** (LLM_API_KEY) — must be a VISION model; Nemotron Nano VL free works to start |
| iOS AR engine | 8th Wall open-source engine binary | **HAVE** — no account since Feb 2026 shutdown; PIN THE VERSION in package/CDN URL and self-host the file on B2 (CDN longevity risk) |
| Android AR | WebXR (Chrome) | none needed |
| Voice recognition | Web Speech API | none needed (on-device/browser) |
| LOD baking | blender-worker (Render) | **HAVE** |
| Storage | Backblaze B2 | **HAVE** |
| — Option B later — | | |
| Unity | Unity ID (Personal free < $200k rev) | NEW when going native |
| Lightship ARDK (depth/semantics/VPS/shared AR) | Niantic Spatial dev account + API key at lightship.dev | NEW — core free; multiplayer free <50k MAU then metered |
| iOS distribution | Apple Developer Program $99/yr | NEW |
| Android distribution | Google Play Console $25 once | NEW |
| (optional) better ASR | Google Cloud Speech / Deepgram | only if Web Speech proves too weak |

---

## 10. Milestones (one per coding-agent session; commit each; do not skip order)

- **AR1** `src/brain/` engine, pure TS: drives, hormones, utility, considerations, BT
  core, action catalog stubs, reinforcement. NO rendering. Tests via the repo's built-in
  `node:test` runner (`node --test tests/*.test.mjs`): decay math, utility ordering,
  fuzzy-noise bounds, BT traversal, reinforcement clamps. (Biggest testable win first.)
- **AR2** Server: migrations §8, `/api/pets/classify` (LLM, zod), breedProfiles table,
  state sync endpoints. Tests with mocked LLM.
- **AR3** Rig pipeline: `/api/pets/:id/rig` → Tripo animate_rig → blender-worker
  `bake-lod` (+bonemap retarget) → B2. Feature-flag: avatars without rig keep current path.
- **AR4** ARPetStage skeleton: both backends render the rigged pet with existing clips,
  reticle placement, contact shadows, IK paw grounding + head look-at.
- **AR5** Wire brain→stage: utility goals drive BTs driving clips; object utilityTags;
  body-language mapping (no stat bars); gestures (stroke/slap/tap) → reinforcement.
- **AR6** Semantic snapshot: capture → LLM zones → navmesh costs → zone behaviors
  (dig/drink/rest/sniff) + iOS occlusion-fade; Android WebXR depth occlusion + lighting.
- **AR7** Voice training + spatial buttons (§7.2–7.3), command persistence + forgetting.
- **AR8** Progression: trainer points, pacing gates, disc trial + agility course,
  credits/ledger integration, aging/mortality settings.
- **AR9** Polish + budget audit: FPS ≥30 mid-range phone, GLB ≤4 MB, memory cleanup on
  session end (dispose textures/geometries — the doc's volumetric cleanup analogue),
  error boundaries, capability-detect matrix test page.
- **AR10 (Option B, separate project)** Unity + Lightship client consuming the same
  backend; port `src/brain/` to C#.

Per-session agent rules: same as X_DM_REFINEMENT_SPEC — stay in scope, tests required,
RUN the git commit, don't touch node_modules, feature-flag anything user-visible.

---

## 11. Open items to verify during implementation
- Exact Tripo rigging/animation task body + pricing on current plan (platform.tripo3d.ai/docs/animation).
- Whether the pinned 8th Wall engine binary exposes camera frames for lighting sampling on iOS (needed §6.3); if not, use WebGL readPixels of the camera background texture.
- WebXR Depth API availability matrix on target Android devices (chrome://flags status).
- Web Speech API continuous-mode stability on iOS Safari 2026 (may need push-to-talk UX).
- Vision-LLM zone-polygon quality — if too coarse, swap §6.4 to an onnxruntime-web segmentation model (e.g. quantized SegFormer) as Phase 2, still no new account.

## 12. Sources
- Lightship ARDK (Unity, depth/semantics/shared AR): https://lightship.dev/docs/ardk/setup/ , https://nianticlabs.com/news/lightship3
- 8th Wall shutdown + open source (Feb 2026): https://tomorrowdesk.com/info/8th-wall , https://www.8thwall.com/faq
- Tripo auto-rig / UniRig quadruped: https://www.tripo3d.ai/features/ai-auto-rigging , https://platform.tripo3d.ai/docs/animation , https://www.tripo3d.ai/blog/unrig-automated-3d-rigging
- Lightship pricing/MAU terms: https://lightship.dev/products/pricing
