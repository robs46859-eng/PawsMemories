# Pawsome3D — Production Implementation, Cost & Competitor Positioning

**Site:** https://pawsome3d.com (formerly mypets.cc)
**Prepared:** July 10, 2026
**Scope:** (1) how the UI, tools, and animations are implemented at final production deploy; (2) per‑generation unit economics (COGS → credit pricing → margin); (3) competitor positioning vs. HeyGen, Synthesia, and the 3D‑native players.
**Companion:** open `UI_MAP_INTERACTIVE.html` (in this folder) for the clickable interface map.

---

## Part 1 — How it's implemented in production

### 1.1 Build & serve topology

Pawsome3D is a single Express process that does double duty: it serves the compiled React SPA and exposes the JSON API under `/api`. There is **no client‑side router** — screen state is a `Screen` enum in `App.tsx`, and all navigation is programmatic via `setCurrentScreen()`.

At deploy time the host runs `npm install && npm run build && npm start`:

- `vite build` emits `dist/` (hashed `assets/*.js` + `*.css`, and a rewritten `dist/index.html`).
- `esbuild server.ts --bundle --platform=node --format=cjs` emits `dist/server.cjs`.
- `server.ts` auto‑detects production by checking whether `dist/index.html` exists. In prod it uses `express.static(dist)` plus a SPA catch‑all; in dev it mounts Vite middleware.

The repo‑root `index.html` is a **Vite dev template** (`<script src="/src/main.tsx">`) and must never be served raw in production — doing so yields a blank `#root`. The deploy is a source‑only zip built from `git archive HEAD`, so uncommitted work is excluded; the host builds it.

Two runtimes cooperate:

| Runtime | Host | Responsibility |
|---|---|---|
| Main web app (Express + React) | Hostinger | UI, API, credits, Stripe, Tripo orchestration, animator job queue |
| Blender microservice (`blender-worker`, `bpy`) | Render.com | Rigging, 24‑frame skeletal‑clip baking, EEVEE PBR renders |

They authenticate to each other with a shared secret (`WORKER_SHARED_SECRET` / `x-worker-secret`) that must match on both sides.

### 1.2 The UI layer

- **Framework:** React 19 + Vite 6, Tailwind CSS 4 (theme tokens in `index.css`), Lucide + Google Material Symbols icons, `motion` for transitions.
- **Design system:** sage‑green primary (`#4a6545`), warm terracotta secondary (`#964826`), cream/slate surfaces, custom glow/shimmer/float utility classes. Plus Jakarta Sans + JetBrains Mono.
- **Navigation shell:** a top nav (**Avatar / Models · Store · Community · Profile**) mirrored by a floating bottom navigator on mobile. Dark‑mode toggle persisted to `localStorage`. Credit balance in the top bar opens the Credit Store.
- **Screens (from the `Screen` enum):** `SIGN_UP → WELCOME → TUTORIAL → DASHBOARD`, then `MODELS` (avatar studio/dashboard), `ANIMATOR`, `STORE`, `COMMUNITY`, `PROFILE`, `ALBUMS`/`ALBUM_VIEW`, `EDIT_MEMORY` (admin) / `REQUEST_MEMORY` (regular users), `SHARE_MEMORY`.
- **Randy AI** is a floating chat widget (Gemini‑backed) with Web Speech API voice in/out.

### 1.3 The generation pipeline (photo/text → rigged 3D avatar)

The "Create 3D Model" dialog (`CreateAvatarDialog.tsx`) submits to `POST /api/avatars`. The target flow:

1. **Reference image** — generate a high‑quality reference from the user's photo or text prompt (Gemini/Imagen).
2. **Qualify** — a QA/triage pass scores the image; bounded retries with corrective prompts; hard failure refunds credits with a clear error.
3. **Classify** — decide subject class: **HUMAN · ANIMAL · STATIC OBJECT** (segmented control gives a hint; server can override on mismatch).
4. **3D generation** — **Tripo3D** image‑to‑3D with class‑appropriate settings (multiview turnaround when available). Tripo replaced Meshy for quality/reliability.
5. **Post‑process by class:**
   - **Animal** → quadruped rig + behavior brain + skeletal clips.
   - **Human** → humanoid rig + brain + clips.
   - **Static object** → **no rig, no brain** — GLB stored as‑is.

Outputs (GLB, sprite sheet, rigged model, `clips_json`) are written to Backblaze B2 and tracked on the `avatars` table with a `generation_status` state machine polled via `GET /api/avatars/:id/status`.

