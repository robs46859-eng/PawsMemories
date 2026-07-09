# SnapGen — Android Implementation Plan (Phased)

**Product:** SnapGen — pic-to-3D-model app. Users snap or upload a photo, customize, and buy generated 3D models by category and complexity. X (Twitter) DM bot as a second order channel. Photobooks from the pre-model generated image.

---

## Recommendation: New app, reuse your backend

**Do NOT fork PawsMemories or start fully from scratch.** Build a new Expo (React Native) app for the frontend, and extend the existing Express backend you already run on Hostinger + the Render blender-worker + x-dm-service.

Why:
- Your hard-won assets are backend: the Tripo multiview pipeline, palette-lock, Blender worker, Backblaze storage, MySQL schema, Stripe wiring, and the X DM bot (OAuth 1.0a webhooks, hybrid payload). All of it transfers with light changes.
- The PawsMemories frontend is pet-avatar-specific (skeletal clips, AR sim, community). Stripping it costs more than starting a clean RN app.
- Expo gives one codebase for Android now and iOS later, native camera via `expo-camera`, 3D preview via `expo-gl` + Three.js, and store-ready builds via EAS Build. You already know React.

**Repo layout:** new repo `snapgen-app` (Expo). Backend endpoints added to the existing server under an `/api/snapgen/` namespace (or a `SERVICE=snapgen` env flag if you prefer a second deploy). x-dm-service gets a second bot config.

---

## Critical constraint: Google Play Billing

Digital goods sold inside the app (3D models, digital photobooks, remakes) **must** use Google Play Billing — Stripe is not allowed for in-app digital content and will get the app rejected. Physical photobooks (print-on-demand) **may** use Stripe.

- Use **RevenueCat** (free up to $2.5K MTR) over raw Play Billing: it handles receipt validation, restores, and later gives you StoreKit for iOS with the same code.
- The credit system sunsets cleanly: each model purchase is a one-time IAP product. No wallet, no Play policy complexity.

---

## Pricing (keep-it-low rule: ~30% of competitor)

Competitor benchmark ≈ $100 for a commissioned/marketplace model → your ceiling is **$30**. Tier by complexity:

| Tier | What the user gets | Price | Remake (50% off) |
|---|---|---|---|
| Basic | Single-view mesh, standard texture | $2.99 | $1.49 |
| Standard | Multiview mesh, palette-locked texture | $6.99 | $3.49 |
| Detailed | High-poly, PBR textures, cleanup pass | $14.99 | $7.49 |
| Pro | Detailed + rigged/animation-ready | $29.99 | $14.99 |
| Digital photobook | 10–20 page PDF, custom backgrounds | $4.99 | — |
| Physical photobook | POD print + ship (Stripe) | $19.99+ | — |

Each (tier × price) is a Play Billing product; remakes are separate half-price SKUs unlocked only when the user owns the original.

---

## Phase 0 — Backend prep (existing server, ~1 week)

1. **Namespace SnapGen API:** `/api/snapgen/*` routes in `server.ts` (or extracted `server/snapgen/` module). Reuse `tripo.ts`, `storage.ts`, blender-worker calls as-is.
2. **Catalog schema (MySQL):** `sg_categories` (e.g. People, Pets, Vehicles, Objects, Landmarks, Toys/Figurines), `sg_complexity_tiers` (maps to Tripo/worker settings: view count, texture quality, rig on/off), `sg_orders`, `sg_models`, `sg_remakes` (FK to original order, enforces 50% pricing), `sg_photobooks`.
3. **Purchase verification endpoint:** validate RevenueCat webhooks / Play purchase tokens server-side before starting a generation job. Generation only starts on verified purchase.
4. **Customization + prompting fields:** carry over PawsMemories fields (colors/palette lock, style) and add: free-text prompt, negative prompt, style preset, material hint, pose hint. Every new field is **optional with a safe default** — empty fields fall back to the deterministic pipeline settings so the generator can't drift or error on missing input. Validate/sanitize prompt text server-side (length cap, strip injection).
5. **Remake flow:** `POST /api/snapgen/remake/:orderId` — verifies ownership, re-runs job with edited customization, priced at 50% SKU.
6. **Photobook image path:** persist the pre-model generated image (you already have it mid-pipeline) so photobooks don't require a model purchase.

**Exit criteria:** curl-able API that takes an image + options, verifies a (sandbox) purchase, returns a model URL from Backblaze.

## Phase 1 — Expo app scaffold (~1 week)

