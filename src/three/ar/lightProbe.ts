/**
 * Phase 5 — AR Light Estimation
 *
 * Reads real-world lighting from WebXR's XRLightProbe API and drives the
 * scene's directional + ambient lights so the pet matches the room.
 *
 * Golden rule: request as optional, degrade silently. If the session doesn't
 * grant light-estimation the AR experience still works with hardcoded lights.
 *
 * @module src/three/ar/lightProbe.ts
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lerp factor per frame — small value smooths flicker. */
const LERP_ALPHA = 0.08;

/** Fallback light when estimation is unavailable. */
const DEFAULT_DIRECTION = new THREE.Vector3(0.5, 1.0, 0.3).normalize();
const DEFAULT_INTENSITY = 1.0;
const DEFAULT_AMBIENT = 0.9;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Linearly interpolate a single scalar. */
function lerpScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Populate a THREE.SphericalHarmonics3 from the flat 27-float array returned
 * by XRLightEstimate.sphericalHarmonicsCoefficients.
 */
function applySH(sh: THREE.SphericalHarmonics3, coeffs: Float32Array): void {
  // WebXR provides 9 RGB coefficients (27 floats, row-major).
  for (let i = 0; i < 9; i++) {
    sh.coefficients[i].set(
      coeffs[i * 3],
      coeffs[i * 3 + 1],
      coeffs[i * 3 + 2],
    );
  }
}

// ---------------------------------------------------------------------------
// React hook — call inside ARContent's useFrame context
// ---------------------------------------------------------------------------

/**
 * `useARLightEstimation` requests a light probe from the active XR session and
 * drives a directional light + ambient probe each frame. Returns refs to the
 * light objects so the caller can mount them in the scene graph.
 *
 * Usage inside ARContent:
 * ```tsx
 * const { directionalRef, ambientProbeRef } = useARLightEstimation();
 * return (
 *   <>
 *     <directionalLight ref={directionalRef} />
 *     <primitive object={ambientProbe} ref={ambientProbeRef} />
 *   </>
 * );
 * ```
 */
export function useARLightEstimation() {
  const session = useXR((s) => s.session);
  const { gl, scene } = useThree();

  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const ambientProbeRef = useRef<THREE.LightProbe>(null);

  // XR-specific handles (session-scoped).
  const xrLightProbe = useRef<XRLightProbe | null>(null);
  const xrBinding = useRef<XRWebGLBinding | null>(null);

  // Smoothed values.
  const smoothDir = useRef(DEFAULT_DIRECTION.clone());
  const smoothIntensity = useRef(DEFAULT_INTENSITY);
  const smoothAmbient = useRef(DEFAULT_AMBIENT);

  // Track whether we've ever successfully estimated — used to skip the lerp on
  // the very first valid estimate so the lights snap to reality instantly.
  const hasEstimated = useRef(false);

  // ------ Request probe on session start ------
  useEffect(() => {
    if (!session) {
      xrLightProbe.current = null;
      xrBinding.current = null;
      hasEstimated.current = false;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const probe = await (session as any).requestLightProbe({
          reflectionFormat: "srgba8",
        });
        if (cancelled) return;
        xrLightProbe.current = probe as XRLightProbe;

        // Create the WebGL binding for optional reflection cube map.
        try {
          const ctx = (gl as any).getContext?.() ?? gl.domElement.getContext("webgl2");
          if (ctx) {
            xrBinding.current = new (window as any).XRWebGLBinding(session, ctx);
          }
        } catch {
          // Reflection cube map won't be available — that's fine.
        }
      } catch {
        // Light estimation not supported — silently degrade.
        xrLightProbe.current = null;
      }
    })();

    return () => {
      cancelled = true;
      xrLightProbe.current = null;
      xrBinding.current = null;
    };
  }, [session, gl]);

  // ------ Per-frame light update ------
  useFrame((_state, _delta, frame?: XRFrame) => {
    if (!frame || !xrLightProbe.current) return;

    let estimate: XRLightEstimate | null = null;
    try {
      estimate = (frame as any).getLightEstimate(xrLightProbe.current) as XRLightEstimate | null;
    } catch {
      return;
    }
    if (!estimate) return;

    const alpha = hasEstimated.current ? LERP_ALPHA : 1.0;
    hasEstimated.current = true;

    // ---- Directional light ----
    const dir = (estimate as any).primaryLightDirection;
    const intensity = (estimate as any).primaryLightIntensity;

    if (dir && directionalRef.current) {
      // XRLightEstimate gives direction as a DOMPointReadOnly {x,y,z,w}.
      // Three.js directional light points FROM its position TO the origin, so
      // we set the light's position to -direction (pointing toward origin).
      const targetDir = new THREE.Vector3(-dir.x, -dir.y, -dir.z).normalize();
      smoothDir.current.lerp(targetDir, alpha);
      directionalRef.current.position.copy(smoothDir.current).multiplyScalar(5);
    }

    if (intensity && directionalRef.current) {
      // intensity is a DOMPointReadOnly {x,y,z,w} with RGB radiance.
      const mag = Math.sqrt(intensity.x * intensity.x + intensity.y * intensity.y + intensity.z * intensity.z);
      const targetI = Math.min(mag, 3.0); // cap to prevent blow-out
      smoothIntensity.current = lerpScalar(smoothIntensity.current, targetI, alpha);
      directionalRef.current.intensity = smoothIntensity.current;

      // Tint the directional light by the dominant color.
      if (mag > 0.001) {
        directionalRef.current.color.setRGB(
          intensity.x / mag,
          intensity.y / mag,
          intensity.z / mag,
        );
      }
    }

    // ---- Ambient (spherical harmonics) ----
    const shCoeffs = (estimate as any).sphericalHarmonicsCoefficients as Float32Array | undefined;
    if (shCoeffs && ambientProbeRef.current) {
      const sh = ambientProbeRef.current.sh;
      applySH(sh, shCoeffs);
      // Scale ambient intensity so it blends naturally.
      const ambientMag = Math.sqrt(
        shCoeffs[0] * shCoeffs[0] + shCoeffs[1] * shCoeffs[1] + shCoeffs[2] * shCoeffs[2],
      );
      const targetAmbient = Math.min(ambientMag * 0.8, 2.0);
      smoothAmbient.current = lerpScalar(smoothAmbient.current, targetAmbient, alpha);
      ambientProbeRef.current.intensity = smoothAmbient.current;
    }

    // ---- Optional reflection cube map ----
    if (xrBinding.current && xrLightProbe.current) {
      try {
        const cubeMap = (xrBinding.current as any).getReflectionCubeMap(xrLightProbe.current);
        if (cubeMap) {
          // Wrap the native WebGL texture as a Three.js cube texture for PBR.
          // Three.js r150+ exposes properties on WebGLRenderer to create textures
          // from native GL resources, but it's fragile. For safety we set the
          // scene environment only once (the first valid cube map), then stop
          // updating to avoid per-frame GC pressure.
          if (!scene.environment) {
            // This is a best-effort path — many devices won't provide it.
            // Left as a no-op placeholder; a real implementation would call
            // `gl.properties.get(texture).__webglTexture = cubeMap` which is
            // renderer-internal. Skipping to avoid breakage.
          }
        }
      } catch {
        // Reflection not available — no-op.
      }
    }
  });

  return { directionalRef, ambientProbeRef };
}
