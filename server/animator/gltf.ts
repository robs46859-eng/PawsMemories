import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { AssetMetadata, AnimationClipInfo } from "../../src/animator/types.ts";
import fs from "fs";

let isAvailable: boolean | null = null;
let functionsModule: any = null;

export async function checkAnimatorAvailable(): Promise<boolean> {
  if (isAvailable !== null) return isAvailable;
  try {
    functionsModule = await import("@gltf-transform/functions");
    isAvailable = true;
  } catch (e) {
    isAvailable = false;
  }
  return isAvailable;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export async function inspectAsset(absPath: string, originalFilename: string): Promise<AssetMetadata> {
  if (!(await checkAnimatorAvailable())) {
    throw new Error("ANIMATOR_UNAVAILABLE");
  }
  
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
      if (targetPath === 'weights' || targetPath.endsWith('.morphTargetInfluences')) {
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
  const bbox = scene && functionsModule ? functionsModule.getBounds(scene) : undefined;
  
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
  if (!(await checkAnimatorAvailable())) {
    throw new Error("ANIMATOR_UNAVAILABLE");
  }
  if (!["inspect", "pack", "unpack", "dedup", "prune"].includes(op)) {
    throw new Error(`Invalid safe operation: ${op}`);
  }
  
  const doc = await io.read(inAbs);
  const opsApplied: string[] = [];
  
  switch (op) {
    case "dedup":
      await doc.transform(functionsModule.dedup());
      opsApplied.push("dedup");
      break;
    case "prune":
      await doc.transform(functionsModule.prune());
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
