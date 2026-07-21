# Gemini Call Audit — every invocation in the build

**Date:** 2026-07-20
**Method:** exhaustive grep across `server.ts`, `src/`, `server/`, `agent/`, `tests/`, excluding `node_modules` and `dist`. Every line number below was read, not inferred.

---

## 1. Summary

| | |
|---|---|
| SDK | `@google/genai` — `import { GoogleGenAI }` |
| Client instances | **3** — main app (`server.ts` L3049), agent harness (`agent/gemini.ts` L41), knowledge tooling (`agent/knowledge/*`) |
| Live call sites in the shipping app | **8**, all in `server.ts` |
| Distinct models referenced | **9** |
| API key | `GEMINI_API_KEY` (declared twice in `.env.example`, L4 and L122) |
| Model override vars | `GEMINI_IMAGE_MODELS` (live), `GEMINI_TEXT_FALLBACK_MODEL` (**dead — declared, never read**) |

**Every Gemini call in the shipping app runs through one client**, constructed once at `server.ts` L3049:

```ts
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({
  apiKey: apiKey || "placeholder-key",
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
});
```

Two things to note. The key falls back to the literal string `"placeholder-key"` rather than failing fast, so a missing key surfaces as a runtime 4xx from Google rather than a clear boot error. And every request is tagged `User-Agent: aistudio-build`.

---

## 2. The 8 live call sites in `server.ts`

| # | Line | SDK method | Model(s) | Route | Purpose |
|---|---|---|---|---|---|
| 1 | 2113 | `generateContent` | `gemini-2.5-flash` → `gemini-2.0-flash-exp` | helper `extractPalette` | Palette-lock for multiview consistency |
| 2 | 2151 | `generateContent` | `IMAGE_MODELS` chain | helper `generateImageWithFallback` | All avatar/reference image generation |
| 3 | 3067 | `generateContent` | `gemini-2.5-flash` | helper `classifyGenerate` | Injected LLM for classify / triage / scan / refunds |
| 4 | 3657 | `generateContent` | `gemini-2.0-flash-exp` | `POST /api/create-creation` | Photo restyle / style transfer |
| 5 | 3723 | `generateImages` | `imagen-4.0-generate-001` | `POST /api/create-creation` | Fresh text-to-image |
| 6 | 3764 | `generateContent` | `gemini-2.0-flash-exp` | `POST /api/create-creation` | Fallback when Imagen fails |
| 7 | 4372 | `generateVideos` | `veo-3.1-fast-generate-preview` | `POST /api/create-video` | Image-to-video |
| 8 | 5352 | `generateContent` | `gemini-2.5-flash` | `POST /api/randy-chat` | Randy conversational assistant |

### 2.1 — Palette extraction (L2106–2124)

Two-model sequential fallback, hardcoded, not configurable:

```ts
for (const model of ["gemini-2.5-flash", "gemini-2.0-flash-exp"]) { … }
```

Sends the approved front view plus an instruction, returns a ≤300-char palette descriptor injected verbatim into every turnaround prompt. The in-code comment explains why: colour drift between views is the top failure mode of multiview-to-3D. Called once per avatar build at L2447, only when a reference image was used. Returns `null` on total failure — the pipeline continues without a palette lock.

### 2.2 — Image generation chain (L2127–2151) — the busiest path

```ts
const IMAGE_MODELS: string[] = (process.env.GEMINI_IMAGE_MODELS ||
  "gemini-3-pro-image,gemini-3.1-flash-image,gemini-2.5-flash-image")
  .split(",").map(s => s.trim()).filter(Boolean);
```

Best-first chain over the Nano Banana family, overridable without redeploy:

| Model string | Product name | Role |
|---|---|---|
| `gemini-3-pro-image` | Nano Banana Pro | Best quality, tried first |
| `gemini-3.1-flash-image` | Nano Banana 2 | Fast, production scale |
| `gemini-2.5-flash-image` | Nano Banana | Older, known-compatible fallback |

Two behaviours documented in-code and worth preserving:

- `config.responseModalities` **must** include `"IMAGE"`. Without it the model returns text only, no `inlineData` part, and the avatar pipeline silently produces nothing and never uploads to Backblaze.
- Aspect-ratio control is honoured **only** by `gemini-2.5-flash-image`, so `imageConfig` is sent only to that model.

Called from five places:

| Line | Route | Label |
|---|---|---|
| 1962 | `POST /api/scenes/backgrounds` | `scene-background` |
| 2205 | `GET /api/avatars` | (turnaround views) |
| 2249 | `GET /api/avatars` | `referenceImage` |
| 2366 | `POST /api/avatars` | `text-to-reference` |
| 4859 | `POST /api/text-to-reference` | `text-to-reference` |

### 2.3 — Injected classifier (L3065–3074) — one function, four consumers

```ts
const classifyGenerate: GenerateFn = async ({ prompt, imageBase64, mimeType, temperature }) => {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: { parts: [part, { text: prompt }] },
    config: { temperature, responseMimeType: "application/json" },
  });
  return (response.text || "").trim();
};
```

This is the cleanest pattern in the codebase. `GenerateFn` is defined in `server/petClassify.ts` L90 and the real client is injected at the route, so tests pass a mock and the **same production handlers** run under test. Four consumers:

| Consumer | Module | Wired at |
|---|---|---|
| `setRefundReviewGenerate` | `server/refunds.ts` | L3074 |
| `triageReferenceImage` | `server/imageTriage.ts` | L2300, L2390 |
| `classifyPetImage` | `server/petClassify.ts` | L3115 |
| `runSemanticScan` | `server/semanticScan.ts` | L3117 |

