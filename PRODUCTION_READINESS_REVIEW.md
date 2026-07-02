# Paws & Memories — Production Readiness Review

**Reviewed:** July 1, 2026
**Repo:** `robs46859-eng/PawsMemories` (main branch, live at mypets.cc)
**Scope:** Full codebase — backend (`server.ts`, `db.ts`, `auth.ts`), the multi-agent 3D avatar pipeline (`agent/`, `blender-worker/`, `tripo.ts`), and the React frontend (`src/`).

This review is independent of — and supersedes where it conflicts with — the existing `codebase_review.md`, `FIX_SPEC.md`, `BUILD_SPEC.md`, and `PHASE_0_PLAN.md` already in the repo. Those documents were re-read as part of this pass; several of the fixes they describe as "pending" are now confirmed fixed in the current `main`, and several are confirmed **still broken** with exact line references below. New issues not covered by those documents (most notably the blender-worker security hole and the CSP misconfiguration) are also included.

---

## 1. Verified build health

Ran directly against a fresh clone:

| Check | Result |
|---|---|
| `npm install` | Clean, 314 packages, no peer conflicts |
| `npx tsc --noEmit` | **0 errors** — type-checks cleanly |
| `npm run build` (vite + esbuild) | **Succeeds** — `dist/server.cjs` (230kb) and frontend bundle produced without warnings |
| `npm test` (`node --test tests/*.test.mjs`) | **8 pass / 2 fail** — see §4 |

The app is not broken at the compiler/build level. All issues below are **logic, security, and runtime** bugs — the kind `tsc` and a passing build can't catch.

---

## 2. Fatal / P0 — blocks real production use

### 2.1 Unauthenticated remote code execution on the Blender microservice
**File:** `blender-worker/server.js:315-324` (and every route under the `requireBridge` list at lines 281-290: `/scene`, `/viewport`, `/execute`, `/undo`, `/checkpoint`, `/export-glb`, `/import-glb`, `/agent/build`)

`POST /execute` takes a raw `code` string from the request body and runs it directly inside the Blender Python interpreter with **zero authentication** — no API key, no shared secret, no IP allowlist, nothing:

```js
app.post("/execute", async (req, res) => {
  const { code } = req.body;
  const result = await bridge.executeCode(code);
  res.json(result);
});
```

This service is deployed publicly on Render.com (`BLENDER_WORKER_URL`). Anyone who finds the URL can execute arbitrary Python — including `os`/`subprocess` calls available inside Blender's interpreter — on that container. This is full remote code execution, not a theoretical risk. It is the single most severe issue in the codebase and must be closed before any public traffic touches this service.

### 2.2 CSP blocks video and 3D-model loading in production
**File:** `server.ts:135-152`

The Content-Security-Policy header sets:
```
connect-src 'self' https://maps.googleapis.com https://*.googleapis.com https://maps.google.com
```
`media-src` is not set at all, so it falls back to `default-src 'self'`.

Generated videos (Veo, HeyGen) and 3D avatar GLB files are served from `MEDIA_BUCKET_URL` (Backblaze B2 or S3 — a third-party domain). `<model-viewer>` fetches its GLB via `fetch()`/XHR internally (subject to `connect-src`), and `<video>` playback is subject to `media-src`. Neither whitelist includes the media bucket's domain. In production, this means:
- 3D avatar models likely fail to load in the model viewer (blocked fetch, silent console CSP violation)
- Generated pet videos likely fail to play

This directly undermines two of the app's core paid features (video creations, 3D avatars) and would only surface as a support complaint ("video won't play") rather than an obvious crash — worth prioritizing a real device/browser test against the deployed CSP.

**Fix:** add `process.env.MEDIA_BUCKET_URL`'s origin to both `connect-src` and a new `media-src` directive.

### 2.3 Veo video byte extraction is broken
**File:** `server.ts:1549`, `server.ts:1682`

