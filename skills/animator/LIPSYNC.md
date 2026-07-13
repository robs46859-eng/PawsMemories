# LIPSYNC — Animator Build-Out Skill

## Purpose
Viseme standard, transition rules, Rhubarb invocation, and VisemeTrack schema.

## Scope
Maps to ANIM-LIP-01..05 in SKILLS.md. Phase 2 implements the full pipeline; this skill documents the standards.

---

## 1. Viseme Standard (Preston Blair / Hanna-Barbera)

| Shape | Mouth | Phonemes | Notes |
|-------|-------|----------|-------|
| A | Closed, firm lip pressure | P, B, M | Distinct from X |
| B | Slightly open, teeth clenched | K, S, T, EE | |
| C | Open neutral | EH, AE | Bridge shape |
| D | Wide open | AA | |
| E | Slightly rounded | AO, ER | Bridge to F |
| F | Puckered pinch | UW, OW, W | |
| G | Upper teeth on lower lip | F, V | Extended |
| H | Open w/ raised tongue | long L | Extended; only if tongue visible |
| X | Relaxed closed (idle) | silence | **No lip pressure** |

---

## 2. Transition Rules (enforced by track post-processor)

1. **A–C–D bridge:** Never jump A→D directly; insert C in-between.
2. **C–E–F rule:** Pucker via E; E must not be wider than C.
3. **Anticipation:** Shift each viseme onset ~2 frames (≈66–83 ms) earlier than the audio event.
4. Cues shorter than 1 frame at target fps are merged into neighbors.
5. A = closed **with lip pressure**; X = relaxed idle, **no pressure**. Never conflate.

**Linter:** Track post-processor validates all rules. Any violation = hard fail.

---

## 3. VisemeTrack v1 Schema

```jsonc
{
  "version": 1,
  "fps": 30,
  "source": "rhubarb",
  "audioUrl": "…",
  "durationSec": 4.2,
  "cues": [{ "t": 0.00, "v": "X" }, { "t": 0.35, "v": "D" }, { "t": 0.47, "v": "C" }],
  "anticipationSec": 0.07
}
```

**Zod schema:** `server/animator/schemas.ts` — `VisemeTrackV1` + `VisemeCueSchema`.

---

## 4. Tier B — Rhubarb CLI (ANIM-LIP-01)

| Parameter | Value |
|-----------|-------|
| Recognizer | `pocketSphinx` (English), `phonetic` (non-English) |
| Dialog file | **Always** supply `-d dialogFile` when transcript exists |
| Extended shapes | `--extendedShapes GHX` (always on) |

**Invocation:** `rhubarb-lipsync -a audio.wav -d dialog.txt -o output.json --extendedShapes GHX`

**Where:** `server/animator/lipsync.ts`; binary vendored in deploy + worker image.

---

## 5. Tier A — Existing (kept)

`src/three/randyVisemes.ts` — amplitude sine-wave jaw. Zero-dependency fallback for SpeechSynthesis voices.

---

## 6. Tier C — Realtime MFCC (ANIM-LIP-04)

- Client-side `AudioWorklet`
- Mono 16-bit in → power mel-spectrogram → 20 MFCCs
- 50 ms FFT window, 10 ms hop
- Stats: mean/std/min/max per viseme window
- Nearest-profile classification against calibrated per-voice profiles

---

## 7. Constraints

- Extended shapes GHX always on
- Anticipation: 2 frames (~66–83 ms)
- Dialog file mandatory when transcript exists
- No `undefined` reads — all tracks validated with zod before consumption
