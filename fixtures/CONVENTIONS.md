# Pawsome3D Coordinate and Scale Conventions

## Canonical Coordinate System

- **Handedness:** Right-handed
- **Up axis:** +Y (Three.js and GLB default)
- **Forward axis:** +Z (Three.js convention; -Z into the screen)
- **Canonical unit:** One meter (SI)
- **One Three.js world unit = One meter**

## Convention Definitions

| Property | Value |
|---|---|
| Coordinate system | Right-handed, Y-up |
| Canonical length unit | meter (SI) |
| Display scale behavior | Edges of the scene or viewport, not authoritative |
| Physical scale behavior | Authoritative, stored in meters, never derived from display |
| Local engineering origin | (0, 0, 0) in scene coordinates |
| Project north | +Z axis (default, configurable per model) |
| True north | Stored in spatial metadata, may differ from project north |
| Up vector | (0, 1, 0) |
| Geospatial origin policy | Late-binding: BIM coordinates preserved, local origin shifted for rendering |

## Scale Rules

1. **Physical scale** is canonical, stored in meters, and never derived from display-normalized geometry
2. **Display scale** is a viewer-only fitting parameter; it must never be persisted as authoritative
3. When authoritative `physicalScale` exists, display normalization must be bypassed
4. Legacy models without `physicalScale` use display-fit as fallback (backward compatible)
5. `PlacedObject.scale` must be split into `physicalScale` and `displayScale`
6. User scale adjustments go to `displayScale` when no authoritative dimensions exist
7. Calibration workflow sets `physicalScale` with provenance metadata

## Boundary Policies

| Boundary | Behavior |
|---|---|
| Upload → Storage | Capture source units, physical bounds, immutable hash |
| Storage → Browser | Apply display-fit only when no physicalScale; bypass when authoritative |
| Browser → Blender worker | Send physicalScale in manifest; preserve through round-trip |
| Blender → Export | Validate physical scale retained within tolerance |
| AR placement | Use physical scale when available; fall back to fitSize |
| IFC import | Preserve project units, convert to meters, store in spatial metadata |
| GLB export | Embed in meters, record conversion in manifest |

## Accuracy Classes

| Class | Tolerance | Use Case |
|---|---|---|
| Visual | N/A | Placeholder, uncalibrated models |
| Approximate | ±25mm | Conceptual massing, room planning |
| Precise | ±5mm | As-built capture, fabrication |
| Survey | ±1mm | Survey-grade, professional BIM exchange |

## Validation Rules

- Reject NaN, Infinity in any transform or position value
- Reject zero or negative scale values
- Reject singular transform matrices
- Reject unsupported unit strings
- Reject implausible dimensions (e.g., >10km for a building element)
- All bounds must have finite real numbers
- Source hash must be present for authoritative models