# Geospatial Acquisition Reference

## Source Selection

- Use EarthExplorer for broad datasets and detailed spatial/temporal filtering.
- Use STAC/cloud catalogs for reproducible cloud-native discovery and near-data processing.
- Use USGS M2M for automated EarthExplorer-style search and retrieval when its account/API model fits.
- Prefer analysis-ready products when they provide the required corrections.
- Use survey or LiDAR data for building dimensions; Landsat is regional context, not building measurement.

## Query Record

Record geometry, dates, dataset/product level, cloud threshold, resolution, CRS, assets, checksums, and licenses. Retain stable item identifiers.

## BIM Integration

- Preserve the BIM local coordinate system and its explicit map-CRS transform.
- Maintain project north, true north, survey point, and elevation datum separately.
- Shift large coordinates to a local floating origin for browser rendering.
- Test transforms against independent controls.
- Use 3D Tiles for large terrain, point clouds, photogrammetry, or campus models while preserving metadata.
