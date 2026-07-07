/**
 * Phase 4 — Depth Occlusion
 *
 * Uses WebXR's depth-sensing API (GPU-optimized path) to occlude avatar
 * fragments that are behind real-world geometry. A chair, person, or wall
 * between the camera and pet correctly hides the pet's occluded parts.
 *
 * Performance: GPU-only — never reads depth back to CPU. Includes an
 * automatic quality gate that disables occlusion if fps drops below ~25.
 *
 * Golden rule: request as optional, degrade silently.
 *
 * @module src/three/ar/occlusion.ts
 */

import { useEffect, useRef, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { useAvatarScene } from "../store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum sustained fps before auto-disabling depth. */
const MIN_FPS_THRESHOLD = 25;

/** Number of frames to average for the fps gate. */
const FPS_WINDOW = 30;

// ---------------------------------------------------------------------------
// Depth shader injection snippets
// ---------------------------------------------------------------------------

/**
 * Vertex shader snippet — passes camera-space depth to the fragment shader.
 * Injected before the closing `}` of the vertex main function.
 */
const VERT_PARS = /* glsl */ `
varying float vCameraDepth;
`;

const VERT_MAIN = /* glsl */ `
  // Camera-space depth (positive = away from camera).
  vec4 csPosition = modelViewMatrix * vec4(position, 1.0);
  vCameraDepth = -csPosition.z;
`;

/**
 * Fragment shader snippet — samples the depth texture at the fragment's screen
 * UV and discards the fragment if the real-world surface is closer.
 */
const FRAG_PARS = /* glsl */ `
varying float vCameraDepth;
uniform sampler2D uDepthTexture;
uniform mat4 uDepthUVTransform;
uniform float uRawValueToMeters;
uniform bool uDepthEnabled;
`;

const FRAG_MAIN = /* glsl */ `
  if (uDepthEnabled) {
    // Compute screen-space UV for the depth texture.
    // The depth buffer maps from normalized view to depth-buffer UV via
    // uDepthUVTransform (normDepthBufferFromNormView).
    vec2 screenUV = gl_FragCoord.xy / vec2(textureSize(uDepthTexture, 0));
    vec4 depthUV = uDepthUVTransform * vec4(screenUV, 0.0, 1.0);
    float rawDepth = texture2D(uDepthTexture, depthUV.xy / depthUV.w).r;
    float realDepthM = rawDepth * uRawValueToMeters;

    // Discard fragments behind real geometry (with a small epsilon to reduce
    // z-fighting at the occlusion boundary).
    if (realDepthM > 0.0 && realDepthM < vCameraDepth - 0.01) {
      discard;
    }
  }
`;

// ---------------------------------------------------------------------------
// Material patching
// ---------------------------------------------------------------------------

/**
 * Patch a Three.js material so its shader samples the depth texture for
 * occlusion. Idempotent — skips materials already patched.
 */
function patchMaterial(
  material: THREE.Material,
  depthTexture: THREE.Texture,
  depthUVTransform: THREE.Matrix4,
  rawValueToMeters: number,
): void {
  // Tag to avoid double-patching.
  if ((material as any).__depthPatched) return;
  (material as any).__depthPatched = true;

  // Attach uniforms that the shader snippets reference.
  (material as any).onBeforeCompile = (shader: any) => {
    shader.uniforms.uDepthTexture = { value: depthTexture };
    shader.uniforms.uDepthUVTransform = { value: depthUVTransform };
    shader.uniforms.uRawValueToMeters = { value: rawValueToMeters };
    shader.uniforms.uDepthEnabled = { value: true };

    // Inject vertex pars + main.
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      VERT_PARS + "\nvoid main() {",
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n" + VERT_MAIN,
    );

    // Inject fragment pars + main.
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      FRAG_PARS + "\nvoid main() {",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      FRAG_MAIN + "\n#include <dithering_fragment>",
    );

    // Stash the compiled shader so we can update uniforms per-frame.
    (material as any).__depthShader = shader;
  };

  // Force recompile.
  material.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * `useDepthOcclusion(avatarGroupRef)` — call inside `ARContent`. Patches the
 * avatar meshes' materials to sample the WebXR depth buffer and discard
 * occluded fragments. Automatically disables on devices without depth or when
 * fps drops below the threshold.
 */
