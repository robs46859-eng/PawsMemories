/**
 * 8th Wall (XR8) iOS AR path.
 *
 * WebXR AR doesn't exist on iOS Safari, so for iOS we use 8th Wall's engine
 * (now free/open: `@8thwall/engine-binary`), which does camera + SLAM world
 * tracking in WASM. XR8 is an IMPERATIVE three.js camera pipeline and does not
 * compose with react-three-fiber, so this is a standalone vanilla-three.js view
 * that reuses only the framework-agnostic helpers (clipMap).
 *
 * NOTE: XR8 ships as a binary with no TypeScript types, so it's accessed via
 * `window.XR8` (typed as any). This module must be validated on a real device;
 * it cannot be unit-tested in CI.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PlacedObject } from "../../types";
import { OBJECT_CATALOG } from "../objects/catalog";
import { resolveClipName } from "../clipMap";
import { useAvatarScene } from "../store";
import { addObjectAtPosition } from "../objects/placement";

const XR8_SRC = "https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js";

/** Dynamically load the XR8 engine script once; resolve when window.XR8 is ready. */
export function loadXR8(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.XR8) return resolve(w.XR8);
    const finish = () => (w.XR8 ? resolve(w.XR8) : reject(new Error("XR8 failed to initialize")));
    const existing = document.querySelector<HTMLScriptElement>(`script[data-xr8]`);
    if (existing) {
      w.XR8 ? resolve(w.XR8) : window.addEventListener("xrloaded", finish, { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = XR8_SRC;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-preload-chunks", "slam");
    s.setAttribute("data-xr8", "1");
    s.onerror = () => reject(new Error("Failed to load 8th Wall engine"));
    window.addEventListener("xrloaded", finish, { once: true });
    document.head.appendChild(s);
  });
}

export interface EighthWallHandle {
  stop: () => void;
}

export interface StartOptions {
  avatarId: number;
  modelUrl: string;
  objects: PlacedObject[];
  /** current behavior action name, read each frame from the shared store */
  getAction: () => string;
}

/**
 * Boot an 8th Wall AR session inside `canvas`. Returns a handle to stop it.
 * Reticle + tap-to-place anchors the pet on a real surface; the avatar plays
 * the clip matching the current behavior action (falls back to first clip).
 */
