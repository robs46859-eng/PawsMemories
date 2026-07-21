# Pawsome3D Module Costs, SEO, and Gemma Status

**Prepared:** 2026-07-17  
**Source of truth reviewed:** `src/pricing.ts`, live route handlers, `server/paidApiGuards.ts`, Hermes routes/workers, and the deployed-environment values supplied for Pawsome3D.

## Executive summary

- Prices below are **customer wallet credits**, not direct vendor invoices. The repository does not contain the Gemini, Veo, Tripo, HeyGen, ElevenLabs, Backblaze, Hostinger, or Render price sheets, so an exact provider-dollar margin cannot be truthfully calculated from this codebase.
- The current credit packs put one credit at roughly **$0.071–$0.10**, depending on the pack. That makes a 100-credit Veo video approximately **$7.14–$10.00** of customer wallet value before taxes/fees.
- **Gemma is not currently serving production users.** `HERMES_ENABLED=false`, there is no client call to `/api/hermes/*`, and the Gemma/Outlines worker is a prepared but disconnected Fido’s Styles planner.
- The SEO update now supplies technical crawl foundations. The biggest remaining SEO opportunity is a **real public landing/content layer**; the current product routes are authenticated and correctly marked `noindex`.
- Several Hostinger variables named `PETSIM_VIDEO_*`, `PETSIM_MODEL_3D_*`, `PETSIM_IMAGE_GENERATION_*`, and `PETSIM_PAWPRINT_*` describe intended provider budgets, but this repository currently does **not** read or enforce them. The enforced limits are called out separately below.

---

## 1. Credit wallet economics

| Wallet pack | Customer price | Credits | Effective price per credit |
|---|---:|---:|---:|
| Starter | $10 | 100 | $0.1000 |
| Creator | $25 | 275 | $0.0909 |
| Pro | $50 | 600 | $0.0833 |
| Studio | $100 | 1,300 | $0.0769 |
| Enterprise | $250 | 3,500 | $0.0714 |

The table below shows the customer-equivalent value range using the Starter and Enterprise pack rates. It is a pricing illustration, **not** a direct cost or margin calculation.

## 2. Customer-facing module cost breakdown

### Image and memory creation

| Module / action | Customer charge | Approx. customer wallet value | Current provider path | Enforcement / notes |
|---|---:|---:|---|---|
| HD image generation | 10 credits | $0.71–$1.00 | Imagen; Gemini image fallback | Live server route charges 10 credits; admin bypass exists. |
| Ultra HD image generation | 15 credits | $1.07–$1.50 | Catalog price only | Price is defined; verify the specific UI/route before advertising it as a separate live tier. |
| First avatar regeneration | 0 credits | $0.00 | Existing avatar/image workflow | First retry is free in the price catalog. |
| Additional avatar regeneration | 5 credits | $0.36–$0.50 | Existing avatar/image workflow | Charged after the free retry. |
| Remove background | 3 credits | $0.21–$0.30 | Catalog price only | Confirm a live route before treating as billable. |
| Upscale image | 5 credits | $0.36–$0.50 | Catalog price only | Confirm a live route before treating as billable. |
| Texture generation | 8 credits | $0.57–$0.80 | Catalog price only | Confirm a live route before treating as billable. |
| Create/Restyle Memory | 10 credits | $0.71–$1.00 | Gemini/Imagen image pipeline | The server’s `create-creation` route uses the HD-image price. |

### Furball3D model builder

| Module / action | Customer charge | Approx. customer wallet value | Current provider path | Enforcement / notes |
|---|---:|---:|---|---|
| Dog or human 3D avatar | 80 credits | $5.71–$8.00 | Gemini image/vision as needed → Tripo → Blender worker → Backblaze | `avatarGenerationCost` charges 80 for dog/human, regardless of image/text entry mode. |
| Object, text-to-3D | 40 credits | $2.86–$4.00 | Text/reference generation → Tripo/Blender path | Static object price. |
| Object, photo-to-3D | 45 credits | $3.21–$4.50 | Photo → Tripo/Blender path | Static photo-object price. |
| Legacy creation image → 3D conversion | 45 credits | $3.21–$4.50 | `startImageTo3D` (Tripo) | Shares the five-per-day creation/video counter in current server code. |
| Rigged 3D avatar catalog item | 80 credits | $5.71–$8.00 | Tripo + Blender | Matches the dog/human builder price. |
| FBX or USDZ export | 10 credits | $0.71–$1.00 | Catalog price | Confirm the export checkout route before exposing as a paid option. |
| Commercial license | 35 credits | $2.50–$3.50 | Catalog price | Licensing terms and fulfillment need a product/legal decision before billing. |

