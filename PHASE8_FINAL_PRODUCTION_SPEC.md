# Phase 8 — Final Production Spec (Pawsome3D)

**Status:** the last large implementation before full prod deployment. Ships after Phase 7 (`ANIMATOR_FIX_PLAN.md`) lands.
**Scope:** storage tiers, profile editor + legal/IP, signup/referral/share economy, tab renames and three new tabs (Pawprints, Pawlisher, Fur Bin©️), global Help.

## 0. Ground rules & cross-cutting

- **Credits firewall (from Phase 7 §7.8 — still binding):** the only credit-increasing functions are `addCredits` (purchases/bonuses), `refundCredits` (refund-review only), and `restoreReservedGenerationCredits(jobId)` (operational reversal only). **All new grants in this spec (signup, profile, referral, share) go through `addCredits` with a distinct `reason` string** and are server-authoritative, idempotent, and never client- or AI-supplied amounts.
- **New "pawprint" token:** a separate non-cash reward token, distinct from credits. 1 pawprint = one Pawprint stationery generation (§7). Track as its own balance `pawprint_tokens`; grant via a server-only `grantPawprintTokens(phone, n, reason)`; never cash-convertible.
- **Email transport (BLOCKER — build first) → RESEND (decided).** The repo has **no server-side mailer** today (only `mailto:`). Add `server/mail.ts` using **Resend** (`npm i resend`) exposing `sendMail({to, subject, html, replyTo})`. Env: `RESEND_API_KEY` (Resend dashboard → API Keys) and `MAIL_FROM` (a verified sender on a domain you control, e.g. `noreply@pawsome3d.com` — verify the domain in Resend first). Everything below that "emails" uses this. Self-guard: if `RESEND_API_KEY` is unset, log-and-skip (don't crash), same pattern as `server/sms.ts`.
  ```bash
  RESEND_API_KEY=""                 # Resend → API Keys
  MAIL_FROM="noreply@pawsome3d.com" # verified domain sender
  ```
- **Money/credit ledger:** every grant/spend writes a `credit_history` row (the table already exists — `getCreditHistory` is in `db.ts`). Reuse it; add `pawprint_history` mirror for tokens.
- **`tsc --noEmit` must pass** (pre-commit hook). Ship in logically-scoped commits (see §14).
- **Nav:** tabs live in `src/App.tsx` (top bar ~lines 384–387, side rail ~472–485) driven by the `Screen` enum in `src/types.ts`. New screens must be added to the enum, both nav lists, and the auth `includes([...])` guards at `App.tsx:450` and `:703`.

---

## 1. Model storage tiers — 50 MB free on pawsome3d.com, overflow to mypets.cc (1 GB = 4 cr)

**Existing hooks:** `storage.ts` (Backblaze/S3 — `uploadBase64Image`, `uploadBinaryFromUrl`, `uploadBase64Binary`), and `DEPLOY_TARGET` = `main` (pawsome3d.com) vs `warehouse` (mypets.cc), already noted in `server.ts:1000` as the intended cold-storage offload target.

**Design**
- **Per-user storage accounting.** New `user_storage` table: `{ user_phone PK, bytes_hot BIGINT, bytes_cold BIGINT, cold_gb_purchased INT, updated_at }`. Every asset write (models, videos, voice clones, pawprints) updates the counter; every delete decrements. Wrap uploads so size is recorded atomically with the object write.
- **Free tier:** 50 MB "hot" on the primary bucket (pawsome3d.com). Enforce a pre-upload check: `if bytes_hot + incoming > 50MB` → route to cold storage or block per rules below.
- **Overflow → mypets.cc.** When hot is full, new/older assets spill to the warehouse bucket (`DEPLOY_TARGET=warehouse` endpoint). Cold capacity is **purchased in 1 GB blocks for 4 credits each** via `addCredits`-style debit (`deductCredits(phone, 4, 'storage_1gb')`) that increments `cold_gb_purchased` by 1. A user with 0 purchased GB and full hot tier gets a clear "Storage full — free up space or add 1 GB for 4 credits" prompt (no silent data loss).
- **Offload policy:** LRU — least-recently-viewed models move to cold first. Cold assets still resolve via a durable URL (warehouse public base); viewer fetches transparently (slightly slower). Record `tier: 'hot'|'cold'` per asset.
- **Endpoints:** `GET /api/storage/usage` → `{ bytesHot, bytesCold, freeLimit, coldGbPurchased, coldLimit }`. `POST /api/storage/purchase-gb` (auth, debits 4 cr, +1 GB, idempotent per request id). `POST /api/storage/offload` (internal/LRU job).
- **UI:** a storage meter in Profile (§2) and Fur Bin (§9) showing hot/cold usage vs limits + "Add 1 GB (4 cr)" button.
- **Acceptance:** uploads past 50 MB either spill to cold (if GB purchased) or are blocked with the buy prompt; usage endpoint is accurate; buying 1 GB debits exactly 4 cr once; deletes free space.

---

## 2. Profile editor

Extend the existing `PROFILE` screen (`ProfileScreen.tsx`).

**Fields (editable):** display name, avatar photo, bio (short), ZIP (required — see §4), email (verified badge), phone (verified badge), notification prefs, privacy toggles (§3). Read-only: member since, user id, referral code (§5).
**Sections:**
- **Account & profile** — the editable fields above with inline validation; ZIP + verified email + verified phone drive the §4 completion bonus.
- **Credit balance & pawprints** — current credit balance and pawprint-token balance, with a link to the Credit Store and a compact ledger (last N `credit_history` rows: grants, spends, refunds).
- **Past purchases** — list from Stripe purchase history (`credit_history` where reason is a pack purchase / album order) with date, item, amount, credits added.
- **Storage** — the §1 meter + "Add 1 GB" button.
- **Legal** — links to Privacy Statement, Terms, IP/Licensing (§3), plus data-export/delete request buttons (GDPR/CCPA-style; email to support via §0 mailer).

**Endpoints:** `GET /api/profile` (compose user + balances + storage + purchase history), `PATCH /api/profile` (update editable fields, re-validate ZIP/email/phone), `POST /api/profile/request-data` and `/request-delete`.
**Acceptance:** all fields persist; verified badges reflect real state; purchases and balances are accurate; completing email+phone+ZIP triggers the §4 bonus exactly once.

---

## 3. Legal — IP, copyright, licensing, privacy

> **Not legal advice — a lawyer must review before prod.** Provide the structure + placeholder copy; Robert/counsel finalizes wording. Store as versioned markdown served in-app and as static pages.

- **Privacy Statement** (`/legal/privacy`): what's collected (email, phone, ZIP, uploads, usage), why, storage (Backblaze/mypets.cc), third parties (Stripe, OpenAI/ElevenLabs, HeyGen, Tripo, Google Maps), retention, user rights (access/delete/export), contact. Cookie/analytics disclosure.
- **Terms of Service** (`/legal/terms`): acceptable use, account rules, credit/pawprint terms (non-cash, non-refundable except via the §7 refund system, no expiry unless stated), storage limits, termination.
- **IP & Copyright / Licensing** (`/legal/licensing`) — establish clearly:
  - **User-uploaded content:** user retains ownership; grants Pawsome3D a limited license to process/store/display for providing the service.
  - **Generated outputs (3D models, videos, voice, pawprints):** define who owns them and the license the user gets. Recommended: user receives a **personal + commercial license to their own generations**, while Pawsome3D retains platform IP (templates, rigs, libraries, code, brand marks **Furball3D©️, Pawprints, Pawlisher, Fur Bin©️**). **Strict licensing:** prohibit resale/redistribution of platform templates/libraries; prohibit using others' shared models without permission; no training third-party models on platform outputs without consent.
  - **Voice cloning consent:** explicit clause — users may only clone voices they own or have documented rights to; store a consent flag per voice-clone asset.
  - **DMCA / takedown** process + contact.
  - **Trademark notices:** ©️/™ marks for Furball3D, Pawprints, Pawlisher, Fur Bin, Pawsome3D.
- **Acceptance:** pages reachable from Profile + footer; acceptance checkbox recorded at signup (`accepted_terms_version`, timestamp); voice-clone flow blocks without the consent checkbox.

---

## 4. Signup + profile-completion credits (100 cr)

- **Grant 100 credits** once a user has: (a) email on file, (b) **verified phone**, (c) ZIP. Wording says "100 credits for sign up and completed profile" — implement as a **single 100-credit grant on profile completion** (all three present + email verified), not double-dipping. If Robert wants it split (e.g., 50 at signup + 50 at completion), flag; default = 100 on completion.
- Idempotent: `addCredits(phone, 100, 'profile_complete_bonus')` guarded by a `profile_bonus_granted` flag on the user row. Never re-grantable.
- **Phone verification → TELNYX VERIFY (decided).** Use Telnyx Verify for the OTP (same account/key as outbound SMS). Flow: `POST https://api.telnyx.com/v2/verifications/sms` with `{ phone_number, verify_profile_id }` to send the code, then `POST https://api.telnyx.com/v2/verifications/by_phone_number/{phone}/actions/verify` with `{ code }` to check. Add server routes `POST /api/verify/phone/start` and `/api/verify/phone/check`; on success set a `phone_verified` flag on the user (drives the §4 bonus). Env: reuse `TELNYX_API_KEY`; add `TELNYX_VERIFY_PROFILE_ID` (Telnyx Portal → Verify → create a Verify profile). Rate-limit start attempts; expire codes.
  ```bash
  TELNYX_VERIFY_PROFILE_ID=""   # Telnyx → Verify → your Verify profile
  ```
- **Acceptance:** bonus lands exactly once when all conditions first met; deleting/re-adding fields doesn't re-trigger; flag set.

---

## 5. Share + referral economy

**Two mechanics:**

### 5a. Share a generation (model / video / user profile)
- Add **Share** on models, videos, and user profiles → share sheet for **X (Twitter), Meta, Snap, BlueSky, TikTok**.
- Reward: **12 credits OR 1 pawprint per network, once each** (5 networks max → user chooses reward per network). Grant on **verified share** where the platform allows a share callback/intent completion; where not verifiable, use a best-effort intent + one-time claim guarded server-side (`share_rewards` table: `{user_phone, generation_id, network, reward_type, granted_at}` UNIQUE on `(user_phone, generation_id?, network)` per the "1x for each" rule).
- **Anti-abuse:** each network reward claimable once per user (interpret "1x for each" as once per network per user account, not per generation — **confirm with Robert**; default = once per network per user, lifetime). Reward via `addCredits(...,'share_reward')` or `grantPawprintTokens(...,'share_reward')`.

### 5b. Referral code / link
- Every user gets a unique **referral code + link** (`/r/:code`), shown in Profile. Store `referral_code` on user; `referrals` table `{referrer_phone, referred_phone, code, credited_at}`.
- When a **new user** signs up via a code/link **and completes profile (§4)**, grant the **referrer 30 credits + 1 pawprint**, once per referred user. `addCredits(referrer, 30, 'referral_bonus')` + `grantPawprintTokens(referrer, 1, 'referral_bonus')`.
- Anti-fraud: referred must be a genuinely new verified account (verified phone, distinct device/IP heuristics), profile completed; self-referral blocked; idempotent per `referred_phone`.
- **Endpoints:** `GET /api/referral` (my code/link/stats), share callbacks `POST /api/share/claim`, referral attribution captured at signup.
- **Acceptance:** codes unique; referral bonus fires once after referred completes profile; share rewards capped as specified; all grants server-authoritative and ledgered.

---

## 6. Rename "Avatars" tab → **Furball3D©️**

- The tab currently labeled for generated 3D pet avatars is **`Screen.MODELS`** (top bar `App.tsx:385` "Models", pets icon; renders `AvatarDashboard`). Rename its **label to `Furball3D©️`** in both nav locations. Keep the enum value/route stable to avoid breaking deep links (label-only change), or add `Screen.FURBALL3D` alias if a clean URL is wanted.
- **Flag:** confirm the target — repo has "Models" (avatars/`AvatarDashboard`) and "Avatars-R-Us" (`Screen.STORE`). Default: rename **Models → Furball3D©️** (that's the avatars surface). Update Randy AI nav copy and any tab references. Keep the ©️ in the visible label.

---

## 7. Pawprints tab — digital stationery

New `Screen.PAWPRINTS` + `PawprintsScreen.tsx`. Pawprints are **custom digital stationery** generated from smart templates. Consumes **1 pawprint token** (or a credit price — confirm) per creation.

**Categories (template families):** grieving loss; new puppy/dog/rescue; veterinarian-related; holiday/birthday; environment-themed; postcard/travel; sick/recovering/get-well; miss-you/thinking-of-you; pet-business (dog-sitter/walker/stylist/photographer/pet-friendly business).

**Smart-template system:**
- **4 layouts** per category (e.g., portrait card, landscape postcard, photo-top, framed-quote). Each layout defines **pre-designated input fields gated by file type** (e.g., photo slot accepts image/*, no PDFs; text slots accept plain text with length caps).
- **AI text generation:** a small model fills copy from the user's category + options selection (tone, occasion, pet name). Build an **organized reference database** (`pawprint_templates` table / JSON) the AI reads from: `{category, layout_id, tone, sample_copy[], field_schema, image_prompt_template}`. The AI selects/varies copy from this curated set rather than free-forming, keeping output on-brand and safe.
- **AI image generation:** reuse the existing image generator (Gemini/Nano-Banana path in `server.ts`) with the layout's `image_prompt_template` + the user's pet photo/reference.
- **Custom name + message:** optional overrides on any template.
- **Untrusted input:** user text is data, never instructions to the AI (Phase 7 §7.8 #4 containment applies).

**Flow:** pick category → pick 1 of 4 layouts → fill file-type-gated fields (+ optional custom name/message) → AI drafts text + image → preview → save/download (debits 1 pawprint token). Output stored as an asset (counts against storage §1), sharable (§5).
**Endpoints:** `GET /api/pawprints/templates`, `POST /api/pawprints/generate` (debits token, validates file types), `GET /api/pawprints/mine`.
**Acceptance:** each category exposes 4 layouts; fields reject wrong file types; AI copy pulls from the reference DB; custom name/message optional; token debited once per creation; sharable + stored.

---

## 8. Pawlisher tab — model viewer/editor + studio hub

New `Screen.PAWLISHER` + `PawlisherScreen.tsx`. This is the pro model workspace. Reuse the Animator/Theatre/R3F stack (`src/animator/`, `src/three/`) — do **not** rebuild the renderer.

**8a. Large model viewer/editor**
- **Model dropdown** to choose any of the user's rigged models.
- **Overhead light:** an Edison-bulb fixture hanging vertically on a cord, **3 settings** (e.g., warm/neutral/bright or low/mid/high intensity). Real light in the scene + matching visual bulb prop.
- **Zoom:** desktop = magnifier cursor + **percent picker**; mobile = two-finger pinch collapse/expand. Clamp sane min/max.
- **360° turntable** at the model base (toggle + speed).
- **Rigging controls / open-source editing tools:** standard bone/IK controls (reuse `ik.ts`, retarget utils). Expose the standard rig manipulation already in the animator.
- **Preset motion libraries — plug-and-play per rigged body part:** head & facial, torso, shoulders & hips, limbs & digits. User applies a preset to any matching rigged part of any model (retarget on apply).
- **Posture & gait libraries** (idle stances, walk/trot/run cycles) — apply to compatible rigs.
- **Voice cloning + lip-sync + voice libraries:** integrate the Phase 6/7 studio voice pipeline (`server/studio/` Voice Director + ElevenLabs TTS + lip-sync). Voice-clone requires the §3 consent flag. Voice library = preset voices.
- **Voice speed / pitch / tone editor:** sliders mapped to the TTS params (pacing→speed, plus pitch/tone where the provider supports it; ElevenLabs stability/similarity for tone).
- **Micro-mesh overlay option:** toggle a fine detail/displacement overlay on the model.
- **Wardrobe button:** present but **stubbed & disabled** (tooltip "Coming soon").
- **Toolbar icons:** ✂️ scissors = **screenshot tool (user download only)**, 💾 floppy = save, ⬆️ upload arrow = import, 🗑️ delete. (Screenshot never leaves the client except as the user's own download.)

**8b. Hub cards** (below/beside the editor):
- **Wardrobe card:** large icon = a large wardrobe, **closed with a padlock**, overlay **"Coming soon"** (disabled).
- **Animation Creator card:** links into the existing Animator portal.
- **Pawprints card:** a large pawprint depicted on a Polaroid, links to the Pawprints page (§7).

**Endpoints:** reuse animator/studio endpoints; add `GET /api/pawlisher/libraries` (motion/posture/gait/voice presets) and preset-apply handled client-side via retarget.
**Acceptance:** dropdown loads user models; light has 3 states; zoom works on desktop (magnifier+%) and mobile (pinch); turntable spins; body-part presets apply to any rigged model; voice clone gated by consent; voice editor changes audible params; micro-mesh toggles; wardrobe locked; scissors downloads a local screenshot only; save/upload/delete work.

### 8c. Multi-voice voiceover (voice libraries) — currently single-voice, expand it
**Current state (as of Phase 7):** voiceovers effectively use ONE voice. The HeyGen route (`server/animator/routes.ts:439`, `heygen.ts:76`) accepts a `voiceId` but the frontend never sends one, so it always falls back to `HEYGEN_DEFAULT_VOICE_ID`. The studio ElevenLabs adapter (`server/studio/adapters/tts.py`) has `VOICE_ID_MAP = {"Rachel": "..."}` — a single named entry — and otherwise falls back to `ELEVENLABS_DEFAULT_VOICE_ID`.

**Do:**
1. **Backend voice catalog:** add a curated voice library — a small server list `[{ id, name, provider, previewUrl }]` (e.g. 6–10 ElevenLabs voices + a few HeyGen voices). For ElevenLabs, expand `VOICE_ID_MAP` in `tts.py` with those name→voice_id pairs (fetch real IDs via `GET https://api.elevenlabs.io/v1/voices`). Expose `GET /api/voices` returning the catalog (id, name, provider, gender/style tags, preview).
2. **Wire selection through:** HeyGen path — send the chosen `voiceId` from the UI to `/api/animator/scenes/voiceover`. Studio path — set the Voice Director's `voice_model` (or per-speaker mapping) to the chosen voice; the adapter already resolves raw 20+ char IDs directly.
3. **Voice picker UI:** in the Pawlisher voice panel (§8a) and the animator voiceover control, add a dropdown/list of catalog voices with a play-preview button. Default to `ELEVENLABS_DEFAULT_VOICE_ID` / `HEYGEN_DEFAULT_VOICE_ID` when none picked (unchanged behavior).
4. **Voice cloning** (§8a) adds the user's own cloned voices to the same picker, gated by the §3 consent flag.
- **Acceptance:** `GET /api/voices` returns the catalog; the picker changes the actual output voice on both the HeyGen and studio paths; preview plays; default preserved when nothing is selected.

---

## 9. Fur Bin©️ tab — storage & asset manager

New `Screen.FURBIN` + `FurBinScreen.tsx`. Central storage view, **organized by how each asset is used on the site.**

- **Groups:** Furball3D models, Animator/videos, Voice-clone files (for video gens), Pawprints, Uploads/reference photos, Memories/albums. Each item shows size, tier (hot/cold §1), created date, and actions (view, download, move to cold, delete).
- **Voice-clone file storage:** dedicated section for cloned-voice assets used by video gens (with the §3 consent flag surfaced).
- **Storage meter** (from §1) at top with the "Add 1 GB (4 cr)" action.
- **Bulk actions:** multi-select delete / offload to cold.
- **Endpoints:** `GET /api/furbin` (assets grouped by usage + sizes/tiers), reuse storage/delete endpoints.
- **Acceptance:** every user asset appears in exactly one usage group with correct size/tier; delete frees storage (§1); voice-clone files are their own group; meter matches `/api/storage/usage`.

---

## 10. Global shell — Help button

- Add a **Help** button to the top global shell panel (`App.tsx` top bar). On click → send an email to **rob@stelar.host** (via §0 `server/mail.ts`), or open a small "describe your issue" modal that posts to `POST /api/help` which emails rob@stelar.host with the user's id/email + message. If no mailer yet, fall back to `mailto:rob@stelar.host`.
- **Acceptance:** Help reachable from every authed screen; submitting delivers an email to rob@stelar.host with user context.

---

## 11. Screen enum + nav wiring (summary)

Add to `src/types.ts` `Screen`: `PAWPRINTS`, `PAWLISHER`, `FURBIN` (and optionally `FURBALL3D` if not just relabeling `MODELS`). Wire each into: top nav (`App.tsx` ~384), side rail (~472), the two auth `includes([...])` guards (`:450`, `:703`), and a `Suspense`-lazy route block like the existing `ANIMATOR` mount (`App.tsx:665`). Update Randy AI's navigable-screen list.

---

## 12. New data model (summary)

`user_storage`, `pawprint_tokens` balance (+ `pawprint_history`), `share_rewards`, `referrals` (+ `referral_code` on user), `pawprint_templates` (+ generated pawprints as assets), `accepted_terms_version`/`profile_bonus_granted`/`referral_code` columns on the user row, voice-clone consent flag on voice assets. One migration `server/migrations/005_phase8.sql` (or split per feature).

## 13. Credits & tokens ledger (all new economy)

| event | grant/debit | reason string |
|-------|-------------|---------------|
| Profile complete (email+verified phone+ZIP) | +100 cr (once) | `profile_complete_bonus` |
| Referred user completes profile | referrer +30 cr +1 pawprint | `referral_bonus` |
| Share a generation (per network, once) | +12 cr **or** +1 pawprint | `share_reward` |
| Buy 1 GB cold storage | −4 cr | `storage_1gb` |
| Create a Pawprint | −1 pawprint token (or cr — confirm) | `pawprint_spend` |

All via server-authoritative functions; amounts fixed constants; idempotent; ledgered. No AI/user-supplied amounts (Phase 7 §7.8).

## 14. Build & commit plan

Suggested order (each its own commit; `tsc --noEmit` between):
1. `server/mail.ts` transport + Help button (unblocks emails).
2. Storage tiers + `/api/storage/*` + meter.
3. Profile editor + purchases/balance + legal pages + signup/profile 100-cr bonus.
4. Referral + share economy (+ pawprint token primitives).
5. Rename Models→Furball3D©️.
6. Pawprints tab (templates DB + AI text/image).
7. Pawlisher tab (viewer/editor + libraries + hub cards).
8. Fur Bin©️ tab.
Final: full `vite build`, migrations run, prod smoke test.

## 15. Open decisions (confirm before/at build)

1. **Furball3D rename target:** Models (avatars) vs something else — default Models. (§6)
2. **Signup bonus:** single 100 on completion vs split 50/50. Default single. (§4)
3. **Pawprint price:** 1 pawprint token per stationery vs a credit price; and whether pawprints are ever purchasable. (§7)
4. **Share reward scope:** once per network **per user lifetime** vs per generation. Default per-network-per-user lifetime. (§5a)
5. **Email transport choice** (Resend/SES/SMTP) + whether an SMS/OTP provider exists for phone verification. (§0, §4)
6. **Voice-clone legal:** confirm consent-flag wording with counsel. (§3, §8)
7. **Cold-storage offload trigger:** automatic LRU vs user-initiated. Default auto-LRU on hot-full. (§1)