### 1.4 Animations

Two distinct animation systems ship:

**(a) Baked skeletal clips.** The Blender worker bakes **~15 skeletal clips** (idle, walk, tail_wave, etc.) at **24‑frame cycles**, rendered with EEVEE PBR. These travel with the GLB as glTF animation tracks (`clips_json`).

**(b) In‑app glTF Animator (`ANIMATOR` screen).** A production‑grade animator that runs **entirely in the app**, split cleanly across the two runtimes:

- **Client (`src/animator/`):** a pure animation state machine over three.js `AnimationMixer`; a timeline / transport / clip selector UI; PNG screenshot capture of a *clean viewport* (no UI chrome); and **client‑side MP4 recording** via **WebCodecs (H.264)** with graceful fallback when a codec/config isn't supported.
- **Server (`server/animator/`, mounted at `/api/animator` and `/api/scenes`):** a **file‑based job queue** (pending → running → done/failed) that runs `@gltf‑transform` operations (inspect / pack / dedup / optimize / convert). **Non‑negotiable guarantees:** every original `.glb`/`.gltf` is copied to `originals/` and never mutated; the "safe" optimization preset is strictly lossless; unsupported features are hidden/disabled rather than faked.

**Scene generation** composes an avatar + a background (location data, uploaded image, or text prompt) with an optional scripted sequence of animation steps and camera cuts.

### 1.5 AR virtual pet

- **Android (Chrome / ARCore):** WebXR with plane + mesh detection, drift‑free `XRAnchor` placement, and footprint center‑of‑gravity grounding so the pet plants on its feet. Rendered with `@react-three/fiber` + `@react-three/xr` (three.js deduped to a single copy — required, or GLTFLoader/materials break).
- **iOS:** falls back to the **8th Wall** engine — its binary must be **pinned and self‑hosted on B2** (the hosted service shut down Feb 2026).
- **Behavior brain:** an autonomous drives/hormones/reinforcement engine with voice‑command training, gesture reinforcement, semantic‑scan navigation, and a 2D navmesh with zone‑cost regions. Paid AR endpoints are per‑user/per‑day cost‑capped.

### 1.6 Payments, credits, gating

- **Auth:** email + password (scrypt‑hashed), 30‑day JWT, `requireAuth` middleware; profile completion is enforced and grants **50 free credits** once.
- **Credits:** a server‑backed ledger (`credit_transactions`) with earn/spend history, persisted daily bonus, per‑day‑capped share rewards, and Stripe credit‑pack purchases (webhook + redirect‑confirm double safety net).
- **Direct AI generation is admin‑only.** Regular users use **Request a Memory** — pay a flat cash rate via Stripe, an admin fulfills it, and Twilio SMS notifies the user.

---

## Part 2 — Per‑generation cost breakdown (COGS → price → margin)

### 2.1 What a credit is worth

Credit packs (from `CreditStore.tsx` / `server.ts`):

| Pack | Price | Credits | Cost per credit |
|---|---|---|---|
| Starter | $5 | 100 | 5.00¢ |
| Popular | $10 | 220 | 4.55¢ |
| Pro | $25 | 600 | 4.17¢ |
| Studio | $50 | 1,300 | 3.85¢ |

**Blended headline value ≈ 4.5¢ / credit** (range 3.85–5.00¢). New users also get 50 credits free on profile completion.

### 2.2 Vendor COGS per action (live 2026 API pricing)

These are the marginal third‑party costs you actually pay per generation. Sources cited in Part 4.

| Action | Vendor & rate | Marginal COGS |
|---|---|---|
| Reference / styled image | Imagen 4 Fast ~$0.02; Gemini image $0.039–$0.24 | **$0.02 – $0.24** |
| Image‑to‑3D model | Tripo P1: 56 cr ($0.28) untextured, 70 cr ($0.35) textured; H3.1 higher | **$0.28 – $0.70** |
| 8‑second video (with audio) | Veo 3 Fast $0.15/s → $1.20; Veo 3 std $0.40/s → $3.20 | **$1.20 – $3.20** |
| Blender rig + 15 clips + EEVEE render | Render.com compute (worker), amortized | **~$0.02 – $0.10** |
| Storage/egress of GLB + media | Backblaze B2 (~$6/TB‑mo storage, cheap egress) | **< $0.01** |
| Stripe fee on a credit pack purchase | 2.9% + $0.30 per charge | (applied at purchase, not per generation) |

### 2.3 Unit economics per priced action

