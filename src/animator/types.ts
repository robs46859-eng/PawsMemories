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
}

export interface AnimationClipInfo {
  name: string;
  index: number;
  duration: number;
  channelCount: number;
  tracksMorph: boolean;
}

export type JobType = "inspect" | "convert" | "optimize";
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
  selectClip(name: string): void;
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
  crossFadeTo?(name: string, seconds: number): void;
  playSequence?(steps: SequenceStep[]): void;
  setMorphInfluence?(meshName: string, targetIndex: number, weight: number): void;
}