export async function startEighthWallAR(
  canvas: HTMLCanvasElement,
  opts: StartOptions
): Promise<EighthWallHandle> {
  const XR8 = await loadXR8();

  // XR8's Three.js pipeline module (XR8.Threejs) resolves three.js from the
  // global `window.THREE`. We bundle three as an ES module, so without this the
  // engine throws "window.THREE is required by the three.js module but doesn't
  // exist." Assigning our bundled instance both satisfies that requirement and
  // ensures XR8's xrScene() shares the SAME three.js instance we use here
  // (avoids "Multiple instances of Three.js"). Must run before the Threejs
  // pipeline module is registered below.
  (window as any).THREE = (window as any).THREE || THREE;

  const loader = new GLTFLoader();
  const clock = new THREE.Clock();

  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let currentClip: string | null = null;
  const anchor = new THREE.Group();
  anchor.visible = false;

  // Live object nodes, kept in sync with the shared store so objects added from
  // the AR overlay appear immediately.
  const objectNodes = new Map<string, THREE.Object3D>();
  let unsubscribe: (() => void) | null = null;

  const buildObjectNode = (o: PlacedObject) => {
    const def = OBJECT_CATALOG[o.kind];
    const wrap = new THREE.Group();
    wrap.position.set(o.position[0], 0, o.position[2]);
    wrap.rotation.y = o.rotationY;
    const place = (child: THREE.Object3D, fit: number) => {
      const box = new THREE.Box3().setFromObject(child);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const s = fit / (Math.max(size.x, size.y, size.z) || 1);
      child.position.set(-center.x, -box.min.y, -center.z);
      const inner = new THREE.Group();
      inner.scale.setScalar(s * o.scale);
      inner.add(child);
      wrap.add(inner);
    };
    if (def?.glbUrl) {
      loader.load(
        def.glbUrl,
        (gltf: any) => place(gltf.scene, def.fitSize),
        undefined,
        () => {
          // Missing GLB → simple box placeholder so something appears in AR.
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(def.fitSize, def.fitSize, def.fitSize),
            new THREE.MeshStandardMaterial({ color: 0x9ca3af })
          );
          box.position.y = def.fitSize / 2;
          wrap.add(box);
        }
      );
    }
    anchor.add(wrap);
    objectNodes.set(o.id, wrap);
  };

  const syncObjects = (list: PlacedObject[]) => {
    const ids = new Set(list.map((o) => o.id));
    // Remove gone.
    for (const [id, node] of objectNodes) {
      if (!ids.has(id)) {
        anchor.remove(node);
        objectNodes.delete(id);
      }
    }
    // Add new.
    for (const o of list) {
      if (!objectNodes.has(o.id)) buildObjectNode(o);
    }
  };

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x22c55e })
  );
  reticle.visible = false;

  const playClip = (action: string) => {
    if (!mixer || !clips.length) return;
    const names = clips.map((c) => c.name);
    const name = resolveClipName(action as any, names) || names[0];
    if (name === currentClip) return;
    const clip = clips.find((c) => c.name === name);
    if (!clip) return;
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().fadeIn(0.2).play();
    currentClip = name;
  };

  // Custom pipeline module: sets up scene content, hit-test reticle, and per-frame updates.
  const scenePipelineModule = () => ({
    name: "pawsmemories",
    onStart: ({ canvas: c }: any) => {
      const { scene, camera } = XR8.Threejs.xrScene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8fbf7f, 1.0));
      const dir = new THREE.DirectionalLight(0xffffff, 1.0);
      dir.position.set(2, 4, 2);
      scene.add(dir);
      scene.add(anchor);
      scene.add(reticle);

      // Load the pet.
      loader.load(opts.modelUrl, (gltf: any) => {
        const model = gltf.scene;
        // Normalize to ~0.7m tall, feet on the anchor.
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const s = 0.7 / (size.y || 1);
        model.position.set(-center.x, -box.min.y, -center.z);
        const wrap = new THREE.Group();
        wrap.scale.setScalar(s);
        wrap.add(model);
        anchor.add(wrap);
        if (gltf.animations?.length) {
          mixer = new THREE.AnimationMixer(model);
          clips = gltf.animations;
          playClip(opts.getAction());
        }
      });

      // Load placed objects now, and keep them in sync with the store live.
      syncObjects(useAvatarScene.getState().placedObjects);
      unsubscribe = useAvatarScene.subscribe((state, prev) => {
        if (state.placedObjects !== prev.placedObjects) syncObjects(state.placedObjects);
      });

      // Camera controls: enable world tracking.
      XR8.XrController.configure({ disableWorldTracking: false });

      // Tap: first tap anchors the pet; once anchored, an armed object
      // (pendingObjectKind) drops at the tapped surface, otherwise re-anchor.
      c.addEventListener("touchstart", (e: TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        const hits = XR8.XrController.hitTest(
          t.clientX / window.innerWidth,
          t.clientY / window.innerHeight,
          ["FEATURE_POINT", "ESTIMATED_SURFACE"]
        );
        if (!hits || !hits[0]) return;
        const p = hits[0].position;
        const pending = useAvatarScene.getState().pendingObjectKind;
        if (pending && anchor.visible) {
          // Drop the armed object at the hit, in the anchor's local space.
          addObjectAtPosition(opts.avatarId, pending, [p.x - anchor.position.x, 0, p.z - anchor.position.z]);
          useAvatarScene.getState().setPendingObjectKind(null);
          return;
        }
        anchor.position.set(p.x, p.y, p.z);
        anchor.visible = true;
        reticle.visible = false;
      });
    },
    onUpdate: () => {
      if (mixer) mixer.update(clock.getDelta());
      playClip(opts.getAction());
      // Reticle follows a center hit until placed.
      if (!anchor.visible) {
        const hits = XR8.XrController.hitTest(0.5, 0.5, ["FEATURE_POINT", "ESTIMATED_SURFACE"]);
        if (hits && hits[0]) {
          const p = hits[0].position;
          reticle.position.set(p.x, p.y, p.z);
          reticle.visible = true;
        }
      }
    },
  });

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    scenePipelineModule(),
  ]);

  XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });

  return {
    stop: () => {
      unsubscribe?.();
      try {
        XR8.stop();
      } catch {
        /* ignore */
      }
      mixer?.stopAllAction();
    },
  };
}
