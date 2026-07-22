# ImageToAsset → Pawsome3D BIM Integration Spec

**Repo:** `robs46859-eng/imagetoasset` (local: `~/Downloads/imagetoasset-main`)
**Target:** PawsMemories/Pawsome3D BIM automator (`/api/bim/*`, `blender-worker/ifc_worker`)
**Goal:** Users upload orthographic drawings (JPG) and get scaled, semantically-grounded assets that flow into the IFC BIM pipeline — reconstructed by *logic and reason* (dimension evidence, cross-view constraint solving, calibrated scale), not visual guesswork.

---

## 1. Current-state audit

### 1.1 imagetoasset (as uploaded)

| Component | What it does | Gap for BIM integration |
|---|---|---|
| `server.ts` `/api/reconstruct` | Single Gemini (`gemini-3.5-flash`) call, structured JSON schema → `CADModel` | One-shot vision guess. No dimension-text extraction, no scale calibration, no cross-view verification. Trusts the LLM's numbers blindly. |
| `types.ts` `CADModel` | CSG primitives: `box`, `cylinder`, `hole_box`, `hole_cylinder`, `wedge`; mm; `subtractive` flag; `interpretedFromView`, `confidence` | No provenance (what evidence produced each dimension), no spatial-metadata contract, no stable GlobalIds. `confidence` exists in type but is never populated or used. |
| `ValidationPanel.tsx` | Heuristic volume/surface-area sums, AABB "floating cut" check, <1 mm warnings | Client-side cosmetic checks only. Volume math ignores boolean intersection (subtracts full hole volume even when it only partially penetrates). Not a gate — nothing blocks export. |
| `exporters.ts` | Hand-rolled DXF projections; pseudo-STEP | **The STEP output is not valid AP203/214** (box edge directions are hard-coded `(1,0,0)`, cylinder faces have empty bounds, rotations ignored). Must not be the authoritative geometry path. DXF is serviceable for 2D reference. |
| `CADCanvas.tsx` | Three.js viewport (visual only — no real CSG evaluation) | Rendering approximates booleans visually; no manifold mesh exists anywhere. |
| `App.tsx` / `FeatureList.tsx` | Parametric feature tree editing, fake progress timers | Fine as UI seed; progress simulation to be replaced by real pipeline stages. |

### 1.2 PawsMemories BIM automator (integration surface)

- **Schema:** `src/bim/model.ts` — `BimModel { levels, elements }`, element types `wall…beam`, **meters**, `validateBimModel` / `preflightBimModel`.
- **Spatial contract:** `src/three/spatial/types.ts` — Zod `ModelSpatialMetadata`: canonical SI meters, `AccuracyClass` (`visual|approximate|precise|survey`), `CalibrationMethod` (incl. `user_calibrated`, `known_marker`, `estimated`, `trusted_source`), bounds, lineage, source hash.
- **Server:** `server.ts` — `POST /api/bim/import-ifc`, `/api/bim/preflight`, `/api/bim/build` (modes `shell|ifc`, credit-gated via `bimModelCost`), persists GLB + IFC + sidecar to Backblaze via `persistBuild`; post-build semantic verification (`schema === "IFC4"`) is a hard gate.
- **Worker:** `blender-worker/ifc_worker/ifc_worker.py` — IfcOpenShell (pinned): `convert_ifc` (IFC→GLB + GlobalId-keyed sidecar), IFC4 authoring via `ifcopenshell.api` including **`add_mesh_representation(vertices, faces)` + `edit_object_placement(matrix, is_si=True)`** — this is the door mesh-based assets walk through. Auth between app and worker uses `WORKER_SHARED_SECRET`.

**Key insight:** the worker already accepts arbitrary triangle meshes with SI placement. ImageToAsset's job is to produce a *verified, evidenced, manifold* mesh + semantic parameters — everything downstream exists.

---

## 2. Architecture

Merge imagetoasset into PawsMemories as a module (Option A), not a second microservice. Rationale: shares auth/credits/Backblaze/worker plumbing; avoids a third deployment; the Gemini call is already server-side Express and drops into `server.ts` routes cleanly. (Option B — standalone service with a shared secret à la blender-worker — only if you later want independent scaling of vision jobs.)

```
JPG upload
   │
   ▼
[A] Evidence Extraction (Gemini pass 1 — READ, don't model)
   views, title block (SCALE:, UNIT:), dimension callouts, hole tables
   │
   ▼
[B] Scale Calibration (deterministic TS — no LLM)
   annotation px ↔ stated mm  →  px_per_mm per view; flag conflicts
   │
   ▼
[C] Geometry Proposal (Gemini pass 2 — model against evidence)
   CSG primitives, every dimension cites evidence ID or is marked estimated
   │
   ▼
[D] Constraint Solver + Validator (deterministic TS)
   cross-view consistency, evidence coverage, hole-host penetration,
   real CSG evaluation → manifold mesh (manifold-3d)
   │
   ▼
[E] User Review UI (feature tree + evidence panel; user confirms/corrects)
   │
   ▼
[F] BIM Handoff — mm → m, ModelSpatialMetadata, psets
   → /api/bim/build → ifc_worker → IFC4 + GLB + sidecar → Backblaze
```

