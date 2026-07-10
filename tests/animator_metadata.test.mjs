import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";
import { Document, NodeIO } from "@gltf-transform/core";
import { inspectAsset } from "../server/animator/gltf.ts";

test("animator_metadata", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "animator-metadata-"));
  const docPath = path.join(tmpDir, "test.glb");

  await t.test("extracts metadata from Document", async () => {
    // Construct a minimal in-memory Document instead of committing a binary fixture
    const doc = new Document();
    
    // Add a mesh and primitive
    const buffer = doc.createBuffer();
    const position = doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array([0,0,0, 1,1,1, 2,2,2]));
    const targetPosition = doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array([0,1,0, 1,2,1, 2,3,2]));
    
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", position)
      .addTarget(doc.createPrimitiveTarget().setAttribute("POSITION", targetPosition));
      
    const mesh = doc.createMesh().addPrimitive(prim);
    const node = doc.createNode().setMesh(mesh);
    const scene = doc.createScene().addChild(node);
    doc.createSkin().setSkeleton(node);
    
    // Add an animation
    const animInput = doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Float32Array([0, 1, 2.5]));
    const animOutput = doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Float32Array([0, 0.5, 1]));
    const sampler = doc.createAnimationSampler().setInput(animInput).setOutput(animOutput);
    const channel = doc.createAnimationChannel().setTargetPath("weights").setTargetNode(node).setSampler(sampler);
    doc.createAnimation().setName("WalkCycle").addSampler(sampler).addChannel(channel);

    // Write it out
    const io = new NodeIO();
    await io.write(docPath, doc);

    // Inspect
    const meta = await inspectAsset(docPath, "test.glb");
    
    // Asserts
    assert.strictEqual(meta.format, "glb");
    assert.strictEqual(meta.meshCount, 1);
    assert.strictEqual(meta.primitiveCount, 1);
    assert.strictEqual(meta.morphTargetCount, 1);
    assert.strictEqual(meta.hasSkin, true);
    
    assert.strictEqual(meta.animations.length, 1);
    assert.strictEqual(meta.animations[0].name, "WalkCycle");
    assert.strictEqual(meta.animations[0].duration, 2.5); // max of [0, 1, 2.5]
    assert.strictEqual(meta.animations[0].tracksMorph, true); // targets "weights"
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
