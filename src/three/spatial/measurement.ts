/**
 * Measurement utilities for physically scaled models.
 *
 * Provides point-to-point distance, axis-aligned dimensions, and
 * bounds calculation with unit display conversion.
 */
import type { ModelSpatialMetadata } from "./types";

// ---------------------------------------------------------------------------
// Supported display units for measurement output
// ---------------------------------------------------------------------------
export const DISPLAY_UNITS = ["m", "cm", "mm", "ft", "in", "ft/in"] as const;
export type DisplayUnit = (typeof DISPLAY_UNITS)[number];

// Conversion factors for display (multiply meter value by factor to get unit)
const DISPLAY_FACTORS: Record<DisplayUnit, number> = {
  m: 1,
  cm: 100,
  mm: 1000,
  ft: 3.28084,
  in: 39.3701,
  "ft/in": 3.28084, // feet portion; inches via fractional remainder
};

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------
export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

export function boundsExtent(b: Bounds3): [number, number, number] {
  return [
    b.max[0] - b.min[0],
    b.max[1] - b.min[1],
    b.max[2] - b.min[2],
  ];
}

export function boundsCenter(b: Bounds3): [number, number, number] {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

// ---------------------------------------------------------------------------
// Point-to-point distance
// ---------------------------------------------------------------------------
export function pointDistance(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------------------
// Axis-aligned dimensions
// ---------------------------------------------------------------------------
export function axisAlignedDimensions(
  bounds: Bounds3
): { width: number; height: number; depth: number } {
  const [w, h, d] = boundsExtent(bounds);
  return { width: w, height: h, depth: d };
}

// ---------------------------------------------------------------------------
// Unit display conversion
// ---------------------------------------------------------------------------
export function formatMeasurement(
  meters: number,
  unit: DisplayUnit = "m",
  decimals: number = 3
): string {
  const value = meters * DISPLAY_FACTORS[unit];

  if (unit === "ft/in") {
    const totalInches = meters * 39.3701;
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet}' ${inches.toFixed(1)}"`;
  }

  return `${value.toFixed(decimals)} ${unit}`;
}

export function formatBounds(
  bounds: Bounds3,
  unit: DisplayUnit = "m",
  decimals: number = 3
): string {
  const { width, height, depth } = axisAlignedDimensions(bounds);
  return `${formatMeasurement(width, unit, decimals)} × ${formatMeasurement(height, unit, decimals)} × ${formatMeasurement(depth, unit, decimals)}`;
}

// ---------------------------------------------------------------------------
// Measurement from metadata
// ---------------------------------------------------------------------------
export function canonicalBoundsFromMetadata(
  meta: ModelSpatialMetadata
): Bounds3 {
  return {
    min: meta.canonicalBoundsMin as [number, number, number],
    max: meta.canonicalBoundsMax as [number, number, number],
  };
}

// ---------------------------------------------------------------------------
// Value source labels
// ---------------------------------------------------------------------------
export type ValueSource = "measured" | "inferred" | "user_entered" | "generated";

export interface MeasuredDimension {
  value: number; // meters
  source: ValueSource;
  unit: DisplayUnit;
  formatted: string;
  tolerance?: number;
}

export function dimensionWithSource(
  meters: number,
  source: ValueSource,
  displayUnit: DisplayUnit = "m",
  decimals: number = 3,
  tolerance?: number
): MeasuredDimension {
  return {
    value: meters,
    source,
    unit: displayUnit,
    formatted: formatMeasurement(meters, displayUnit, decimals),
    tolerance,
  };
}