### Fido’s Styles and wardrobe

| Module / action | Customer charge | Approx. customer wallet value | Current provider path | Enforcement / notes |
|---|---:|---:|---|---|
| Choose from 15 wardrobe items | No separate charge currently | — | CC0 wardrobe catalog / client-side selection | The 15-item selection requirement is implemented as a catalog capability. |
| Clothing variant | 15 credits | $1.07–$1.50 | Catalog price | Marked `comingSoon`; do not present as a live purchase until a renderer/route charges it. |
| Voice clone | 100 credits | $7.14–$10.00 | Voice asset storage / configured TTS stack | The Fido’s Styles UI checks and charges this amount. |
| Gemini/Gemma look plan | No customer price currently | — | Hermes/Gemma plan, if enabled | Not live: Hermes is disabled and the client has no Hermes integration. |

### Pawprints manual template studio

| Module / action | Customer charge | Approx. customer wallet value | Current provider path | Enforcement / notes |
|---|---:|---:|---|---|
| Standard Pawprint | 75 credits | $5.36–$7.50 | Browser canvas compositor → storage | Manual editor: no LLM writes copy and no animation model runs. |
| Pawprint using an existing subject image | 60 credits | $4.29–$6.00 | Browser canvas compositor → storage | 20% reuse discount, rounded from the 75-credit base. |
| Template browsing / text editing / preview | No charge before save | — | Client-side canvas | The charge happens when the selected finished variation is saved. |

### Video Creator and 3D Animator

| Module / action | Customer charge | Approx. customer wallet value | Current provider path | Enforcement / notes |
|---|---:|---:|---|---|
| Image-to-video | 100 credits | $7.14–$10.00 | Gemini Veo 3.1 Fast | Video Creator now allows only Veo-supported `16:9` or `9:16`; server cap is five/day/user. |
| Talking-photo video | 25 credits | $1.79–$2.50 | HeyGen | Uses the lip-sync 30-second price and shares the five/day/user counter. |
| Animator speech preview | 25 credits | $1.79–$2.50 | Configured TTS provider | Up to 30 seconds; charged per preview for non-admin users. |
| Animator voiceover/talking job | 25 credits | $1.79–$2.50 | HeyGen/TTS flow | Up to 30 seconds; server cap is five/day/user. |
| Lip sync catalog item | 25 credits | $1.79–$2.50 | Rhubarb/voice workflow | The talking-video route currently charges this price. |
| Additional animation, 10 seconds | 30 credits | $2.14–$3.00 | Catalog price | Confirm a production route before billing separately. |
| 3D scene editing, scripts, timeline, local render controls | No additional standalone charge | — | Browser WebGL/WebCodecs where available | Provider spend occurs only when a paid voice/video/generation action is invoked. |

### BIM, storage, and marketplace

| Module / action | Customer charge | Approx. customer wallet value | Current provider path | Enforcement / notes |
|---|---:|---:|---|---|
| Scaled building shell | 60 credits | $4.29–$6.00 | Blender/IFC worker + B2 storage | Live server preflight/build route. Delivers GLB geometry without IFC semantics. |
| IFC building information model | 300 credits | $21.43–$30.00 | IFC worker + semantic GLB + B2 storage | Live server preflight/build route. |
| Additional storage | 4 credits / GB / month | $0.29–$0.40 | Backblaze B2 | Catalog price; confirm billing job/checkout before offering as live recurring billing. |
| Marketplace listing | 7.5% commission; $10 or 100-credit wallet minimum | — | Catalog only | Marked `comingSoon`. |

### Pet simulation / AR support modules

| Module / action | Customer wallet charge | Provider path | Enforced guard today |
|---|---:|---|---|
| Pet image classification | No wallet price defined | Gemini Vision | Master switch + `PETSIM_CLASSIFY_ENABLED`; default/user configuration cap 25/day. |
| Semantic scene scan | No wallet price defined | Gemini Vision | Master switch + `PETSIM_SEMANTIC_SCAN_ENABLED`; cap 50/day. |
| Pet auto-rig | No wallet price defined | Tripo/Blender | Master switch + `PETSIM_RIG_ENABLED`; cap 5/day; currently configured off. |

These are cost-bearing provider calls, but they do not presently use the customer-credit catalog. That is a product-margin risk until a server-side credit price or a budget reservation is added.

---

## 3. Intended Hostinger provider budgets vs. code actually enforcing them

The following values were provided in the Hostinger configuration. They are useful operating targets, but the current repository has no reads of these variable names, so they do **not** limit traffic or dollars by themselves.

