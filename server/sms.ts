/**
 * Provider-agnostic SMS driver (replaces Twilio/Vonage).
 *
 * Supports Telnyx (primary), Plivo, and AWS SNS.
 * Configured via environment variables:
 *   SMS_PROVIDER  = "telnyx" | "plivo" | "sns" | "none"  (default "none")
 *   SMS_FROM      = your sending E.164 number or alphanumeric sender
 *   TELNYX_API_KEY / TELNYX_MESSAGING_PROFILE_ID   — Telnyx
 *   PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN                 — Plivo
 *   AWS_REGION (reuses existing AWS creds)            — SNS
 *
 * Fire-and-forget: never throws — logs warnings on failure.
 */

const PROVIDER = process.env.SMS_PROVIDER || "none";
const FROM = process.env.SMS_FROM || "";

/** E.164 normalizer: prefixes US numbers with +1 if missing country code. */
function e164(n: string): string {
  const d = n.replace(/[^\d]/g, "");
  return "+" + (d.length === 10 ? "1" + d : d);
}

/**
 * Fire-and-forget SMS notification.
 * Never throws — logs and returns on failure.
 */
export async function sendSms(to: string, text: string): Promise<void> {
  if (PROVIDER === "none" || !FROM) return; // unconfigured → skip
  try {
    if (PROVIDER === "telnyx") return await telnyx(to, text);
    if (PROVIDER === "plivo") return await plivo(to, text);
    if (PROVIDER === "sns") return await sns(to, text);
    console.warn(`[sms] Unknown SMS_PROVIDER "${PROVIDER}" — skipping`);
  } catch (e) {
    console.warn("[sms] send failed:", e);
  }
}

/**
 * Telnyx API v2 driver.
 * POST https://api.telnyx.com/v2/messages
 */
async function telnyx(to: string, text: string): Promise<void> {
  const key = process.env.TELNYX_API_KEY;
  if (!key) {
    console.warn("[sms] TELNYX_API_KEY not set — skipping Telnyx send");
    return;
  }
  const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID || undefined;
  const reqBody: Record<string, unknown> = {
    from: FROM,
    to: e164(to),
    text,
  };
  if (profileId) reqBody.messaging_profile_id = profileId;

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`[sms] Telnyx returned ${res.status}: ${body}`);
  }
}

/**
 * Plivo driver.
 * POST https://api.plivo.com/v1/Account/{AUTH_ID}/Message/
 */
async function plivo(to: string, text: string): Promise<void> {
  const id = process.env.PLIVO_AUTH_ID;
  const token = process.env.PLIVO_AUTH_TOKEN;
  if (!id || !token) {
    console.warn("[sms] PLIVO_AUTH_ID or PLIVO_AUTH_TOKEN not set — skipping Plivo send");
    return;
  }

  const res = await fetch(`https://api.plivo.com/v1/Account/${id}/Message/`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${token}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ src: FROM, dst: e164(to), text }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`[sms] Plivo returned ${res.status}: ${body}`);
  }
}

/**
 * AWS SNS driver.
 * Reuses existing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the
 * media-bucket setup. The @aws-sdk/client-sns dependency is required
 * explicitly (don't rely on a transitive copy from client-s3).
 */
async function sns(to: string, text: string): Promise<void> {
  const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
  const c = new SNSClient({ region: process.env.AWS_REGION || "us-east-1" });
  await c.send(new PublishCommand({ PhoneNumber: e164(to), Message: text }));
}
