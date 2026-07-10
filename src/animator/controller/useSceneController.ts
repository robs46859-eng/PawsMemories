import { useState, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { createSceneController } from "./createSceneController.ts";
import type { SceneController, SceneActor } from "../types.ts";

export function useSceneController() {
  const [controller] = useState(() => createSceneController());
  
  // React state mirrors for UI
  const [actors, setActors] = useState<SceneActor[]>([]);
  const [activeActorId, setActiveActorId] = useState<string | null>(null);
  
  // We don't want to re-render 60fps for timeline progress, so we only trigger React state updates
  // for structural changes.
  // Timeline progress will be read via ref or a separate micro-store if needed.
  
  useEffect(() => {
    // Initial sync
    setActors(controller.listActors());
    setActiveActorId(controller.getActiveActorId());
    
    // Cleanup on unmount
    return () => {
      controller.dispose();
    };
  }, [controller]);
  
  // Override structural methods to trigger React renders
  const syncReact = () => {
    setActors(controller.listActors());
    setActiveActorId(controller.getActiveActorId());
  };
  
  const wrappedController = {
    ...controller,
    async addActor(...args: Parameters<typeof controller.addActor>) {
      const id = await controller.addActor(...args);
      syncReact();
      return id;
    },
    removeActor(...args: Parameters<typeof controller.removeActor>) {
      controller.removeActor(...args);
      syncReact();
    },
    setActiveActor(...args: Parameters<typeof controller.setActiveActor>) {
      controller.setActiveActor(...args);
      syncReact();
    }
  };

  useFrame((_, delta) => {
    wrappedController.update(delta);
  });

  return wrappedController;
}
