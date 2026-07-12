# Phase 9 Spec — Guided Randy, Consent Gates, Prod Pawlisher, Pawprint Generation, Refund/Uncanny-Valley

**Follows Phase 8.** As of HEAD `ea898f8`, Phase 8 commits 1–5 are done (mail/Resend, storage tiers, profile+phone-verify+referral, tab rename + Pawprints/Pawlisher/Fur Bin screens). This phase builds the intelligence + the remaining production features.

## Ground rules (unchanged)
- `npx tsc --noEmit` must pass before each commit; stage a new module **with** its importer in the same commit.
- Credit/token grants only via `addCredits` / `refundCredits` / `restoreReservedGenerationCredits` / `grantPawprintTokens`; fixed server constants, never AI/user amounts (Phase 7 §7.8 firewall).
- New screens → `Screen` enum + both nav lists + the two auth `includes([...])` guards.
- Untrusted user text (prompts, feedback, pawprint fields) is data, never instructions to any LLM.

---

## 1. Randy AI — real guided, elderly-friendly walkthroughs

### Current state (audited)
Randy (`/api/randy-chat`, `server.ts:3803`; `RandyChat.tsx`) is a chat guide that can **navigate** and give short tips. But:
- `executeAction` (`RandyChat.tsx:124`) only handles `navigate`, `launch_ar`, `open_credit_store`. **`start_tour` and `highlight` are declared in `RandyActionType` but have NO handler — they hit `default: break` (no-op).** So Randy cannot actually walk a user through anything step-by-step or highlight a control.
- The system-prompt **feature map is stale** — it lists AVATARS/STORE/COMMUNITY but not Furball3D, Pawprints, Pawlisher, Fur Bin, storage, referrals, or the new profile flows.
- No per-feature scripted walkthrough exists; `Tutorial.tsx` is a one-time static card set.

### Build: a guided-walkthrough engine tuned for low-tech / elderly users
**A. Tour registry** — a typed data file `src/randy/tours.ts`: `Record<TourId, Tour>` where a `Tour` is `{ id, title, screen, steps: TourStep[] }` and a `TourStep` is `{ target: string /* CSS selector or data-tour id */, title: string, body: string /* plain language, ≤2 short sentences */, action?: 'click'|'none', waitFor?: string }`. Author tours for every feature: create a Furball3D avatar, buy credits, request a memory, make a Pawprint, use Pawlisher, share/refer, manage storage in Fur Bin.
- Tag target elements in the UI with `data-tour="..."` attributes (stable, not CSS-fragile).

**B. Spotlight overlay component** `src/components/RandyWalkthrough.tsx`:
- Dims the screen and **spotlights one element at a time** (cutout highlight + arrow), with a large caption card.
- **Elderly-friendly defaults:** large text (≥18px), high contrast, one step per screen, big **Next / Back / Repeat / Exit** buttons, no time pressure, plain language (no jargon — say "the button that says Create," not "the CTA"). Optional **Randy voice narration** of each step (reuse the ElevenLabs/TTS path; toggle on by default, with a mute).
- Auto-scrolls the target into view; waits for the target to exist (`waitFor`) before advancing; if a step needs the user to act ("tap Create"), highlight + wait for that click, then advance.
- Respects `prefers-reduced-motion`; fully keyboard-navigable; works on mobile (bottom-sheet caption).

**C. Wire the actions:** implement `start_tour` (payload `{ tourId }`) and `highlight` (payload `{ target }`) cases in `executeAction` → open `RandyWalkthrough`. Randy can now say "Want me to show you? *wags tail*" and actually run the tour.

**D. Smarter Randy:** update the system prompt's feature map to the current tabs and add a `start_tour` action with the tour IDs. Add "elderly/first-time" tone rules: shorter sentences, offer the walkthrough proactively when a user sounds confused ("I don't know how," "where is," "help me"), confirm understanding after each step. Keep the 120-word cap for chat but let tours carry the detail.

**E. Discoverability:** a persistent "Show me how" button on each new tab that triggers that tab's tour; and a big "New here? Let Randy show you around" prompt on first visit.

