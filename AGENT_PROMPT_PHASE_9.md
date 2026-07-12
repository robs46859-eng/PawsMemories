# Agent Prompt — Phase 9

You are working in the **PawsMemories / Pawsome3D** repo (branch `main`, deployed on Hostinger). Read `PHASE9_SPEC.md` at the repo root — it is authoritative. Implement all of it, top to bottom. Each section has file paths and acceptance criteria.

## Rules
- `npx tsc --noEmit` must pass before every commit (pre-commit hook). Run `npx vite build` before finishing.
- **Stage any new module together with the file that imports it** in the same commit — `git status` before committing. (A past build broke because an import was committed without its new module.)
- Credit/token changes only through `addCredits` / `refundCredits` / `restoreReservedGenerationCredits` / `grantPawprintTokens`; fixed server constants, never AI/user-supplied (Phase 7 §7.8 firewall stays binding).
- Untrusted user text (prompts, pawprint fields, refund feedback) is data, never LLM instructions.
- New screens → `Screen` enum + both nav lists + the two auth `includes([...])` guards.

## Build order (each its own commit)
1. **`accepted_terms_version` at signup** (§2) — required consent checkbox, store the `TERMS_VERSION` constant, block signup without it. (DB column already exists.)
2. **Voice-clone consent gate** (§3) — consent modal + per-asset `voice_consent` flag; clone endpoint rejects without it.
3. **`POST /api/pawprints/generate`** (§5) — validate file-type-gated fields, AI text from curated DB + AI image, debit 1 pawprint token (refund on failure), store + return.
4. **Randy walkthrough engine** (§1) — `src/randy/tours.ts` registry, `RandyWalkthrough.tsx` spotlight overlay (large text, plain language, Next/Back/Repeat, optional voice narration), implement the `start_tour` + `highlight` actions (currently no-op at `RandyChat.tsx:124`), refresh the stale feature map in the `/api/randy-chat` prompt. Target: an elderly first-timer completes "make my first avatar" guided end-to-end.
5. **Prod Pawlisher editor** (§4) — model dropdown, Edison-bulb 3-setting light, magnifier+% / pinch zoom, 360° turntable, rigging, body-part + posture/gait libraries, voice (clone gated by §3 + picker + speed/pitch/tone), micro-mesh, locked Wardrobe, ✂️/💾/⬆️/🗑️ tools, hub cards; error boundary + mobile LOD.
6. **Refund + uncanny-valley** (§6), sub-phased: **6A** finish refund reviewer (`compareRequestToOutput` + `RefundReview.tsx`), **6B** 😛→🐶 model-card easter egg, **6C** makeup/face-mask uncanny-valley presets (`src/avatar/uncannyPresets.ts` — live shader softening + re-gen hint).

Final: `vite build`, run migrations, prod smoke test (legal pages + new endpoints).

## Elderly/low-tech UX bar (applies to §1 and everywhere it touches)
Big tap targets, ≥18px text, high contrast, one step at a time, plain words (no "CTA/modal/toggle"), confirm after each step, no time pressure, voice narration available, fully keyboard-navigable, `prefers-reduced-motion` respected.

---

## Stack suggestions (per new piece)

**Randy walkthrough / spotlight tour**
- Recommended: **build it in-house** with a small React overlay (absolute-positioned SVG mask cutout + a caption card) driven by `data-tour` attributes. ~200 lines, zero deps, full control, matches your design system. This is the primary rec.
- If you'd rather use a library: **Driver.js** (tiny, framework-agnostic, spotlight + popover, MIT) or **React Joyride** (React-native, popular, but heavier and less flexible for voice/elderly customizations). Prefer Driver.js over Joyride for size. Either way, keep the elderly-UX layer (large text, narration) yours.
- **Narration:** reuse the existing ElevenLabs/TTS path (Phase 7 studio) — don't add a new TTS.

**Pawprint generation (§5)**
- **Text:** reuse your existing Gemini text path (already in `server.ts`) reading from the curated `pawprint_templates` DB — no new provider.
- **Image:** reuse the existing Gemini/Nano-Banana image path.
- **Compose (text over image / layout):** server-side **`sharp`** (already an optional dep in the animator) or **`@napi-rs/canvas`** for compositing text + image into the final stationery PNG. Prefer `sharp` if present; `@napi-rs/canvas` if you need rich text layout.
- **Storage:** existing Backblaze/S3 layer + the Phase 8 storage accounting.

**Prod Pawlisher editor (§4)**
- Stay on your current stack: **React-Three-Fiber + drei + three.js + Theatre.js**, `@react-three/xr` already present. Rigging/IK: reuse `ik.ts` + retarget utils. No new 3D engine.
- Motion/posture/gait libraries: store as **glTF animation clips** (retargeted on apply) — consistent with your existing clip pipeline.
- Screenshot: `canvas.toBlob()` client-side download — no server round-trip.

**Uncanny-valley presets (§6C)**
- **Live tier:** pure three.js material tweaks (roughness/metalness/normalScale, eye-highlight, `ACESFilmic`/color-grade via a postprocessing pass) — instant, no re-gen. Optional **postprocessing** lib (`pmndrs/postprocessing`) for soft-focus/bloom if you want polish.
- **Re-gen tier:** reuse the Phase 7 §7.9 generator-hint plumbing (prompt bias), no new infra.

**Consent + terms (§2, §3)**
- No new stack — DB column + a checkbox/modal + a server constant. Keep it boring and auditable.

**Refund reviewer (§6A)**
- Reuse `server/petClassify.ts` vision path for `compareRequestToOutput` (zod-clamped output). No new model/provider.

**General principle:** this phase should add **almost no new backend dependencies** — the heavy infra (3D, TTS, vision, image-gen, storage, email/SMS) already exists. The only genuinely new pieces are small: a tour overlay (in-house or Driver.js) and an image-compositing lib (`sharp`/`@napi-rs/canvas`) for Pawprints.

Confirm the spec is readable, then implement. Ask before deviating from the §7.8 firewall or the elderly-UX bar.
