---
name: geospatial-model-context
description: Acquire, normalize, and integrate terrain, imagery, point clouds, survey control, CRS, vertical datum, and georeferencing for Pawsome3D scaled models and BIM. Use for USGS/Landsat, STAC, EarthExplorer/M2M, DEM, GeoTIFF/COG, LAS/LAZ, 3D Tiles, map placement, campus scenes, or BIM-to-world alignment.
---

# Geospatial Model Context

## Workflow

1. Define extent, time, resolution, accuracy, CRS, vertical datum, and license constraints.
2. Choose STAC/cloud catalogs for automation, EarthExplorer for precise manual search, or provider APIs for operational pipelines.
3. Prefer analysis-ready products when they meet the requirement.
4. Validate coverage, masks, resolution, acquisition time, CRS, datum, and provenance.
5. Transform authoritatively with PROJ/GDAL-class tooling and retain source metadata.
6. Use a local engineering origin in Three.js while preserving the real-world transform.
7. Use 3D Tiles only when geographic extent or model volume requires streaming.

## Guardrails

- Never mix latitude/longitude degrees with meter-based scene coordinates.
- Never claim vertical alignment without identifying the vertical datum.
- Keep survey control authoritative over imagery alignment.
- Treat remote sensing as context unless its accuracy satisfies the building workflow.
- Record dataset ID, date, processing level, masks, license, and checksum.

## Output

Provide source, query criteria, CRS/datum, unit conversion, local-origin transform, accuracy limits, preprocessing, provenance, and validation.

Read `references/geospatial-acquisition.md` for source selection and automated acquisition.