```ts
const base64Video = videoData.imageBytes || videoData;
```
Veo returns a signed GCS `uri`, not `imageBytes`. When `imageBytes` is undefined, the fallback is the raw JS object, producing `data:video/mp4;base64,[object Object]` — every video-to-still-download path is corrupted. (Matches `FIX_SPEC.md` FIX-01 — confirmed **still present**, not yet applied.)

### 2.4 Pet-photo style transfer silently ignores the uploaded photo
**File:** `server.ts:816`, `server.ts:935`

```ts
model: 'gemini-2.5-flash-image',
```
This is not a valid Gemini model name. The call returns a text-only response with no `inlineData`, so every photo-based creation silently falls through to text-only generation — the user's actual pet photo is never used, even though the UI implies it was. (Matches `FIX_SPEC.md` FIX-03 — confirmed **still present**.)

### 2.5 Twilio SMS notifications are completely broken
**Files:** `server.ts:1480, 1518, 1565, 1623, 1658, 1697`

All six SMS send sites use:
```ts
from: process.env.TWILIO_VERIFY_SERVICE_SID
```
`TWILIO_VERIFY_SERVICE_SID` is a Verify Service SID (`VA…`), not a valid SMS sender — Twilio's Messages API requires a phone number or Messaging Service SID. Every one of these calls throws. Confirmed by a repo-wide search: `TWILIO_PHONE_NUMBER` (the correct variable, called for in `FIX_SPEC.md` FIX-02) **does not appear anywhere in the code** — it was never added. Every "memory fulfilled" and "video ready" SMS notification is currently non-functional.

### 2.6 SSRF in `/api/download`
**File:** `server.ts:1189-1207`

```ts
app.get("/api/download", requireAuth, async (req, res) => {
  const url = req.query.url as string;
  const fetchReq = await fetch(url);
  ...
});
```
Any authenticated user can pass an arbitrary URL and the server will fetch it server-side — including internal network addresses and cloud metadata endpoints (`169.254.169.254`). `FIX_SPEC.md` FIX-08 already documents the correct fix (whitelist to `MEDIA_BUCKET_URL`); it has **not been applied**.

---

## 3. High priority (P1) — fix before public launch

| # | Issue | Location |
|---|---|---|
| 3.1 | `PUT /api/creations/:id` accepts `album_id` from the request body without verifying the target album belongs to the requesting user — one user can move a creation into another user's album. `updateCreation` only checks ownership of the *creation* row, not the *album* being assigned. | `server.ts:1159-1185`, `db.ts` `updateCreation` |
| 3.2 | Race condition: `GET /api/avatars/:id/status` both reads status **and** triggers the background Blender pipeline as a side effect. Two near-simultaneous polls (e.g. two open tabs) can both pass the `meshy_handle` check before the DB `UPDATE ... SET meshy_handle = NULL` commits, spawning two parallel avatar builds for the same avatar (duplicate GPU/render cost, possible DB write conflicts). No lock/mutex guards this. | `server.ts:376-433` |
| 3.3 | Brightness/contrast sliders in the editor are inert — values are sent to the server but never read or folded into the AI prompt. Users see controls that visibly do nothing. | `server.ts:739` (destructured, unused), `src/components/EditMemory.tsx:867-887` |
| 3.4 | Album cover images are hardcoded to a placeholder Unsplash photo even though `db.ts`'s `getAlbums` query already computes a real `cover_url` from the first creation. The API route never reads it. | `server.ts:1104`, `server.ts:1124`; `db.ts:550-557` |
| 3.5 | No React error boundary anywhere in the app. A single uncaught exception in any component (e.g. a malformed avatar record) blanks the entire app to a white screen instead of degrading gracefully. | `src/App.tsx`, `src/main.tsx` |
| 3.6 | No process-level `unhandledRejection`/`uncaughtException` handlers. The avatar build pipeline, video pollers, and several other flows run as fire-and-forget `(async () => {...})()` IIFEs; an unexpected throw inside one of these (outside its own try/catch) can crash the entire Node process and take down every user, not just the one whose job failed. | `server.ts` (no handler registered anywhere) |
| 3.7 | No rate limiting and no `helmet`-equivalent security headers beyond the hand-rolled CSP. Auth endpoints (`/api/auth/login`, `/api/auth/signup`) have no throttling — open to credential stuffing / brute force. | `server.ts` |
| 3.8 | The avatar playpen has **no fallback to the pet's static photo** when the sprite sheet fails to load or wasn't generated — it shows a dead-end "🔧 Avatar Render Issue / Regenerate Avatar" card instead. This is a known regression: the repo's own test suite (`tests/blender_pipeline_regressions.test.mjs`, test #10, "avatar playpen does not go blank when sprite preview cannot load") **currently fails** against this exact behavior — it expects a fallback render of `avatar.image_url` that does not exist in the current component. | `src/components/Avatar3DPlaypen.tsx:346-369` |
| 3.9 | Automatic-weight rigging (`bpy.ops.object.parent_set(type='ARMATURE_AUTO')`) is still the primary bind path even though the codebase has partial explicit-vertex-group logic sitting next to it. This is a known regression too: test #9 in the same suite ("core avatar rigging no longer depends on generated automatic-weight scripts") **currently fails**, confirming the team's own intended fix (deterministic, explicit vertex-group binding, more resistant to thin-geometry failures on ears/tail/whiskers) was started but never completed as the primary path. | `agent/graph/nodes/act.ts:386-414` |

