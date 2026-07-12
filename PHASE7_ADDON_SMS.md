# Phase 7 Add-on — Replace Twilio with a provider-agnostic SMS driver

**Add-on to `ANIMATOR_FIX_PLAN.md`.** Removes Twilio (and does NOT use Vonage — Vonage blocks the user's virtual number). Introduces a swappable `sendSms()` driver so the SMS provider can change without touching call sites.

## ✅ LOCKED DECISIONS (build to these)
- **Provider: Telnyx** (API v2). `POST https://api.telnyx.com/v2/messages`, `Authorization: Bearer <TELNYX_API_KEY>`.
- **Sender number:** `+12154840960` (local long code) → `SMS_FROM=+12154840960`.
- **Audience: US** → **10DLC Brand + Campaign registration required** (transactional/account-notification use case) before carriers deliver. Operator task, not code.
- Keep the Plivo/SNS branches in the helper for portability, but Telnyx is the configured provider.

## Decision notes (read first)
- **Vonage: removed.** Vonage blocks sending with the user's virtual number.
- **The two repos the user linked are not usable:**
  - `worksome/verify-by-phone` — a **Laravel/PHP** package; this backend is Node/TypeScript. Its only real driver is **Twilio Verify**, so it doesn't solve the virtual-number block.
  - `virtualsms-io/sms-verification-guide` — not a library; a marketing page for a **disposable-number *receiving*** service (burner numbers to receive OTPs for other apps). Wrong direction (it can't send an OTP to your user) and abuse-oriented. **Do not integrate.**
- **Root cause is the number, not the SDK.** US A2P SMS from an unregistered virtual/VoIP number is blocked by every major provider (carrier 10DLC / toll-free rules). The fix is (1) a provider-agnostic sender, and (2) a provider + number that supports hosted/virtual numbers.
- **Recommended providers** (Node-friendly, hosted/virtual-number tolerant): **Telnyx** (primary rec — hosts/ports VoIP numbers well), **Plivo** (alt), or **AWS SNS** (no number to own; still needs US registration for reliable A2P). Pick one; the driver below supports all three.

## What's there today
- `import twilio from "twilio";` (`server.ts:9`), dep `"twilio": "^6.0.2"`.
- **6 identical SMS notification call sites** in `server.ts` (~3299, 3337, 3389, 3475, 3511, 3558) — "your video/model is ready", each guarded by `if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)`, try/catch, non-fatal.
- **No OTP uses SMS** (`auth.ts` removed phone verification). This is notifications only.
- **Latent bug:** the poller site (~3564) uses `from: process.env.TWILIO_VERIFY_SERVICE_SID` — not a valid sender. Centralizing removes it.

## Plan
1. **Add one helper `server/sms.ts`** with a driver switch on `SMS_PROVIDER` (`telnyx` | `plivo` | `sns` | `none`). All drivers use plain HTTPS (Plivo/Telnyx are simple REST; SNS via `@aws-sdk/client-sns`, already present transitively through `@aws-sdk/client-s3`):
   ```ts
   const PROVIDER = process.env.SMS_PROVIDER || "none";
   const FROM = process.env.SMS_FROM || ""; // your sending number (E.164) or alpha sender

   /** Fire-and-forget SMS notification. Never throws — logs and returns. */
   export async function sendSms(to: string, text: string): Promise<void> {
     if (PROVIDER === "none" || !FROM) return; // unconfigured → skip (today's behavior)
     try {
       if (PROVIDER === "telnyx") return await telnyx(to, text);
       if (PROVIDER === "plivo")  return await plivo(to, text);
       if (PROVIDER === "sns")    return await sns(to, text);
     } catch (e) { console.warn("[sms] send failed:", e); }
   }

   // Telnyx: POST https://api.telnyx.com/v2/messages  (Bearer TELNYX_API_KEY)
   async function telnyx(to: string, text: string) {
     await fetch("https://api.telnyx.com/v2/messages", {
       method: "POST",
       headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, "Content-Type": "application/json" },
       body: JSON.stringify({ from: FROM, to: e164(to), text, messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID || undefined }),
     });
   }
   // Plivo: POST https://api.plivo.com/v1/Account/{AUTH_ID}/Message/  (Basic AUTH_ID:AUTH_TOKEN)
   async function plivo(to: string, text: string) {
     const id = process.env.PLIVO_AUTH_ID!, token = process.env.PLIVO_AUTH_TOKEN!;
     await fetch(`https://api.plivo.com/v1/Account/${id}/Message/`, {
       method: "POST",
       headers: { Authorization: "Basic " + Buffer.from(`${id}:${token}`).toString("base64"), "Content-Type": "application/json" },
       body: JSON.stringify({ src: FROM, dst: e164(to), text }),
     });
   }
   // AWS SNS
   async function sns(to: string, text: string) {
     const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
     const c = new SNSClient({ region: process.env.AWS_REGION || "us-east-1" });
     await c.send(new PublishCommand({ PhoneNumber: e164(to), Message: text }));
   }
   function e164(n: string) { const d = n.replace(/[^\d]/g, ""); return "+" + (d.length === 10 ? "1" + d : d); }
   ```
2. **Replace all 6 call sites** with `await sendSms(<to>, <body>);` (keep each message string). Delete the inline `if (TWILIO_...)` guards and `twilio(...)` construction — the helper self-guards and never throws.
3. **Remove** `import twilio from "twilio";` and drop `"twilio"` from `package.json`. If using SNS, add `"@aws-sdk/client-sns"` explicitly (don't rely on the transitive copy). `npm install`.
4. **`.env.example`** — replace the Twilio block with the block below.
5. `npx tsc --noEmit` must pass. Commit: `refactor(sms): remove Twilio/Vonage; add provider-agnostic sendSms (Telnyx/Plivo/SNS); fix invalid sender`.

## Env vars

Pick ONE provider, then set `SMS_PROVIDER` + `SMS_FROM` + that provider's keys.

| Var | Value / where to get it |
|-----|--------------------------|
| `SMS_PROVIDER` | `telnyx` \| `plivo` \| `sns` \| `none` (blank = SMS skipped) |
| `SMS_FROM` | your sending number in E.164 (e.g. `+12015550123`), or an alphanumeric sender ID (non-US only, e.g. `Pawsome3D`) |
| **Telnyx** `TELNYX_API_KEY` | Telnyx Portal → API Keys (`KEY...`) |
| **Telnyx** `TELNYX_MESSAGING_PROFILE_ID` | Telnyx Portal → Messaging → your profile (optional but recommended) |
| **Plivo** `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` | Plivo Console dashboard (Auth ID / Auth Token) |
| **AWS SNS** `AWS_REGION` (+ existing `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) | your AWS account; SNS in an SMS-capable region |