Note `responseMimeType: "application/json"` — structured output is requested at the API level, then parsed by `extractJson` in `petClassify.ts`.

### 2.4 — Creation pipeline (L3657, L3723, L3764) — three-stage cascade

All inside `POST /api/create-creation`:

1. **L3657** — if a base64 photo was supplied, `gemini-2.0-flash-exp` restyles it, optionally compositing a backdrop part.
2. **L3723** — otherwise `imagen-4.0-generate-001` generates fresh via `generateImages` (1 image, JPEG, 1:1). Result uploads to Backblaze then saves via `saveCreation`.
3. **L3764** — if Imagen throws, falls back to `gemini-2.0-flash-exp` with `responseModalities: ["IMAGE", "TEXT"]`.

**Inconsistency worth fixing:** the catch at L3762 logs `"Imagen model error, trying gemini-2.5-flash-image fallback"` but the code immediately below actually calls `gemini-2.0-flash-exp`. The log message is wrong and will mislead anyone debugging a production incident.

### 2.5 — Video (L4372)

```ts
const op = await ai.models.generateVideos({
  model: "veo-3.1-fast-generate-preview",
  prompt: motionPrompt || "Gentle breeze, subtle motion, cinematic lighting",
  image: { imageBytes, mimeType },
  config: { aspectRatio },
});
```

Long-running operation, polled. Comment records that the Gemini Developer API **rejects `generateAudio`** for Veo, so audio is left to model default. Aspect ratio is validated at the API boundary by `server/videoAspectRatio.ts` specifically so stale clients cannot send an unsupported value.

### 2.6 — Randy chat (L5352)

`gemini-2.5-flash`, multi-turn `contentParts` with roles, `systemInstruction: randySystemInstruction`, `temperature: 0.9`.

---

## 3. Outside the shipping app

### 3.1 — Agent harness (`agent/`)

Separate `GoogleGenAI` client at `agent/gemini.ts` L41, model passed in by caller. All callers pin `gemini-2.5-flash`:

| File | Line |
|---|---|
| `agent/graph/nodes/perceive.ts` | 80 |
| `agent/graph/nodes/act.ts` | 151 |
| `agent/graph/nodes/verify.ts` | 135 |
| `agent/graph/nodes/visual-verify.ts` | 136 |
| `agent/dspy/optimize.ts` | 240, 260, 277 |

### 3.2 — Knowledge tooling

`agent/knowledge/retriever.ts` L191 and `agent/knowledge/ingest_docs.ts` L219 each construct their own client. Embeddings use **`text-embedding-004`** (`ingest_docs.ts` L227) — the only embedding model in the build.

### 3.3 — Frontend

**No Gemini calls from the browser.** The only two references are a comment (`src/api.ts` L874) and an error string (`src/components/EditMemory.tsx` L314). The API key is server-side only — correct, and worth keeping that way.

---

## 4. Findings

### 4.1 — Dead configuration
`GEMINI_TEXT_FALLBACK_MODEL` is declared at `.env.example` L161 and **read nowhere in the codebase**. Text-model fallbacks are hardcoded (`extractPalette`) or single-model (classifier, Randy). Either wire it or delete it — a config var that silently does nothing is worse than no var.

### 4.2 — Misleading error log
`server.ts` L3762 names `gemini-2.5-flash-image` in the log; the code calls `gemini-2.0-flash-exp`. One-line fix.

### 4.3 — Silent key fallback
`apiKey || "placeholder-key"` at L3050 defers a config error to runtime. A boot-time assertion would fail fast and obviously.

### 4.4 — Model mix is inconsistent
The image chain is current-generation (Gemini 3 family, `GEMINI_IMAGE_MODELS`-overridable). The text calls are older and hardcoded — `gemini-2.5-flash` in four places, `gemini-2.0-flash-exp` (an experimental preview build) in three. Per `geminimodels.md`, `gemini-2.0-flash-exp` is not in the current stable line-up at all.

### 4.5 — Relevance to the Fido's Styles work
Per `geminimodels.md`, the current stable image models are **Nano Banana Pro** (`gemini-3-pro-image`), **Nano Banana 2** (`gemini-3.1-flash-image`), and **Nano Banana 2 Lite** (`gemini-3.1-flash-lite-image`). The existing `IMAGE_MODELS` chain already covers the first two.

This maps directly onto the quality tiers in §6.5 of `MARKETPLACE_AND_STYLES_SPEC.md`, and answers the open question about which generator receives the validated `LookSpecV1` plan:

| Tier | Model | Rationale |
|---|---|---|
| **Draft** | `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | Ultra-low latency and cost, built for high-volume interactive use |
| **Standard** | `gemini-3.1-flash-image` (Nano Banana 2) | Production-scale quality/speed balance |
| **Studio** | `gemini-3-pro-image` (Nano Banana Pro) | State-of-the-art, highly contextual native image creation |

Note Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`) is **not** currently in the fallback chain and would need adding for the Draft tier.

This also means **no new image provider is required** — the tiers reuse the existing client, key, and fallback machinery, and `GEMINI_IMAGE_MODELS` already provides redeploy-free override. Recommend a parallel `GEMINI_IMAGE_MODELS_DRAFT` / `_STANDARD` / `_STUDIO` triple following the identical parsing pattern.

Text planning stays on Hermes — that decision is unaffected.