| Intended module budget | Hostinger configuration | Intended per-user / global limit | Intended provider estimate | Enforcement status in current code |
|---|---|---:|---:|---|
| Veo video | `PETSIM_VIDEO_*` | 2/day / 20/day | $1.00 per job; $20/day global | **Not read.** Code instead uses 5/day/user and no global spend cap. |
| HeyGen talking video | `PETSIM_TALKING_VIDEO_*` | 1/day / 10/day | $2.00 per job; $20/day global | **Not read.** Code shares the 5/day/user video counter. |
| 3D model generation | `PETSIM_MODEL_3D_*` | 2/day / 20/day | $1.00 per job; $20/day global | **Not read.** Legacy conversion shares the 5/day/user counter. |
| Image generation | `PETSIM_IMAGE_GENERATION_*` | 5/day / 50/day | $1.00 per job; $50/day global | **Not read.** Current image route charges credits but has no matching global provider budget. |
| Pawprints | `PETSIM_PAWPRINT_*` | 3/day / 50/day | $0.10 per job; $5/day global | **Not read.** Manual Pawprint save is credit-gated but lacks these daily/global guards. |
| Classify / semantic scan / rig | `PETSIM_*_DAILY_CAP` | 25 / 50 / 5 per user/day | Provider-dependent | **Read and enforced** by `server/paidApiGuards.ts`; rig is currently disabled. |

### Highest-priority cost-control fix

Implement one server-authoritative budget service for video, talking video, image generation, 3D generation, and Pawprints that:

1. Reads the existing `PETSIM_*_ENABLED`, per-user cap, global cap, estimated micro-USD, and global daily micro-USD variables.
2. Atomically reserves both the user allowance and global budget **before** the provider call.
3. Releases the reservation if the provider rejects or the job cannot be started.
4. Records the provider, estimate, actual provider usage when available, job ID, user, and refund outcome.
5. Fails closed with a clear “temporarily unavailable” message once a provider budget is exhausted.

This is more important than adjusting credit prices because it prevents a successful wallet charge from becoming an unbounded vendor bill.

---

## 4. What Gemma is currently doing

### Current production status: inactive

The supplied Hostinger setting is `HERMES_ENABLED=false`. With that value:

- `/api/hermes/*` returns the safe “Hermes is unavailable” response.
- No Pawsome3D browser component currently posts to `/api/hermes/looks`.
- The project has no runtime evidence of a Gemini/Gemma wardrobe plan being used to generate Fido’s Styles images.
- Therefore Gemma currently has **zero production requests and zero request-driven model cost** from this app. Hosting a worker elsewhere may still have its own idle infrastructure cost, which is outside this repository.

### Prepared Gemma capability: Fido’s Styles look planner

The `hermes-looks-worker` is a Python service intended to run a **Transformers-compatible Gemma 4 E2B** model behind Outlines. Its job is deliberately narrow:

1. Accept a text-only Fido’s Styles request: user prompt, identity summary, optional look pack, requested aspect ratio, and 10–30 reference-photo count.
2. **Never receive the actual reference photos.** The private image pipeline retains them.
3. Use Outlines + a Pydantic `LookSpecV1` schema to constrain decoding. It asks for 1–4 distinct looks with stable IDs (`look-1` through `look-4`).
4. Return structured fields for outfit, colors, accessories, pose, setting, camera, lighting, `render_prompt`, and `negative_prompt`.
5. Have Pawsome3D validate the same `pawsome.look-spec.v1` schema again before an image renderer can use it.

Gemma is therefore a **planning model**, not an image/video/3D model. It should decide a structured creative brief; Gemini/Imagen or another image renderer would create the actual visual output.

### What is required before enabling Gemma

| Requirement | Why it matters |
|---|---|
| A deployed Hermes edge bridge | Pawsome3D’s server sends authenticated jobs to this bridge, not directly to the Python worker. |
| `HERMES_ENABLED=true` | Enables the authenticated server routes. |
| HTTPS `HERMES_EDGE_BRIDGE_URL` and `HERMES_EDGE_PRODUCER_SECRET` | Required server-only transport/authentication settings. |
| Worker `HERMES_LOOKS_MODEL_ID` | Must be a **Transformers-compatible Gemma 4 E2B** checkpoint; do not point it at the Android `.litertlm` runtime file. |
| Worker `HERMES_LOOKS_WORKER_TOKEN` | Private bridge-to-worker authentication. |
| A Fido’s Styles client integration | The current UI needs a submit/poll/apply flow for `/api/hermes/looks`. |
| Credit/budget decision | Hermes routes have rate limits and daily caps but no customer-credit charge. Decide whether a look plan is free, bundled, or billable before exposure. |
| End-to-end image-renderer integration | The structured look plan must be applied to a private-avatar image generation request and audited for identity preservation. |

