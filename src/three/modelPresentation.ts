import type { BehaviorAction } from "../types";
import { resolveClipName } from "./clipMap";

export const DEFAULT_MODEL_YAW_CORRECTION_DEGREES = 0;
export const DEFAULT_MODEL_CAMERA_AZIMUTH_DEGREES = 90;

export function radiansForModelYaw(
  yawCorrectionDegrees = DEFAULT_MODEL_YAW_CORRECTION_DEGREES,
): number {
  return yawCorrectionDegrees * Math.PI / 180;
}

export function modelViewerOrientation(
  yawCorrectionDegrees = DEFAULT_MODEL_YAW_CORRECTION_DEGREES,
): string {
  return `0deg ${yawCorrectionDegrees}deg 0deg`;
}

export function modelViewerCameraOrbit(
  cameraAzimuthDegrees = DEFAULT_MODEL_CAMERA_AZIMUTH_DEGREES,
): string {
  return `${cameraAzimuthDegrees}deg 80deg 105%`;
}

export function resolvePresentationClipName(
  action: BehaviorAction,
  available: string[],
  avatarType?: "dog" | "human",
): string | null {
  // Static presentation must remain truly static. Provider-authored idle,
  // breath, and stand clips frequently contain a pronounced full-body sway.
  if (action === "idle") return null;
  return resolveClipName(action, available, avatarType);
}
