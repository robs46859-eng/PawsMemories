# MESHOPS — Animator Build-Out Skill

> **Cross-ref:** Master skill index `SKILLS.md` (§4), AGENTS.md `Animator Agent Personas` section.

## Purpose
QEM/LOD policy, topology gates, Poisson parameters, and deviation-analysis procedure.

## Scope
Maps to ANIM-MESH-01..04 in SKILLS.md. Phase 5 implements the full pipeline; this skill documents the standards.

---

## 1. QEM Simplification & LOD Chain (ANIM-MESH-01)

### Math
Vertex error: **E(v) = vᵀQv**, where Q = Σ fundamental quadrics of incident planes.
Edge collapse ordered by minimal error; optimal vertex from ∇E = 0.

### LOD Targets
| LOD | Target |
|-----|--------|
| LOD0 | Source (100%) |
| LOD1 | ~50% |
| LOD2 | ~15% |
| LOD3 | ~5% |

### Manifest Schema
```jsonc
{
  "version": 1,
  "lods": [
    { "level": 0, "triangles": 100000, "maxQuadricError": 0.0, "sizeBytes": 1048576, "url": "…" },
    { "level": 1, "triangles": 50000,  "maxQuadricError": 0.012, "sizeBytes": 524288, "url": "…" }
  ]
}
```

**Zod schema:** `server/animator/schemas.ts` — `LodManifestV1` + `LodEntrySchema`.

**Implementation:** `meshoptimizer` (`simplify`) via gltf-transform.

---

## 2. Topology Validation (ANIM-MESH-02)

### Pre-rig Gate Checks

| Check | Formula | Description |
|-------|---------|-------------|
| Euler characteristic | χ = V − E + F = 2(c − g) − b | Verify expected genus/components |
| Generalized winding number | w(p) = (1/4π) Σ Ω_t(p) | Detect flipped normals + enclosed junk |
| Non-manifold edges | — | Detect and flag |
| Flipped normals | — | Detect and auto-repair |

### Repair Pass
- Light fixes: gltf-transform custom transform
- Heavy repairs: Blender mesh-cleanup ops in worker
- Unfixable → job fails with rule detail (never silent pass)

---

## 3. Poisson Reconstruction (ANIM-MESH-03)

### Math
Solve **Δχ = ∇·V** (indicator function Laplacian = divergence of oriented normals).
Adaptive octree discretization, **depth ≤ 10 default**.
Marching-Cubes isosurface extraction → watertight mesh.

### Pre-smooth
Moving Least Squares (MLS) for noisy clouds pre-Poisson.

### Executor
Open3D in worker job (`reconstruct`).

### QA
Deviation color-map (reconstructed surface vs source points). Tolerance gate before rigging.

---

## 4. Compression & Packing (ANIM-MESH-04)

### Standard Pass
1. Draco or meshopt (`EXT_meshopt_compression`) per target
2. KTX2/Basis texture transcode
3. `prune()`, `dedup()`, `palette()` passes
4. LSCM UV unwrap in worker when source UVs missing/degenerate
5. Optional Catmull-Clark subdivision for hero close-ups (runtime stays on base cage)

---

## 5. Constraints

- LOD error budgets enforced; report sizes
- No silent quality loss
- Octree depth ≤ 10
- Euler characteristic check mandatory pre-rig
- Never skip topology gate for production assets
