/**
 * Phase 3 — Plane Detection & Visualization
 *
 * Reads `frame.detectedPlanes` each frame and renders a translucent mesh for
 * each detected surface. Horizontal planes get a soft green tint; vertical
 * planes get a cyan tint. Meshes are created/updated/removed as the plane set
 * changes.
 *
 * Golden rule: if `detectedPlanes` is missing on the frame, render nothing.
 *
 * @module src/three/ar/planeGrid.tsx
 */

import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HORIZONTAL_COLOR = new THREE.Color(0x22c55e); // soft green
const VERTICAL_COLOR = new THREE.Color(0x06b6d4);   // cyan
const PLANE_OPACITY = 0.12;
const FADE_OUT_OPACITY = 0.0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Triangulate a convex polygon boundary (array of {x,y,z} points in the
 * plane's local space) into an indexed BufferGeometry. Uses a simple fan
 * triangulation — XRPlane polygons are always convex.
 */
function triangulatePolygon(polygon: DOMPointReadOnly[]): THREE.BufferGeometry {
  const positions = new Float32Array(polygon.length * 3);
  for (let i = 0; i < polygon.length; i++) {
    positions[i * 3] = polygon[i].x;
    positions[i * 3 + 1] = polygon[i].y;
    positions[i * 3 + 2] = polygon[i].z;
  }

  // Fan triangulation from vertex 0.
  const indexCount = (polygon.length - 2) * 3;
  const indices = new Uint16Array(indexCount);
  for (let i = 0; i < polygon.length - 2; i++) {
    indices[i * 3] = 0;
    indices[i * 3 + 1] = i + 1;
    indices[i * 3 + 2] = i + 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Check whether a polygon has changed by comparing vertex positions.
 * XRPlane.polygon can update as ARCore refines the boundary.
 */
function polygonChanged(
  prev: DOMPointReadOnly[] | undefined,
  curr: DOMPointReadOnly[],
): boolean {
  if (!prev || prev.length !== curr.length) return true;
  for (let i = 0; i < curr.length; i++) {
    if (
      Math.abs(prev[i].x - curr[i].x) > 1e-5 ||
      Math.abs(prev[i].y - curr[i].y) > 1e-5 ||
      Math.abs(prev[i].z - curr[i].z) > 1e-5
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cached per-plane data
// ---------------------------------------------------------------------------
interface PlaneEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  polygon: DOMPointReadOnly[];
  lastSeen: number; // frame counter — prune planes not seen for several frames
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `<ARPlaneGrid />` — mount inside `ARContent`. Shows detected surfaces as
 * faint translucent overlays. Pass `visible={false}` or `fadeOut` to hide
 * after the pet has been placed.
 */
export default function ARPlaneGrid({ fadeOut = false }: { fadeOut?: boolean }) {
  const session = useXR((s) => s.session);
  const { gl } = useThree();

  const groupRef = useRef<THREE.Group>(null);
  const planeMap = useRef<Map<any, PlaneEntry>>(new Map());
  const frameCounter = useRef(0);
  const targetOpacity = useRef(PLANE_OPACITY);

  // Materials pool — reused for horizontal vs vertical.
  const materials = useMemo(
    () => ({
      horizontal: new THREE.MeshBasicMaterial({
        color: HORIZONTAL_COLOR,
        transparent: true,
        opacity: PLANE_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      vertical: new THREE.MeshBasicMaterial({
        color: VERTICAL_COLOR,
        transparent: true,
        opacity: PLANE_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    }),
    [],
  );

  // Fade out when pet is placed.
  useEffect(() => {
    targetOpacity.current = fadeOut ? FADE_OUT_OPACITY : PLANE_OPACITY;
  }, [fadeOut]);

  // Cleanup on unmount / session end.
  useEffect(() => {
    return () => {
      const map = planeMap.current;
      map.forEach((entry) => {
        entry.mesh.geometry.dispose();
        entry.mesh.removeFromParent();
      });
      map.clear();
    };
  }, [session]);

  useFrame((_state, _delta, frame?: XRFrame) => {
    if (!frame || !groupRef.current) return;

    // Feature check: not all devices / frames have detectedPlanes.
    const detectedPlanes = (frame as any).detectedPlanes as Set<any> | undefined;
    if (!detectedPlanes) return;

    const refSpace = gl.xr.getReferenceSpace();
    if (!refSpace) return;

    frameCounter.current++;
    const currentFrame = frameCounter.current;
    const group = groupRef.current;
    const map = planeMap.current;

    // ---- Animate opacity (fade in / fade out) ----
    const currentOp = materials.horizontal.opacity;
    const target = targetOpacity.current;
    if (Math.abs(currentOp - target) > 0.001) {
      const newOp = currentOp + (target - currentOp) * 0.08;
      materials.horizontal.opacity = newOp;
      materials.vertical.opacity = newOp;
    }

    // ---- Update / create plane meshes ----
    detectedPlanes.forEach((plane: any) => {
      const polygon = plane.polygon as DOMPointReadOnly[];
      if (!polygon || polygon.length < 3) return;

      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) return;

      let entry = map.get(plane);

      if (!entry) {
        // New plane — create mesh.
        const isHorizontal = plane.orientation === "horizontal";
        const geo = triangulatePolygon(polygon);
        const mat = isHorizontal ? materials.horizontal : materials.vertical;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
        entry = { mesh, material: mat, polygon: [...polygon], lastSeen: currentFrame };
        map.set(plane, entry);
      } else if (polygonChanged(entry.polygon, polygon)) {
        // Polygon refined — rebuild geometry.
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = triangulatePolygon(polygon);
        entry.polygon = [...polygon];
      }

      // Update transform.
      entry.mesh.matrix.fromArray(pose.transform.matrix);
      entry.lastSeen = currentFrame;
    });

    // ---- Remove stale planes (not seen for 3+ frames) ----
    map.forEach((entry, plane) => {
      if (currentFrame - entry.lastSeen > 3) {
        entry.mesh.geometry.dispose();
        entry.mesh.removeFromParent();
        map.delete(plane);
      }
    });
  });

  return <group ref={groupRef} />;
}