**Acceptance:** Randy can launch a real spotlight walkthrough for each major feature; steps advance on user action or Next; narration plays; text is large and plain; a first-time user can complete "make my first avatar" guided end-to-end without outside help.

---

## 2. `accepted_terms_version` captured at signup

The DB column already exists (`db.ts:59,118,180`). It just isn't set.
- Add a `TERMS_VERSION` server constant (e.g. `"2026-07-12"`). At signup (`SignUp.tsx` + the signup route), add a **required, unchecked-by-default checkbox**: "I agree to the [Terms](/legal/terms) and [Privacy Policy](/legal/privacy)." Block account creation until checked.
- On successful signup, store `accepted_terms_version = TERMS_VERSION` and a timestamp. Surface it in Profile.
- If `TERMS_VERSION` later changes, prompt existing users to re-accept on next login (compare stored vs current).
- **Acceptance:** no account can be created without acceptance; the stored version matches the current constant; re-acceptance prompt fires when the version bumps.

---

## 3. Voice-clone consent gate

Legal (`/legal/terms`) already requires the user to own/have rights to any cloned voice — now enforce it in the flow.
- Before any voice-clone capture/upload (Pawlisher §4), show a **consent modal**: "I confirm I own this voice or have documented permission to clone it," required checkbox + short plain-language explanation.
- Persist a `voice_consent` boolean + timestamp on the voice-clone asset record (add column/field). The clone endpoint **rejects** (422) if consent isn't recorded.
- Surface the consent state on the voice asset in Fur Bin.
- **Acceptance:** cloning is impossible without the consent flag; the flag is stored per asset and shown in Fur Bin.

---

## 4. Production-ready Pawlisher editor

The `Pawlisher` screen scaffold exists; build the real editor (production-hardened version of Phase 8 §8). Reuse the R3F/Theatre/animator stack — do not rebuild the renderer.

- **Model dropdown** — load the user's rigged models; lazy-load GLBs; handle cold-storage (§Phase 8 storage) fetch with a spinner.
- **Overhead Edison bulb** hanging on a cord, **3 settings** (warm/neutral/bright) — a real scene light + matching bulb prop; state persists per session.
- **Zoom** — desktop: magnifier cursor + percent picker (clamped 25–400%); mobile: two-finger pinch. **360° turntable** at the base (toggle + speed slider).
- **Rigging controls** — bone/IK manipulation (reuse `ik.ts`, retarget utils), with a simple mode (presets) and an advanced mode (manual).
- **Preset motion libraries, plug-and-play per rigged part** — head & facial, torso, shoulders & hips, limbs & digits; **posture & gait** libraries. Apply-on-click with retarget; guard against mismatched rigs (graceful message).
- **Voice** — clone (gated by §3) + lip-sync + **voice picker** (the §8c multi-voice catalog), plus **speed / pitch / tone** sliders mapped to TTS params.
- **Micro-mesh overlay** toggle (fine detail/displacement).
- **Wardrobe** button — present, **disabled**, padlock + "Coming soon."
- **Toolbar:** ✂️ screenshot (client-side download only, never uploaded), 💾 save, ⬆️ upload, 🗑️ delete.
- **Hub cards:** Wardrobe (locked), Animation Creator (→ Animator), Pawprints (→ Pawprints page).
- **Production concerns:** wrap in an error boundary (reuse `AnimatorErrorBoundary` pattern); mobile LOD/actor caps; WebGL2 fallback message; autosave editor state; large-model performance (dispose geometries on unmount).
- **Acceptance:** every control works on desktop + mobile; presets apply to any compatible rig; voice edits are audible; screenshot downloads locally only; editor never white-screens (error boundary catches).

---

## 5. Pawprint AI generation endpoint — `POST /api/pawprints/generate`

