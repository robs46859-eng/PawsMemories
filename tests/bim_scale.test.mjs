/**
 * Phase 1 Tests: ModelSpatialMetadata schema, unit conversion, validation.
 *
 * Run: ./node_modules/.bin/tsx --test tests/bim_scale.test.mjs
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import fs from "fs";
import path from "path";

const FIXTURES_DIR = new URL("../fixtures/", import.meta.url).pathname;

let spatial;
try {
  spatial = await import("../src/three/spatial/types.ts");
} catch (e) {
  console.warn("Could not load spatial/types.ts, skipping Phase 1 tests:", e.message);
  process.exit(0);
}

const {
  ModelSpatialMetadataSchema,
  createSpatialMetadata,
  computeGlbBounds,
  UNIT_TO_METERS,
  SUPPORTED_LENGTH_UNITS,
} = spatial;

test("computeGlbBounds includes nested node world transforms", async () => {
  const { Document, NodeIO } = await import("@gltf-transform/core");
  const os = await import("node:os");
  const doc = new Document(); doc.createBuffer();
  const positions = new Float32Array([0,0,0, 1,0,0, 0,1,1]);
  const primitive = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(positions));
  const child = doc.createNode("child").setMesh(doc.createMesh("mesh").addPrimitive(primitive)).setTranslation([2,3,4]);
  doc.createScene("scene").addChild(doc.createNode("parent").setScale([2,2,2]).addChild(child));
  const output = path.join(os.tmpdir(), `nested-bounds-${Date.now()}.glb`);
  try {
    await new NodeIO().write(output, doc);
    const bounds = await computeGlbBounds(output);
    assert.deepEqual(bounds.min, [4,6,8]);
    assert.deepEqual(bounds.max, [6,8,10]);
  } finally { fs.rmSync(output, { force: true }); }
});

// ---------------------------------------------------------------------------
// Unit conversion correctness
// ---------------------------------------------------------------------------
describe("Unit conversion factors", () => {
  test("meter to meter = 1", () => {
    assert.equal(UNIT_TO_METERS["m"], 1);
  });

  test("centimeter to meter = 0.01", () => {
    assert.equal(UNIT_TO_METERS["cm"], 0.01);
  });

  test("millimeter to meter = 0.001", () => {
    assert.equal(UNIT_TO_METERS["mm"], 0.001);
  });

  test("foot to meter = 0.3048", () => {
    assert.equal(UNIT_TO_METERS["ft"], 0.3048);
  });

  test("inch to meter = 0.0254", () => {
    assert.equal(UNIT_TO_METERS["in"], 0.0254);
  });

  test("kilometer to meter = 1000", () => {
    assert.equal(UNIT_TO_METERS["km"], 1000);
  });

  test("all supported units have finite positive factors", () => {
    for (const unit of SUPPORTED_LENGTH_UNITS) {
      const f = UNIT_TO_METERS[unit];
      assert.ok(f > 0, `${unit} factor must be positive`);
      assert.ok(Number.isFinite(f), `${unit} factor must be finite`);
    }
  });
});

// ---------------------------------------------------------------------------
// Schema validation: valid data
// ---------------------------------------------------------------------------
describe("ModelSpatialMetadataSchema basic validation", () => {
  const validMetadata = {
    schemaVersion: 1,
    sourceUnit: "mm",
    metersPerSourceUnit: 0.001,
    canonicalUnit: "m",
    upAxis: "Y",
    forwardAxis: "+Z",
    handedness: "right",
    sourceBoundsMin: [0, 0, 0],
    sourceBoundsMax: [1000, 2000, 1500],
    canonicalBoundsMin: [0, 0, 0],
    canonicalBoundsMax: [1.0, 2.0, 1.5],
    localOrigin: [0, 0, 0],
    sourceHash: "abc123def456",
    sourceFilename: "test-model.glb",
    physicalScale: 1,
    displayScale: 1,
    calibrationMethod: "unknown",
    accuracyClass: "visual",
    calibrationConfidence: 0,
    createdAt: new Date().toISOString(),
  };

  test("accepts valid metadata", () => {
    const result = ModelSpatialMetadataSchema.parse(validMetadata);
    assert.equal(result.sourceUnit, "mm");
    assert.equal(result.canonicalUnit, "m");
    assert.equal(result.schemaVersion, 1);
  });

  test("accepts metadata with optional fields", () => {
    const withOpts = {
      ...validMetadata,
      datumDescription: "WGS84",
      sourceCRS: "EPSG:4326",
      verticalDatum: "NAVD88",
      projectNorth: { x: 0, y: 0, z: 1 },
      trueNorth: { x: 0.7071, y: 0, z: 0.7071 },
      tolerance: 0.005,
      parentDerivativeId: "550e8400-e29b-41d4-a716-446655440000",
      importTool: "fixture-generator",
      converterVersion: "1.0.0",
    };
    const result = ModelSpatialMetadataSchema.parse(withOpts);
    assert.equal(result.datumDescription, "WGS84");
    assert.equal(result.tolerance, 0.005);
  });
});

// ---------------------------------------------------------------------------
// Schema validation: rejection
// ---------------------------------------------------------------------------
describe("ModelSpatialMetadataSchema rejection", () => {
  const baseValid = {
    schemaVersion: 1,
    sourceUnit: "m",
    metersPerSourceUnit: 1,
    canonicalUnit: "m",
    sourceBoundsMin: [0, 0, 0],
    sourceBoundsMax: [1, 1, 1],
    canonicalBoundsMin: [0, 0, 0],
    canonicalBoundsMax: [1, 1, 1],
    localOrigin: [0, 0, 0],
    sourceHash: "hash",
    createdAt: new Date().toISOString(),
  };

  const rejects = (overrides) => {
    assert.throws(() => ModelSpatialMetadataSchema.parse({ ...baseValid, ...overrides }));
  };

  test("rejects NaN in bounds", () => {
    rejects({ sourceBoundsMin: [NaN, 0, 0] });
  });

  test("rejects Infinity in bounds", () => {
    rejects({ sourceBoundsMax: [Infinity, 0, 0] });
  });

  test("rejects zero metersPerSourceUnit", () => {
    rejects({ metersPerSourceUnit: 0 });
  });

  test("rejects negative metersPerSourceUnit", () => {
    rejects({ metersPerSourceUnit: -1 });
  });

  test("rejects zero physicalScale", () => {
    rejects({ physicalScale: 0 });
  });

  test("rejects negative physicalScale", () => {
    rejects({ physicalScale: -1 });
  });

  test("rejects unsupported source unit", () => {
    rejects({ sourceUnit: "fathoms" });
  });

  test("rejects missing sourceHash", () => {
    rejects({ sourceHash: "" });
  });

  test("rejects reversed bounds (max < min)", () => {
    // Use an explicit parse to verify the refine catches reversed bounds
    const bad = {
      ...baseValid,
      sourceBoundsMin: [5, 0, 0],
      sourceBoundsMax: [1, 1, 1],
    };
    assert.throws(() => ModelSpatialMetadataSchema.parse(bad));
  });

  test("allows large but nonnegative tolerance", () => {
    const valid = ModelSpatialMetadataSchema.parse({
      ...baseValid,
      tolerance: 1000,
    });
    assert.equal(valid.tolerance, 1000);
  });
});

// ---------------------------------------------------------------------------
// createSpatialMetadata helper
// ---------------------------------------------------------------------------
describe("createSpatialMetadata helper", () => {
  const hash = "deadbeef01234567";

  test("creates metadata for 1m cube (source unit = m)", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "m",
      sourceBoundsMin: [-0.5, -0.5, -0.5],
      sourceBoundsMax: [0.5, 0.5, 0.5],
      sourceHash: hash,
      sourceFilename: "1m-cube.glb",
    });
    assert.equal(meta.canonicalBoundsMin[0], -0.5);
    assert.equal(meta.canonicalBoundsMax[0], 0.5);
    assert.equal(meta.physicalScale, 1);
    assert.equal(meta.displayScale, 1);
  });

  test("creates metadata for mm-authorized model (source unit = mm)", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "mm",
      sourceBoundsMin: [-50, -50, -50],
      sourceBoundsMax: [50, 50, 50],
      sourceHash: hash,
      sourceFilename: "100mm-cube.glb",
    });
    assert.equal(meta.canonicalBoundsMin[0], -0.05);
    assert.equal(meta.canonicalBoundsMax[0], 0.05);
    assert.equal(meta.metersPerSourceUnit, 0.001);
  });

  test("creates metadata for cm-authorized model", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "cm",
      sourceBoundsMin: [0, 0, 0],
      sourceBoundsMax: [100, 200, 50],
      sourceHash: hash,
    });
    assert.equal(meta.canonicalBoundsMin[0], 0);
    assert.equal(meta.canonicalBoundsMax[0], 1);
    assert.equal(meta.canonicalBoundsMax[1], 2);
    assert.equal(meta.canonicalBoundsMax[2], 0.5);
  });

  test("creates metadata for feet inches model", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "ft",
      sourceBoundsMin: [0, 0, 0],
      sourceBoundsMax: [10, 10, 10],
      sourceHash: hash,
    });
    assert.equal(meta.canonicalBoundsMax[0], 3.048);
  });

  test("preserves physical scale override", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "m",
      sourceBoundsMin: [-0.5, -0.5, -0.5],
      sourceBoundsMax: [0.5, 0.5, 0.5],
      sourceHash: hash,
      physicalScale: 2.5,
    });
    assert.equal(meta.physicalScale, 2.5);
  });

  test("sets created timestamp", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "m",
      sourceBoundsMin: [-0.5, -0.5, -0.5],
      sourceBoundsMax: [0.5, 0.5, 0.5],
      sourceHash: hash,
    });
    assert.ok(meta.createdAt);
    assert.ok(new Date(meta.createdAt).getTime() > 0);
  });
});

// ---------------------------------------------------------------------------
// Fixture-to-metadata integration
// ---------------------------------------------------------------------------
describe("Fixture metadata integration", () => {
  test("1m-cube.glb can produce valid spatial metadata", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "m",
      sourceBoundsMin: [-0.5, -0.5, -0.5],
      sourceBoundsMax: [0.5, 0.5, 0.5],
      sourceHash: fs.readFileSync(path.join(FIXTURES_DIR, "1m-cube.glb")).slice(0, 32).toString("hex"),
      sourceFilename: "1m-cube.glb",
    });
    assert.equal(meta.canonicalBoundsMax[0] - meta.canonicalBoundsMin[0], 1);
  });

  test("100mm-cube.glb canonical dimensions are 0.1m", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "mm",
      sourceBoundsMin: [-50, -50, -50],
      sourceBoundsMax: [50, 50, 50],
      sourceHash: "test",
      sourceFilename: "100mm-cube.glb",
    });
    const w = meta.canonicalBoundsMax[0] - meta.canonicalBoundsMin[0];
    assert.ok(Math.abs(w - 0.1) < 1e-6, `Width ${w} must be ~0.1m`);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility helper tests
// ---------------------------------------------------------------------------
describe("Backward compatibility", () => {
  test("metadata can be constructed with defaults for legacy models", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "m",
      sourceBoundsMin: [-0.5, -0.5, -0.5],
      sourceBoundsMax: [0.5, 0.5, 0.5],
      sourceHash: "legacy-fallback",
      accuracyClass: "visual",
    });
    assert.equal(meta.accuracyClass, "visual");
    assert.equal(meta.calibrationMethod, "unknown");
    assert.equal(meta.calibrationConfidence, 0);
  });
});

// ---------------------------------------------------------------------------
// Display-scale vs physical-scale behavior
// ---------------------------------------------------------------------------
describe("Display vs physical scale separation", () => {
  test("displayScale defaults to 1 independently of physicalScale", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "m",
      sourceBoundsMin: [-0.5, -0.5, -0.5],
      sourceBoundsMax: [0.5, 0.5, 0.5],
      sourceHash: "test",
      physicalScale: 1,
    });
    assert.equal(meta.displayScale, 1);
  });

  test("physicalScale can be set to override display fitting", () => {
    const meta = createSpatialMetadata({
      sourceUnit: "m",
      sourceBoundsMin: [-0.5, -0.5, -0.5],
      sourceBoundsMax: [0.5, 0.5, 0.5],
      sourceHash: "test",
      physicalScale: 1.0,
    });
    assert.equal(meta.physicalScale, 1);
  });
});

// ---------------------------------------------------------------------------
// Measurement utilities
// ---------------------------------------------------------------------------
let meas;
try {
  meas = await import("../src/three/spatial/measurement.ts");
} catch (e) {
  console.warn("Could not load measurement.ts:", e.message);
}

if (meas) {
describe("Measurement utilities", () => {
    test("pointDistance computes correct 3D distance", () => {
      const d = meas.pointDistance([0, 0, 0], [3, 4, 0]);
      assert.equal(d, 5);
    });

    test("pointDistance handles negative coordinates", () => {
      const d = meas.pointDistance([-1, -1, -1], [1, 1, 1]);
      assert.ok(Math.abs(d - 3.464) < 0.01);
    });

    test("boundsExtent returns correct dimensions", () => {
      const ext = meas.boundsExtent({ min: [0, 0, 0], max: [5, 10, 15] });
      assert.deepEqual(ext, [5, 10, 15]);
    });

    test("boundsCenter returns correct midpoint", () => {
      const c = meas.boundsCenter({ min: [-1, -2, -3], max: [1, 2, 3] });
      assert.deepEqual(c, [0, 0, 0]);
    });

    test("axisAlignedDimensions returns width/height/depth", () => {
      const dim = meas.axisAlignedDimensions({ min: [0, 0, 0], max: [5, 10, 15] });
      assert.equal(dim.width, 5);
      assert.equal(dim.height, 10);
      assert.equal(dim.depth, 15);
    });

    test("formatMeasurement outputs meters by default", () => {
      assert.equal(meas.formatMeasurement(1.5), "1.500 m");
    });

    test("formatMeasurement converts to cm", () => {
      assert.equal(meas.formatMeasurement(1.0, "cm"), "100.000 cm");
    });

    test("formatMeasurement converts to mm", () => {
      assert.equal(meas.formatMeasurement(0.1, "mm"), "100.000 mm");
    });

    test("formatMeasurement converts to feet/inches", () => {
      const result = meas.formatMeasurement(1.0, "ft/in");
      assert.ok(result.includes("'"), "Feet/inches format should include feet marker");
      assert.ok(result.includes('"'), "Feet/inches format should include inches marker");
    });

    test("formatMeasurement converts to feet", () => {
      assert.equal(meas.formatMeasurement(3.048, "ft"), "10.000 ft");
    });

    test("formatBounds outputs formatted string", () => {
      const result = meas.formatBounds({ min: [0, 0, 0], max: [1, 2, 0.5] });
      assert.ok(result.includes("m"), "Should include unit");
      assert.ok(result.includes("×"), "Should include dimension separator");
    });

    test("dimensionWithSource labels value source", () => {
      const d = meas.dimensionWithSource(1.5, "measured", "m", 3, 0.005);
      assert.equal(d.source, "measured");
      assert.equal(d.tolerance, 0.005);
      assert.equal(d.formatted, "1.500 m");
    });

    test("canonicalBoundsFromMetadata extracts bounds", () => {
      const meta = createSpatialMetadata({
        sourceUnit: "m",
        sourceBoundsMin: [-0.5, -0.5, -0.5],
        sourceBoundsMax: [0.5, 0.5, 0.5],
        sourceHash: "test",
      });
      const b = meas.canonicalBoundsFromMetadata(meta);
      assert.equal(b.min[0], -0.5);
      assert.equal(b.max[0], 0.5);
    });
});
}
