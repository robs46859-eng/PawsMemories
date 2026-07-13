/** Generate deterministic, meter-authored GLB fixtures. */
import { Document, NodeIO } from "@gltf-transform/core";
import fs from "node:fs";
import path from "node:path";

const directory = new URL("../fixtures/", import.meta.url).pathname;
fs.mkdirSync(directory, { recursive: true });
const io = new NodeIO();

async function createCube(size, name, sourceUnit) {
  const document = new Document();
  document.getRoot().getAsset().generator = "Pawsome3D fixture generator";
  document.createBuffer();
  const half = size / 2;
  const positions = new Float32Array([
    -half,-half,half, half,-half,half, half,half,half, -half,-half,half, half,half,half, -half,half,half,
    -half,-half,-half, -half,half,-half, half,half,-half, -half,-half,-half, half,half,-half, half,-half,-half,
    -half,half,-half, -half,half,half, half,half,half, -half,half,-half, half,half,half, half,half,-half,
    -half,-half,-half, half,-half,-half, half,-half,half, -half,-half,-half, half,-half,half, -half,-half,half,
    half,-half,-half, half,half,-half, half,half,half, half,-half,-half, half,half,half, half,-half,half,
    -half,-half,-half, -half,-half,half, -half,half,half, -half,-half,-half, -half,half,half, -half,half,-half,
  ]);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setArray(positions).setType("VEC3"))
    .setIndices(document.createAccessor().setArray(new Uint16Array(Array.from({ length: 36 }, (_, index) => index))).setType("SCALAR"));
  primitive.setMaterial(document.createMaterial("Fixture gray").setBaseColorFactor([0.45, 0.48, 0.5, 1]));
  const mesh = document.createMesh(name).addPrimitive(primitive);
  document.createScene("default").addChild(document.createNode(name).setMesh(mesh));
  const output = path.join(directory, `${name}.glb`);
  await io.write(output, document);
  return { path: `${name}.glb`, sourceUnit, canonicalUnit: "m", expectedBounds: { min: [-half, -half, -half], max: [half, half, half] } };
}

const fixtures = [
  await createCube(1, "1m-cube", "m"),
  await createCube(10, "10m-cube", "m"),
  await createCube(0.1, "100mm-cube", "mm"),
];
fs.writeFileSync(path.join(directory, "glb-manifest.json"), JSON.stringify({ generatedBy: "scripts/generate-bim-fixtures.mjs", fixtures }, null, 2));
