import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { XR, XRDomOverlay, createXRStore, useXR, useXRHitTest } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "../../types";
import AvatarModel from "../AvatarModel";
import ObjectModel from "../objects/ObjectModel";
import { useAvatarScene } from "../store";
import EighthWallARView from "./EighthWallARView";
import ARCommandOverlay from "../../components/ARCommandOverlay";
import ARObjectOverlay from "../../components/ARObjectOverlay";
import { useARLightEstimation } from "./lightProbe";
import ARPlaneGrid from "./planeGrid";
import { useDepthOcclusion } from "./occlusion";
import { makeContactShadow } from "./shadows";
import { buildLegIK, headLookAt, LegIKRig } from "./ik";
import { chooseStageModelUrl } from "./stageModel";
import { usePetBrain } from "./brainBridge";
import { applyGestureToBrain, type PointerSample } from "./gestures";
import { disposeObject3D } from "./dispose";
import ARErrorBoundary from "./ARErrorBoundary";

/**
 * ARPetStage — AR_PET_SIM_SPEC §6 (milestone AR4).
 *
 * One component, two backends (WebXR on Android, 8th Wall/XR8 on iOS) sharing the
 * behavior store. Renders the rigged pet with its existing clips, a hit-test
 * reticle for placement, contact shadows for grounding, and head-look-at IK.
 *
 * This is the AR4 SKELETON: it stands alongside the current ARScene rather than
 * overwriting it. AR5 wires the brain→BT→clip bridge; AR6 adds semantic zones +
 * depth occlusion/lighting refinements. The iOS path still delegates to the
 * standalone EighthWallARView (XR8 doesn't compose with react-three-fiber);
 * unifying it onto this scene graph is the remaining parity task.
 */

const store = createXRStore({
  domOverlay: true,
  hitTest: true,
  anchors: true,
  planeDetection: true,
  meshDetection: true,
  depthSensing: {
    usagePreference: ["gpu-optimized"],
    dataFormatPreference: ["luminance-alpha"],
  } as any,
  lightEstimation: true,
} as any);

const HIT_TRACKABLES: XRHitTestTrackableType[] = ["plane", "mesh"];

function PlacedObjects() {
  const objects = useAvatarScene((s) => s.placedObjects);
  return (
    <>
      {objects.map((o) => (
        <ObjectModel key={o.id} object={o} />
      ))}
    </>
  );
}

function SceneActorsList() {
  const actors = useAvatarScene((s) => s.sceneActors);
  const [SceneActorModel, setSceneActorModel] = useState<any>(null);

  useEffect(() => {
    import("../objects/SceneActorModel").then((m) => setSceneActorModel(() => m.default));
  }, []);

  if (!SceneActorModel) return null;

  return (
    <>
      {actors.map((a) => (
        <SceneActorModel key={a.id} actor={a} />
      ))}
    </>
  );
}

/**
 * Head-look-at IK: each frame, point the pet's `head` bone at the user camera.
 * Lazily builds the IK rig from the anchored group once the skinned mesh loads.
 * Full CCDIK leg grounding is set up here in AR-later; this ships the visible
 * head-tracking behavior and never throws if the rig lacks the bones.
 */
function useHeadLookAt(anchorRef: React.RefObject<THREE.Group>, active: boolean) {
  const camera = useThree((s) => s.camera);
  const rigRef = useRef<LegIKRig | null>(null);
  const triedRef = useRef(false);
  const camWorld = useRef(new THREE.Vector3());

  useFrame(() => {
    const grp = anchorRef.current;
    if (!active || !grp) return;
    if (!rigRef.current && !triedRef.current) {
      rigRef.current = buildLegIK(grp);
      triedRef.current = !!rigRef.current; // retry until a skinned mesh exists
    }
    const rig = rigRef.current;
    if (rig?.headBone) {
      camera.getWorldPosition(camWorld.current);
      headLookAt(rig.headBone, camWorld.current);
    }
  });
}

