import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Email + password authentication with JWT session tokens.
 *
 * Phone/SMS verification (Twilio) has been removed. Accounts are now gated by
 * email + password only. Every user row still carries an opaque internal key in
 * the `users.phone` column (kept because the albums/creations/jobs/pets tables
 * foreign-key to it) — but it is NO LONGER a real phone number. For email
 * sign-ups we generate a synthetic key with generateUserKey().
 *
 * Required env vars:
 *   JWT_SECRET
 */

const JWT_SECRET = process.env.JWT_SECRET || "";

/** Lower-case + trim an email for consistent storage and lookups. */
export function normalizeEmail(input: string): string | null {
  if (!input) return null;
  const email = String(input).trim().toLowerCase();
  // Simple, permissive RFC-ish check: something@something.tld
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

/**
 * Generate a unique opaque user key that fits the users.phone VARCHAR(32) column.
 * Example: "u_3f9a1c2b8d4e5f60a1b2c3d4" (26 chars).
 */
export function generateUserKey(): string {
  return "u_" + crypto.randomBytes(12).toString("hex");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return key === derivedKey;
}

/**
 * Password-reset tokens. The RAW token is emailed to the user; only its SHA-256
 * HASH is stored in the DB, so a DB leak can't be used to reset accounts.
 */
export function generateResetToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashResetToken(raw);
  return { raw, hash };
}

export function hashResetToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export interface TokenPayload {
  /** Opaque internal user key (stored in users.phone). NOT a phone number. */
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
