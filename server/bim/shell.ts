import { Document, NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";
import type { BimElement, BimModel, Point3 } from "../../src/bim/model";

const COLORS: Record<string, [number, number, number, number]> = {
  wall: [0.79, 0.36, 0.23, 1], slab: [0.45, 0.5, 0.52, 1], roof: [0.48, 0.24, 0.18, 1],
  door: [0.52, 0.34, 0.18, 1], window: [0.25, 0.65, 0.78, 0.65], column: [0.78, 0.62, 0.28, 1], beam: [0.8, 0.55, 0.25, 1],
};

function transformFor(item: BimElement): { scale: Point3; translation: Point3; rotation?: [number, number, number, number] } | null {
  if (item.type === "opening" || item.type === "space") return null;
  const [x, y, z] = item.position;
  let width = item.width || 1;
  const depth = item.depth || item.thickness || 0.2;
  const height = item.height || 1;
  if (item.type === "wall" && item.end) {
    const dx = item.end[0] - x;
    const dy = item.end[1] - y;
    width = Math.hypot(dx, dy);
    const angle = -Math.atan2(dy, dx);
    return {
      scale: [width, height, depth],
      translation: [(x + item.end[0]) / 2, z + height / 2, (y + item.end[1]) / 2],
      rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
    };
  }
  return { scale: [width, height, depth], translation: [x + width / 2, z + height / 2, y + depth / 2] };
}

export async function buildAndVerifyShell(model: BimModel): Promise<{ glbBase64: string; verification: Record<string, unknown> }> {
  const document = new Document();
  document.getRoot().getAsset().generator = "Pawsome3D verified shell builder";
  document.createBuffer();
  const positions = document.createAccessor("unit-cube-positions").setType("VEC3").setArray(new Float32Array([
    -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
    -0.5,-0.5,-0.5, -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,-0.5,-0.5,
  ]));
  const indices = document.createAccessor("unit-cube-indices").setType("SCALAR").setArray(new Uint16Array([
    0,1,2,0,2,3, 4,5,6,4,6,7, 3,2,6,3,6,5, 4,7,1,4,1,0, 1,7,6,1,6,2, 4,0,3,4,3,5,
  ]));
  const scene = document.createScene(model.name);
  let renderedElements = 0;
  for (const item of model.elements) {
    const transform = transformFor(item);
    if (!transform) continue;
    const material = document.createMaterial(item.type).setBaseColorFactor(COLORS[item.type] || [0.6, 0.6, 0.58, 1]);
    if (item.type === "window") material.setAlphaMode("BLEND");
    const primitive = document.createPrimitive().setAttribute("POSITION", positions).setIndices(indices).setMaterial(material);
    const node = document.createNode(item.id).setMesh(document.createMesh(item.name).addPrimitive(primitive)).setScale(transform.scale).setTranslation(transform.translation);
    if (transform.rotation) node.setRotation(transform.rotation);
    scene.addChild(node);
    renderedElements += 1;
  }
  if (!renderedElements) throw new Error("Shell contains no renderable elements");
  const expectedBounds = getBounds(scene);
  const io = new NodeIO();
  const bytes = await io.writeBinary(document);

  // Post-build verification parses the delivered bytes rather than trusting the authoring document.
  const reopened = await io.readBinary(bytes);
  const outputScene = reopened.getRoot().listScenes()[0];
  const bounds = outputScene ? getBounds(outputScene) : null;
  const meshCount = reopened.getRoot().listMeshes().length;
  const finiteBounds = !!bounds && [...bounds.min, ...bounds.max].every(Number.isFinite);
  const dimensionsPreserved = !!bounds && [0, 1, 2].every((axis) =>
    Math.abs(bounds.min[axis] - expectedBounds.min[axis]) < 1e-5
    && Math.abs(bounds.max[axis] - expectedBounds.max[axis]) < 1e-5
  );
  const passed = meshCount === renderedElements && finiteBounds && dimensionsPreserved && bytes.byteLength > 20;
  if (!passed) throw new Error("Shell failed post-build GLB verification");
  return {
    glbBase64: Buffer.from(bytes).toString("base64"),
    verification: {
      stage: "post-build", passed, format: "glb-shell", meshCount, renderedElements,
      bounds: bounds ? { min: [...bounds.min], max: [...bounds.max] } : null, dimensionsPreserved,
      sizeBytes: bytes.byteLength,
    },
  };
}
