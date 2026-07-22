# BIM and Scaled Model Implementation

## Phase 0: Baseline and Contracts

- Reproducible 1 m, 10 m, and 100 mm GLB fixtures.
- API-generated IFC4 fixtures plus malformed-signature and unsupported-schema failures.
- Canonical meter/right-handed conventions and normalization audit.
- Two-room acceptance model with known dimensions and semantic relationships.

Exit gate: fixtures have known units, bounds, hierarchy, and expected failure behavior.

## Phase 1: Authoritative Scale

- Versioned spatial metadata records bounds, units, axes, provenance, accuracy, hashes, lineage, and calibration.
- Bounds include nested node world transforms.
- Database identity is tenant + asset kind + asset ID.
- Trusted physical scale bypasses longest-edge fitting in browser and AR.
- Metric measurement and snap utilities are tested.

Exit gate: a source dimension traces to canonical meters without display fitting changing physical scale.

## Phase 2: IFC Import

- IfcOpenShell validates STEP signature, exact schema, units, element limits, GlobalIds, and semantics.
- Conversion must produce a nonempty valid glTF 2.0 GLB or fail.
- Sidecar preserves class, GlobalId, storey, placement, properties, quantities, materials, and hierarchy.
- Area and volume quantities use squared/cubed conversion.
- Authenticated worker API enforces 50 MB inputs, timeout, two-process concurrency, cleanup, and SHA-256 caching.
- Browser supports selection, class filters, category colors, and property display.

Exit gate: valid IFC converts and is selectable by GlobalId; invalid IFC fails closed.

## Phase 3: Constrained Authoring and IFC4 Export

- Levels, walls, slabs, roofs, openings, doors, windows, spaces, columns, and beams.
- Metric snapping, positive dimensions, wall endpoints, host/opening/filling validation.
- Bounded undo/redo command history.
- IFC4 project hierarchy, geometry, Psets, voids, and fillings.
- Every export is reopened, inspected, and converted before delivery.
- Two-room round trip verifies two spaces and two openings.

Exit gate: authored IFC4 reopens, retains semantic counts/relations, and renders as valid GLB.

## Verification and Product Tiers

Every paid build has two gates. The free pre-build gate validates topology, host relationships, positive dimensions, levels, warnings, and intended physical bounds. The server repeats it before charging. The post-build gate parses the delivered GLB and confirms serialized bounds for Shell models; IFC builds additionally reopen IFC4, verify semantic counts and GlobalIds, convert to GLB, and compare intended versus rendered dimensions. A failed post-build gate refunds the charge.

- Shell model: 60 credits. Meter-scaled visual GLB without IFC/BIM semantics.
- IFC/BIM model: 300 credits. IFC4, semantic sidecar, rendered GLB, and stronger round-trip verification.

## Library Decision

Required: IfcOpenShell 0.8.5 and NumPy 2.2.1 in the worker. Existing Three.js, React Three Fiber, and glTF Transform dependencies cover browser rendering and GLB validation. Do not add `web-ifc` unless client-only/offline parsing becomes necessary; duplicating parsers now would increase bundle size and create semantic differences.
