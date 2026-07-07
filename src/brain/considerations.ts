/**
 * src/brain/considerations.ts
 * Curve library for utility considerations (AR_PET_SIM_SPEC §4.1).
 * Every curve maps an arbitrary input to [0,1]. Compose with clamp01.
 */

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Normalize a 0..100 drive to 0..1. */
export function norm100(x: number): number {
  return clamp01(x / 100);
}

/** Linear ramp from `a`→`b`. Values outside [a,b] clamp to 0/1. */
export function linear(a: number, b: number): (x: number) => number {
  return (x: number) => {
    if (a === b) return x >= b ? 1 : 0;
    return clamp01((x - a) / (b - a));
  };
}

/** Quadratic ease (x^2 over a linear ramp) — slow start, sharp finish. */
export function quadratic(a: number, b: number): (x: number) => number {
  const lin = linear(a, b);
  return (x: number) => {
    const t = lin(x);
    return t * t;
  };
}

/** Inverse: high input → low output. Useful for "how satisfied" curves. */
export function inverse(a: number, b: number): (x: number) => number {
  const lin = linear(a, b);
  return (x: number) => 1 - lin(x);
}

/**
 * Logistic (sigmoid) centered at `mid` with steepness `k`.
 * Returns ~0 well below mid, ~1 well above. Good for threshold-y drives.
 */
export function logistic(mid: number, k = 0.15): (x: number) => number {
  return (x: number) => clamp01(1 / (1 + Math.exp(-k * (x - mid))));
}

/** Exponential decay bonus e^(-t/tau) for a stimulus of age `ageSeconds` (§4.1). */
export function decayBonus(ageSeconds: number, tauSeconds = 20): number {
  if (ageSeconds <= 0) return 1;
  return clamp01(Math.exp(-ageSeconds / tauSeconds));
}
