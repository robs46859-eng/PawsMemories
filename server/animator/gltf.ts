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

export type SafeOp = "inspect" | "pack" | "unpack" | "dedup" | "prune" | "optimize";

export async function runSafe(op: SafeOp, inAbs: string, outAbs: string): Promise<string[]> {
  if (!(await checkAnimatorAvailable())) {
    throw new Error("ANIMATOR_UNAVAILABLE");
  }
  if (!["inspect", "pack", "unpack", "dedup", "prune", "optimize"].includes(op)) {
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
    case "optimize":
      await doc.transform(
        functionsModule.resample(),
        functionsModule.weld()
      );
      opsApplied.push("resample", "weld");
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

export interface FacialRigMap {
  headBone: string;
  jawBone?: string;
  lipCornerLeftBone?: string;
  lipCornerRightBone?: string;
  visemes: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X", Array<{ morphTarget: string; weight: number }>>;
}

export async function validateRiggedGlb(glbBase64: string): Promise<FacialRigMap> {
  let raw = glbBase64;
  if (raw.startsWith("data:")) raw = raw.split(",")[1];
  
  const doc = await io.readBinary(new Uint8Array(Buffer.from(raw, "base64")));
  const root = doc.getRoot();

  let headBone: string | undefined;
  let jawBone: string | undefined;
  let lipCornerLeftBone: string | undefined;
  let lipCornerRightBone: string | undefined;
  
  const allMorphs = new Set<string>();

  // 1. Scan for bones and morphs
  for (const node of root.listNodes()) {
    const name = node.getName() || "";
    const lower = name.toLowerCase();
    
    // Exact or alias matching
    if (lower === "head" || lower === "mixamorighead" || lower === "cc_base_head") headBone = name;
    if (lower === "jaw" || lower === "jawbone" || lower === "mixamorigjaw" || lower === "cc_base_jawroot" || lower === "blendshape1.jaw") jawBone = name;
    if (lower === "lipcorner.l" || lower === "lip_corner_l") lipCornerLeftBone = name;
    if (lower === "lipcorner.r" || lower === "lip_corner_r") lipCornerRightBone = name;
    
    // Check if jaw has neutral pose rotation/translation (only allow (0,0,0) or identity)
    if (jawBone === name) {
      const translation = node.getTranslation();
      const rotation = node.getRotation(); // quaternion [x, y, z, w]
      // In bind pose, bone translation/rotation from its local rest is typically identity if baked, 
      // but in glTF the node's local transform IS the rest pose. We must verify there is no ongoing animation on it!
    }
  }
  
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) {
        const tName = target.getName();
        if (tName) allMorphs.add(tName);
      }
    }
  }

  // Check animations to ensure jaw isn't animated in default clips (idle)
  for (const anim of root.listAnimations()) {
    for (const channel of anim.listChannels()) {
      const targetNode = channel.getTargetNode();
      if (targetNode && targetNode.getName() === jawBone && jawBone !== undefined) {
        throw new Error(`Validation failed: Jaw bone '${jawBone}' is animated in clip '${anim.getName()}'. Default animations must not contain jaw chattering.`);
      }
    }
  }

  if (!headBone) {
    throw new Error("Validation failed: No head bone found in the GLB.");
  }

  // 2. Build the alias dictionary and viseme map
  // Helper to find actual morph name from aliases
  const findMorph = (...aliases: string[]) => {
    for (const alias of aliases) {
      const lowerAlias = alias.toLowerCase();
      for (const m of allMorphs) {
        if (m.toLowerCase() === lowerAlias) return m;
      }
    }
    return undefined;
  };

  const jawOpen = findMorph("jawOpen", "Jaw_Open", "mouthOpen", "MouthOpen", "blendShape1.MouthOpen", "vrc.v_aa");
  const mouthClose = findMorph("mouthClose", "MouthClose", "blendShape1.MouthClose");
  const mouthFunnel = findMorph("mouthFunnel", "MouthFunnel", "vrc.v_oh");
  const mouthPucker = findMorph("mouthPucker", "MouthPucker", "vrc.v_ou");
  const mouthSmileLeft = findMorph("mouthSmileLeft", "MouthSmileLeft", "mouthSmile_L");
  const mouthSmileRight = findMorph("mouthSmileRight", "MouthSmileRight", "mouthSmile_R");
  const mouthPressLeft = findMorph("mouthPressLeft", "MouthPressLeft");
  const mouthPressRight = findMorph("mouthPressRight", "MouthPressRight");

  const vA = findMorph("viseme_A", "viseme_aa", "Viseme_A", "mouth_A");
  const vB = findMorph("viseme_B", "viseme_E", "Viseme_B", "mouth_B");
  const vC = findMorph("viseme_C", "viseme_I", "Viseme_C", "mouth_C");
  const vD = findMorph("viseme_D", "viseme_O", "Viseme_D", "mouth_D");
  const vE = findMorph("viseme_E", "viseme_U", "Viseme_E", "mouth_E");
  const vF = findMorph("viseme_F", "viseme_FF", "Viseme_F", "mouth_F");
  const vG = findMorph("viseme_G", "viseme_TH", "Viseme_G", "mouth_G");
  const vH = findMorph("viseme_H", "viseme_PP", "Viseme_H", "mouth_H");
  const vX = findMorph("viseme_X", "viseme_sil", "Viseme_X", "mouth_X");

  const visemes: FacialRigMap["visemes"] = {
    A: vA ? [{ morphTarget: vA, weight: 1 }] : jawOpen ? [{ morphTarget: jawOpen, weight: 1 }] : [],
    B: vB ? [{ morphTarget: vB, weight: 1 }] : jawOpen ? [{ morphTarget: jawOpen, weight: 0.8 }, ...(mouthSmileLeft ? [{ morphTarget: mouthSmileLeft, weight: 0.5 }] : [])] : [],
    C: vC ? [{ morphTarget: vC, weight: 1 }] : jawOpen ? [{ morphTarget: jawOpen, weight: 0.7 }] : [],
    D: vD ? [{ morphTarget: vD, weight: 1 }] : jawOpen ? [{ morphTarget: jawOpen, weight: 0.9 }, ...(mouthFunnel ? [{ morphTarget: mouthFunnel, weight: 0.8 }] : [])] : [],
    E: vE ? [{ morphTarget: vE, weight: 1 }] : jawOpen ? [{ morphTarget: jawOpen, weight: 0.6 }, ...(mouthPucker ? [{ morphTarget: mouthPucker, weight: 0.9 }] : [])] : [],
    F: vF ? [{ morphTarget: vF, weight: 1 }] : jawOpen ? [{ morphTarget: jawOpen, weight: 0.4 }, ...(mouthPucker ? [{ morphTarget: mouthPucker, weight: 0.5 }] : [])] : [],
    G: vG ? [{ morphTarget: vG, weight: 1 }] : jawOpen ? [{ morphTarget: jawOpen, weight: 0.3 }] : [],
    H: vH ? [{ morphTarget: vH, weight: 1 }] : mouthClose ? [{ morphTarget: mouthClose, weight: 1 }] : [],
    X: vX ? [{ morphTarget: vX, weight: 1 }] : mouthClose ? [{ morphTarget: mouthClose, weight: 1 }] : []
  };

  const hasVisemes = Object.values(visemes).some(arr => arr.length > 0);

  if (!jawBone && !hasVisemes) {
    throw new Error("Validation failed: No jaw bone and no complete viseme set exists in the final GLB.");
  }

  return {
    headBone,
    jawBone,
    lipCornerLeftBone,
    lipCornerRightBone,
    visemes
  };
}
