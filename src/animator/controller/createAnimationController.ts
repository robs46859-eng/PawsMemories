import * as THREE from "three";
import type { AnimationController, AnimationClipInfo } from "../types.ts";

export function createAnimationController(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[]
): AnimationController {
  const mixer = new THREE.AnimationMixer(root);
  
  // Cache initial bind pose transforms
  const bindPoses = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  root.traverse((obj) => {
    bindPoses.set(obj, {
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    });
  });

  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    // Setup defaults
    action.clampWhenFinished = true;
    action.loop = THREE.LoopRepeat;
    actions.set(clip.name, action);
  }

  let currentAction: THREE.AnimationAction | null = null;
  let isPlaying = false;
  let globalSpeed = 1.0;

  return {
    listClips(): AnimationClipInfo[] {
      return clips.map((clip, index) => {
        let tracksMorph = false;
        for (const track of clip.tracks) {
          if (track.name.endsWith(".morphTargetInfluences")) {
            tracksMorph = true;
            break;
          }
        }
        return {
          name: clip.name,
          index,
          duration: clip.duration,
          channelCount: clip.tracks.length,
          tracksMorph
        };
      });
    },

    addClip(clip: THREE.AnimationClip) {
      if (!actions.has(clip.name)) {
        clips.push(clip);
        const action = mixer.clipAction(clip);
        action.clampWhenFinished = true;
        action.loop = THREE.LoopRepeat;
        actions.set(clip.name, action);
      }
    },

    selectClip(name: string, crossFadeSeconds: number = 0) {
      const action = actions.get(name);
      if (!action) return;

      if (currentAction && currentAction !== action) {
        if (crossFadeSeconds > 0 && isPlaying) {
          action.time = 0;
          action.play();
          currentAction.crossFadeTo(action, crossFadeSeconds, true);
        } else {
          currentAction.stop();
          action.play();
        }
      } else if (!currentAction) {
        action.play();
      }

      currentAction = action;
      if (!isPlaying) {
        currentAction.paused = true;
      } else {
        currentAction.paused = false;
      }
    },

    play() {
      if (!currentAction) return;
      isPlaying = true;
      currentAction.paused = false;
      currentAction.play();
    },

    pause() {
      if (!currentAction) return;
      isPlaying = false;
      currentAction.paused = true;
    },

    stop() {
      if (!currentAction) return;
      isPlaying = false;
      currentAction.stop();
      currentAction.time = 0;
    },

    setLoop(loop: boolean) {
      if (!currentAction) return;
      currentAction.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
      currentAction.clampWhenFinished = !loop;
    },

    setSpeed(multiplier: number) {
      globalSpeed = multiplier;
      if (currentAction) {
        currentAction.timeScale = multiplier;
      }
    },

    seek(seconds: number) {
      if (!currentAction) return;
      const duration = currentAction.getClip().duration;
      const t = Math.max(0, Math.min(seconds, duration));
      currentAction.time = t;
      mixer.update(0); // Flush without advancing time
    },

    getCurrentTime(): number {
      if (!currentAction) return 0;
      return currentAction.time;
    },

    getDuration(): number {
      if (!currentAction) return 0;
      return currentAction.getClip().duration;
    },

    resetToBindPose() {
      mixer.stopAllAction();
      if (currentAction) {
        currentAction.time = 0;
        isPlaying = false;
      }
      
      root.traverse((obj) => {
        const pose = bindPoses.get(obj);
        if (pose) {
          obj.position.copy(pose.position);
          obj.quaternion.copy(pose.quaternion);
          obj.scale.copy(pose.scale);
        }
      });
    },

    update(delta: number) {
      mixer.update(delta);
    },

    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      actions.clear();
      bindPoses.clear();
      currentAction = null;
    },
    
    listMorphTargets(): string[] {
      const morphs = new Set<string>();
      root.traverse((obj: any) => {
        if (obj.isMesh && obj.morphTargetDictionary) {
          Object.keys(obj.morphTargetDictionary).forEach(k => morphs.add(k));
        }
      });
      return Array.from(morphs).sort();
    },
    crossFadeTo(name: string, duration: number) {
      this.selectClip(name, duration);
    },
    playSequence() { throw new Error("NotImplemented"); },
    setMorphInfluence(name: string, value: number) {
      root.traverse((obj: any) => {
        if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
          const idx = obj.morphTargetDictionary[name];
          if (idx !== undefined) {
            obj.morphTargetInfluences[idx] = value;
          }
        }
      });
    },
  };
}