Stages B and D are the "logic and reason" core: **the LLM proposes, deterministic code verifies, the user approves.** No number reaches IFC without either annotation evidence, a passing cross-view check, or explicit user confirmation.

---

## 3. Data contracts (new/changed types)

### 3.1 Evidence ledger (`src/imagetoasset/evidence.ts`, Zod)

```ts
interface DrawingEvidence {
  id: string;                        // "ev-001"
  kind: "dimension" | "diameter" | "radius" | "title_block_scale"
      | "title_block_unit" | "note" | "hole_table" | "grid_pitch";
  rawText: string;                   // "DIA 24.0", "SCALE 1:1  UNIT: mm"
  valueMm?: number;                  // parsed numeric, normalized to mm
  view: "front" | "top" | "side" | "sketch" | "title_block";
  pixelAnchor?: { x: number; y: number };       // where on the image
  pixelSpanPx?: number;              // measured extent the callout dimensions
}

interface ScaleCalibration {
  view: string;
  pxPerMm: number;
  method: "annotation_pair" | "title_block_scale" | "user_reference" | "estimated";
  supportingEvidence: string[];      // evidence ids
  residualPct: number;               // agreement across all callouts in view
}
```

### 3.2 Extended primitive (supersedes `types.ts` `CADPrimitive`)

```ts
interface EvidencedPrimitive extends CADPrimitive {
  globalId: string;                  // durable UUID, survives into IFC GlobalId
  dimensionEvidence: {               // per-dimension provenance
    [dim in "width"|"height"|"depth"|"radius"|"length"|"posX"|"posY"|"posZ"]?: {
      evidenceIds: string[];         // [] ⇒ estimated
      source: "annotation" | "cross_view_inferred" | "pixel_measured"
            | "user_edited" | "estimated";
      agreementViews: string[];      // views where this dim was independently confirmed
    }
  };
  confidence: number;                // now REQUIRED and computed (see §4.4)
  role?: "base" | "flange" | "boss" | "rib" | "bore" | "pocket" | "keyway"
       | "mount_hole" | "unknown";   // engineering semantics for psets
}

interface ReconstructedAsset {
  schemaVersion: 1;
  name: string;
  units: "mm";                       // internal fixed; converted at BIM boundary
  primitives: EvidencedPrimitive[];
  evidence: DrawingEvidence[];
  calibration: ScaleCalibration[];
  validation: AssetValidationReport; // §4.3
  sourceImage: { sha256: string; mimeType: string; storedUrl?: string };
}
```

### 3.3 BIM handoff payload

New element type in `src/bim/model.ts`: `"asset"` added to `BIM_ELEMENT_TYPES`, with:

```ts
interface BimAssetElement extends BimElement {
  type: "asset";
  meshRef: string;                   // key to uploaded manifold mesh (vertices/faces, meters)
  ifcClass: "IfcBuildingElementProxy" | "IfcFurnishingElement"
          | "IfcDistributionElement";                 // default proxy
  spatialMetadata: ModelSpatialMetadata;              // reuse existing Zod schema:
                                                      //   sourceUnit "mm", accuracyClass from §4.4,
                                                      //   calibrationMethod mapped: annotation_pair→trusted_source,
                                                      //   user_reference→user_calibrated, estimated→estimated
  reconstruction: {                                   // → Pset_Pawsome3D_Reconstruction
    sourceImageSha256: string; overallConfidence: number;
    evidencedDimensionRatio: number; toolVersion: string;
  };
}
```

---

## 4. Pipeline stages — build detail

### 4.1 Stage A/C — split the Gemini call (`src/imagetoasset/reconstruct.ts`)

Refactor `server.ts` `/api/reconstruct` logic into two calls with separate response schemas:

1. **Pass 1 (extraction):** system prompt instructs *read only*: enumerate views and their pixel bounding boxes, transcribe the title block, list every dimension callout with anchor pixels and the pixel span it annotates. Output = `DrawingEvidence[]`. Temperature 0.
2. **Pass 2 (modeling):** receives the image **plus the parsed evidence list and computed `ScaleCalibration`**. Every primitive dimension in the response schema requires an `evidenceIds` array (may be empty ⇒ `estimated`). Prompt rule: "Never output a dimension that contradicts cited evidence; if views conflict, cite both and set source `cross_view_inferred` with your resolution."

