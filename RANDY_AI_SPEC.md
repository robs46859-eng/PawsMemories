# Randy AI — 3D Talking-Head Upgrade Spec

**Character:** Randy, the **"Golden Receiver"** — a small, highly detailed, textured golden‑retriever talking head who greets users and guides them through the app and AR.
**Goal:** replace/augment the current text bubble chat with an expressive 3D head that lip‑syncs its replies and can actively **walk users through features and AR** (not just answer questions).
**Status:** Draft v1 — not started.

---

## 1. Current state (audit)

- **UI:** `src/components/RandyChat.tsx` — a floating bubble that opens a text chat. Messages typed `{ role: 'user' | 'model', text }`. Voice **dictation** already wired via the Web Speech API (`SpeechRecognition`) with a mic button; unlocks the `voice_use` achievement.
- **Backend:** `POST /api/randy-chat` (`server.ts` ~2293) → Gemini, system prompt casts Randy as a "clay golden retriever puppy… AI pet memory guide." Returns `{ text }`.
- **3D infra available to reuse:** `src/three/AvatarModel.tsx` (loads GLB via `useGLTF`, plays animations), `PetScene.tsx`, `@react-three/fiber`, `three`, and Google `<model-viewer>` (already in `index.html`).

Gaps: no face/head, no lip‑sync, no spoken output (only dictation input), and Randy can *describe* features but cannot *drive* the UI or launch AR.

---

## 2. The 3D head asset

**Style:** stylized‑realistic golden retriever **head + upper neck** (not full body) — friendly, warm, high‑detail fur and eyes, matching the app's clay/TerraPaw look but more textured.

