# Auth Hardening Spec — mandatory phone verification + password reset

Grounded in current code: auth is **email + password only** (`auth.ts` — SMS verify was removed; `users.phone` is an opaque internal key, NOT a real number). Signup = `POST /api/auth/signup` (`server.ts:338`) → `createUserByEmail(email, hash, TERMS_VERSION)`. Telnyx Verify endpoints **already exist** (`/api/verify/phone/start`, `/api/verify/phone/check`, `server.ts:685/712`) but are optional/post-login. `phone_verified` column exists (`db.ts:182`). Email sender exists: `sendMail({to,subject,html,replyTo})` (`server/mail.ts`). **No password reset exists.**

## Ground rules
- `tsc --noEmit` must pass; stage new modules with their importers.
- Reuse existing infra: **Telnyx Verify** (`TELNYX_API_KEY` + `TELNYX_VERIFY_PROFILE_ID`) for OTP, **Resend** (`server/mail.ts`) for reset email. No new providers.
- `users.phone` stays the opaque FK key — store the **real** number separately.

---

## Part 1 — Mandatory phone verification for every new user

### Data (add to `db.ts` initDb migration list — auto-applies on boot)
- `real_phone VARCHAR(32) NULL` — the actual E.164 number (distinct from the opaque `phone` key).
- `phone_verified` already exists (TINYINT default 0).
- Add a **UNIQUE index on `real_phone`** (one account per phone) — enforce after verification; handle collisions gracefully ("this number is already registered").

### Flow (gate access until verified)
1. Signup (`/api/auth/signup`) unchanged for email/password, but the account starts `phone_verified = 0`. Issue the session token as today.
2. **Frontend gate:** after signup/login, if `phoneVerified` is false, route the user to a **mandatory "Verify your phone" screen** — they cannot reach the app shell/tabs until verified. (Add a `phoneVerified` check to the authed-screen guard in `App.tsx`, similar to the existing `isAuthed` gate.)
3. Verify screen calls the existing `POST /api/verify/phone/start` (sends OTP via Telnyx Verify) then `POST /api/verify/phone/check` (validates code). On success: set `phone_verified = 1`, store `real_phone`, enforce the unique-phone rule.
4. Keep the existing profile-completion 100-cr bonus tied to `phone_verified` + email + ZIP.

### Guards & abuse
- **Server-side enforcement, not just UI:** protect sensitive routes (generation, credits spend, pawprints, etc.) with a `requirePhoneVerified` middleware so an unverified token can't call them directly. Public/auth/verify routes stay open.
- Rate-limit `/verify/phone/start` (reuse `authLimiter` pattern) — each OTP costs money; cap attempts per account/IP and per number.
- Reject a `real_phone` already verified on another account (unique index) with a clear message.
- Admin bypass (`isUserAdmin`) as elsewhere.

### Acceptance
- A brand-new user cannot use any app feature until phone-verified; the verify screen is unskippable.
- OTP sends via Telnyx Verify; correct code verifies; wrong/expired code rejected.
- One phone → one account. `requirePhoneVerified` blocks direct API calls from unverified sessions (tested). Needs `TELNYX_VERIFY_PROFILE_ID` set.

---

## Part 2 — Password reset (forgot password)

### Data
New table (add to initDb, or migration `008_password_reset.sql` **and** mirror into `initDb` since `.sql` files aren't auto-run here):
```sql
CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_phone VARCHAR(32) NOT NULL,           -- opaque user key
  token_hash VARCHAR(255) NOT NULL,          -- store a HASH of the token, never the raw token
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_phone), INDEX (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Endpoints
1. `POST /api/auth/forgot-password` — body `{ email }`. Look up user by email. **Always return 200** with a generic message ("If that email exists, we've sent a reset link") — never reveal whether the email is registered. If found: generate a cryptographically random token (`crypto.randomBytes(32).hex`), store **only its hash** + a short expiry (e.g. 30–60 min), and email the raw token as a link via Resend: `https://pawsome3d.com/reset-password?token=<raw>`. Rate-limit hard.
2. `POST /api/auth/reset-password` — body `{ token, newPassword }`. Hash the token, look up an unused, unexpired row, verify, then set the new `password_hash` (reuse `hashPassword` from `auth.ts`), mark the row `used_at`, and invalidate other outstanding resets for that user. Enforce password strength. Optionally rotate the session/JWT.

### Frontend
- "Forgot password?" link on the login screen → email entry form → success message.
- `/reset-password` route (public) reads `?token=`, shows new-password + confirm fields → calls reset endpoint → on success, redirect to login with a success toast.

### Security
- Token: single-use, short-lived, **hashed at rest**; never logged; constant-time compare.
- No user enumeration (generic responses).
- Rate-limit both endpoints (`authLimiter`).
- Reset email uses `server/mail.ts` (Resend) — subject "Reset your Pawsome3D password", `replyTo` support address.

### Acceptance
- Forgot-password sends a reset email (Resend) with a working one-time link; the same link can't be reused; expired links rejected; wrong/unknown email returns the same generic 200 (no enumeration); new password logs in.

---

## Part 0 — Existing users = grandfathered TESTERS (decided)

All current users are beta testers and must NOT be locked out by the new gates. Implemented: `is_tester` column on `users` (wired in `db.ts` + `toPublicUser` → `isTester`, auto-migrates on boot).

- **Bypass the mandatory phone-verify gate** (Part 1) and the **terms re-accept prompt** when `is_tester = 1`. New (non-tester) signups still get the full gate.
- Testers keep a **complimentary credit balance** (see backfill).
- **Open decision:** should testers also **bypass credit charges entirely** (free usage, like the `isUserAdmin` bypass in generation/paid routes), or just hold the complimentary balance? Default = complimentary balance only. If free usage is wanted, extend the existing admin-bypass checks (`isUserAdmin(...)`) to `is_admin || is_tester`.

### One-time backfill (run in phpMyAdmin now — safe before or after deploy)
```sql
-- Ensure the column exists (harmless if the deploy already added it)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_tester TINYINT(1) NOT NULL DEFAULT 0;

-- Mark every current user a tester
UPDATE users SET is_tester = 1;

-- Complimentary tester credits: floor everyone at 1000 (never reduces anyone).
-- Change 1000 to your preferred amount, or use `credits = credits + 1000` to top up instead.
UPDATE users SET credits = GREATEST(credits, 1000);

-- Grandfather terms so testers aren't re-prompted (sets acceptance to current version)
UPDATE users SET accepted_terms_version = '2026-07-12', accepted_terms_at = NOW()
WHERE accepted_terms_version IS NULL;
```
> The cutoff is implicit: only rows that exist at backfill time are testers. Every signup after is a normal gated user.

## Build order (each its own commit; tsc between)
1. `real_phone` column + unique index + `requirePhoneVerified` middleware.
2. Frontend mandatory phone-verify gate (reusing existing verify endpoints).
3. `password_resets` table + forgot/reset endpoints (Resend email).
4. Frontend forgot-password + reset-password screens.

Env needed (already or newly on host): `TELNYX_API_KEY`, `TELNYX_VERIFY_PROFILE_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` (for the reset link base).
