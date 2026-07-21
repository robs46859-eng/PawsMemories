import * as THREE from "three";
import { BIPED_SET, QUADRUPED_SET, WINGED_SET } from "./animationSets.ts";

type Axis = "x" | "y" | "z";
type BoneMotion = { aliases: string[]; axis: Axis; degrees: number[] };

const timesFor = (count: number, duration: number) =>
  Array.from({ length: count }, (_, index) => (duration * index) / Math.max(1, count - 1));

function findBone(root: THREE.Object3D, aliases: string[]): THREE.Bone | null {
  for (const alias of aliases) {
    const exact = root.getObjectByName(alias);
    if (exact instanceof THREE.Bone) return exact;
  }
  const normalized = aliases.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  let match: THREE.Bone | null = null;
  root.traverse((node) => {
    if (match || !(node instanceof THREE.Bone)) return;
    const candidate = node.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized.some((name) => candidate === name || candidate.endsWith(name))) match = node;
  });
  return match;
}

function quaternionTrack(root: THREE.Object3D, motion: BoneMotion, duration: number) {
  const bone = findBone(root, motion.aliases);
  if (!bone) return null;
  const axis = motion.axis === "x" ? new THREE.Vector3(1, 0, 0) : motion.axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const values: number[] = [];
  for (const degrees of motion.degrees) {
    const q = bone.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees)));
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, timesFor(motion.degrees.length, duration), values);
}

function clip(root: THREE.Object3D, name: string, duration: number, motions: BoneMotion[]): THREE.AnimationClip | null {
  const tracks = motions.map((motion) => quaternionTrack(root, motion, duration)).filter(Boolean) as THREE.KeyframeTrack[];
  return tracks.length ? new THREE.AnimationClip(name, duration, tracks) : null;
}

const head = ["head", "Head"];
const neck = ["neck", "Neck"];
const chest = ["chest", "Chest", "spine2", "Spine2"];
const hips = ["hips", "Hips", "pelvis", "Pelvis"];
const jaw = ["jaw", "Jaw"];
const leftFront = ["front_leg_upper.L", "upperarm.L", "LeftArm", "arm.L"];
const rightFront = ["front_leg_upper.R", "upperarm.R", "RightArm", "arm.R"];
const leftBack = ["back_leg_upper.L", "thigh.L", "LeftUpLeg"];
const rightBack = ["back_leg_upper.R", "thigh.R", "RightUpLeg"];
const leftWing = ["wing_inner.L", "wing.L", "Wing.L", "left_wing"];
const rightWing = ["wing_inner.R", "wing.R", "Wing.R", "right_wing"];

