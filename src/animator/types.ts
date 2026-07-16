export type AssetId = string;
export type JobId = string;
export type ProjectId = string;

export interface AssetMetadata {
  id: AssetId;
  userPhone?: string;
  originalFilename: string;
  format: "glb" | "gltf";
  sizeBytes: number;
  createdAt: string;
  animations: AnimationClipInfo[];
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  morphTargetCount: number;
  hasSkin: boolean;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  /** Optional spatial metadata for authoritative scale/coordinate info. */
  spatialMetadata?: {
    sourceUnit: string;
    metersPerSourceUnit: number;
    canonicalBoundsMin: [number, number, number];
    canonicalBoundsMax: [number, number, number];
    physicalScale: number;
    displayScale: number;
    accuracyClass: string;
    calibrationMethod: string;
    sourceHash: string;
    createdAt: string;
  };
}

export interface AnimationClipInfo {
  name: string;
  index: number;
  duration: number;
  channelCount: number;
  tracksMorph: boolean;
}

export type JobType = "inspect" | "convert" | "optimize" | "rig" | "retarget" | "repurpose" | "lipsync" | "reconstruct" | "bake";
export interface JobSpec {
  id: JobId;
  userPhone: string;
  assetId: AssetId;
  type: JobType;
  preset: "safe" | "optimize";
  params: Record<string, unknown>;
  createdAt: string;
}

export type JobState = "pending" | "running" | "done" | "failed";
export interface JobRecord extends JobSpec {
  state: JobState;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  manifestPath?: string;
}

export interface ConversionManifest {
  jobId: JobId;
  assetId: AssetId;
  preset: "safe" | "optimize";
  inputs: { path: string; sha256: string; bytes: number; preserved: true }[];
  outputs: { path: string; bucketUrl?: string; op: string; bytes: number; sha256: string }[];
  operations: string[];
  lossless: boolean;
  createdAt: string;
}

export interface SceneActor {
  actorId: string;
  assetId: AssetId;
  label: string;
  transform: { position: [number, number, number]; rotation: [number, number, number]; scale: number };
  selectedClip?: string;
  visible: boolean;
}

export interface SequenceStep {
  actorId: string;
  clip: string;
  loops?: number;
  hardCut?: boolean;
}

export interface CameraBookmark {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface SceneController {
  listActors(): SceneActor[];
  addActor(assetId: AssetId, opts?: Partial<SceneActor>): Promise<string>;
  removeActor(actorId: string): void;
  getActorController(actorId: string): AnimationController | undefined;
  getActorRoot(actorId: string): any; // THREE.Object3D
  applyIK(actorId: string, options: { groundIK: boolean; lookAtCamera: boolean; cameraPosition?: any }): void;
  setActorBehavior(actorId: string, action: import("../types.ts").BehaviorAction, needs: import("../types.ts").AvatarNeeds): void;
  setActorLipSyncPlayer(actorId: string, player: { update(): void; dispose(): void } | null): void;
  setActiveActor(actorId: string): void;
  playAll(): void;
  pauseAll(): void;
  stopAll(): void;
  seekAll(seconds: number): void;
  setGlobalSpeed(multiplier: number): void;
  update(delta: number): void;
  dispose(): void;
}

export interface AnimationController {
  listClips(): AnimationClipInfo[];
  selectClip(name: string, crossFadeSeconds?: number): void;
  addClip(clip: any): void; // THREE.AnimationClip
  play(): void;
  pause(): void;
  stop(): void;
  setLoop(loop: boolean): void;
  setSpeed(multiplier: number): void;
  seek(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  resetToBindPose(): void;
  update(delta: number): void;
  dispose(): void;
  listMorphTargets(): string[];
  crossFadeTo(name: string, seconds: number): void;
  playSequence(steps: SequenceStep[]): void;
  setMorphInfluence(name: string, weight: number): void;
}

// ──────────────────────────────────────────────────────────────────
// §12 data-contract interfaces (typed contracts, never undefined reads)
// ──────────────────────────────────────────────────────────────────

export type VisemeShape = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";

export interface VisemeCue {
  t: number;    // seconds
  v: VisemeShape;
}

export type VisemeSource = "rhubarb" | "mfcc" | "provider";

export interface VisemeTrack {
  version: 1;
  fps: number;
  source: VisemeSource;
  audioUrl?: string;
  durationSec: number;
  cues: VisemeCue[];
  anticipationSec?: number;
}

export interface RigValidationRule {
  rule: string;   // e.g. "twist_bones_present"
  pass: boolean;
  detail: string;
}

export interface FacialRigMap {
  headBone: string;
  jawBone?: string;
  lipCornerLeftBone?: string;
  lipCornerRightBone?: string;

  visemes: Record<
    "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X",
    Array<{
      morphTarget: string;
      weight: number;
    }>
  >;
}

export interface RigManifest {
  version: 1;
  jobId: string;
  state: "pending" | "running" | "done" | "failed" | "needs_manual";
  profileId: string;
  validation: RigValidationRule[];
  stats: {
    boneCount: number;
    skinnedVerts: number;
    rigidAttachments: number;
  };
  facialRig?: FacialRigMap;
}

export interface LodEntry {
  level: number;       // 0 = source, 1..3 = simplified
  triangles: number;
  maxQuadricError: number;
  sizeBytes: number;
  url: string;
}

export interface LodManifest {
  version: 1;
  lods: LodEntry[];
}

export interface AnimationTransition {
  from: string;
  to: string;
  fadeSec: number;
  condition?: string;
}

export interface BoneDefinitionProfile {
  id: string;
  skeleton: "quadruped" | "biped" | "winged";
  version: 1;
  joints: Record<string, [number, number, number]>; // name → [x,y,z] normalised bbox
  twistBones?: Record<string, number>;              // bone → count
  boneMask?: string[];
  rigidAttachments?: string[];                       // mesh-name globs
  physics?: {
    bones: string[];
    type: "spring";
    stiffness: number;
    damping: number;
    gravity?: number;
  }[];
}

export type AnimationLayer = "L0" | "L1" | "L2" | "L3";

export interface AnimationSetV2 {
  version: 1;
  type: "quadruped" | "biped" | "winged";
  expectedClips: string[];
  transitions?: AnimationTransition[];
  layers?: Record<AnimationLayer, string>;
  masks?: Record<string, string[]>;
  phaseMarkers?: Record<string, number[]>;
}