---

## 4. Test suite status

`node --test tests/*.test.mjs` → **8 passed, 2 failed.**

The two failures are not flaky — they are source-string assertions that directly encode two real, still-open regressions (§3.8 and §3.9 above). Whoever wrote this test file intended those fixes to land and they didn't. Treat both as first-class bugs, not test debt.

---

## 5. Architecture drift & dead code

These aren't bugs, but they materially increase the risk of the *next* bug and should be cleaned up as part of any repair pass:

- **`avatar-agent.ts` is dead code.** Its own docstring says it's "the public API consumed by server.ts," but `server.ts` actually imports `analyzePetImage` from the older `ollama-agent.ts` and calls `runBuildPipeline` from `agent/graph/orchestrator.ts` directly. `avatar-agent.ts` is never imported anywhere.
- **`meshy.ts` and `huggingface-3d.ts` are fully dead** — not imported by `server.ts` or any agent module. Only referenced by ad-hoc root-level `test-*.ts` scripts. Legacy from earlier 3D-generation providers (Meshy, HuggingFace Hunyuan3D) before the switch to Tripo3D.
- **The "multi-model" architecture described in comments/README doesn't match the code.** `README.md` and code comments describe "Gemini (Vision), Claude (Reasoning), and GPT (Code Gen)." In reality: `reason.ts` (`agent/graph/nodes/reason.ts`) is fully deterministic TypeScript with no LLM call at all (the "Reason Node — Claude" docstring is aspirational); `act.ts` (labeled "Act Node — GPT Code Generation") actually calls Gemini via `generateGeminiText`, not GPT. There is no Anthropic or OpenAI API call anywhere in the repository. This means `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_HTTP_REFERER`, and `OPENAI_X_TITLE` in `.env.example` are entirely unused — don't provision them for production, they do nothing today.
- **`HEYGEN_API_KEY` and `HEYGEN_DEFAULT_VOICE_ID` are the opposite problem** — actively used in a real, wired-in feature (`heygen.ts`, "talking pet" video, `server.ts:1291-1636`) but **completely absent from `.env.example` and the README's env var table.** Anyone deploying from the documented env var list alone will have a broken talking-video feature with no indication why.
- **`OLLAMA_API_URL` / `OLLAMA_MODEL` / `MESHY_API_KEY` / `HUGGINGFACE_SPACE` / `HUGGINGFACE_TOKEN`** are all documented in `.env.example` but unused by any code path currently wired into `server.ts`. Legacy from earlier pipeline iterations.
- **Root-directory clutter**: `scratch-gradio.js` through `scratch-gradio5.js`, nine ad-hoc `test-*.ts`/`test_*.ts` scripts, and a duplicate `check_db.cjs` + `check_db.js`. None of these are part of the build (esbuild only bundles `server.ts`), but several of them call live third-party APIs directly using production env vars if run accidentally, and they clutter the repo root next to real source files. Recommend moving to a `/scripts/manual/` directory that's clearly marked as non-production.
- **`package.json`'s `name` field is `"react-example"`** — leftover scaffold metadata on a live production app.

