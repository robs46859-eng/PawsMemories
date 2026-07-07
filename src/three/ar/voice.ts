/**
 * src/three/ar/voice.ts — AR_PET_SIM_SPEC §7.2
 * Voice command training via Web Speech API (no new account).
 *
 * TODO(AR7):
 *  - Teach mode: gesture-guide the pet into a pose → record phrase (3 samples) →
 *    store doubleMetaphone(transcript) per sample.
 *  - Runtime: continuous SpeechRecognition (user toggle, mic permission); match by
 *    min Levenshtein over stored metaphone keys.
 *      dist <= T           → compliant perform (prob = compliance §4.5, breed-stubbornness modified)
 *      T < dist <= 2T      → confusion action (head tilt)
 *      else                → ignore
 *  - 15s response window after a command (utility re-eval with "commanded" boost).
 *  - Forgetting: unreinforced commands lose compliance over days.
 *  - iOS Safari: webkit-prefixed, needs user gesture; fall back to on-screen buttons.
 */

export const MATCH_THRESHOLD = 2; // T (Levenshtein over metaphone keys)
export const RESPONSE_WINDOW_MS = 15_000;

/** Levenshtein distance — used at runtime to match transcripts to stored keys. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// TODO(AR7): doubleMetaphone(), startRecognition(), matchCommand().
