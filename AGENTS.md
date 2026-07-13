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