export function useDepthOcclusion(avatarGroupRef: React.RefObject<THREE.Group | null>) {
  const session = useXR((s) => s.session);
  const { gl } = useThree();

  const xrBinding = useRef<any>(null);
  const depthTexture = useRef<THREE.DataTexture | null>(null);
  const depthUVMatrix = useRef(new THREE.Matrix4());
  const rawToMeters = useRef(0.001);

  // FPS gate.
  const frameTimes = useRef<number[]>([]);
  const autoDisabled = useRef(false);

  // User toggle from the store.
  const depthEnabled = useAvatarScene((s) => s.depthOcclusionEnabled);

  // Track which materials we've patched so we can un-patch on cleanup.
  const patchedMaterials = useRef<Set<THREE.Material>>(new Set());

  // ------ Create binding on session start ------
  useEffect(() => {
    if (!session) {
      xrBinding.current = null;
      autoDisabled.current = false;
      frameTimes.current = [];
      return;
    }

    try {
      const ctx = (gl as any).getContext?.() ?? gl.domElement.getContext("webgl2");
      if (ctx) {
        xrBinding.current = new (window as any).XRWebGLBinding(session, ctx);
      }
    } catch {
      xrBinding.current = null;
    }

    return () => {
      xrBinding.current = null;
      // Un-patch materials.
      patchedMaterials.current.forEach((mat) => {
        (mat as any).__depthPatched = false;
        (mat as any).onBeforeCompile = undefined;
        mat.needsUpdate = true;
      });
      patchedMaterials.current.clear();
    };
  }, [session, gl]);

  // ------ Patch avatar materials when they appear ------
  const patchAvatarMeshes = useCallback(() => {
    const group = avatarGroupRef.current;
    if (!group || !depthTexture.current) return;

    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!(mat as any).__depthPatched) {
          patchMaterial(mat, depthTexture.current!, depthUVMatrix.current, rawToMeters.current);
          patchedMaterials.current.add(mat);
        }
      }
    });
  }, [avatarGroupRef]);

  // ------ Per-frame depth update ------
  useFrame((state, delta, frame?: XRFrame) => {
    if (!frame || !xrBinding.current || !depthEnabled || autoDisabled.current) {
      // Update the enabled uniform on patched materials to false.
      patchedMaterials.current.forEach((mat) => {
        const shader = (mat as any).__depthShader;
        if (shader?.uniforms?.uDepthEnabled) {
          shader.uniforms.uDepthEnabled.value = false;
        }
      });
      return;
    }

    // ---- FPS gate ----
    const dt = delta || 0.016;
    frameTimes.current.push(dt);
    if (frameTimes.current.length > FPS_WINDOW) frameTimes.current.shift();
    if (frameTimes.current.length >= FPS_WINDOW) {
      const avg = frameTimes.current.reduce((a, b) => a + b, 0) / frameTimes.current.length;
      const fps = 1 / avg;
      if (fps < MIN_FPS_THRESHOLD) {
        console.warn("[AR Occlusion] FPS dropped below threshold, auto-disabling depth occlusion.");
        autoDisabled.current = true;
        return;
      }
    }

    // ---- Read depth from the current view ----
    const refSpace = gl.xr.getReferenceSpace();
    if (!refSpace) return;

    const pose = frame.getViewerPose(refSpace);
    if (!pose || pose.views.length === 0) return;

    const view = pose.views[0]; // primary view
    let depthInfo: any = null;

    try {
      depthInfo = (xrBinding.current as any).getDepthInformation(view);
    } catch {
      return;
    }
    if (!depthInfo) return;

    // ---- Upload depth texture ----
    const nativeTexture = depthInfo.texture;
    if (!nativeTexture) return;

    // Create or reuse a DataTexture to wrap the GPU depth texture.
    if (!depthTexture.current) {
      // We create a placeholder texture; the actual GPU texture is bound below.
      depthTexture.current = new THREE.DataTexture(
        new Uint8Array(4),
        1,
        1,
        THREE.RGFormat,
        THREE.UnsignedByteType,
      );
      depthTexture.current.minFilter = THREE.NearestFilter;
      depthTexture.current.magFilter = THREE.NearestFilter;
      depthTexture.current.needsUpdate = true;
    }

    // Bind the native WebGL depth texture to our Three.js texture.
    // This is the key GPU-optimized trick: no readback, just reference the GPU texture.
    const texProps = (gl as any).properties.get(depthTexture.current);
    if (texProps) {
      texProps.__webglTexture = nativeTexture;
    }

    // Update the UV transform + raw-to-meters.
    if (depthInfo.normDepthBufferFromNormView) {
      depthUVMatrix.current.fromArray(depthInfo.normDepthBufferFromNormView.matrix);
    }
    if (typeof depthInfo.rawValueToMeters === "number") {
      rawToMeters.current = depthInfo.rawValueToMeters;
    }

    // ---- Patch materials if not yet done ----
    patchAvatarMeshes();

    // ---- Update uniforms on already-patched materials ----
    patchedMaterials.current.forEach((mat) => {
      const shader = (mat as any).__depthShader;
      if (!shader?.uniforms) return;
      shader.uniforms.uDepthEnabled.value = true;
      shader.uniforms.uDepthTexture.value = depthTexture.current;
      shader.uniforms.uDepthUVTransform.value = depthUVMatrix.current;
      shader.uniforms.uRawValueToMeters.value = rawToMeters.current;
    });
  });
}