Using the blended **4.5¢/credit** value. "Credit revenue" = what the user effectively paid in credits; COGS = mid‑point vendor cost; Stripe fee is charged once per pack purchase, not per action.

| Action | Price (credits) | ≈ Credit revenue | Vendor COGS (mid) | Gross margin | Margin % |
|---|---|---|---|---|---|
| **AI image** (`GENERATION_COST`) | 40 cr | ~$1.80 | ~$0.10 | ~$1.70 | ~94% |
| **3D avatar model** (`MODEL_COST`) | 400 cr | ~$18.00 | ~$0.50 (Tripo) + $0.10 (Blender) + $0.05 (image) = ~$0.65 | ~$17.35 | ~96% |
| **Animate / video** (`VIDEO_COST`) | 250 cr | ~$11.25 | ~$1.20–$3.20 (Veo) | ~$8.00–$10.00 | ~71–89% |
| **Physical album** (`OrderAlbumModal`) | 800 cr **+ $12 cash** | ~$36 + $12 | print + fulfillment + shipping (est. $10–18) | positive, print‑dependent | — |

**Read‑through:**

- **The 3D avatar is your margin engine.** COGS is tiny (~$0.65) against ~$18 of credit value. It is also the action most likely to force a credit purchase, since 400 cr > the 50‑credit free grant.
- **Video is the only action with real COGS pressure.** At Veo 3 *standard* ($0.40/s), an 8‑second clip costs $3.20 — margin still ~71%, but if you offer longer or higher‑res clips the math tightens fast. **Default to Veo 3 Fast** ($0.15/s) unless quality demands otherwise; that alone roughly triples video margin.
- **Cash "Request a Memory" tiers** (non‑admin): Standard Photo $2.99, Premium Photo $4.99, Standard Video $7.99, Premium Video $12.99. Against the COGS above these are all comfortably profitable; the Standard Video at $7.99 vs. up to $3.20 Veo COGS is the thinnest — keep those on Veo Fast.
- **Free‑grant exposure:** the 50 free credits can fund ~1 image (40 cr) and not a model or video, so first‑run cost exposure per signup is roughly **one image's COGS (~$0.02–0.24)** plus one qualified reference — bounded and cheap.

### 2.4 Cost‑control levers already in the code (keep them on)