Keep the existing structured `responseSchema` approach — extend it with the evidence fields. Retry once on schema-parse failure, then fail loud (no silent fallback model).

### 4.2 Stage B — scale calibration (`src/imagetoasset/calibrate.ts`, pure functions)

- For each view: pair every dimension callout's `valueMm` with its `pixelSpanPx` → candidate `pxPerMm`; robust-fit (median + MAD outlier rejection) → per-view `pxPerMm` and `residualPct`.
- Cross-check against `title_block_scale` (e.g. `SCALE 1:1`) when a paper DPI hint or grid pitch exists.
- **Conflict rule:** if any callout disagrees with the fitted scale by >5% it's flagged; if >25% of callouts disagree, calibration fails → UI demands a user reference measurement ("this edge is __ mm") before proceeding. That user entry becomes `method: "user_reference"` → `CalibrationMethod "user_calibrated"`.
- Sketches (no callouts): `method: "estimated"`, and the whole asset caps at `accuracyClass: "visual"`.

### 4.3 Stage D — constraint solver + real validation (`src/imagetoasset/solve.ts`)

Deterministic checks, each producing pass/warn/fail entries in `AssetValidationReport`:

1. **Cross-view consistency:** every primitive projects into ≥2 views; its X-extent must agree between front and top, Y-extent between front and side, Z-extent between top and side, within tolerance = max(2 px / pxPerMm, ISO 2768 class from the existing tolerance selector). Disagreement >tolerance = fail on that dimension.
2. **Evidence coverage:** ratio of dimensions with non-empty `evidenceIds`. <50% ⇒ warn banner; the ratio feeds accuracy class (§4.4).
3. **Boolean sanity (replaces ValidationPanel heuristics):** run real CSG with **`manifold-3d`** (npm, WASM — deterministic, battle-tested): union additives, subtract subtractives. Fail if result is non-manifold, zero-volume, or splits into unintended disconnected components. Correct volume/area come free and replace the naive sums.
4. **Hole-host penetration:** each subtractive must intersect ≥1 additive with ≥95% of its own volume inside the union (catches the current "floating cut" case exactly instead of AABB-with-10mm-buffer).
5. **Dimensional sanity:** min feature size vs tolerance class; wall-thickness check (offset test on the manifold) for manufacturability warnings.

Output of this stage is also the **authoritative mesh**: `manifold-3d` result → indexed triangle list (mm), later scaled to meters for the worker. The hand-rolled STEP exporter is demoted to "experimental download" or deleted; DXF export stays as-is.

### 4.4 Confidence & accuracy mapping

```
primitive.confidence = 0.5·evidenceRatio + 0.3·viewAgreementScore + 0.2·(1 − solverWarnRatio)
asset accuracyClass:
  "precise"      — calibration annotation_pair/user_reference AND evidenceRatio ≥ 0.8 AND no solver fails
  "approximate"  — calibration OK AND evidenceRatio ≥ 0.5
  "visual"       — otherwise (incl. all sketches)
  ("survey" never claimable from a drawing)
```

Accuracy class is displayed prominently and written into `ModelSpatialMetadata` — downstream AR placement and the animator already respect this contract (Phase 1 of BIM_IMPLEMENTATION_PLAN).

### 4.5 Stage E — review UI (`src/components/AssetReconstructor.tsx`)

Port `DrawingUploader`/`FeatureList`/`CADCanvas`/`ValidationPanel` into PawsMemories as one panel (TerraPaw design system, replacing the OrthoCAD dark theme), with these changes:

- Feature tree rows show per-dimension evidence chips: green = annotation, blue = cross-view, amber = estimated. Clicking a chip highlights the callout's `pixelAnchor` on the source image.
- Estimated (amber) dimensions are editable inline; edits set `source: "user_edited"` and re-run the solver (fast — manifold-3d is ms-scale at this size).
- Replace fake `setTimeout` progress with real stage events (A→D) streamed via the existing job pattern.
- "Send to BIM Builder" button = Stage F; disabled until solver has no fails and calibration isn't `estimated`-with-unconfirmed-dims (user can override per-dim by confirming).

### 4.6 Stage F — BIM handoff

- **Server (`server.ts`):** new routes, same auth/credit pattern as existing BIM routes:
  - `POST /api/assets/reconstruct` — image in, runs A–D, returns `ReconstructedAsset` (charge reconstruction credits here; store source image hash → cache repeat runs).
  - `POST /api/assets/:id/to-bim` — converts confirmed asset: mm→m (÷1000) on vertices and placement, builds `BimAssetElement`, then reuses the **existing** `/api/bim/build` path (`getBlenderClient().exportIfc`) and `persistBuild`.
