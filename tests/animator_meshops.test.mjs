import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  eulerCharacteristic, expectedEulerCharacteristic, impliedTriangleEdgeCount,
  checkTopology, planLodChain, checkLodResult, MIN_TRIANGLES_FOR_LODS,
} from "../server/animator/meshops.ts";

describe("ANIM-MESH-02 topology gate", () => {
  test("closed triangulated sphere-like mesh has chi = 2", () => {
    // Octahedron: V=6, F=8, E=12 → χ=2 (c=1, g=0, b=0)
    const summary = { vertexCount: 6, edgeCount: 12, faceCount: 8 };
    assert.equal(eulerCharacteristic(summary), 2);
    assert.equal(impliedTriangleEdgeCount(8), 12);
    const check = checkTopology(summary, { components: 1, genus: 0, boundaries: 0 });
    assert.equal(check.pass, true);
  });
  test("torus and multi-component expectations", () => {
    assert.equal(expectedEulerCharacteristic({ components: 1, genus: 1, boundaries: 0 }), 0);
    assert.equal(expectedEulerCharacteristic({ components: 2, genus: 0, boundaries: 0 }), 4);
  });
  test("unexpected junk geometry fails with a named detail", () => {
    // Sphere + hidden enclosed cube: c=2 → χ should be 4, but expectation says one body.
    const check = checkTopology({ vertexCount: 14, edgeCount: 30, faceCount: 20 }, { components: 1, genus: 0, boundaries: 0 });
    assert.equal(check.pass, false);
    assert.match(check.detail, /holes, handles, or disconnected junk/);
  });
});

describe("ANIM-MESH-01 LOD chain planning", () => {
  test("plans the 100/50/15/5 chain with monotonic budgets", () => {
    const chain = planLodChain(100000);
    assert.deepEqual(chain.map((l) => l.level), [0, 1, 2, 3]);
    assert.deepEqual(chain.map((l) => l.targetTriangles), [100000, 50000, 15000, 5000]);
    for (let i = 1; i < chain.length; i += 1) {
      assert.ok(chain[i].screenErrorThreshold > chain[i - 1].screenErrorThreshold);
      assert.ok(chain[i].maxMeanQuadricError > chain[i - 1].maxMeanQuadricError);
    }
  });
  test("small meshes stay LOD0-only", () => {
    const chain = planLodChain(MIN_TRIANGLES_FOR_LODS - 1);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].level, 0);
  });
  test("rejects invalid triangle counts", () => {
    assert.throws(() => planLodChain(0));
    assert.throws(() => planLodChain(Number.NaN));
  });
  test("checkLodResult enforces triangle and quadric budgets", () => {
    const [, lod1] = planLodChain(100000);
    assert.equal(checkLodResult(lod1, 50500, 5e-7).pass, true);
    assert.equal(checkLodResult(lod1, 70000, 5e-7).pass, false, "triangle overshoot fails");
    assert.equal(checkLodResult(lod1, 50000, 5e-6).pass, false, "quadric overshoot fails");
  });
});