- Bounded QA retries with **credit refund on hard failure** (you don't eat COGS for junk output).
- Per‑user/per‑day **cost caps** on paid AR endpoints.
- Admin‑only direct generation + user Request‑a‑Memory flow (caps uncontrolled API spend by regular users).
- Feature flag `PETSIM_RIG_ENABLED` (rigging off by default) so the expensive rig path is opt‑in.

---

## Part 3 — Competitor positioning

### 3.1 The key framing: you're not really in HeyGen/Synthesia's category

HeyGen and Synthesia are **B2B "talking‑head" video** platforms — you type a script, a photoreal human avatar reads it, priced per **minute of rendered video** for marketing, training, and sales enablement. Pawsome3D is a **consumer 3D‑pet** platform — a photo becomes a *rigged, playable, AR‑placeable* 3D character plus keepsakes. The overlap is only the phrase "AI avatar." That difference is your positioning wedge, not a weakness.

### 3.2 Talking‑head video incumbents

| Platform | Entry price | What you get | Model | Where Pawsome3D differs |
|---|---|---|---|---|
| **HeyGen** | Free (3 videos); Creator **$29/mo** (600 cr ≈ 30 min); Pro from $49; Business $149 | Photoreal talking human avatars, 175+ languages, lip‑sync | Per‑minute credits (Avatar IV/V = 20 cr/min) | Pawsome3D outputs an **interactive 3D asset + AR**, not a flat talking video; consumer + physical merch |
| **Synthesia** | Free (10 min, watermark); Starter **$29/mo** (10 min); Creator $89/mo (30 min) | Studio‑grade talking avatars, 140+ languages, per‑**seat** | Per‑minute + per editor seat | Pawsome3D is pay‑per‑creation credits, no seats; pets not corporate presenters |

Takeaway: their pricing is **minute‑metered and seat‑gated for enterprise**. Yours is **per‑creation credits for consumers**. Don't compete on "minutes of video" — compete on "a living 3D version of *your* pet you can hold, animate, and drop into your living room."

### 3.3 The competitors you actually overlap with (3D generation)

| Platform | Entry price | Positioning | Pawsome3D edge |
|---|---|---|---|
| **Meshy** | Pro **$20/mo** (~1,000 cr ≈ ~50 models; ~$0.40/model) | Best‑in‑class general text/image‑to‑3D for creators/devs; won a 63.8% artist‑preference benchmark vs Tripo 3.1 | Meshy is a **raw asset tool**; you deliver a *finished, rigged, animated, playable* pet + AR + merch |
| **Tripo** (your engine) | Pro **$19.90/mo** (3,000 cr); API P1 image‑to‑3D 56–70 cr (~$0.28–0.35) | General 3D gen + API; you consume it as infrastructure | You wrap Tripo in classification, rigging, a behavior brain, and a consumer product |
| **Luma / CSM / Sloyd / Hyper3D** | ~$0.13–0.50 per model on subs | General 3D gen for games/AR/design | Same wedge: you're a *vertical consumer app*, they're horizontal tools |

**Strategic read:** the 3D‑gen market is a race‑to‑the‑bottom on **cost per raw mesh** ($0.13–0.50). You are insulated from it because (a) Tripo is a swappable ~$0.30–0.70 input line, not your product, and (b) your value is the **rig + brain + AR + Tamagotchi loop + physical keepsakes** on top. Your ~96% margin on the 3D action exists precisely because you sell an *experience*, not a mesh.

### 3.4 Differentiation summary (what to lead with)

1. **Consumer, emotional, pet‑specific** — HeyGen/Synthesia are corporate; Meshy/Tripo are developer tools. You own "my pet, alive in 3D."
2. **The asset is interactive, not a video** — rigged, animated, voice‑trainable, and AR‑placeable on a real surface.
3. **Retention loop** — Tamagotchi feeding/streaks/achievements + community board; the incumbents have no recurring engagement mechanic like this.
4. **Physical monetization** — resin prints ($89), plush ($45), and albums convert a digital avatar into recurring high‑margin merch. Pure‑software competitors can't.
5. **Guided by Randy** — an AI onboarding/help persona lowers the skill floor vs. pro 3D/video tools.

### 3.5 Positioning risks to watch

- **Video COGS** is your one exposed line — keep it on Veo Fast and cap clip length.
- **Meshy/Tripo could move downstream** into rigging/animation; your moat is the *pet vertical + AR + merch + retention*, so invest there, not in raw mesh quality.
- **8th Wall dependency (iOS AR)** is an external‑longevity risk — the self‑hosted‑binary mitigation must actually ship.

---

## Part 4 — Sources (live pricing, retrieved July 2026)

- Tripo API pricing — [docs.tripo3d.ai/get-started/pricing](https://docs.tripo3d.ai/get-started/pricing.html), [platform.tripo3d.ai/docs/billing](https://platform.tripo3d.ai/docs/billing), [poyo.ai Tripo P1](https://poyo.ai/models/tripo-p1-3d)
- 3D generator cost comparison (Sloyd vs Meshy vs Tripo vs CSM vs Hyper3D) — [sloyd.ai/blog/3d-ai-price-comparison](https://www.sloyd.ai/blog/3d-ai-price-comparison), [3daistudio.com pricing guide](https://www.3daistudio.com/3d-generator-ai-comparison-alternatives-guide/how-much-does-ai-3d-model-generation-cost)
- Meshy pricing — [meshy.ai/pricing](https://www.meshy.ai/pricing), [Meshy credits per task](https://help.meshy.ai/en/articles/10000507-how-many-credits-does-each-generation-task-cost)
- Google Veo 3 / Veo 3.1 API pricing — [veo3ai.io Veo 3 API pricing](https://www.veo3ai.io/blog/veo-3-api-pricing-2026), [costgoat.com Google Veo](https://costgoat.com/pricing/google-veo)
- Gemini / Imagen image pricing — [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing), [aifreeapi.com Gemini image pricing](https://www.aifreeapi.com/en/posts/gemini-image-generation-api-pricing)
- HeyGen pricing — [heygen.com/pricing](https://www.heygen.com/pricing), [HeyGen credit-based plans](https://help.heygen.com/en/articles/15125761-heygen-credit-based-pricing-plans-explained)
- Synthesia pricing — [synthesia.io/pricing](https://www.synthesia.io/pricing), [arcade.software Synthesia pricing](https://www.arcade.software/post/synthesia-pricing)

*Internal figures (credit costs, pack prices, merch prices, request‑memory tiers) are read directly from the repository: `server.ts`, `src/components/CreditStore.tsx`, `src/components/Store.tsx`, `src/components/RequestMemory.tsx`, `src/components/OrderAlbumModal.tsx`.*
