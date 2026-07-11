import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { SKELETON_CONTRACTS } from "../../../skeletonContract.ts";

/**
 * Retargets an AnimationClip from a source rig to a target rig.
 * Uses SkeletonUtils.retargetClip but applies bone name normalization
 * and fixes the common off-by-one frame issue at the end of the clip.
 */
export function retargetClip(
  targetMesh: THREE.SkinnedMesh,
  sourceMesh: THREE.SkinnedMesh,
  clip: THREE.AnimationClip,
  skeletonType: "quadruped" | "biped"
): THREE.AnimationClip {
  
  // Build a name mapping if target bone names slightly differ from source
  // For CC0 library clips, we assume source follows SKELETON_CONTRACTS exactly.
  // We'll map the target mesh's bones to the source names based on simple substring matching or direct lookup.
  const contract = SKELETON_CONTRACTS[skeletonType];
  const nameMap: Record<string, string> = {};
  
  if (targetMesh.skeleton && sourceMesh.skeleton) {
    for (const tgtBone of targetMesh.skeleton.bones) {
      // Find matching bone in the contract (which the source rig uses)
      const srcName = contract.allBones.find(b => tgtBone.name.includes(b) || b.includes(tgtBone.name));
      if (srcName) {
        nameMap[tgtBone.name] = srcName;
      } else {
        nameMap[tgtBone.name] = tgtBone.name;
      }
    }
  }

  const options = {
    useFirstFramePosition: true,
    names: nameMap
  };

  const retargeted = SkeletonUtils.retargetClip(targetMesh, sourceMesh, clip, options);
  
  // Pad the missing frame (off-by-one issue)
  // Find the max time across all tracks, and ensure all tracks extend to that duration
  let maxTime = 0;
  for (const track of retargeted.tracks) {
    if (track.times.length > 0) {
      maxTime = Math.max(maxTime, track.times[track.times.length - 1]);
    }
  }
  
  for (const track of retargeted.tracks) {
    if (track.times.length > 0) {
      const lastTime = track.times[track.times.length - 1];
      if (lastTime < maxTime) {
        // Pad by duplicating the last frame's values at maxTime
        const newTimes = new Float32Array(track.times.length + 1);
        newTimes.set(track.times);
        newTimes[track.times.length] = maxTime;
        track.times = newTimes;

        const valueSize = track.getValueSize();
        const newValues = new Float32Array(track.values.length + valueSize);
        newValues.set(track.values);
        for (let i = 0; i < valueSize; i++) {
          newValues[track.values.length + i] = track.values[track.values.length - valueSize + i];
        }
        track.values = newValues;
      }
    }
  }
  
  retargeted.duration = maxTime;
  
  return retargeted;
}