### `.env.example` block (values for this deploy)
```bash
# --- SMS Notifications (Telnyx v2; replaces Twilio/Vonage) ---
# Texts users when a memory/video is ready. Blank SMS_PROVIDER = SMS skipped.
SMS_PROVIDER="telnyx"
SMS_FROM="+12154840960"            # Telnyx local long code (E.164)
TELNYX_API_KEY=""                  # Telnyx Portal → API Keys (KEY...)
TELNYX_MESSAGING_PROFILE_ID=""     # Telnyx Portal → Messaging → your profile; assign +12154840960 to it
# Alternate providers (unused; kept for portability):
# PLIVO_AUTH_ID=""  PLIVO_AUTH_TOKEN=""
# AWS SNS reuses AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```
> `.env.example` ships placeholders (no secrets); the real `TELNYX_API_KEY` + profile ID go in the deployed host env only.

## The number/registration reality (so you're not surprised)
- **US destinations:** whichever provider you pick, sending A2P to US numbers reliably requires either a **10DLC-registered long code** or a **verified toll-free number**. A raw unregistered virtual number will be filtered. Telnyx/Plivo both support 10DLC/TF registration; budget ~1–3 days for approval.
- **Non-US destinations:** an **alphanumeric sender ID** (`SMS_FROM="Pawsome3D"`) often works with no number purchase.
- If your "virtual number" is a VoIP DID you want to keep as the sender, **Telnyx** is the most accommodating for hosting/porting it — the reason it's the primary rec.

## Pre-build questions — RESOLVED
1. Provider → **Telnyx** ✅
2. Audience → **US** → 10DLC Brand + Campaign registration (operator task) ✅
3. Sender → dedicated Telnyx local number **+12154840960** (keep it app-only; don't also use for personal SMS) ✅

No open questions. Code is ready to implement against the locked env above.

## Acceptance
- All 6 notification sites send via `sendSms()`; no `twilio`/`vonage` import or dep remains.
- With `SMS_PROVIDER` unset, sends are silently skipped (unchanged behavior); with a provider + keys set, a real SMS is delivered.
- The invalid Verify-SID-as-sender bug is gone. `tsc --noEmit` clean.
