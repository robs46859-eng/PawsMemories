# Pawsome3D Agent Guidance

## Mission

Build safe, durable 3D creation workflows. Preserve user-owned media, physical scale, coordinate systems, provenance, and semantic metadata across browser, API, storage, and Blender-worker boundaries.

## Skill Routing

- Use `.agents/skills/scaled-model-engineering` for dimensions, scan-to-CAD, point clouds, reconstruction, tolerances, and design intent.
- Use `.agents/skills/bim-ifc-integration` for IFC, BIM entities and properties, building hierarchy, classifications, quantities, and validation.
- Use `.agents/skills/geospatial-model-context` for CRS, survey control, terrain, imagery, georeferencing, and cloud geospatial data.
- Use all three when a building must be BIM-aware and placed at a real-world location.

## Non-Negotiable Rules

1. Treat one Three.js world unit as one meter. Never infer an authoritative dimension from a display-normalized object.
2. Store source units, conversion-to-meters, original dimensions, axes, datum, and provenance before transforming geometry.
3. Keep source assets immutable. Produce GLB, IFC, previews, LODs, and reports as versioned derivatives.
4. Keep BIM semantics separate from render geometry and join them with stable IDs.
5. Validate units, finite transforms, bounds, topology, and semantic references at every import/export boundary.
6. Do not call a mesh CAD or BIM merely because it is watertight. State whether it is tessellated, B-Rep, parametric, or IFC-semantic.
7. Require explicit calibration or trusted metadata before claiming a generated or photogrammetric model is dimensionally accurate.
8. Prefer GLB for delivery, IFC4/IFC4.3 for BIM exchange, STEP for B-Rep, LAS/LAZ/E57 for point clouds, GeoTIFF/COG for rasters, and 3D Tiles for large spatial delivery.

## Verification

Run `npm run lint`, `npm run test`, `npm run test:ar`, and `npm run build` before deployment. For BIM changes, also validate IFC and verify an IFC-to-GLB round trip retains units, stable IDs, hierarchy, and representative properties.

## Animator Agent Personas

The following personas govern the Animator build-out phases. See `skills/animator/` for full skill definitions and `ANIMATOR_SPEC.md` for the authoritative design.

| Persona | Mapped skills | Operational constraints |
|---------|---------------|------------------------|
| **Rig Technician** | ANIM-RIG-01..08, ANIM-MESH-01/02 (`skills/animator/RIGGING.md`) | Must pass ANIM-RIG-04 before completing; octree depth ≤ 10; never rename canonical bones |
| **Lip-Sync Director** | ANIM-LIP-01..05, ANIM-AUD-01 (`skills/animator/LIPSYNC.md`) | Extended shapes GHX always on; anticipation 2 frames; dialog file mandatory when transcript exists |
| **Asset Optimizer** | ANIM-MESH-01..04 (`skills/animator/MESHOPS.md`) | LOD error budgets enforced; report sizes; no silent quality loss |
| **Runtime Engineer** | ANIM-RUN-01..06, ANIM-CAP-01 | node:test coverage for all scheduling/blending logic; tsc clean; lazy-chunk new deps |

**Prompt recipe:** "Acting as {Persona}, implement {Skill_ID(s)} per SKILLS.md and ANIMATOR_SPEC.md §{n}, within Phase {k} scope of PHASED_IMPLEMENTATION.md. Honor ANIM-CORE-00."

### ANIM-CORE-00 (Global Ground Rules — applies to every Animator skill)

- `npx tsc --noEmit` must pass before any commit (pre-commit hook enforces it).
- **Never break boot:** optional server/worker deps degrade to 200-with-empty-shape reads, never 503 on read paths. No `undefined` property reads — guard and type every payload with zod.
- **Bundle discipline:** every new client library is lazy-chunked; verify with `npx vite build` that no unexpected chunks ship.
- **Validation doctrine:** treat outputs as hypotheses. Every job writes a manifest with `validation: [{rule, pass, detail}]`. On failure, adjust parameters and re-run.
- Naming: AnimationSet v2 (`src/animator/controller/animationSets.ts`) is the single source of truth for clip names; `blender-worker` clip exports must match it exactly; `src/three/clipMap.ts` fuzzy matching is a safety net only.
- Tests: runtime logic uses `node:test` (NOT Vitest).
- Paths: client `src/animator/`, `src/three/`; server `server/animator/`; worker `blender-worker/`.
