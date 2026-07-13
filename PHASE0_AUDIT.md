# Phase 0 Audit: Scale and Coordinate Pipeline

## Scale Normalization Points Found

### 1. AvatarModel.tsx — Target-Height Normalization (DOG)
- **File:** `src/three/AvatarModel.tsx`
- **Lines:** 114-171 (useMemo block)
- **Constants:** `TARGET_HEIGHT = 0.7` (line 15), human `1.7` (line 162)
- **Mechanism:** `fitScale = targetHeight / size.y` (line 163)
- **Effect:** Every dog avatar is scaled to 0.7m tall regardless of source dimensions
- **Consequence:** Original physical scale is **permanently lost** — the scale factor is applied
  as a `<group scale={fitScale}>` wrapper and the underlying model's original size is
  overwritten in the rendering pipeline
- **Also applied:** Footprint-based centering (lines 136-160), ground-drop (line 160)

### 2. ObjectModel.tsx — Longest-Edge Display Fitting
- **File:** `src/three/objects/ObjectModel.tsx`
- **Lines:** 10-33 (GlbObject component)
- **Mechanism:** `s = fitSize / Math.max(size.x, size.y, size.z)` (line 17-18)
- **Effect:** Every downloaded GLB is scaled so its longest edge = `fitSize` from catalog
- **Consequence:** A 2-meter-wide object and a 0.2-meter-wide object render identically
  if they have the same `fitSize`. Physical scale is **completely destroyed**.
- **Also:** Centered on bbox center, dropped to ground (lines 19-21)

### 3. Object Catalog — Display-Size Constants
- **File:** `src/three/objects/catalog.ts`
- **Lines:** 32-41
- **Values:** `fitSize` in meters: food_bowl=0.35, ball=0.25, bone=0.28, bed=0.85,
  dog_house=1.0, hydrant=0.5
- **Note:** These are display-fitting targets, not physical dimensions. `baseScale=1`
  for all items, which is then multiplied by user `object.scale`.

### 4. EighthWall AR — Same Display Fitting
- **File:** `src/three/ar/eighthWallAR.ts`
- **Lines:** 111-122 (buildObjectNode)
- **Mechanism:** Same `fit / longest` ratio as ObjectModel
- **Effect:** AR objects also lose physical scale
- **Additionally:** Fallback box placeholder if GLB missing (lines 130-138)

### 5. ObjectModel Top-Level — Guest/User Scale
- **File:** `src/three/objects/ObjectModel.tsx`
- **Line 166:** `scale = object.scale * (def?.baseScale ?? 1)`
- **Note:** `object.scale` is a user-controlled parameter with no distinction between
  physical scale adjustment and display resize. There is no `physicalScale` field.

### 6. PlacedObject Type — No Scale Provenance
- **File:** `src/types.ts`
- **Lines:** 272-280
- **Fields:** `position`, `rotationY`, `scale`, `createdAt`
- **Missing:** No `physicalScale`, `sourceUnits`, `displayScale`, or any spatial metadata.

### 7. Animator Asset Import — No Spatial Capture
- **File:** `server/animator/assets.ts`
- **Mechanism:** GLB magic-byte validation only (lines 40-42)
- **Missing:** No capture of source units, scale, or coordinate system

### 8. Animator GLB Inspection — Partial Bounds
- **File:** `server/animator/gltf.ts` (via `inspectAsset`)
- **Captures:** `boundingBox` (min/max)
- **Missing:** No unit information, no scale provenance

### 9. Database — No Spatial Metadata Table
- **File:** `db.ts`
- **Tables examined:** `avatars`, `creations`, `placed_objects`
- **Missing:** No table for `model_spatial_metadata` or equivalent

### 10. Storage — No Metadata Preservation
- **File:** `storage.ts`
- **Mechanism:** S3-compatible upload
- **Missing:** No metadata about scale, units, or coordinate system stored alongside

## Summary: Where Scale Is Changed or Lost

| Pipeline Step | Scale Preserved? | Notes |
|---|---|---|
| GLB upload | Yes (original bytes) | Immutable in B2 but metadata not captured |
| Browser GLB load | **No** | fitSize/longest-edge normalization |
| Avatar model load | **No** | Target-height normalization |
| AR model load | **No** | Same fitSize normalization |
| Blender worker round-trip | Unknown | Needs testing |
| Animator import | Partial | Bounds captured, units not |
| Database storage | **No** | No spatial metadata table |
| IFC import | N/A | Not implemented yet |
| User scale adjustment | Mixed | `object.scale` combines physical + display |

## Recommended Actions

1. Add `ModelSpatialMetadata` schema with physical scale, source units, axes, bounds
2. Add `physicalScale` and `displayScale` to `PlacedObject`
3. Bypass display normalization when authoritative dimensions exist
4. Capture scale metadata at import/upload boundaries
5. Add database table for spatial metadata
6. Thread metadata through Blender worker requests
7. Store canonical values in meters; convert only for display