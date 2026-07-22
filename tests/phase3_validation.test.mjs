import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGlb } from "../server/model-builds/validation.ts";
import { createMinimalGlb } from "../server/model-builds/provider.ts";

describe("Phase 3 Post-Build GLB Validation Test Suite", () => {
  it("should pass a valid minimal GLB fixture", async () => {
    const glb = createMinimalGlb();
    const result = await validateGlb(glb);
    assert.equal(result.status, "pass");
    assert.ok(result.metrics.magicValid);
    assert.ok(result.metrics.versionValid);
    assert.equal(result.metrics.meshCount, 1);
    assert.equal(result.metrics.primitiveCount, 1);
    assert.equal(result.metrics.triangleCount, 1);
    assert.equal(result.metrics.vertexCount, 3);
    assert.ok(result.metrics.hasPositionAccessor);
    assert.ok(result.metrics.boundingBox);
    assert.equal(result.metrics.dimensions.unit, "unscaled");
    assert.equal(result.metrics.containsNaN, false);
    assert.equal(result.metrics.containsInfinity, false);
    assert.ok(/^[a-f0-9]{64}$/i.test(result.metricsHash));
  });

  it("should fail when magic bytes are invalid", async () => {
    const glb = createMinimalGlb();
    glb.writeUInt32LE(0x12345678, 0); // Corrupt magic
    const result = await validateGlb(glb);
    assert.equal(result.status, "fail");
    assert.equal(result.metrics.magicValid, false);
    assert.ok(result.metrics.errors.some(e => e.includes("Invalid GLB magic")));
  });

  it("should fail when GLB version is not 2", async () => {
    const glb = createMinimalGlb();
    glb.writeUInt32LE(1, 4); // Version 1
    const result = await validateGlb(glb);
    assert.equal(result.status, "fail");
    assert.equal(result.metrics.versionValid, false);
    assert.ok(result.metrics.errors.some(e => e.includes("Unsupported GLB version")));
  });

  it("should fail when buffer is too small (< 12 bytes)", async () => {
    const glb = Buffer.from([0x46, 0x54, 0x6c, 0x67]);
    const result = await validateGlb(glb);
    assert.equal(result.status, "fail");
    assert.ok(result.metrics.errors.some(e => e.includes("too small")));
  });

  it("should generate deterministic metricsHash for identical GLB", async () => {
    const glb1 = createMinimalGlb();
    const glb2 = createMinimalGlb();
    const res1 = await validateGlb(glb1);
    const res2 = await validateGlb(glb2);
    assert.equal(res1.metricsHash, res2.metricsHash);
  });

  it("should fail when the declared GLB length does not exactly match the bytes", async () => {
    const glb = createMinimalGlb();
    glb.writeUInt32LE(glb.length - 4, 8);
    const result = await validateGlb(glb);
    assert.equal(result.status, "fail");
    assert.ok(result.metrics.errors.some((error) => error.includes("does not equal actual")));
  });
});
