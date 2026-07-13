# Phased BIM and Scaled Model Implementation

## Architecture Decision

Keep GLB and Three.js as Pawsome3D's delivery/viewing path. First add an authoritative unit-and-coordinate contract, then run IFC conversion and validation in an isolated Python worker using IfcOpenShell. Keep BIM semantics separate from render geometry and join them with IFC GlobalIds or durable UUIDs.

## Libraries

### Add in Phase 2

- `ifcopenshell` in a dedicated Python worker for IFC read/write, geometry, validation, and IFC-to-GLB conversion. Pin the tested version.
- `numpy` in that worker for matrices, bounds, unit conversion, and deviation calculations.

### Add only when needed

- `web-ifc` for direct browser IFC parsing/properties. Run it in a Web Worker; do not make it the authoritative exporter initially.
- That Open Engine/Components if a complete browser BIM viewer toolkit is worth the larger architectural commitment.
- OpenCascade.js for proven browser B-Rep/STEP editing needs; prefer server-side processing first due WASM size and memory.
- `proj4` for browser CRS display and PROJ/GDAL in a geospatial worker for authoritative transforms.
- LAS/LAZ loaders or a point-cloud renderer when point-cloud ingestion becomes a product requirement.
- CesiumJS/3D Tiles when campus/city extent or asset volume requires streamed spatial delivery.

No IFC package is required in the current Hostinger app for Phase 1.

## Phase 0: Baseline

1. Select the first building workflow and accuracy class.
2. Create fixtures: 1 m GLB, millimeter-authored model, small IFC, rotated/georeferenced IFC, and noisy point cloud.
3. Measure current browser, AR, Blender round-trip, and export behavior.
4. Record hidden normalization, including avatar target-height and object longest-edge fitting.
5. Define canonical axes, meters, local origin, and geospatial-origin policy.

Exit: every fixture has known dimensions and a baseline report.

## Phase 1: Scale Foundation

1. Add a shared TypeScript/Zod `ModelSpatialMetadata` schema.
2. Store units, meters-per-unit, axes, bounds, calibration, datum, accuracy, source hash, and lineage.
3. Thread metadata through imports, database/storage, animator manifests, Blender calls, and exports.
4. Split physical scale from display scale; bypass fitting when authoritative dimensions exist.
5. Add calibration and measurement UI with SI storage and user-selected display units.
6. Test unit conversions, nested transforms, Blender round trips, AR placement, and invalid values.

Exit: a 1 m fixture remains 1 m through upload -> browser -> Blender -> GLB export within tolerance.

## Phase 2: IFC Read and Semantic Sidecar

1. Add a sandboxed Python worker with pinned IfcOpenShell.
2. Store immutable IFC and generate GLB plus a GlobalId-keyed semantic index.
3. Preserve units, hierarchy, placements, properties, quantities, materials, classifications, and georeferencing.
4. Add element selection, hierarchy/property browsing, filtering, and category colors.
5. Return schema, relationship, geometry, proxy, and conversion warnings in a validation report.

Exit: fixtures retain units, hierarchy, GlobalIds, and representative properties.

## Phase 3: Scaled BIM Authoring

1. Add levels, grids, walls, slabs, openings, doors, windows, spaces, roofs, columns, and beams in that order.
2. Store semantic parameters and generate render geometry; do not make arbitrary triangles the source of truth.
3. Add snapping, constraints, dimensions, undo/redo, and relationship validation.
4. Generate IFC entities/placements with stable GlobalIds.
5. Export IFC4 and linked GLB with validation.

Exit: a two-room model opens in an independent IFC viewer and re-imports without scale or identity loss.

## Phase 4: Scan-to-BIM Assistance

1. Ingest calibrated point clouds/meshes with provenance.
2. Add denoising, registration QA, normals, reconstruction, and deviation analysis.
3. Detect levels, walls, slabs, openings, and primitives as confidence-scored proposals.
4. Require user confirmation before creating BIM elements.
5. Compare accepted BIM surfaces to capture data and enforce tolerances.

Exit: each accepted element records evidence, confidence, deviation, and approval.

## Phase 5: Geospatial Delivery

1. Add CRS, vertical datum, survey point, project north, true north, and local engineering origin.
2. Use PROJ/GDAL in a worker and floating origins in the browser.
3. Ingest terrain/imagery through STAC or provider APIs with provenance and licensing.
4. Add 3D Tiles only when normal GLB delivery is insufficient.
5. Test control points, high coordinates, rotations, and vertical datums.

Exit: a georeferenced fixture aligns with independent controls without jitter.

## Phase 6: Production Hardening

1. Add quotas, cancellation, job isolation, upload scanning, and external-reference controls.
2. Cache by source hash, tool version, settings, and schema.
3. Track failures, memory, duration, entities, triangles, and output size.
4. Add multi-authoring-tool fixtures and continuous round-trip tests.
5. Document supported IFC classes, schemas, tolerances, and known loss modes.

## Primary References

- IfcOpenShell: https://docs.ifcopenshell.org/
- IfcOpenShell geometry: https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html
- buildingSMART IFC: https://technical.buildingsmart.org/standards/ifc/
- web-ifc: https://github.com/ThatOpen/engine_web-ifc
- OpenCascade.js: https://ocjs.org/
- 3D Tiles: https://github.com/CesiumGS/3d-tiles