---

## 6. 3D Avatar Generation — current-state technical assessment

(Full upgrade plan is in `PRODUCTION_REPAIR_SPEC.md`, Phase 3. This section documents what the pipeline actually does today, verified by reading `tripo.ts`, `agent/graph/nodes/{reason,act,verify,visual-verify,finalize}.ts`, `agent/knowledge/breed-anatomy.ts`, `blender-worker/*`, and the two viewer components.)

- **Structure:** Mesh comes from a single uploaded photo via Tripo3D's `image_to_model` endpoint (`tripo.ts:57-62`) — no multi-view capture, no quad-remesh/texture flags requested in the API call despite Tripo3D supporting them. Geometry the camera never saw (the pet's back, underside) is guessed by the model. Rigging uses one generic mammal/dog-shaped bone list (`front_leg_upper.L/R`, `tail_01-03`, etc.) for every species, including birds and small pets that don't anatomically fit it. Mesh validation before rigging only checks vertex/face counts — no manifoldness or interior-geometry cleanup.
- **Textures/materials:** Every avatar gets the same generic procedural noise "fur" bump (`agent/graph/nodes/act.ts:547-562`, Scale=150, Roughness hardcoded to 0.8) regardless of actual coat color, pattern, or length. No color/pattern extraction from the source photo feeds into the material at all — a black lab and a spotted dalmatian get materials that differ only in whatever base color Tripo3D itself assigned.
- **Colors:** Not sampled or driven by the photo anywhere in the pipeline.
- **Movement:** Six fixed 24-frame loops (eat/drink/run/play/sleep/photo). Some steps use safe deterministic Python templates (camera/lighting, sprite render); others are freeform LLM-authored bpy per build, with real quality/consistency variance run to run. No blending between action states (hard cuts), no foot-locking/IK on the run cycle, no secondary motion (ear/jowl follow-through, breathing) outside the sleep animation.
- **Features:** Facial rig exists (`jaw`, `eye.L/R`, `ear.L/R`) but is only driven for a single blink in the "photo" animation — no broader expression system tied to the avatar's food/water/energy state.
- **Delivery (the biggest gap):** The in-app "3D Playpen" (`Avatar3DPlaypen.tsx`) that users actually interact with day-to-day is a **2D canvas rendering a baked 128×128 sprite sheet**, with the "3D Parallax Hover" effect implemented as a CSS/Framer-Motion tilt on the flat sprite — not real 3D rendering. The real rigged/lit/PBR-textured GLB this whole pipeline produces is only viewable through the separate `PetModelViewer` component (Google `<model-viewer>`), which isn't part of the everyday feeding/watering/playing loop. Most of the sophistication this pipeline builds is invisible to users most of the time.

---

## 7. Required environment variables & secrets for a production deployment

Grouped by whether they're currently required by live code paths, verified against a repo-wide `process.env.*` / `import.meta.env.*` grep (not just `.env.example`, which has drifted from the code — see §5).

