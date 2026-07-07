/**
 * src/three/ar/voice.ts — AR_PET_SIM_SPEC §7.2
 * Voice command training via the Web Speech API (no new account).
 *
 * The matching core (phonetic key + Levenshtein + comply/confuse/ignore decision)
 * is pure and shared with the server (which computes + stores the keys). The
 * SpeechRecognition runtime is a thin, feature-detected browser wrapper with an
 * iOS push-to-talk fallback — accessed lazily so this module stays import-safe in
 * node (server + tests).
 */

import type { ActionId } from "../../brain";

export const MATCH_THRESHOLD = 2; // T, Levenshtein over phonetic keys
export const RESPONSE_WINDOW_MS = 15_000; // "increased wait time" after a command

// --- Phonetic matching (pure) ----------------------------------------------

/** Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Simplified Metaphone-style phonetic key for one word. (The spec names Double
 * Metaphone; this compact deterministic reduction is enough to match short spoken
 * commands and keeps the code agent-editable. Swappable later without touching callers.)
 */
export function phoneticKey(word: string): string {
  let s = (word || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  s = s
    .replace(/PH/g, "F")
    .replace(/GH/g, "")
    .replace(/CK/g, "K")
    .replace(/SH/g, "X")
    .replace(/TH/g, "0")
    .replace(/CH/g, "X")
    .replace(/[WH]/g, "")
    .replace(/C/g, "K")
    .replace(/Q/g, "K")
    .replace(/Z/g, "S")
    .replace(/V/g, "F")
    .replace(/Y/g, "");
  const first = s[0];
  // Drop vowels after the first letter, then collapse consecutive duplicates.
  const rest = s.slice(1).replace(/[AEIOU]/g, "");
  let key = first + rest;
  key = key.replace(/(.)\1+/g, "$1");
  return key;
}

/** Phonetic key for a phrase: per-word keys joined by space. */
export function phraseKey(phrase: string): string {
  return (phrase || "")
    .trim()
    .split(/\s+/)
    .map(phoneticKey)
    .filter(Boolean)
    .join(" ");
}

export interface StoredCommand {
  id: string | number;
  action: ActionId | string;
  /** Stored phonetic keys (one per recorded sample). */
  keys: string[];
  compliance: number; // 0..1
}

export type CommandDecision = "comply" | "confuse" | "ignore";

export interface MatchResult {
  command: StoredCommand | null;
  distance: number;
  decision: CommandDecision;
}

/**
 * Match a heard transcript against stored commands by min Levenshtein over their
 * phonetic keys (§7.2):
 *   distance <= T        → comply
 *   T < distance <= 2T   → confuse (head tilt)
 *   else                 → ignore
 */
export function matchCommand(
  transcript: string,
  commands: StoredCommand[],
  T = MATCH_THRESHOLD
): MatchResult {
  const heard = phraseKey(transcript);
  let best: StoredCommand | null = null;
  let bestD = Infinity;
  for (const c of commands) {
    for (const k of c.keys) {
      const d = levenshtein(heard, k);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  let decision: CommandDecision = "ignore";
  if (best && bestD <= T) decision = "comply";
  else if (best && bestD <= 2 * T) decision = "confuse";
  return { command: decision === "ignore" ? null : best, distance: bestD, decision };
}

/**
 * Whether the pet performs a matched command: probability = command compliance,
 * reduced by breed stubbornness (§4.5 / §7.2). `rand` in [0,1).
 */
export function shouldPerform(
  compliance: number,
  rand: number,
  stubbornness = 0
): boolean {
  const p = Math.max(0, Math.min(1, compliance * (1 - 0.5 * stubbornness)));
  return rand < p;
}

// --- SpeechRecognition runtime (browser only, lazily accessed) --------------

/** True if the browser exposes SpeechRecognition (webkit-prefixed on Safari). */
export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** iOS Safari needs a user gesture + is flaky in continuous mode → push-to-talk. */
export function prefersPushToTalk(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

/**
 * Create a SpeechRecognition instance (or null if unsupported). The caller wires
 * onresult → matchCommand. Continuous unless push-to-talk is preferred.
 * TODO(AR7 runtime): mic-permission UX + on-screen command-button fallback.
 */
export function createRecognition(): any | null {
  if (!speechRecognitionSupported()) return null;
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.continuous = !prefersPushToTalk();
  return rec;
}