1. `npx create-expo-app snapgen` (TypeScript, Expo Router). EAS project + Android package id (e.g. `com.snapgen.app`).
2. Auth: reuse your JWT auth (`auth.ts` pattern) with email + Google Sign-In.
3. Navigation: **Create · Store · My Models · Profile** tabs.
4. Camera + gallery: `expo-camera` (live capture, multi-shot for multiview) + `expo-image-picker`. Upload with progress to the existing upload endpoint.
5. Theme: fresh SnapGen brand (don't carry TerraPaw).

**Exit criteria:** installable dev APK — sign in, take/pick a photo, photo lands in Backblaze.

## Phase 2 — Generation flow + 3D viewer (~1–2 weeks)

1. Customization screen: category picker, complexity tier picker, PawsMemories-style fields (palette/colour picker) + new prompt fields, all optional, with live "what you'll get" summary.
2. Job flow: submit → poll job status (reuse existing job pattern) → push notification (`expo-notifications`) on completion.
3. 3D preview: `expo-gl` + Three.js GLB viewer (orbit, zoom, lighting). Watermarked/low-res preview until purchase confirmed if you want try-before-buy; otherwise purchase-first per Phase 3.
4. My Models library: list, re-download, share, "Remake for 50% off" button.

**Exit criteria:** end-to-end photo → customized → generated → viewable model on a real Android device.

## Phase 3 — Store + in-app purchasing (~1 week)

1. RevenueCat SDK; define all SKUs from the pricing table in Play Console (in-app products, not subscriptions).
2. Purchase gate: pay → server verifies → generation starts. Failed generations auto-refund or free re-run (protects ratings).
3. Store tab: browse categories, sample models per category/tier so buyers see quality before paying.
4. Remake purchases surface only on owned models.

**Exit criteria:** sandbox (license-tester) purchases work end-to-end; server rejects unverified jobs.

## Phase 4 — X (Twitter) DM bot (~1 week, parallel-able)

1. Reuse `x-dm-service` (Render) exactly as with PawsMemories: OAuth 1.0a subscriptions, hybrid webhook payload. Add a SnapGen bot account + config.
2. DM flow: user DMs a photo → bot replies with tier menu → payment via deep link into the app (Play Billing can't run in DMs) → bot DMs the model link when done.
3. Account linking: one-time code the user enters in-app to tie their X handle to their SnapGen account.

**Exit criteria:** DM a photo, tap the link, pay in app, receive model link back in DMs.

## Phase 5 — Photobooks (~1–2 weeks)

1. **Digital first:** server-side PDF composer — generated image composited onto background templates (landscapes/locations; extend `backgrounds.ts` catalog). User picks backgrounds + layout in app; sold as IAP ($4.99).
2. **Physical later (5b):** Prodigi or Peecho POD API; Stripe checkout (physical goods = allowed); ship-to address collection; order status webhook.

**Exit criteria (5a):** buy and download a themed PDF photobook from a generation.

## Phase 6 — Hardening + Play Store launch (~1–2 weeks)

1. Error/drift guard rails: retry policy on Tripo failures, output validation (poly count, texture presence) before delivery, fallback to safe defaults.
2. Analytics + crash reporting (Sentry), rate limiting on generation endpoints.
3. Play listing: screenshots, feature graphic, data-safety form, content rating, privacy policy page on your Hostinger domain.
4. **Closed testing track first** (Play requires testing before production for newer accounts; even if exempt, do it), then staged rollout 10% → 100%.

**Exit criteria:** live on Google Play.

## Phase 7 — iOS (after Android is stable)

Same Expo codebase: EAS iOS build, RevenueCat handles StoreKit, App Store review (expect stricter review of user-generated-content + purchase flows). Est. 1–2 weeks since features already exist.

---

## Timeline & cost notes

- **Total to Android launch: roughly 6–8 weeks** of focused work; Phases 0/4 can run parallel to 1–3.
- Fixed costs: Google Play $25 (done), Apple $99/yr (Phase 7), RevenueCat free tier, EAS free tier is fine to start, Tripo per-generation costs — verify unit economics: your COGS per Basic model must stay well under $2.99 (check current Tripo credit pricing before finalizing tiers).
- Keep PawsMemories/Pawsome3D running untouched; SnapGen endpoints are additive.

## If you need to resume later (credit-outage checklist)

1. Phase 0: add `/api/snapgen` routes + catalog tables to existing server.
2. Phase 1: `create-expo-app`, auth, camera, upload.
3. Phase 2: customization screen, job polling, expo-gl GLB viewer.
4. Phase 3: RevenueCat + Play Console SKUs, server-side verification.
5. Phase 4: second bot config in x-dm-service, deep-link payment.
6. Phase 5: PDF photobook composer, then POD via Stripe.
7. Phase 6: hardening, Play closed testing, staged rollout.