**Requirements:**
- Format: **GLB** (glTF binary), single file, embedded textures.
- Poly budget: **15k–30k tris** (it's a small on‑screen head; keep it light for mobile).
- Textures: 1–2k albedo + normal + roughness; soft subsurface‑ish fur shading via normal + a fur‑direction normal map (real fur cards are too heavy for this use).
- **Rig / blendshapes (morph targets)** — the critical part for talking + expression:
  - **Visemes** (mouth shapes): at minimum `mouth_open` (jaw), plus `viseme_AA`, `viseme_EE`, `viseme_OO`, `viseme_FV`, `viseme_MBP` (closed). ARKit‑style 15‑viseme set is ideal but the 5–6 above are enough for convincing dog speech.
  - **Expressions:** `blink_L`, `blink_R`, `brow_up`, `ear_perk_L/R`, `smile/pant`, `tongue_out`.
- Animation clips (optional, can be procedural): `idle` (breathing + occasional blink), `listen` (ears perk, head tilt), `happy` (tail‑less head bob + pant).

**How to source the asset (pick one):**
1. **Purpose‑built (recommended):** commission or model a golden‑retriever head with the morph targets above (Blender → glTF export with morph targets + `KHR_materials` PBR). Store at `public/models/randy_head.glb`.
2. **Pipeline‑generated:** feed a golden‑retriever reference image through the existing Tripo→Blender avatar pipeline, then add viseme morph targets in the Blender step (`BLENDER_RIG_PIPELINE.md`). Cheaper but less control over the face rig.
3. **Stopgap:** a stylized head with a single `mouth_open` morph — amplitude‑only lip‑sync (see §4) — shippable while the full viseme rig is produced.

---

## 3. Rendering integration

- New component `src/components/RandyHead.tsx`: a small `<Canvas>` (≈160×160, capped DPR) rendering `randy_head.glb` via `useGLTF`, mounted in the RandyChat panel header (and optionally as the collapsed bubble avatar).
- Reuse the `AvatarModel` loading pattern; expose an imperative API (ref) to set: `state` (`idle|listen|think|talk|happy`), and per‑frame `visemeWeights` / `mouthOpen`.
- Perf: single light + baked ambient; pause the render loop when the chat is closed (`frameloop="demand"` and invalidate on state change) to save battery.

---

## 4. Animation & lip‑sync

**Idle/expression layer (always on when visible):** procedural — sine‑based breathing on the neck, random blinks every 3–6s, ear micro‑motion; switch to `listen` pose while `SpeechRecognition` is active, `happy` on achievement unlocks.

**Lip‑sync — two tiers:**

- **Tier A (ship first): amplitude‑driven.** When Randy speaks (TTS audio, §5), route the audio through an `AudioContext` `AnalyserNode`; map the smoothed RMS amplitude → `mouth_open` morph weight each frame. Cheap, works with any TTS, reads as believable "dog talking." Requires only the `mouth_open` morph.
- **Tier B (upgrade): viseme‑driven.** Use a TTS that emits viseme/timing data and blend the corresponding viseme morphs on a timeline:
  - **Azure Speech** — emits `visemeReceived` events (viseme id + offset) alongside audio. Best fit.
  - **ElevenLabs** — returns audio + character alignment; derive visemes from text.
  - Or offline: map text → phonemes → visemes (a small rule set) and schedule against `SpeechSynthesis` `boundary` events.

Recommendation: **Tier A now** (any TTS, only needs `mouth_open`), design the morph set for **Tier B later** without re‑exporting the asset.

---

## 5. Voice (output + input)

- **Output (new):** speak Randy's replies.
  - Free path: Web Speech `SpeechSynthesis` (client, no key) — but it gives no audio stream for the analyser; use its `boundary`/`end` events to gate a simpler jaw motion, **or**
  - Streamed audio path (recommended for Tier A analyser): a server TTS endpoint `POST /api/randy-tts` (Gemini/Azure/ElevenLabs) returning an audio blob; play via `<audio>` + `AnalyserNode`. Add a mute toggle and respect autoplay policies (require a user gesture to enable voice).
- **Input (exists):** keep the current `SpeechRecognition` dictation. While listening, drive the `listen` head pose.

---

## 6. Guidance / agent layer (so Randy can *guide*, not just chat)

Give Randy the ability to **navigate the app and launch AR** on the user's behalf, with confirmation.

- **Feature knowledge base:** extend the system prompt with a concise map of the app — Avatars (create/build 3D pet), Store (merch + Albums), Community (local info, live board), Credits (earn/spend, daily bonus), Profile (photos), and **AR** (how to enter, what it does). Keep it accurate and short so Gemini answers correctly.
- **Structured actions (intent layer):** have `/api/randy-chat` return, alongside `text`, an optional `action`:
  ```json
  { "text": "Let's build your first avatar! Want me to take you there?",
    "action": { "type": "navigate", "screen": "AVATAR_DASHBOARD" } }
  ```
  Supported action types: `navigate` (to a `Screen`), `launch_ar`, `open_credit_store`, `start_tour`, `highlight` (point at a UI element), `none`.
- **Frontend executor:** `RandyChat` interprets `action` and calls the matching handler (`setCurrentScreen`, AR launch, etc.). **Side‑effectful actions require a tap to confirm** ("Take me there") — Randy proposes, the user approves.
- **Guided tours:** predefined step sequences (`start_tour` → "create avatar" tour, "AR" tour). Each step = Randy speaks + a `highlight`/`navigate` action + a Next control. The AR tour walks: open Avatars → Enter AR → find a surface (reticle) → tap to place → move around (anchors) → exit.

Implementation notes: Gemini can emit the `action` via a strict JSON response contract (validate server‑side; default to `{type:'none'}` on parse failure so chat never breaks). Alternatively use Gemini function‑calling with a small tool schema mirroring the action types.

---

## 7. Backend changes

- `POST /api/randy-chat` — update system prompt (feature KB + "Golden Receiver" persona), and return `{ text, action }` with a validated action schema.
- `POST /api/randy-tts` *(new, optional for voice)* — text → audio blob (chosen TTS provider); env key added to Hostinger. Cache by text hash to cut cost.
- No DB changes required for v1.

---

## 8. Phased plan

1. **P1 — Head on screen:** `RandyHead.tsx` renders `randy_head.glb` with idle/blink; swap the bubble icon for the head. (Asset: stopgap head with `mouth_open`.)
2. **P2 — Talk (Tier A):** add `/api/randy-tts` + amplitude lip‑sync; Randy speaks replies with jaw motion; mute toggle.
3. **P3 — Guidance actions:** `action` contract in `/api/randy-chat` + frontend executor (navigate / launch AR / open credit store), confirm‑to‑act.
4. **P4 — Guided tours:** scripted "create avatar" and "AR" tours with highlights.
5. **P5 — Viseme lip‑sync (Tier B):** upgrade TTS to viseme events + full viseme morphs.

---

## 9. Acceptance criteria (v1 = P1–P3)

- A textured golden‑retriever head renders in the chat, idles/blinks, and perks up while listening.
- Randy speaks replies aloud (toggleable) with mouth motion synced to the audio.
- Randy can offer and, on user confirmation, **navigate to a feature or launch AR**.
- Chat never breaks if TTS or the action parse fails (graceful text‑only fallback).
- Mobile: smooth at 30fps; render loop pauses when chat is closed.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Face rig / viseme asset is the long pole | Ship P1–P2 with a single `mouth_open` morph; design for visemes later. |
| Autoplay audio blocked | Require a gesture to enable voice; default muted. |
| TTS cost | Cache by text hash; keep replies short; offer the free `SpeechSynthesis` path. |
| Randy taking unwanted actions | All side‑effectful actions are proposals requiring a user tap. |
| Mobile perf | Small canvas, capped DPR, demand frameloop, low‑poly head. |

## 11. New/edited files
- `public/models/randy_head.glb` *(asset)*
- `src/components/RandyHead.tsx` *(new)* — 3D head + expression/viseme API.
- `src/components/RandyChat.tsx` *(edit)* — mount head, TTS playback + analyser, action executor, tour UI.
- `src/three/randyVisemes.ts` *(new)* — amplitude→mouth and (later) viseme→morph mapping.
- `server.ts` *(edit)* — Randy system prompt + `{text, action}` schema; `POST /api/randy-tts` *(new)*.

*Cross‑reference: `BLENDER_RIG_PIPELINE.md` (how to add morph targets if generating the head via the pipeline) and `AR_PET_SIM_SPEC.md` (the AR flow Randy's tour walks through).*
