import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, getBounds } from "@gltf-transform/functions";
import type { AssetMetadata, AnimationClipInfo } from "../../src/animator/types.ts";
import fs from "fs";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export async function inspectAsset(absPath: string, originalFilename: string): Promise<AssetMetadata> {
  const doc = await io.read(absPath);
  const root = doc.getRoot();
  
  const animations: AnimationClipInfo[] = [];
  
  root.listAnimations().forEach((anim, index) => {
    let duration = 0;
    let tracksMorph = false;
    
    for (const channel of anim.listChannels()) {
      const sampler = channel.getSampler();
      if (!sampler) continue;
      
      const input = sampler.getInput();
      if (input) {
        // According to gltf-transform docs, getMinMax might not be available if min/max aren't defined in the accessor,
        // but typically time accessors have them. We should calculate max if minMax is null.
        let maxTime = 0;
        const count = input.getCount();
        if (count > 0) {
          maxTime = input.getScalar(count - 1);
        }
        if (maxTime > duration) duration = maxTime;
      }
      
      const targetPath = channel.getTargetPath();
      if (targetPath === 'weights') {
        tracksMorph = true;
      }
    }
    
    animations.push({
      name: anim.getName() || `Animation_${index}`,
      index,
      duration,
      channelCount: anim.listChannels().length,
      tracksMorph
    });
  });
  
  const meshes = root.listMeshes();
  let morphTargetCount = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      morphTargetCount += prim.listTargets().length;
    }
  }

  const format = absPath.toLowerCase().endsWith(".gltf") ? "gltf" : "glb";
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const bbox = scene ? getBounds(scene) : undefined;
  
  let sizeBytes = 0;
  if (fs.existsSync(absPath)) {
    sizeBytes = fs.statSync(absPath).size;
  }
  
  return {
    id: "", // Caller fills this
    originalFilename,
    format,
    sizeBytes,
    createdAt: new Date().toISOString(),
    animations,
    meshCount: meshes.length,
    primitiveCount: meshes.reduce((acc, m) => acc + m.listPrimitives().length, 0),
    materialCount: root.listMaterials().length,
    textureCount: root.listTextures().length,
    morphTargetCount,
    hasSkin: root.listSkins().length > 0,
    boundingBox: bbox ? { min: bbox.min as [number, number, number], max: bbox.max as [number, number, number] } : undefined
  };
}

export type SafeOp = "inspect" | "pack" | "unpack" | "dedup" | "prune";

export async function runSafe(op: SafeOp, inAbs: string, outAbs: string): Promise<string[]> {
  if (!["inspect", "pack", "unpack", "dedup", "prune"].includes(op)) {
    throw new Error(`Invalid safe operation: ${op}`);
  }
  
  const doc = await io.read(inAbs);
  const opsApplied: string[] = [];
  
  switch (op) {
    case "dedup":
      await doc.transform(dedup());
      opsApplied.push("dedup");
      break;
    case "prune":
      await doc.transform(prune());
      opsApplied.push("prune");
      break;
    case "pack":
      opsApplied.push("pack");
      break;
    case "unpack":
      opsApplied.push("unpack");
      break;
    case "inspect":
      return ["inspect"];
  }
  
  await io.write(outAbs, doc);
  return opsApplied;
}