function motionsFor(name: string): { duration: number; motions: BoneMotion[] } {
  const cycle = [-18, 18, -18, 18, -18];
  switch (name) {
    case "walk": return { duration: 1.2, motions: [
      { aliases: leftFront, axis: "x", degrees: cycle }, { aliases: rightFront, axis: "x", degrees: cycle.map((v) => -v) },
      { aliases: leftBack, axis: "x", degrees: cycle.map((v) => -v) }, { aliases: rightBack, axis: "x", degrees: cycle },
    ] };
    case "run": return { duration: 0.65, motions: [
      { aliases: leftFront, axis: "x", degrees: cycle.map((v) => v * 1.8) }, { aliases: rightFront, axis: "x", degrees: cycle.map((v) => -v * 1.8) },
      { aliases: leftBack, axis: "x", degrees: cycle.map((v) => -v * 1.8) }, { aliases: rightBack, axis: "x", degrees: cycle.map((v) => v * 1.8) },
      { aliases: chest, axis: "x", degrees: [0, 6, 0, 6, 0] },
    ] };
    case "head_tilt": case "head_nod": return { duration: 1.5, motions: [{ aliases: head, axis: name === "head_nod" ? "x" : "z", degrees: [0, 18, 0, -10, 0] }] };
    case "tail_wave": return { duration: 0.8, motions: [
      { aliases: ["tail_01", "Tail1"], axis: "z", degrees: [0, 24, -24, 24, 0] },
      { aliases: ["tail_02", "Tail2"], axis: "z", degrees: [0, -30, 30, -30, 0] },
    ] };
    case "ear_flick": return { duration: 0.7, motions: [{ aliases: ["ear.L", "Ear.L"], axis: "x", degrees: [0, 16, 0, -8, 0] }, { aliases: ["ear.R", "Ear.R"], axis: "x", degrees: [0, -16, 0, 8, 0] }] };
    case "play-bow": return { duration: 1.4, motions: [{ aliases: chest, axis: "x", degrees: [0, 22, 22, 0] }, { aliases: neck, axis: "x", degrees: [0, -18, -18, 0] }] };
    case "sit": return { duration: 1.6, motions: [{ aliases: hips, axis: "x", degrees: [0, -18, -18, 0] }, { aliases: leftBack, axis: "x", degrees: [0, 48, 48, 0] }, { aliases: rightBack, axis: "x", degrees: [0, 48, 48, 0] }] };
    case "lie": case "roost": return { duration: 2, motions: [{ aliases: hips, axis: "x", degrees: [0, -30, -30, 0] }, { aliases: chest, axis: "x", degrees: [0, 18, 18, 0] }] };
    case "yawn": case "bark_speak": case "growl": return { duration: 1.1, motions: [{ aliases: jaw, axis: "x", degrees: [0, 18, 4, 22, 0] }, { aliases: head, axis: "x", degrees: [0, -8, 2, -6, 0] }] };
    case "paw_offer": case "point": return { duration: 1.4, motions: [{ aliases: leftFront, axis: "x", degrees: [0, -58, -58, 0] }] };
    case "beg": return { duration: 1.5, motions: [{ aliases: leftFront, axis: "x", degrees: [0, -55, -55, 0] }, { aliases: rightFront, axis: "x", degrees: [0, -55, -55, 0] }, { aliases: chest, axis: "x", degrees: [0, -14, -14, 0] }] };
    case "roll_over": return { duration: 2, motions: [{ aliases: hips, axis: "y", degrees: [0, 90, 180, 270, 360] }, { aliases: chest, axis: "y", degrees: [0, 90, 180, 270, 360] }] };
    case "shake": case "scratch": return { duration: 0.8, motions: [{ aliases: head, axis: "z", degrees: [0, 24, -24, 24, -24, 0] }, { aliases: chest, axis: "z", degrees: [0, -8, 8, -8, 8, 0] }] };
    case "wave": case "wing_wave": return { duration: 1.2, motions: [{ aliases: name === "wing_wave" ? leftWing : leftFront, axis: "z", degrees: [0, 55, 25, 55, 25, 0] }] };
    case "talk_gesture": case "laugh": return { duration: 1.3, motions: [{ aliases: leftFront, axis: "z", degrees: [0, 20, -8, 16, 0] }, { aliases: rightFront, axis: "z", degrees: [0, -20, 8, -16, 0] }, { aliases: head, axis: "x", degrees: [0, 6, 0, 4, 0] }] };
    case "clap": return { duration: 0.9, motions: [{ aliases: leftFront, axis: "z", degrees: [0, -45, 0, -45, 0] }, { aliases: rightFront, axis: "z", degrees: [0, 45, 0, 45, 0] }] };
    case "fly": case "hover": return { duration: name === "fly" ? 0.75 : 0.55, motions: [{ aliases: leftWing, axis: "x", degrees: [0, 48, -30, 48, 0] }, { aliases: rightWing, axis: "x", degrees: [0, -48, 30, -48, 0] }] };
    case "land": return { duration: 1.4, motions: [{ aliases: leftWing, axis: "x", degrees: [35, 15, 0] }, { aliases: rightWing, axis: "x", degrees: [-35, -15, 0] }] };
    case "preen": case "peck": return { duration: 1.2, motions: [{ aliases: neck, axis: "x", degrees: [0, 35, 12, 35, 0] }, { aliases: head, axis: "z", degrees: [0, 18, 0, -12, 0] }] };
    default: return { duration: 2, motions: [{ aliases: chest, axis: "x", degrees: [0, 3, 0, -2, 0] }, { aliases: head, axis: "y", degrees: [0, 2, 0, -2, 0] }] };
  }
}

/** Build lightweight runtime clips when a rigged GLB contains bones but no baked motion. */
export function createProceduralClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const boneNames = new Set<string>();
  root.traverse((node) => { if (node instanceof THREE.Bone) boneNames.add(node.name.toLowerCase()); });
  if (boneNames.size === 0) return [];
  const isWinged = [...boneNames].some((name) => name.includes("wing"));
  const isBiped = !isWinged && [...boneNames].some((name) => name.includes("upperarm") || name.includes("shoulder"));
  const expected = isWinged ? WINGED_SET.expectedClips : isBiped ? BIPED_SET.expectedClips : QUADRUPED_SET.expectedClips;
  return expected.map((name) => {
    const definition = motionsFor(name);
    return clip(root, name, definition.duration, definition.motions);
  }).filter(Boolean) as THREE.AnimationClip[];
}
