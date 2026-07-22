---
name: scaled-model-engineering
description: Preserve physical scale, coordinates, provenance, design intent, and measurable accuracy across Pawsome3D scan, mesh, GLB, Blender, Three.js, AR, and CAD workflows. Use for unit conversion, calibration, point-cloud reconstruction, mesh repair, dimensions, deviation analysis, scan-to-CAD work, or any claim that a model is scaled or accurate.
---

# Scaled Model Engineering

## Workflow

1. Identify the use case and required tolerance before selecting capture or reconstruction methods.
2. Establish units, axes, handedness, datum, local origin, and calibration evidence.
3. Preserve the immutable source and record every derived transform and tool version.
4. Store canonical dimensions in SI meters; convert only at display and exchange boundaries.
5. Keep physical transforms separate from viewer fitting and camera framing.
6. Reconstruct with explicit settings and repair topology without erasing functional features.
7. Extract design intent: datums, planes, axes, levels, openings, primitives, symmetry, and patterns.
8. Compare the result to source evidence before accepting an accuracy claim.

## Pawsome3D Guardrails

- Treat one Three.js unit as one meter.
- Audit `src/three/AvatarModel.tsx`, `src/three/objects/ObjectModel.tsx`, and AR loaders before trusting scale; they normalize geometry for display.
- Thread spatial metadata through API schemas, storage, animator manifests, Blender calls, and exports.
- Reject missing units for authoritative work unless the user calibrates the model.
- Never infer real scale from a single uncalibrated image.
- Never describe a repaired mesh as parametric CAD unless a B-Rep or feature representation exists.

## Reconstruction

- Require oriented points for Poisson reconstruction.
- Maintain capture overlap and quantify registration residuals.
- Make octree depth and filtering settings explicit and reproducible.
- Preserve boundaries and high-curvature regions during adaptive decimation.
- Check non-manifold edges, flipped normals, self-intersections, holes, duplicates, and degenerate faces.

## Validation Output

Report source units, canonical bounds, calibration, axes, transform chain, topology findings, RMS/median/P95/max deviation, outlier handling, and pass/fail against tolerance.

Read `references/reverse-engineering-protocol.md` for capture, reconstruction, parametric recovery, and dimensional QA.
