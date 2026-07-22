# IFC Implementation Reference

## Recommended Stack

- Use IfcOpenShell in a Python worker for authoritative IFC read/write, geometry processing, validation, and IFC-to-GLB conversion.
- Use `web-ifc` in a browser Web Worker only when client-side IFC inspection is required.
- Continue using Three.js/GLB for routine visualization.
- Evaluate OpenCascade.js only for a proven browser B-Rep/STEP requirement.

## Canonical Boundary

Store immutable source information, spatial metadata, semantic entities and relationships, a GlobalId-to-render-node index, derivatives, converter settings, and validation reports separately.

## Import Report

Report schema, project units, spatial hierarchy, element counts by class, geometry failures, proxy count, identity findings, bounds in meters, georeferencing, and property/material/classification extraction.

## Export Gate

Require a valid project hierarchy, stable unique GlobalIds, explicit units and contexts, valid placements and containment, supported representations, opening relationships, finite bounds, and an independent viewer smoke test.

References:

- https://docs.ifcopenshell.org/
- https://technical.buildingsmart.org/standards/ifc/
- https://github.com/ThatOpen/engine_web-ifc
