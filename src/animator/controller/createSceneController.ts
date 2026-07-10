import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { v4 as uuidv4 } from "uuid";
import type { SceneController, SceneActor, AnimationController, AssetId } from "../types.ts";
import { createAnimationController } from "./createAnimationController.ts";
import { ANIMATOR_DEFAULTS } from "../defaults.ts";

export function createSceneController(): SceneController & { getScene(): THREE.Scene; getActiveActorId(): string | null } {
  const scene = new THREE.Scene();
  const loader = new GLTFLoader();
  
  const actors = new Map<string, SceneActor>();
  const controllers = new Map<string, AnimationController>();
  const objectRoots = new Map<string, THREE.Object3D>();
  
  let activeActorId: string | null = null;
  let globalSpeed = 1.0;

  return {
    getScene() { return scene; },
    getActiveActorId() { return activeActorId; },
    
    listActors() {
      return Array.from(actors.values());
    },
    
    async addActor(assetId: AssetId, opts?: Partial<SceneActor>): Promise<string> {
      // In a real app we'd fetch the URL mapping. For now, assume assetId is the URL if it's an HTTP link,
      // or we hit /api/animator/outputs/:assetId to find the glb.
      // Wait, the requirement says "addActor(assetId): load the GLB... return a fresh actorId".
      // Since it's unit testable, we might pass a direct URL in tests, or we could fetch the outputs.
      // Let's resolve the URL.
      let url = assetId;
      if (!url.startsWith("http") && !url.startsWith("/") && !url.startsWith("data:")) {
        // Fetch from API to get the first output URL, or fallback to originals
        try {
          const res = await fetch(`/api/animator/outputs/${assetId}`);
          if (res.ok) {
            const files = await res.json();
            if (files.length > 0) {
              url = files[0].url;
            } else {
              // Fallback to original
              const metaRes = await fetch(`/api/animator/assets/${assetId}`);
              if (metaRes.ok) {
                const meta = await metaRes.json();
                const safeOriginal = meta.originalFilename.replace(/[^a-zA-Z0-9_\-\.]/g, "");
                url = `/animator-files/originals/${assetId}/${safeOriginal}`;
              }
            }
          }
        } catch (e) {
          // If we are in node:test, fetch might fail or be undefined.
          // Tests can pass file:// URLs directly or mock fetch.
        }
      }

      const gltf = await loader.loadAsync(url);
      const clonedScene = SkeletonUtils.clone(gltf.scene);
      
      const actorId = uuidv4();
      
      // Default placement: spacingX * number of actors
      const xOffset = actors.size * ANIMATOR_DEFAULTS.actor.spacingX;
      
      const actor: SceneActor = {
        actorId,
        assetId,
        label: opts?.label || `Actor ${actors.size + 1}`,
        transform: opts?.transform || { position: [xOffset, ANIMATOR_DEFAULTS.actor.offsetY, 0], rotation: [0, 0, 0], scale: 1 },
        visible: opts?.visible !== undefined ? opts.visible : true,
      };
      
      actors.set(actorId, actor);
      
      // Apply transform
      clonedScene.position.set(...actor.transform.position);
      clonedScene.rotation.set(...actor.transform.rotation);
      clonedScene.scale.setScalar(actor.transform.scale);
      clonedScene.visible = actor.visible;
      
      scene.add(clonedScene);
      objectRoots.set(actorId, clonedScene);
      
      const controller = createAnimationController(clonedScene, gltf.animations);
      controller.setSpeed(globalSpeed);
      controllers.set(actorId, controller);
      
      // Auto-pick idle clip
      const clips = controller.listClips();
      if (clips.length > 0) {
        let bestClip = clips[0];
        for (const clip of clips) {
          const lower = clip.name.toLowerCase();
          if (ANIMATOR_DEFAULTS.clip.heuristics.some(h => lower.includes(h))) {
            bestClip = clip;
            break;
          }
        }
        controller.selectClip(bestClip.name);
        controller.setLoop(ANIMATOR_DEFAULTS.clip.loop);
        actor.selectedClip = bestClip.name;
      }
      
      if (!activeActorId) {
        activeActorId = actorId;
      }
      
      return actorId;
    },
    
    removeActor(actorId: string) {
      const controller = controllers.get(actorId);
      if (controller) {
        controller.dispose();
        controllers.delete(actorId);
      }
      
      const obj = objectRoots.get(actorId);
      if (obj) {
        scene.remove(obj);
        // Clean up geometries and materials
        obj.traverse((child: any) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose());
            else child.material.dispose();
          }
        });
        objectRoots.delete(actorId);
      }
      
      actors.delete(actorId);
      if (activeActorId === actorId) {
        activeActorId = actors.size > 0 ? actors.keys().next().value || null : null;
      }
    },
    
    getActorController(actorId: string) {
      return controllers.get(actorId);
    },
    
    setActiveActor(actorId: string) {
      if (actors.has(actorId)) {
        activeActorId = actorId;
      }
    },
    
    playAll() {
      for (const ctrl of controllers.values()) ctrl.play();
    },
    
    pauseAll() {
      for (const ctrl of controllers.values()) ctrl.pause();
    },
    
    stopAll() {
      for (const ctrl of controllers.values()) ctrl.stop();
    },
    
    seekAll(seconds: number) {
      for (const ctrl of controllers.values()) ctrl.seek(seconds);
    },
    
    setGlobalSpeed(multiplier: number) {
      globalSpeed = multiplier;
      for (const ctrl of controllers.values()) ctrl.setSpeed(multiplier);
    },
    
    update(delta: number) {
      for (const ctrl of controllers.values()) ctrl.update(delta);
    },
    
    dispose() {
      for (const actorId of Array.from(actors.keys())) {
        this.removeActor(actorId);
      }
    }
  };
}
