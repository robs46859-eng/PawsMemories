/**
 * Pure mesh-QA and LOD-planning helpers for Phase 5 (SKILLS.md ANIM-MESH-01/02).
 *
 * Deliberately dependency-free: these functions take counts/summaries that the
 * gltf-transform pipeline (or the worker) extracts, so they are unit-testable
 * without any 3D toolchain present. Wire into the optimize/inspect jobs when
 * Phase 5 lands; nothing imports this module before then.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Topology gate (ANIM-MESH-02): Euler characteristic χ = V − E + F = 2(c−g) − b
// ─────────────────────────────────────────────────────────────────────────────

export interface TopologySummary {
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
}

export interface TopologyExpectation {
  components: number; // c
  genus: number;      // g
  boundaries: number; // b
}

export interface TopologyCheck {
  rule: string;
  pass: boolean;
  detail: string;
  chi: number;
  expectedChi: number;
}

export function eulerCharacteristic({ vertexCount, edgeCount, faceCount }: TopologySummary): number {
  return vertexCount - edgeCount + faceCount;
}

export function expectedEulerCharacteristic({ components, genus, boundaries }: TopologyExpectation): number {
  return 2 * (components - genus) - boundaries;
}

/** For a pure triangle mesh without boundary, E = 3F/2; use to derive edgeCount when the loader reports only V/F. */
export function impliedTriangleEdgeCount(faceCount: number): number {
  return (3 * faceCount) / 2;
}

export function checkTopology(summary: TopologySummary, expectation: TopologyExpectation): TopologyCheck {
  const chi = eulerCharacteristic(summary);
  const expectedChi = expectedEulerCharacteristic(expectation);
  const pass = chi === expectedChi;
  return {
    rule: "euler-characteristic",
    pass,
    chi,
    expectedChi,
    detail: pass
      ? `χ = ${chi} matches expectation (c=${expectation.components}, g=${expectation.genus}, b=${expectation.boundaries})`
      : `χ = ${chi} but expected ${expectedChi} — mesh has unexpected holes, handles, or disconnected junk`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOD chain planning (ANIM-MESH-01): LOD0 src / LOD1 ≈50% / LOD2 ≈15% / LOD3 ≈5%
// ─────────────────────────────────────────────────────────────────────────────

export interface LodLevelPlan {
  level: 0 | 1 | 2 | 3;
  targetRatio: number;
  targetTriangles: number;
  /** Screen-space error threshold (fraction of screen height) at which this LOD may show. */
  screenErrorThreshold: number;
  /** Quadric error budget: max mean E(v)=vᵀQv relative to bbox diagonal², reported by simplifier. */
  maxMeanQuadricError: number;
}

export const LOD_RATIOS: Record<1 | 2 | 3, number> = { 1: 0.5, 2: 0.15, 3: 0.05 };
export const LOD_SCREEN_ERROR: Record<0 | 1 | 2 | 3, number> = { 0: 0, 1: 0.002, 2: 0.008, 3: 0.02 };
export const LOD_QUADRIC_BUDGET: Record<0 | 1 | 2 | 3, number> = { 0: 0, 1: 1e-6, 2: 1e-5, 3: 1e-4 };

/** Below this count, decimation hurts silhouettes more than it saves — plan LOD0 only. */
export const MIN_TRIANGLES_FOR_LODS = 2000;

export function planLodChain(sourceTriangles: number): LodLevelPlan[] {
  if (!Number.isFinite(sourceTriangles) || sourceTriangles <= 0) {
    throw new Error("planLodChain requires a positive triangle count");
  }
  const chain: LodLevelPlan[] = [{
    level: 0, targetRatio: 1, targetTriangles: Math.round(sourceTriangles),
    screenErrorThreshold: LOD_SCREEN_ERROR[0], maxMeanQuadricError: LOD_QUADRIC_BUDGET[0],
  }];
  if (sourceTriangles < MIN_TRIANGLES_FOR_LODS) return chain;
  for (const level of [1, 2, 3] as const) {
    const targetTriangles = Math.max(64, Math.round(sourceTriangles * LOD_RATIOS[level]));
    // Skip levels that no longer reduce the previous one meaningfully (tiny sources).
    if (targetTriangles >= chain[chain.length - 1].targetTriangles) continue;
    chain.push({
      level, targetRatio: LOD_RATIOS[level], targetTriangles,
      screenErrorThreshold: LOD_SCREEN_ERROR[level], maxMeanQuadricError: LOD_QUADRIC_BUDGET[level],
    });
  }
  return chain;
}

/** Validate a simplifier's reported result against its plan (manifest `validation[]` entry). */
export function checkLodResult(plan: LodLevelPlan, resultTriangles: number, meanQuadricError: number): TopologyCheck {
  const triangleOk = resultTriangles <= plan.targetTriangles * 1.1; // 10% grace
  const errorOk = plan.level === 0 || meanQuadricError <= plan.maxMeanQuadricError;
  const pass = triangleOk && errorOk;
  return {
    rule: `lod${plan.level}-budget`,
    pass,
    chi: resultTriangles,
    expectedChi: plan.targetTriangles,
    detail: pass
      ? `LOD${plan.level}: ${resultTriangles} tris, mean quadric error ${meanQuadricError} within budget`
      : `LOD${plan.level}: ${resultTriangles} tris (target ${plan.targetTriangles}), mean quadric error ${meanQuadricError} (budget ${plan.maxMeanQuadricError})`,
  };
}