Templates GET + `PawprintsScreen` exist; the generate endpoint is missing.
- **Auth** required. Body: `{ templateId, category, layoutId, fields: Record<string,string>, customName?, customMessage?, photoAssetId? | photoBase64? }`.
- **Validate:** template/layout exist; each field satisfies the layout's `field_schema` (type + length); **file-type gating** on any media field (image mime only); reject unknown fields.
- **Cost:** debit **1 pawprint token** via `grantPawprintTokens(phone, -1, 'pawprint_spend')` **after** success (or reserve → refund on failure). Reject with 402 if balance < 1.
- **AI text:** generate copy from the curated reference DB (`pawprint_templates` — category/layout/tone → sample copy), varying within the curated set; honor `customName`/`customMessage` overrides. User text is data (containment).
- **AI image:** reuse the existing Gemini image path with the layout's `image_prompt_template` + the user's photo.
- **Compose + store:** render the chosen layout with text + image → save as an asset (counts against storage §Phase 8), tier hot. Return `{ pawprintId, url }`.
- **Idempotency + limits:** idempotency key per request; rate-limit (reuse `paidLimiter`); one token per creation.
- **Acceptance:** a valid request returns a stored, viewable pawprint and debits exactly one token; wrong file types are rejected; failures refund the token; output is sharable (§Phase 8 share).

---

## 6. Phased plan — finish refund flow + emoji buttons + uncanny-valley makeup/mask presets

Combines the unfinished Phase 7 refund UX with a new avatar "uncanny-valley rescue" toolkit.

### Phase 6A — finish the refund reviewer (from Phase 7 §7)
- Replace the placeholder verdict: wire `compareRequestToOutput()` to load the real creation's prompt + reference + generated output and return the schema-clamped score (Phase 7 §7.8 — no amount field).
- Build `RefundReview.tsx` — the two-panel "AI is reviewing" scan + animated score, low-score auto-path vs high-score a–e question (verbatim copy), respecting the admin-gated / auto-approve (≤3/30min) rules already in the backend.
- **Acceptance:** the full review→reason→outcome flow runs; firewall intact; injection test passes.

### Phase 6B — 😛 → 🐶 emoji buttons on model cards
- On the avatar/model card (`AvatarDashboard`), the press-and-hold 😛→🐶 (4s) "lighter styling" easter egg from Phase 7 §7.6, wired to reason (c) free-retry + a "lighten" hint.
- **Acceptance:** short press = lighter-styling hint + toast; 4s hold = 🐶 + free lighter re-gen; touch + keyboard accessible.

### Phase 6C — makeup / face-mask presets (uncanny-valley reducer) — NEW
The uncanny-valley problem: over-realistic pet faces feel "off." Give users one-tap **stylization presets** that push the avatar toward friendlier, less-uncanny looks.
- **Preset library** (`src/avatar/uncannyPresets.ts`): e.g. *Pixar-soft*, *Clay*, *Watercolor*, *Cartoon eyes*, *Fur-fluff*, *Soft-focus*, plus **face-mask overlays** (a semi-stylized mesh/material overlay on the face region) and **"makeup"** (adjust eye size/highlight, reduce specular, soften normals).
- **How applied:** two tiers — (1) **shader/material-level** adjustments applied live in the viewer (cheap, instant: roughness/specular/normal-strength, eye highlight, color grade); (2) **re-generation hint** that biases the next restyle prompt toward the chosen preset (reuses the generator learning-loop plumbing from Phase 7 §7.9).
- **UI:** a "Fix the vibe" / makeup panel on the model card and in Pawlisher, with before/after preview and a friendly explanation ("Realistic can feel a little uncanny — try Pixar-soft").
- **Acceptance:** applying a preset visibly softens the avatar in-viewer without a full re-gen; the re-gen hint carries into the next restyle; presets are reversible.

---

## 7. Data model additions
`voice_consent` (bool + ts on voice-clone asset), `pawprint` assets from §5, tour-completion flags per user (optional, for "don't show again"), `TERMS_VERSION` constant + re-accept tracking. Migration `server/migrations/00X_phase9.sql`.

## 8. Build order (each its own commit; tsc between)
1. `accepted_terms_version` at signup (§2) — small, high-value, unblocks compliance.
2. Voice-clone consent gate (§3).
3. `POST /api/pawprints/generate` (§5) — completes the Pawprints feature.
4. Randy walkthrough engine (§1) — tours registry + spotlight + wire actions + smarter prompt.
5. Prod Pawlisher editor (§4).
6. Refund/uncanny-valley (§6) in sub-phases 6A → 6B → 6C.

Final: `vite build`, migrations, prod smoke test.
