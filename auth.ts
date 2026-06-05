import twilio from "twilio";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

/**
 * Phone verification (Twilio Verify) + session tokens (JWT).
 * Required env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID, JWT_SECRET
 */

const JWT_SECRET = process.env.JWT_SECRET || "";

export function authConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID &&
    process.env.JWT_SECRET
  );
}

function client() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
}

function serviceSid(): string {
  return process.env.TWILIO_VERIFY_SERVICE_SID!;
}

/**
 * Normalize a phone number to a Twilio-friendly E.164-ish string.
 * The user is expected to include their country code (e.g. +1 ...).
 * Returns null if the input clearly isn't a usable number.
 */
export function normalizePhone(input: string): string | null {
  if (!input) return null;
  let digits = input.replace(/[^0-9]/g, "");
  // Convenience for US users: a bare 10-digit number (no country code) is
  // assumed to be US and gets a "1" prefix, so "5551234567" -> "+15551234567".
  // Numbers entered with a country code (e.g. "+44...", "+1 555...") are untouched.
  if (digits.length === 10) {
    digits = "1" + digits;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

export async function sendVerificationCode(phone: string): Promise<void> {
  await client().verify.v2.services(serviceSid()).verifications.create({
    to: phone,
    channel: "sms",
  });
}

export async function checkVerificationCode(phone: string, code: string): Promise<boolean> {
  const result = await client().verify.v2.services(serviceSid()).verificationChecks.create({
    to: phone,
    code,
  });
  return result.status === "approved";
}

export interface TokenPayload {
  phone: string;
  uid: number;
}

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: THIRTY_DAYS_SECONDS });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

/** Express request augmented with the authenticated user payload. */
export interface AuthedRequest extends Request {
  user?: TokenPayload;
}

/** Middleware: rejects requests without a valid Bearer session token. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Unauthorized. Please sign in to continue." });
  }
  req.user = payload;
  next();
}