### Core — app will not start or basic auth/DB will fail without these
| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs session JWTs. Server refuses to boot if missing, default, or <16 chars (`server.ts:30`). |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection. Use `127.0.0.1` for `DB_HOST` on Hostinger, not `localhost` (IPv6 resolution issue). |
| `ADMIN_KEY` (or `ADMIN_PHONE`, same fallback) | Internal row key for the seeded admin account. Any short string. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Admin login credentials, upserted into `users` on every boot. |
| `APP_URL` | Public site URL. |

### AI / generation — required for the app's core features to work
| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini (chat, vision, pet analysis), Imagen (stills), Veo (video). Required for nearly every AI feature. |
| `TRIPO_API_KEY` | Tripo3D image-to-3D mesh generation — the primary/only active 3D engine. |
| `BLENDER_WORKER_URL` | URL of the Blender microservice (Render.com). **Must be paired with the auth fix in §2.1 before going live** — currently this URL alone grants code execution to anyone who has it. |
| `HEYGEN_API_KEY`, `HEYGEN_DEFAULT_VOICE_ID` | Talking-pet video feature — actively used but **missing from `.env.example`/README today**. Add these. |

### Payments & notifications
| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe Checkout + webhook verification. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio SMS client. |
| `TWILIO_PHONE_NUMBER` | **Does not currently exist in the codebase — must be added as part of the §2.5 fix**, along with changing the `from:` field at all six call sites to use it instead of `TWILIO_VERIFY_SERVICE_SID`. |

### Storage & maps
| Variable | Purpose |
|---|---|
| `MEDIA_BUCKET_NAME`, `MEDIA_BUCKET_URL`, `MEDIA_BUCKET_KEY`, `MEDIA_BUCKET_SECRET` | Object storage (Backblaze B2 / S3-compatible) for generated media and 3D models. Also must be added to the CSP `connect-src`/`media-src` — see §2.2. |
| `GOOGLE_MAPS_API_KEY_SERVER` | Server-side Street View Static API. IP-restrict this key in Google Cloud Console. |
| `VITE_GOOGLE_MAPS_API_KEY_BROWSER` | Browser-side Maps/Places JS API. HTTP-referrer-restrict this key. Never reuse the server key here. |

### Blender worker microservice (its own environment, separate from the main app)
| Variable | Purpose |
|---|---|
| `PORT` | Render.com-assigned port. |
| `BLENDER_BIN`, `BLENDER_BRIDGE_HOST`, `BLENDER_BRIDGE_PORT`, `BLENDER_BRIDGE_SCRIPT`, `BLENDER_AUTOSTART_BRIDGE` | Blender TCP bridge process configuration. |
| *(new — recommended)* a shared-secret header (e.g. `WORKER_SHARED_SECRET`) that `server.ts` sends and `blender-worker/server.js` validates on every request. This does not exist today and is required to close §2.1. |

### Documented but confirmed unused — do not bother provisioning these
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_HTTP_REFERER`, `OPENAI_X_TITLE`, `OLLAMA_API_URL`, `OLLAMA_MODEL`, `MESHY_API_KEY`, `HUGGINGFACE_SPACE`, `HUGGINGFACE_TOKEN`. None of these are read by any code path currently wired into `server.ts`. Either remove them from `.env.example` or genuinely wire up the multi-model reasoning architecture the comments describe (see §5) — right now they're pure noise for anyone standing up a new deployment.

---

## 8. Summary

The app **compiles, type-checks, and builds cleanly** — the engineering foundation is solid. The problems are concentrated in three places: an **open code-execution endpoint** on the Blender microservice, a handful of **broken integrations** (video byte extraction, SMS sender ID, an invalid Gemini model name) that were already diagnosed in the repo's own `FIX_SPEC.md` but never applied, and a **3D avatar pipeline that builds more sophistication than users ever actually see**, because the interactive experience renders a flattened sprite sheet instead of the real 3D asset. None of these require a rewrite — see `PRODUCTION_REPAIR_SPEC.md` for a phased plan to close all of the above.
