/**
 * src/brain/aging.ts — AR_PET_SIM_SPEC §4.6
 * Aging & mortality (settings-driven, OFF by default — Wobbledogs-style grief
 * management). Life stages scale energy + clip playback speed. Death, if enabled,
 * is handled by the app (memorial album entry) — data is never deleted. Pure.
 */

export type AgingMode = "off" | "slow" | "realistic";
export type LifeStage = "puppy" | "adult" | "senior";

export interface AgingConfig {
  mode: AgingMode;
  mortalityEnabled: boolean;
  /** Nominal lifespan in (effective) days. */
  lifespanDays: number;
}

export const DEFAULT_AGING: AgingConfig = {
  mode: "off",
  mortalityEnabled: false,
  lifespanDays: 365 * 3,
};

/** How fast in-game aging advances relative to real time, by mode. */
export const AGING_RATE: Record<AgingMode, number> = {
  off: 0,
  slow: 0.5,
  realistic: 1,
};

/** Effective (in-game) age from elapsed real days. `off` never ages. */
export function effectiveAgeDays(realDays: number, mode: AgingMode): number {
  return Math.max(0, realDays) * AGING_RATE[mode];
}

/** Life stage from effective age vs lifespan. */
export function lifeStageForAge(ageDays: number, lifespanDays: number): LifeStage {
  const f = lifespanDays > 0 ? ageDays / lifespanDays : 0;
  if (f < 0.15) return "puppy";
  if (f < 0.75) return "adult";
  return "senior";
}

/** Energy + clip playback-speed multipliers per life stage. */
export function stageModifiers(stage: LifeStage): { energyScale: number; clipSpeed: number } {
  switch (stage) {
    case "puppy":
      return { energyScale: 1.2, clipSpeed: 1.15 };
    case "senior":
      return { energyScale: 0.7, clipSpeed: 0.85 };
    default:
      return { energyScale: 1, clipSpeed: 1 };
  }
}

/** Whether the pet has passed on (only when mortality is enabled). */
export function isDeceased(ageDays: number, cfg: AgingConfig): boolean {
  return cfg.mortalityEnabled && cfg.lifespanDays > 0 && ageDays >= cfg.lifespanDays;
}
