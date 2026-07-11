import { useState, useEffect } from "react";
import { getProject, types, ISheet, ISheetObject } from "@theatre/core";

let studioInitialized = false;

export function useTheatreSheet(active: boolean, projectId: string) {
  const [cameraObj, setCameraObj] = useState<ISheetObject<any> | null>(null);
  const [sheet, setSheet] = useState<ISheet | null>(null);
  
  useEffect(() => {
    if (active) {
      const p = getProject(projectId || "PawsMemories");
      const s = p.sheet("Scene");
      setSheet(s);
      
      const obj = s.object("Camera", {
        position: types.compound({ x: types.number(0), y: types.number(2), z: types.number(5) }),
        fov: types.number(50, { range: [10, 120] }),
      });
      setCameraObj(obj);

      if (!studioInitialized) {
        import("@theatre/studio").then(studio => {
          studio.default.initialize();
          studioInitialized = true;
        }).catch(e => {
          console.error("Failed to load theatre studio", e);
        });
      }
    }
  }, [active, projectId]);

  return { cameraObj, sheet };
}
