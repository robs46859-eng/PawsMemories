# Pawsome3D — Logged-in Smoke Checklist (Phase 8/9)

Run these in-app while logged in on **pawsome3d.com**. Each item lists the steps, what "pass" looks like, and what a failure points to (which migration or env var to fix). Public routes already verified green (legal pages 200, `/api/pawprints/templates` 200, `/api/avatars` 401 = auth working, studio-proxy bug fixed).

## 0. Session
- [ ] Log in. Dashboard loads, avatars/credits populate (no 502s). → confirms the `/api` surface is healthy post proxy-fix.

## 1. Signup: terms acceptance + phone verify + 100-cr bonus
*(Use a fresh test account.)*
- [ ] On signup, the **"I agree to Terms & Privacy" checkbox** is required — try to submit without it → blocked.
- [ ] Enter phone → receive an **SMS OTP**, enter it → verified.
  - Fail (no code) → `TELNYX_VERIFY_PROFILE_ID` not set on host, or Telnyx Verify profile missing.
- [ ] Complete profile (email + verified phone + ZIP) → **+100 credits** land once.
  - Fail → check `accepted_terms_version`/bonus logic; DB `users` columns auto-migrate on boot so this should be fine.

## 2. Pawprints generate  — needs migration 007
- [ ] Pawprints tab → pick a category → pick a layout → fill fields → Generate.
- [ ] Pass: a stationery image renders, **1 pawprint token** is debited, it appears in your list.
  - Fail with a DB/"table doesn't exist" error → **run `007_phase9_pawprint_assets.sql`** (pawprint_assets table missing).
  - Try a wrong file type in a photo field → rejected (validation working).

## 3. Voice-clone consent gate — needs migration 006
- [ ] Pawlisher → voice → attempt a voice clone.
- [ ] Pass: a **consent modal** appears; without checking it, cloning is blocked (422). With consent, it proceeds and the asset shows a consent flag in Fur Bin.
  - Fail with a DB error → **run `006_phase9_voice_clone_assets.sql`** (voice_clone_assets table missing).

## 4. Email (Resend) — needs RESEND_API_KEY + MAIL_FROM
- [ ] Click the **Help** button (global shell) → send a test message → an email arrives at **rob@stelar.host**.
  - Fail → `RESEND_API_KEY`/`MAIL_FROM` unset, or `pawsome3d.com` sender not verified (it is ✅).
- [ ] (If wired) referral or data-request emails also deliver.

## 5. SMS notification (Telnyx) — needs SMS_* + 10DLC approved
- [ ] Trigger a generation that finishes (model/video ready) → receive the "ready" SMS on a real phone.
  - No text → confirm `SMS_PROVIDER=telnyx`, `SMS_FROM=+12154840960`, `TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID` set, and the **10DLC campaign is approved** (carriers filter until then).

## 6. Storage tiers
- [ ] Profile / Fur Bin shows a **storage meter** (hot MB used vs 50 MB).
- [ ] "Add 1 GB (4 cr)" debits exactly 4 credits and raises the cold cap.
- [ ] Delete an asset → usage drops.

## 7. Referral + share
- [ ] Profile shows your **referral code/link**. A new signup via it grants you **30 cr + 1 pawprint** after they complete profile (test with the fresh account from step 1).
- [ ] Share a generation to a network → **12 cr or 1 pawprint** once per network.

## 8. Randy guided walkthrough (Phase 9)
- [ ] Open Randy → ask "show me how to make an avatar" (or hit a "Show me how" button).
- [ ] Pass: a **spotlight walkthrough** runs — one step at a time, large text, Next/Back, optional voice narration; it actually highlights real controls and advances on your action.
  - Fail (Randy only talks/navigates, no spotlight) → `start_tour`/`highlight` not wired or tours registry missing.

## 9. Pawlisher editor
- [ ] Pawlisher → pick a model → it loads. Edison-bulb light cycles 3 settings; zoom (magnifier+% desktop / pinch mobile); 360° turntable spins; a body-part/posture preset applies; voice picker changes voice; micro-mesh toggles; Wardrobe shows locked; ✂️ downloads a local screenshot; 💾/⬆️/🗑️ work.
- [ ] Editor never white-screens (error boundary catches bad models).

## 10. Refund + uncanny-valley (Phase 9 §6)
- [ ] From an unhappy restyle → open the refund review → the AI "reviewing" scan + score shows; low score auto-approves (≤3/30min) or high score shows the a–e question.
- [ ] Model card: press-and-hold **😛 → 🐶** (4s) triggers lighter styling.
- [ ] Makeup/face-mask presets visibly soften an avatar in-viewer (uncanny reducer).

## 11. Redress + optional rigging (ADR-001 / PAWSOME3D_REDRESS_PLAN §5)
- [ ] Sidebar has NO "Animate" entry; Store "Go to Avatars" and AR launch land on **Create**, never a lock screen.
- [ ] Store price list shows the BIM rows as "Moved to fsai.pro" (no credits shown).
- [ ] Create → Personalize: "Rig this model for animation" (+35) checkbox; "Include facial rig" (+20) is disabled until rigging is checked; total updates live (45 → 80 → 100).
- [ ] Checkout shows the same total; approve deducts it; insufficient-credits message reflects the rigged total.
- [ ] Rigged order: job status walks queued → generating → **rigging → validating** → done; library entry gains the rigged model (`rigged_model_url` set, rig_report populated).
- [ ] Force a rig failure (or use a broken fixture): status ends **done_static_fallback**, static model still present, and EXACTLY the add-on PupCoins (35 or 55) are refunded — never the base 45.
- [ ] Facial rig purchased → exported GLB contains `viseme_A..viseme_X` shape keys; NOT purchased → no viseme keys on create-flow models.
- [ ] Print a RIGGED model end-to-end (Slant3D quote): STL derives cleanly (armature stripped by `prepare_print_stl`), quote + Stripe checkout work.
- [ ] Worker `/physics-validate` responds (via `/api/health` worker check or direct with secret): report includes `gravity_ms2: 9.8` and the named checks (neck_weight_isolation, hinge_axes, twist_volume, foot_contact...).

---

### If anything DB-backed fails, first check the two tables exist (phpMyAdmin → your DB):
- `pawprint_assets` (migration 007)
- `voice_clone_assets` (migration 006)
The terms/pawprint-token columns on `users` auto-migrate on boot, so those don't need manual SQL.

### Host env vars that gate features (set on Hostinger):
`RESEND_API_KEY`, `MAIL_FROM=noreply@pawsome3d.com`, `TELNYX_VERIFY_PROFILE_ID`, plus the existing `SMS_PROVIDER` / `SMS_FROM` / `TELNYX_API_KEY` / `TELNYX_MESSAGING_PROFILE_ID`.
