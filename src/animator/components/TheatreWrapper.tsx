import React, { useState, useEffect, ReactNode } from "react";
import { getProject } from "@theatre/core";
import { SheetProvider } from "@theatre/r3f";

let studioInitialized = false;

export function TheatreWrapper({ children, active, projectId }: { children: ReactNode, active: boolean, projectId: string }) {
  const [ready, setReady] = useState(!active);
  
  useEffect(() => {
    if (active && !studioInitialized) {
      import("@theatre/studio").then(studio => {
        studio.default.initialize().then(() => {
          studioInitialized = true;
          setReady(true);
        });
      }).catch(e => {
        console.error("Failed to load theatre studio", e);
        setReady(true); // fall back
      });
    } else if (active) {
      setReady(true);
    }
  }, [active]);

  if (!ready) return null;

  if (active) {
    // Project ID should be unique to the user's project
    const sheet = getProject(projectId || "PawsMemories").sheet("Scene");
    return <SheetProvider sheet={sheet}>{children}</SheetProvider>;
  }

  return <>{children}</>;
}