- **Worker (`ifc_worker.py`):** extend the authoring payload with `elements[].type == "asset"`: `create_entity(ifc_class=element.ifcClass)` → existing `add_mesh_representation(vertices, faces)` (already SI-correct via `is_si=True` placement) → new `Pset_Pawsome3D_Reconstruction` via `ifcopenshell.api.pset` (confidence, evidence ratio, source hash, calibration method, tool version) plus `Qto` volume/area from the manifold result. GlobalId = the primitive-tree asset `globalId` so the GLB↔sidecar↔IFC join keeps working.
- Post-build gate unchanged: IFC4 schema verification must pass; sidecar now includes the reconstruction pset so `BimModelBuilder`'s property browser shows evidence data on imported assets.

---

## 5. File-by-file build plan

| # | File (PawsMemories repo) | Action |
|---|---|---|
| 1 | `src/imagetoasset/types.ts` | New — §3.1/3.2 Zod schemas (`DrawingEvidence`, `ScaleCalibration`, `EvidencedPrimitive`, `ReconstructedAsset`) |
| 2 | `src/imagetoasset/reconstruct.ts` | Port + split Gemini call (Pass 1/Pass 2), env `GEMINI_API_KEY` |
| 3 | `src/imagetoasset/calibrate.ts` | New — deterministic scale fit, conflict detection (pure, unit-tested) |
| 4 | `src/imagetoasset/solve.ts` | New — cross-view solver, manifold-3d CSG, validation report (pure, unit-tested) |
| 5 | `src/imagetoasset/handoff.ts` | New — mm→m, `ModelSpatialMetadata` population, `BimAssetElement` builder |
| 6 | `src/bim/model.ts` | Extend — add `"asset"` type + validation rules (meshRef present, metadata parses) |
| 7 | `src/components/AssetReconstructor.tsx` | Port UI (§4.5); register in avatar-first nav / BIM builder entry |
| 8 | `server.ts` | Add `/api/assets/reconstruct`, `/api/assets/:id/to-bim`; add pricing entry in `src/pricing.ts` |
| 9 | `blender-worker/ifc_worker/ifc_worker.py` | Extend authoring for `asset` elements + reconstruction pset |
| 10 | `blender-worker/ifc_worker/tests/` | Fixtures: flange/collar/clevis assets → assert GlobalIds, psets, SI scale in output IFC |
| 11 | `exporters.ts` (imagetoasset) | Keep DXF; remove or clearly mark pseudo-STEP as non-authoritative |

Dependencies to add: `manifold-3d` (app), nothing new in worker (IfcOpenShell already pinned).

---

## 6. Phased milestones

**IA-0 — Port & contract (exit: types compile, Gemini two-pass returns evidenced JSON for the 3 sample drawings).** Files 1–2. Reuse the flange/collar/clevis procedural canvases from `DrawingUploader.tsx` as deterministic test fixtures — they have known ground-truth primitives to score against.

**IA-1 — Logic core (exit: calibration + solver pass unit tests; flange fixture reconstructs within ±0.5 mm on all annotated dims; deliberately corrupted fixture (one wrong callout) is flagged, not silently absorbed).** Files 3–4. This is the milestone that delivers "logic and reason".

**IA-2 — Review UI (exit: user can see evidence chips, edit an estimated dim, and watch validation re-run live).** File 7.

**IA-3 — BIM handoff (exit: reconstructed flange lands in an IFC4 file that opens in an independent viewer at correct meter scale, with reconstruction pset visible; 1 m fixture rule from BIM Phase 1 holds through the new path).** Files 5–6, 8–10.

**IA-4 — Hardening (exit: credit gating, source-image caching by sha256, job cancellation, size limits (20 MB image cap already exists), worker timeout parity with existing BIM jobs).**

Each milestone ends with the solver/round-trip tests running in CI alongside the existing `ifc_worker` tests.

---

## 7. Risks & decisions taken

- **LLM numeric drift** is the top risk — mitigated structurally (evidence citation requirement + deterministic verification), not by prompt-tuning alone. Anything unverifiable is *visibly* estimated and user-confirmable, never silently authoritative.
- **`gemini-3.5-flash` for Pass 1 OCR-ish extraction** may under-read dense callouts; if fixture accuracy <95% on annotated dims, upgrade Pass 1 to the pro-tier model (Pass 2 can stay flash).
- **CSG in TS (manifold-3d) vs Python worker:** chosen TS-side so the review UI gets instant re-validation; the worker receives final vertices/faces and stays geometry-dumb, matching its current design.
- **IFC class default `IfcBuildingElementProxy`:** correct per buildingSMART for unclassified manufactured items; users can reclassify in the builder later without geometry loss (GlobalId stable).
- **Existing pseudo-STEP exporter** must not ship as an integration path — it fails STEP validation structurally (unbounded faces). DXF stays.