Hermes’s server-side caps are 20 translation plans/day/user, 10 knowledge plans/day/user, and 10 look plans/day/user. It additionally rate-limits create and status requests, stores jobs in MySQL, never forwards photos to the language model, and validates returned look JSON.

---

## 5. SEO status and recommended next work

### Completed technical foundation

- One public title and meta description focused on 3D pet models, video, styles, Pawprints, and keepsakes.
- Canonical URL, Open Graph, X/Twitter cards, theme color, favicon, and web manifest.
- `Organization`, `WebSite`, and `SoftwareApplication` JSON-LD.
- `robots.txt` that allows public crawling while blocking `/api/` and `/animator-files/`.
- Sitemap containing the public root and server-rendered legal pages.
- Canonical/meta/social markup on privacy, terms, and SMS pages.
- Signed-in product pages dynamically use `noindex,nofollow,noarchive`; user data and private studios should never become search landing pages.
- A no-JavaScript public summary so crawlers have a truthful baseline description.

### Priority 1 — create public, indexable marketing pages

The current public root is mostly an authentication entry. The strongest SEO improvement is to add server-rendered or statically generated public pages with visible, useful content, each with a unique title, description, canonical, internal links, and sitemap entry:

1. `/3d-pet-models` — examples, input guidance, output types, and limitations.
2. `/pet-video-creator` — Veo image-to-video use cases and safe image guidance.
3. `/pawprints` — public examples of occasions/templates and exact manual-editor workflow.
4. `/fidos-styles` — wardrobe/look concepts, clearly distinguishing planning from generated imagery.
5. `/how-it-works` — upload → create → refine → save/print flow.
6. `/pricing` — only publish prices that are actually purchasable and keep them synchronized with the credit catalog.
7. `/help` and FAQ pages — answer real search questions such as “how to turn a pet photo into a 3D model.”

Do not sitemap authenticated `/home`, `/furball3d`, `/animator`, or individual user assets.

### Priority 2 — Search Console and crawl operations

1. Verify the `https://pawsome3d.com/` domain property in Google Search Console.
2. Submit `https://pawsome3d.com/sitemap.xml` after deploying this ZIP.
3. Inspect the live homepage and each legal URL with URL Inspection; request indexing only for public pages.
4. Watch Coverage, Page Indexing, Core Web Vitals, mobile usability, and 404 reports weekly for the first month.
5. Set one preferred host/protocol in Hostinger/Cloudflare and redirect all other variants to the canonical HTTPS domain.

### Priority 3 — content, social, and performance

- Replace the generic `MAIN.jpg` social image with a purpose-built 1200×630 Open Graph image that clearly shows the Pawsome3D logo and a finished pet model/video/Pawprint. Keep the copy minimal and legible.
- Add unique, descriptive `alt` text for every public, meaningful image. Decorative images should have empty alt text.
- Keep one visible H1 per public page and use descriptive H2s; do not keyword-stuff titles, metadata, or schema.
- Publish example galleries only with permission and public-safe media; each example should include a useful explanation, not duplicate captions.
- Add `FAQPage` structured data only when the matching questions and answers are visibly present on the page.
- Preserve the current lazy-loading strategy and reduce the large Three.js chunks further for better Largest Contentful Paint and interaction responsiveness on the public landing pages.
- Self-host or subset fonts if Google Fonts becomes a measurable render-blocking cost; validate changes with real-field Core Web Vitals rather than assumptions.
- Build relevant backlinks through pet-rescue partnerships, creators, press, and genuinely useful resources—not paid link schemes or synthetic reviews.

### SEO guardrails

- Never index private creations, profiles, API results, signed media URLs, or generated files without an explicit public-sharing product and consent flow.
- Do not claim print accuracy, AI capabilities, pricing, or turnaround times that the live product cannot meet.
- Do not add Product/Review/FAQ schema unless the visible page exactly supports it.
- Keep canonical URLs self-referential and consistent with the sitemap.

---

## 6. Recommended business decisions

1. Decide the desired gross-margin target for each provider-backed module, then derive wallet prices from real provider invoices rather than from estimates.
2. Implement the missing global provider budget guard before increasing marketing spend or opening more free/admin access.
3. Decide whether Fido’s Styles look planning is included, credit-priced, or a premium entitlement before enabling Hermes/Gemma.
4. Build public marketing pages before expecting meaningful organic traffic; technical metadata alone cannot make an authenticated application competitive for non-brand searches.
5. Maintain this document whenever a price, provider, cap, or model integration changes.