function PetStageContent({
  avatar,
  modelUrl,
}: {
  avatar: Avatar;
  modelUrl: string;
}) {
  const session = useXR((s) => s.session);
  const reticleRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Group>(null);

  const matrix = useRef(new THREE.Matrix4());
  const hitPos = useRef(new THREE.Vector3());
  const hitQuat = useRef(new THREE.Quaternion());
  const tmpScale = useRef(new THREE.Vector3());

  const latestHit = useRef<XRHitTestResult | null>(null);
  const xrAnchor = useRef<XRAnchor | null>(null);
  const placedRef = useRef(false);
  const [placed, setPlaced] = useState(false);

  const { directionalRef, ambientProbeRef } = useARLightEstimation();
  useDepthOcclusion(anchorRef);
  useHeadLookAt(anchorRef, placed);

  // AR5 — the brain drives clips + walk targets once the pet is placed.
  const bridge = usePetBrain(placed);
  const gestureSamples = useRef<PointerSample[]>([]);
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // Contact shadow plane under the pet (grounding fallback, §6.2).
  const contactShadow = useMemo(() => makeContactShadow(0.6), []);

  // AR9 — free GPU resources when the stage unmounts (session end / volumetric cleanup).
  useEffect(() => {
    return () => {
      disposeObject3D(anchorRef.current);
      contactShadow.geometry.dispose();
      (contactShadow.material as THREE.Material).dispose();
    };
  }, [contactShadow]);

  useXRHitTest((results, getWorldMatrix) => {
    latestHit.current = results[0] ?? null;
    if (!results.length || !reticleRef.current) return;
    if (getWorldMatrix(matrix.current, results[0])) {
      matrix.current.decompose(hitPos.current, hitQuat.current, tmpScale.current);
      reticleRef.current.position.copy(hitPos.current);
      reticleRef.current.quaternion.copy(hitQuat.current);
      reticleRef.current.visible = !placedRef.current;
    }
  }, "viewer", HIT_TRACKABLES);

  useFrame((state, _delta, frame?: XRFrame) => {
    const grp = anchorRef.current;
    const anchor = xrAnchor.current;
    if (!grp || !anchor || !frame) return;
    const refSpace = state.gl.xr.getReferenceSpace();
    if (!refSpace) return;
    const pose = frame.getPose(anchor.anchorSpace, refSpace);
    if (!pose) return;
    const m = pose.transform.matrix;
    if (!Number.isFinite(m[12]) || !Number.isFinite(m[13]) || !Number.isFinite(m[14])) return;
    matrix.current.fromArray(m);
    matrix.current.decompose(grp.position, grp.quaternion, tmpScale.current);
  });

  useEffect(() => {
    if (!session) return;
    const onSelect = async () => {
      const grp = anchorRef.current;
      if (!grp) return;

      const state = useAvatarScene.getState();
      const pendingObj = state.pendingObjectKind;
      const pendingComp = state.pendingCompanion;

      if ((pendingObj || pendingComp) && placedRef.current) {
        const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert();
        const local = hitPos.current.clone().applyMatrix4(inv);
        if (pendingComp) {
          import("../objects/placement").then(m => {
            m.addCompanionAtPosition(avatar.id, pendingComp, [local.x, 0, local.z]);
            state.setPendingCompanion(null);
          });
        } else if (pendingObj) {
          import("../objects/placement").then(m => {
            m.addObjectAtPosition(avatar.id, pendingObj, [local.x, 0, local.z]);
            state.setPendingObjectKind(null);
          });
        }
        return;
      }

      const hit = latestHit.current as any;
      if (hit && typeof hit.createAnchor === "function") {
        try {
          xrAnchor.current = (await hit.createAnchor()) as XRAnchor;
          placedRef.current = true;
          setPlaced(true);
          return;
        } catch {
          /* fall through to static placement */
        }
      }
      xrAnchor.current = null;
      grp.position.copy(hitPos.current);
      grp.quaternion.copy(hitQuat.current);
      placedRef.current = true;
      setPlaced(true);
    };
    session.addEventListener("select", onSelect);
    return () => session.removeEventListener("select", onSelect);
  }, [session]);

  return (
    <>
      <directionalLight ref={directionalRef} position={[2, 4, 2]} intensity={1} castShadow />
      <primitive object={new THREE.LightProbe()} ref={ambientProbeRef} intensity={0.9} />

      <ARPlaneGrid fadeOut={placed} />

      <group ref={reticleRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.08, 0.1, 32]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      </group>

      <group
        ref={anchorRef}
        visible={placed}
        onPointerDown={(e) => {
          gestureSamples.current = [{ t: now(), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }];
        }}
        onPointerMove={(e) => {
          if (gestureSamples.current.length)
            gestureSamples.current.push({ t: now(), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
        }}
        onPointerUp={() => {
          if (gestureSamples.current.length) {
            applyGestureToBrain(bridge, gestureSamples.current); // stroke/slap/tap → reinforcement
            gestureSamples.current = [];
          }
        }}
      >
        <primitive object={contactShadow} />
        {modelUrl ? <AvatarModel url={modelUrl} /> : null}
        <PlacedObjects />
        <SceneActorsList />
      </group>
    </>
  );
}

export interface ARPetStageProps {
  avatar: Avatar;
  /** Mobile-budget LOD GLB (preferred) and full rigged GLB from the rig pipeline (AR3). */
  lodGlbUrl?: string | null;
  riggedGlbUrl?: string | null;
}

export default function ARPetStage({ avatar, lodGlbUrl, riggedGlbUrl }: ARPetStageProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [use8thWall, setUse8thWall] = useState(false);

  const modelUrl = chooseStageModelUrl({
    lodGlbUrl,
    riggedGlbUrl,
    fallbackUrl: avatar.rigged_model_url || avatar.model_url || "",
  });

  useEffect(() => {
    const xr = (navigator as any).xr;
    if (!xr?.isSessionSupported) {
      setSupported(false);
      return;
    }
    xr.isSessionSupported("immersive-ar").then((ok: boolean) => setSupported(ok)).catch(() => setSupported(false));
  }, []);

  if (use8thWall) {
    return <EighthWallARView avatar={avatar} onExit={() => setUse8thWall(false)} />;
  }

  if (supported === false) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center gap-3 p-6">
        <p className="text-sm font-bold">This device has no native WebXR AR.</p>
        <p className="text-xs opacity-60 max-w-xs">
          Native world-tracking AR (WebXR) is Android-only. On iPhone we use the 8th Wall
          engine instead — it loads the camera + tracking on first use.
        </p>
        <button
          onClick={() => setUse8thWall(true)}
          className="px-4 py-2 rounded-full bg-primary text-white text-sm font-bold shadow-lg hover:bg-primary/90 active:scale-95"
        >
          Start AR (beta)
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <button
        onClick={() => store.enterAR()}
        disabled={supported === null}
        className="absolute z-20 top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-primary text-white text-sm font-bold shadow-lg hover:bg-primary/90 active:scale-95 disabled:opacity-50"
      >
        {supported === null ? "Checking AR…" : "Enter AR"}
      </button>
      <ARErrorBoundary>
        <Canvas shadows camera={{ position: [0, 1.4, 2], fov: 50 }}>
          <XR store={store}>
            <PetStageContent avatar={avatar} modelUrl={modelUrl} />
            <XRDomOverlay>
              <ARObjectOverlay />
              <ARCommandOverlay avatarId={avatar.id} />
            </XRDomOverlay>
          </XR>
        </Canvas>
      </ARErrorBoundary>
    </div>
  );
}
