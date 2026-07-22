# BIM and Scaled Model Builder Review Checklist

A pass means the behavior is demonstrated by a fixture or test, not inferred from a viewer screenshot.

## Product and Accuracy

- [ ] Define the first use case: conceptual massing, room planning, as-built capture, fabrication, or professional BIM exchange.
- [ ] Define required accuracy (visual-only, +/- 25 mm, +/- 5 mm, or survey-grade).
- [ ] Label generated geometry uncalibrated until known dimensions, markers, sensor scale, or survey controls establish scale.
- [ ] Separate visual approval from dimensional and semantic approval.
- [ ] Define who can change authoritative dimensions and audit each revision.

## Current Scale Audit

- [ ] Confirm right-handed, Y-up, meter-based scene conventions and document every boundary conversion.
- [ ] Bypass target-height normalization in `src/three/AvatarModel.tsx` for authoritative assets.
- [ ] Bypass longest-edge `fitSize` normalization in `src/three/objects/ObjectModel.tsx` for authoritative assets.
- [ ] Audit equivalent bounding-box normalization in AR and Eighth Wall loaders.
- [ ] Separate `displayScale` from `physicalScale`; never persist camera-fit transforms as model truth.
- [ ] Define whether `PlacedObject.scale` is physical, display-only, or user-relative and prevent compounded scale.
- [ ] Verify Blender scene units, imports, nested transforms, and exports.
- [ ] Add 1 m, 10 m, and millimeter-authored regression fixtures.

## Spatial Metadata

- [ ] Add versioned `ModelSpatialMetadata`: source unit, meters-per-unit, axes, handedness, CRS, bounds, origin, and datum.
- [ ] Store calibrated dimensions, method, accuracy class, tolerance, confidence, capture method, and date.
- [ ] Preserve immutable source URI/hash and derivative lineage.
- [ ] Reject NaN/Infinity, zero scale, singular matrices, implausible extents, and unsupported units.
- [ ] Use durable UUIDs/IFC GlobalIds, not transient node indices or IFC STEP line numbers.

## Capture and Geometry

- [ ] Require a known measurement or marker when source units are untrusted.
- [ ] Record oriented normals, 30%-50% overlap, camera/sensor metadata, datums, levels, project north, and survey control.
- [ ] Preserve raw point clouds/meshes before filtering, registration, filling, or decimation.
- [ ] Quantify ICP residuals and reject bad alignment.
- [ ] Make Poisson octree depth configurable and recorded.
- [ ] Detect non-manifold edges, self-intersections, flipped normals, holes, duplicates, and degenerate faces.
- [ ] Use adaptive decimation that preserves openings, boundaries, curvature, and controls.
- [ ] Extract planes, levels, cylinders, profiles, openings, and patterns before assigning BIM classes.
- [ ] Keep GLB render derivatives separate from STEP/B-Rep and IFC semantic masters.

## BIM and IFC

- [ ] Select IFC4 initially; evaluate IFC4.3 for infrastructure/georeferencing needs.
- [ ] Preserve `IfcProject > IfcSite > IfcBuilding > IfcBuildingStorey > element`.
- [ ] Map wall, slab, roof, opening, door, window, space, column, beam, and furnishing deliberately.
- [ ] Report every fallback to `IfcBuildingElementProxy`.
- [ ] Preserve GlobalIds, placements, units, property sets, quantities, materials, classifications, and types.
- [ ] Preserve project north, true north, and IFC map-conversion data.
- [ ] Validate openings, containment, decomposition, and space relationships.
- [ ] Round-trip fixtures and compare IDs, counts, units, hierarchy, properties, and bounds.

## Runtime Architecture and Security

- [ ] Keep authoritative IFC conversion in an isolated worker with CPU, memory, time, and file-size limits.
- [ ] Keep browser viewing on GLB plus a semantic index; use a Web Worker for optional browser IFC parsing.
- [ ] Add progressive loading/LOD for large buildings.
- [ ] Validate uploads by file signature, scan them, block traversal, and deny external-reference fetching by default.
- [ ] Cache by source hash, converter version, and settings.
- [ ] Pin converter versions and record them in derivative metadata.

## Measurement and Editing

- [ ] Display units on every dimension and store canonical SI meters.
- [ ] Add point, axis, area, elevation, and clearance measurements with snapping.
- [ ] Mark each value measured, inferred, user-entered, or generated.
- [ ] Add undoable scale calibration with before/after bounds.
- [ ] Prevent accidental non-uniform scaling of semantic elements.

## Quality and Deployment

- [ ] Produce signed deviation heat maps and RMS, median, P95, max, and outlier counts.
- [ ] Apply tighter tolerances to openings, structural grids, and functional interfaces.
- [ ] Test mm -> m -> IFC unit -> GLB meter round trips, large coordinates, rotations, mirrors, and negative elevations.
- [ ] Block authoritative export when configured quality gates fail.
- [ ] Emit a machine-readable validation report with each export.
- [ ] Add worker health checks, conversion metrics, and a small IFC smoke fixture.
- [ ] Keep native/Python BIM dependencies in the worker, not Hostinger's web process.
- [ ] Run lint, full tests, AR tests, production build, and deployment zip checks.
