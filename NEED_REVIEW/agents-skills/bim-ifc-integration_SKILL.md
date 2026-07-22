---
name: bim-ifc-integration
description: Design, implement, and validate BIM and IFC workflows for Pawsome3D, including IFC import/export, semantic sidecars, stable identity, spatial containment, properties, quantities, materials, classifications, placements, units, georeferencing, and browser/worker architecture. Use for BIM, IFC, building elements, digital twins, spaces, quantities, or IFC-to-GLB conversion.
---

# BIM and IFC Integration

## Architecture

1. Preserve IFC as the semantic master.
2. Convert IFC in an isolated worker with pinned IfcOpenShell.
3. Generate GLB for rendering and a semantic index keyed by IFC GlobalId.
4. Keep units, hierarchy, relationships, properties, quantities, and placements outside transient Three.js state.
5. Join browser selections to semantic records with stable IDs.

## Import

- Validate schema, units, contexts, placements, georeferencing, hierarchy, and file limits.
- Preserve `IfcProject > IfcSite > IfcBuilding > IfcBuildingStorey > element` containment.
- Record geometry failures and every fallback to `IfcBuildingElementProxy`.
- Cache derivatives by source hash, converter version, and settings.

## Authoring and Export

- Represent building elements as semantic parameters plus generated geometry.
- Preserve GlobalIds across edits.
- Prefer parametric representations for regular elements and deliberate tessellation for irregular as-built geometry.
- Assign units, contexts, placements, materials, types, properties, quantities, and relationships explicitly.
- Export a validation report with IFC and GLB derivatives.

## Tests

- Round-trip fixtures and compare units, GlobalIds, entity counts, containment, properties, and bounds.
- Test nested placements, openings, rotated sites, large coordinates, negative elevations, and multiple authoring sources.
- Verify browser selection resolves the correct semantic entity after optimization.

Read `references/ifc-implementation.md` for library selection and quality gates.
