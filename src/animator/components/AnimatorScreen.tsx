import React, { useEffect, useState, useRef, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { Play, Pause, FastForward, Video, Plus, X, List, Clapperboard, Download, Square, Sun, CloudRain, Volume2, VolumeX, Mic } from "lucide-react";
import { useSceneController, SceneTicker } from "../controller/useSceneController.ts";
import { useCaptureSession } from "../capture/useCaptureSession.ts";
import { ANIMATOR_DEFAULTS } from "../defaults.ts";
import { WeatherSystem, WeatherType } from "../scenes/weather/WeatherSystem.tsx";
import { SoundSystem } from "../scenes/sound/SoundSystem.tsx";
import { evaluateSequence, SceneSequence } from "../scenes/SceneSequence.ts";
import { lightingFor } from "../scenes/lightingRig.ts";
import { AnimatorErrorBoundary } from "./AnimatorErrorBoundary.tsx";
import { isMobile, hasWebGL2, hasWebCodecs } from "../utils/capabilities.ts";
import { filterReadyAvatars, resolveAvatarGlbUrl } from "../utils/avatarUtils.ts";
import { ALL_OBJECT_KINDS, OBJECT_CATALOG } from "../../three/objects/catalog.ts";
import { runScript } from "../scenes/SceneSequence.ts";
import { retargetClip } from "../utils/retargetUtils.ts";
import { findSkinnedMesh } from "../../three/ar/ik.ts";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useTheatreSheet } from "./TheatreWrapper.tsx";

/**
 * Renders the scene backdrop based on the preset's `backdrop.kind`.
 * Previously the code read `environment.hdriBucketUrl` (which never existed on
 * the preset schema), so HDRIs fell back to "city" and `image` backdrops — like
 * the Arkham renders — displayed nothing at all. This switches on the real
 * `backdrop: { kind, url }` shape returned by /api/scenes/environments.
 */
function SceneBackdrop({ backdrop }: { backdrop?: { kind?: string; url?: string } }) {
  const { scene } = useThree();
  const kind = backdrop?.kind;
  const url = backdrop?.url;
  const mobile = isMobile();

  // Flat image renders (kind: "image") can't be a drei <Environment>; set them as
  // scene.background so they fill the viewport no matter where the camera orbits.
  useEffect(() => {
    if (kind !== "image" || !url || mobile) {
      if (scene.background instanceof THREE.Texture) {
        scene.background.dispose();
      }
      scene.background = null;
      return;
    }
    let disposed = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tex) => {
        if (disposed) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        scene.background = tex;
      },
      undefined,
      (err) => console.warn("[Animator] backdrop image failed to load:", url, err)
    );
    return () => {
      disposed = true;
      if (scene.background instanceof THREE.Texture) {
        scene.background.dispose();
        scene.background = null;
      }
    };
  }, [kind, url, scene]);

  if (mobile) {
    return <Environment preset="city" background />;
  }
  
  if (kind === "hdri" || kind === "dome360") {
    // 360° map: lights the pet AND shows as the visible background.
    return url ? <Environment files={url} background /> : <Environment preset="city" />;
  }
  if (kind === "image") {
    // Image is the scene.background (above); light the pet with a neutral studio env.
    return <Environment preset="apartment" />;
  }
  // procedural / glb-scene(unbuilt) / none → neutral visible environment.
  return <Environment preset="city" background />;
}

/**
 * Syncs the R3F camera with Theatre's imperative camera object state
 */
function TheatreCameraRig({ cameraObj }: { cameraObj: any }) {
  const { camera } = useThree();
  
  useFrame(() => {
    if (cameraObj) {
      const v = cameraObj.value;
      camera.position.set(v.position.x, v.position.y, v.position.z);
      if ((camera as THREE.PerspectiveCamera).fov !== v.fov) {
        (camera as THREE.PerspectiveCamera).fov = v.fov;
        camera.updateProjectionMatrix();
      }
    }
  });
  
  return null;
}

/**
 * Inner viewport component that depends on `useThree` context.
 */
function Viewport({
  sceneController,
  environment,
  weather,
  cameraState,
  soundMuted,
  lightTarget,
  soundCue,
  ikOptions,
  proMode,
  cameraObj,
}: {
  sceneController: ReturnType<typeof useSceneController>,
  environment: any,
  weather: WeatherType,
  cameraState: { position: [number, number, number], fov: number },
  soundMuted: boolean,
  lightTarget: any,
  soundCue: any,
  ikOptions: any,
  proMode?: boolean,
  cameraObj?: any,
}) {
  const scene = sceneController.getScene();
  
  const lighting = useMemo(() => {
    if (environment) {
      const baseTime = typeof lightTarget === 'string' ? lightTarget : (environment.defaultTimeOfDay || "afternoon");
      const baseLighting = lightingFor(baseTime as any, environment);
      return typeof lightTarget === 'object' ? { ...baseLighting, ...lightTarget } : baseLighting;
    }
    return null;
  }, [environment, lightTarget]);

  return (
    <>
      {/* Per-frame controller tick — must live inside <Canvas> */}
      <SceneTicker controller={sceneController} ikOptions={ikOptions} />

      <primitive object={scene} />

      {proMode && (
        <TheatreCameraRig cameraObj={cameraObj} />
      )}

      <WeatherSystem weather={weather} />
      
      {environment && (
        <SoundSystem 
          ambientUrl={environment.ambientSound} 
          weather={weather} 
          volume={soundMuted ? 0 : ANIMATOR_DEFAULTS.sound.volume} 
          soundCue={soundCue}
        />
      )}

      <SceneBackdrop backdrop={environment?.backdrop} />
      
      <ContactShadows 
        resolution={1024} 
        scale={10} 
        blur={ANIMATOR_DEFAULTS.shadows.contactShadowBlur} 
        opacity={ANIMATOR_DEFAULTS.shadows.contactShadowOpacity} 
        far={10} 
      />
      
      <OrbitControls 
        makeDefault 
        enabled={!proMode}
        target={ANIMATOR_DEFAULTS.camera.target}
        maxPolarAngle={Math.PI / 2 + 0.1}
      />
      
      {/* Dynamic Lighting from Profile */}
      {lighting ? (
        <>
          <ambientLight intensity={lighting.ambientIntensity} />
          <directionalLight 
            position={lighting.sunPosition} 
            intensity={lighting.sunIntensity} 
            castShadow 
          />
          {lighting.fogDensity > 0 && (
            <fogExp2 attach="fog" color={lighting.fogColor} density={lighting.fogDensity} />
          )}
        </>
      ) : (
        <>
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
        </>
      )}
    </>
  );
}

export default function AnimatorScreen({
  initialAssetId,
  onClose
}: {
  initialAssetId: string | null;
  onClose: () => void;
}) {
  const sceneController = useSceneController();
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1.0);
  const [timeline, setTimeline] = useState(0); // 0 to 1
  
  const [mode, setMode] = useState<"cast" | "scene">("cast");
  const [environments, setEnvironments] = useState<any[]>([]);
  const [scripts, setScripts] = useState<any[]>([]);
  const [directorScripts, setDirectorScripts] = useState<any[]>([]);
  const [userAvatars, setUserAvatars] = useState<any[]>([]);
  const [libraryClips, setLibraryClips] = useState<any[]>([]);
  const [activeDirectorScript, setActiveDirectorScript] = useState<any>(null);
  const [castAssignments, setCastAssignments] = useState<Record<string, string>>({});
  const [mappedRoles, setMappedRoles] = useState<Record<string, string>>({});
  const [ikOptions, setIkOptions] = useState<Record<string, { groundIK: boolean, lookAtCamera: boolean }>>({});
  const [proMode, setProMode] = useState(false);
  
  const { cameraObj } = useTheatreSheet(proMode, "PawsMemories");
  
  const mobile = useMemo(() => isMobile(), []);
  const webGL2 = useMemo(() => hasWebGL2(), []);
  const webCodecs = useMemo(() => hasWebCodecs(), []);
  const [contextLost, setContextLost] = useState(false);
  
  const [activeEnvId, setActiveEnvId] = useState<string>("");
  const [weather, setWeather] = useState<WeatherType>("clear");
  const [lightTarget, setLightTarget] = useState<any>(null);
  const [soundTarget, setSoundTarget] = useState<any>(null);
  const [soundMuted, setSoundMuted] = useState(false);
  const [activeSequenceId, setActiveSequenceId] = useState<string>("");
  
  const [morphInfluences, setMorphInfluences] = useState<Record<string, number>>({});
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  
  const [voiceoverText, setVoiceoverText] = useState("");
  const [isVoiceoverRunning, setIsVoiceoverRunning] = useState(false);
  
  const [addingAssetId, setAddingAssetId] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  
  const rafRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureSession = useCaptureSession(canvasRef);

  const actors = sceneController.listActors();
  const activeActorId = sceneController.getActiveActorId();
  const activeController = activeActorId ? sceneController.getActorController(activeActorId) : null;
  
  const duration = activeController ? activeController.getDuration() : 10;
  
  const activeEnv = environments.find(e => e.id === activeEnvId);
  const activeSequence = ANIMATOR_DEFAULTS.sequences.find(s => s.id === activeSequenceId) as SceneSequence | undefined;
  
  const [cameraState, setCameraState] = useState({ 
    position: ANIMATOR_DEFAULTS.camera.position as [number, number, number], 
    fov: ANIMATOR_DEFAULTS.camera.fov 
  });
  
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    if (activeController) {
      const morphs = activeController.listMorphTargets();
      const initial: Record<string, number> = {};
      morphs.forEach(m => initial[m] = 0);
      setMorphInfluences(initial);
    }
  }, [activeController]);

  const handleMorphChange = (name: string, value: number) => {
    setMorphInfluences(prev => ({ ...prev, [name]: value }));
    if (activeController) {
      activeController.setMorphInfluence(name, value);
    }
  };
  
  const saveBookmark = () => {
    if (cameraRef.current) {
      const pos = cameraRef.current.position;
      setBookmarks(prev => [...prev, {
        id: Date.now().toString(),
        name: `Cam ${prev.length + 1}`,
        position: [pos.x, pos.y, pos.z],
        fov: cameraRef.current!.fov
      }]);
    }
  };

  // Fetch presets
  useEffect(() => {
    fetch("/api/scenes/environments", { headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }})
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setEnvironments(data);
      })
      .catch(console.error);
      
    fetch("/api/scenes/scripts", { headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }})
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setScripts(data);
      })
      .catch(console.error);
      
      fetch("/api/scenes/director-scripts", { headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }})
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setDirectorScripts(data);
      })
      .catch(console.error);

    fetch("/api/avatars", { headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }})
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setUserAvatars(filterReadyAvatars(data));
        }
      })
      .catch(console.error);
      
    fetch("/api/scenes/clips", { headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }})
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setLibraryClips(data);
      })
      .catch(console.error);
  }, []);

  // Sync timeline progress and evaluate sequences
  useEffect(() => {
    const updateTimeline = () => {
      let currentTime = 0;
      if (activeController) {
        currentTime = activeController.getCurrentTime();
        setTimeline(currentTime / (activeController.getDuration() || 1));
      }
      
      if (activeSequence) {
        const state = evaluateSequence(activeSequence, currentTime);
        if (state.weatherTarget) {
          setWeather(state.weatherTarget as WeatherType);
        }
        if (state.cameraTarget) {
          setCameraState(state.cameraTarget);
        }
        if (state.clipTarget && activeController) {
          activeController.selectClip(state.clipTarget);
        }
      }
      
      if (activeDirectorScript) {
        const state = runScript(activeDirectorScript, currentTime);
        if (state.cameraTarget) setCameraState(state.cameraTarget);
        if (state.weatherTarget) setWeather(state.weatherTarget as WeatherType);
        if (state.lightTarget) setLightTarget(state.lightTarget);
        if (state.soundTarget) setSoundTarget(state.soundTarget);

        for (const [roleId, clipTarget] of Object.entries(state.clipTargets)) {
          const actorId = mappedRoles[roleId];
          if (actorId) {
            const controller = sceneController.getActorController(actorId);
            if (controller) {
              const blend = clipTarget.blend || 0;
              if (blend > 0) {
                controller.crossFadeTo(clipTarget.name, blend);
              } else {
                controller.selectClip(clipTarget.name, 0);
              }
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(updateTimeline);
    };
    rafRef.current = requestAnimationFrame(updateTimeline);
    return () => cancelAnimationFrame(rafRef.current!);
  }, [activeController, activeSequence, activeDirectorScript]);

  // Load initial asset
  useEffect(() => {
    if (initialAssetId) {
      sceneController.addActor(initialAssetId).catch(console.error);
    }
  }, [initialAssetId, sceneController]);

  const handlePlayPause = () => {
    if (isPlaying) sceneController.pauseAll();
    else sceneController.playAll();
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setTimeline(v);
    sceneController.seekAll(v * duration);
  };

  const handleSpeed = (v: number) => {
    setSpeed(v);
    sceneController.setGlobalSpeed(v);
  };

  const handleAddActor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingAssetId) return;
    if (mobile && actors.length >= 2) {
      alert("Mobile devices are limited to 2 actors to preserve memory.");
      return;
    }
    sceneController.addActor(addingAssetId);
    setShowAddModal(false);
    setAddingAssetId("");
  };
  
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const handleGenerateVoiceover = async () => {
    if (!voiceoverText) return;
    setIsVoiceoverRunning(true);
    try {
      let currentRecordingId = recordingId;
      if (!currentRecordingId) {
        if (!captureSession.hasRecording) {
          alert("Please record a video first!");
          setIsVoiceoverRunning(false);
          return;
        }
        const data = await captureSession.saveToBackend();
        currentRecordingId = data.filename;
        setRecordingId(currentRecordingId);
      }

      const res = await fetch("/api/scenes/voiceover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({
          recordingId: currentRecordingId,
          text: voiceoverText
        })
      });
      const data = await res.json();
      if (!data.success) {
        alert("Failed: " + data.error);
      } else {
        alert("Voiceover queued! Job ID: " + data.jobId);
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsVoiceoverRunning(false);
    }
  };

  const handleApplyCast = async () => {
    if (!activeDirectorScript) return;
    sceneController.dispose(); // clear existing actors
    const newMappedRoles: Record<string, string> = {};
    for (const role of activeDirectorScript.roles || []) {
      const avatarId = castAssignments[role.id];
      if (avatarId) {
        const avatar = userAvatars.find(a => String(a.id) === avatarId);
        if (avatar) {
          const glbUrl = resolveAvatarGlbUrl(avatar);
          const actorId = await sceneController.addActor(glbUrl, { label: avatar.name || role.name });
          newMappedRoles[role.id] = actorId;
        }
      }
    }
    setMappedRoles(newMappedRoles);
    setIsPlaying(true);
  };

  const handleApplyLibraryClip = async (clipData: any) => {
    if (!activeController || !activeActorId) return;
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(clipData.url);
      const srcClip = gltf.animations[0];
      if (!srcClip) return;
      
      const srcMesh = findSkinnedMesh(gltf.scene);
      const tgtRoot = sceneController.getActorRoot(activeActorId);
      const tgtMesh = tgtRoot ? findSkinnedMesh(tgtRoot) : null;
      
      if (srcMesh && tgtMesh) {
        const retargeted = retargetClip(tgtMesh, srcMesh, srcClip, clipData.skeleton);
        retargeted.name = clipData.id;
        activeController.addClip(retargeted);
        activeController.crossFadeTo(retargeted.name, 0.5);
      } else {
        alert("Could not find required SkinnedMesh to retarget.");
      }
    } catch (e: any) {
      alert("Failed to apply library animation: " + e.message);
    }
  };

  return (
    <AnimatorErrorBoundary hasWebGL2={webGL2} onClose={onClose}>
      <div className="fixed inset-0 z-50 bg-black text-white flex flex-col font-sans">
          {/* Top Bar */}
          <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Clapperboard className="text-primary" />
                <h1 className="font-extrabold text-lg tracking-tight">Studio Animator</h1>
              </div>
              
              <div className="flex bg-white/10 rounded-full p-1 border border-white/10 ml-4">
                <button 
                  onClick={() => setMode("cast")}
                  className={`px-4 py-1 rounded-full text-xs font-bold transition-colors ${mode === "cast" ? "bg-primary text-white shadow-lg" : "text-white/60 hover:text-white"}`}
                >
                  Cast
                </button>
                <button 
                  onClick={() => setMode("scene")}
                  className={`px-4 py-1 rounded-full text-xs font-bold transition-colors ${mode === "scene" ? "bg-primary text-white shadow-lg" : "text-white/60 hover:text-white"}`}
                >
                  Scene
                </button>
              </div>
            </div>
            
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* 3D Viewport */}
          <div className="flex-1 w-full h-full relative">
            {contextLost && (
              <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center text-white p-6 text-center" onClick={() => setContextLost(false)}>
                <div>
                  <h2 className="text-xl font-bold mb-2">Graphics Context Lost</h2>
                  <p className="text-white/60 mb-4">The device ran out of graphics memory or the app went to the background.</p>
                  <p className="text-sm font-bold text-primary animate-pulse">Tap anywhere to resume</p>
                </div>
              </div>
            )}
            <Canvas 
              ref={canvasRef}
              camera={{ 
                position: cameraState.position, 
                fov: cameraState.fov 
              }}
              gl={{
                toneMapping: (React as any).useMemo(() => (THREE as any)[ANIMATOR_DEFAULTS.renderer.toneMapping], []),
                outputColorSpace: ANIMATOR_DEFAULTS.renderer.outputColorSpace,
                powerPreference: "high-performance",
                failIfMajorPerformanceCaveat: false,
                antialias: !mobile
              }}
              dpr={mobile ? [1, 1.5] : [1, ANIMATOR_DEFAULTS.renderer.dprMax]}
              shadows={{ type: ANIMATOR_DEFAULTS.renderer.shadowMapType as any }}
              onCreated={({ camera, gl }) => { 
                cameraRef.current = camera as THREE.PerspectiveCamera; 
                gl.domElement.addEventListener("webglcontextlost", (e) => {
                  e.preventDefault();
                  setContextLost(true);
                  if (isPlaying) {
                    sceneController.pauseAll();
                    setIsPlaying(false);
                  }
                });
                gl.domElement.addEventListener("webglcontextrestored", () => {
                  setContextLost(false);
                });
              }}
            >
              <Viewport 
                sceneController={sceneController} 
                environment={activeEnv}
                weather={weather}
                cameraState={cameraState}
                soundMuted={soundMuted}
                lightTarget={lightTarget}
                soundCue={soundTarget}
                ikOptions={ikOptions}
                proMode={proMode}
                cameraObj={cameraObj}
              />
            </Canvas>
          </div>

      {/* HUD Overlays */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 flex flex-col gap-4 pointer-events-none">
        
        {/* Middle HUD */}
        <div className="flex justify-between items-end w-full max-w-7xl mx-auto">
          
          {mode === "cast" && (
            <>
              {/* Actors Panel */}
              <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto min-w-[200px]">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1">
                    <List size={12} /> Cast
                  </h3>
                  <button onClick={() => setShowAddModal(true)} className="hover:text-primary transition-colors">
                    <Plus size={16} />
                  </button>
                </div>
                
                <div className="flex flex-col gap-1 max-h-[30vh] overflow-y-auto">
                  {actors.length === 0 && <span className="text-xs text-white/40 italic">Empty Stage</span>}
                  {actors.map((actor) => (
                    <div 
                      key={actor.actorId} 
                      className={`flex justify-between items-center p-2 rounded-lg cursor-pointer transition-colors ${activeActorId === actor.actorId ? 'bg-primary/20 border border-primary/50' : 'hover:bg-white/5 border border-transparent'}`}
                      onClick={() => sceneController.setActiveActor(actor.actorId)}
                    >
                      <span className="text-sm font-medium truncate max-w-[120px]">{actor.label}</span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); sceneController.removeActor(actor.actorId); }}
                        className="opacity-50 hover:opacity-100 hover:text-error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                
                <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider mt-2 border-t border-white/10 pt-3">Objects</h3>
                <div className="flex flex-wrap gap-2 max-h-[15vh] overflow-y-auto pb-1">
                  {ALL_OBJECT_KINDS.map(kind => {
                    const def = OBJECT_CATALOG[kind];
                    return (
                      <button 
                        key={kind}
                        onClick={() => {
                          if (!def.glbUrl) return;
                          if (mobile && actors.length >= 2) {
                            alert("Mobile devices are limited to 2 actors to preserve memory.");
                            return;
                          }
                          sceneController.addActor(def.glbUrl, { label: def.label });
                        }}
                        className="w-10 h-10 bg-white/5 hover:bg-white/20 rounded-lg flex items-center justify-center text-xl transition-colors border border-transparent hover:border-primary/50"
                        title={def.label}
                      >
                        {def.emoji}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Clips Panel */}
              {activeController && (
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto max-w-[300px] max-h-[40vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">Animations</h3>
                    {false /* Hidden until retargeting pipeline is wired */ && (
                      <button 
                        className="text-[10px] bg-primary/20 text-primary px-2 py-1 rounded-md hover:bg-primary/40 transition-colors"
                        title="Generate more animations (1 Credit)"
                      >
                        + More (1 🪙)
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeController.listClips().map((clip) => (
                      <button
                        key={clip.name}
                        onClick={() => { setActiveSequenceId(""); activeController.selectClip(clip.name); }}
                        className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-primary/40 border border-white/5 transition-all text-left truncate max-w-full"
                        title={clip.name}
                      >
                        {clip.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* IK Panel */}
              {activeController && activeActorId && (
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto w-[250px]">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">IK Controls</h3>
                  <div className="flex flex-col gap-2">
                    <label className="flex justify-between text-xs items-center">
                      <span className="text-white font-medium">Ground IK (Planted Feet)</span>
                      <input 
                        type="checkbox" 
                        checked={ikOptions[activeActorId]?.groundIK || false}
                        onChange={(e) => setIkOptions(prev => ({
                          ...prev,
                          [activeActorId]: { ...prev[activeActorId], groundIK: e.target.checked }
                        }))}
                        className="accent-primary"
                      />
                    </label>
                    <label className="flex justify-between text-xs items-center">
                      <span className="text-white font-medium">Look at Camera</span>
                      <input 
                        type="checkbox" 
                        checked={ikOptions[activeActorId]?.lookAtCamera || false}
                        onChange={(e) => setIkOptions(prev => ({
                          ...prev,
                          [activeActorId]: { ...prev[activeActorId], lookAtCamera: e.target.checked }
                        }))}
                        className="accent-primary"
                      />
                    </label>
                  </div>
                </div>
              )}
              
              {/* Library Clips Panel */}
              {activeController && libraryClips.length > 0 && (
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto max-w-[300px] max-h-[30vh] overflow-y-auto">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">Library Animations</h3>
                  <div className="flex flex-wrap gap-2">
                    {libraryClips.map((clip) => (
                      <button
                        key={clip.id}
                        onClick={() => handleApplyLibraryClip(clip)}
                        className="text-xs px-3 py-1.5 rounded-full bg-primary/20 hover:bg-primary/40 text-primary border border-primary/20 transition-all text-left truncate max-w-full"
                        title={clip.description}
                      >
                        + {clip.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Morph Targets Panel */}
              {activeController && Object.keys(morphInfluences).length > 0 && (
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto w-[250px] max-h-[40vh] overflow-y-auto">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">Morph Targets</h3>
                  <div className="flex flex-col gap-2">
                    {Object.keys(morphInfluences).map(morph => (
                      <div key={morph} className="flex flex-col gap-1">
                        <div className="flex justify-between text-xs">
                          <span>{morph}</span>
                          <span className="text-white/40">{morphInfluences[morph].toFixed(2)}</span>
                        </div>
                        <input 
                          type="range" min="0" max="1" step="0.01" 
                          value={morphInfluences[morph]} 
                          onChange={(e) => handleMorphChange(morph, parseFloat(e.target.value))}
                          className="accent-primary"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {mode === "scene" && (
            <div className="flex gap-4 items-end pointer-events-none">
              {/* Environment & Weather Panel */}
              <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto w-[250px]">
                <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1">
                  <Sun size={12} /> Environments
                </h3>
                <div className="grid grid-cols-2 gap-2 max-h-[20vh] overflow-y-auto">
                  <button 
                    onClick={() => setActiveEnvId("")}
                    className={`text-xs p-2 rounded-xl text-center border transition-all ${activeEnvId === "" ? 'bg-primary/30 border-primary' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                  >
                    Default
                  </button>
                  {environments.map(env => (
                    <button 
                      key={env.id}
                      onClick={() => setActiveEnvId(env.id)}
                      className={`text-xs p-2 rounded-xl text-center border transition-all truncate ${activeEnvId === env.id ? 'bg-primary/30 border-primary' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                    >
                      {env.name}
                    </button>
                  ))}
                </div>
                
                <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1 mt-2">
                  <CloudRain size={12} /> Weather
                </h3>
                <select 
                  value={weather}
                  onChange={(e) => setWeather(e.target.value as WeatherType)}
                  className="bg-black/50 border border-white/20 rounded-xl p-2 text-xs outline-none focus:border-primary w-full"
                >
                  <option value="clear">Clear</option>
                  <option value="rain">Rain</option>
                  <option value="snow">Snow</option>
                  <option value="fog">Fog</option>
                  <option value="overcast">Overcast</option>
                </select>
                
                <button 
                  onClick={() => setSoundMuted(!soundMuted)}
                  className={`flex items-center gap-2 text-xs p-2 rounded-xl justify-center transition-colors border ${soundMuted ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-white/10 border-transparent hover:bg-white/20'}`}
                >
                  {soundMuted ? <VolumeX size={14} /> : <Volume2 size={14} />} 
                  {soundMuted ? "Sound Muted" : "Sound Enabled"}
                </button>
              </div>

                {/* Sequences & Voiceover Panel */}
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto w-[300px]">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">Sequences</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setActiveSequenceId("")}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all ${activeSequenceId === "" ? 'bg-primary/40 border-primary' : 'bg-white/10 border-white/5 hover:bg-white/20'}`}
                    >
                      Free Play
                    </button>
                    {ANIMATOR_DEFAULTS.sequences.map(seq => (
                      <button
                        key={seq.id}
                        onClick={() => setActiveSequenceId(seq.id)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${activeSequenceId === seq.id ? 'bg-primary/40 border-primary' : 'bg-white/10 border-white/5 hover:bg-white/20'}`}
                      >
                        {seq.name}
                      </button>
                    ))}
                  </div>

                  <div className="w-full h-px bg-white/10 my-1"></div>
                  
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1">
                    <Mic size={12} /> Voiceover
                  </h3>
                  <textarea 
                    value={voiceoverText}
                    onChange={(e) => setVoiceoverText(e.target.value)}
                    placeholder="Enter script here..."
                    className="bg-black/50 border border-white/20 rounded-xl p-2 text-xs outline-none focus:border-primary w-full h-16 resize-none"
                  />
                  <div className="flex justify-between items-center">
                    <select 
                      onChange={(e) => setVoiceoverText(e.target.value)}
                      className="bg-transparent border-none text-xs text-white/60 outline-none w-24"
                      value=""
                    >
                      <option value="" disabled>Presets...</option>
                      {scripts.map(s => (
                        <option key={s.id} value={s.text}>{s.title}</option>
                      ))}
                    </select>
                    <button 
                      onClick={handleGenerateVoiceover}
                      disabled={isVoiceoverRunning || !voiceoverText}
                      className="bg-primary text-on-primary text-xs font-bold px-3 py-1.5 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isVoiceoverRunning ? "Generating..." : "Generate Audio"}
                    </button>
                  </div>

                  <div className="w-full h-px bg-white/10 my-1"></div>

                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center justify-between">
                    <span>Camera Bookmarks</span>
                    <button onClick={saveBookmark} className="hover:text-primary transition-colors text-white/60">
                      <Plus size={14} />
                    </button>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {bookmarks.length === 0 && <span className="text-[10px] text-white/40">No bookmarks saved</span>}
                    {bookmarks.map((b, i) => (
                      <button 
                        key={b.id}
                        onClick={() => setCameraState({ position: b.position, fov: b.fov })}
                        className="text-xs px-2 py-1 bg-white/10 hover:bg-white/20 rounded border border-transparent"
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Director Scripts Panel */}
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto min-w-[200px]">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1">
                    <Play size={12} /> Director Scripts
                  </h3>
                  <div className="flex flex-col gap-1 max-h-[30vh] overflow-y-auto">
                    {directorScripts.length === 0 && <span className="text-xs text-white/40 italic">No scripts found.</span>}
                    {directorScripts.map(script => (
                      <div 
                        key={script.id}
                        onClick={() => {
                          setActiveDirectorScript(script);
                          setActiveSequenceId("");
                          if (script.recommendedEnvironment) {
                            const env = environments.find(e => e.id === script.recommendedEnvironment);
                            if (env) setActiveEnvId(env.id);
                          }
                          // Pre-fill castAssignments if possible
                          const initialCast: Record<string, string> = {};
                          (script.roles || []).forEach((r: any, i: number) => {
                             if (userAvatars[i]) {
                               initialCast[r.id] = String(userAvatars[i].id);
                             }
                          });
                          setCastAssignments(initialCast);
                        }}
                        className={`p-2 rounded-lg cursor-pointer text-sm font-medium transition-colors ${activeDirectorScript?.id === script.id ? 'bg-primary/20 text-primary border border-primary/50' : 'hover:bg-white/5 border border-transparent'}`}
                      >
                        {script.name}
                      </div>
                    ))}
                  </div>
                  {activeDirectorScript && activeDirectorScript.roles && activeDirectorScript.roles.length > 0 && (
                    <div className="mt-2 p-3 bg-white/5 rounded-xl border border-white/10 flex flex-col gap-2">
                      <h4 className="text-xs font-bold text-white/60 uppercase">Cast Assignments</h4>
                      {activeDirectorScript.roles.map((role: any) => (
                        <div key={role.id} className="flex justify-between items-center text-xs">
                          <span className="text-white font-medium">{role.name}</span>
                          <select 
                            className="bg-black/50 border border-white/20 rounded p-1 text-white max-w-[120px]"
                            value={castAssignments[role.id] || ""}
                            onChange={(e) => setCastAssignments(prev => ({ ...prev, [role.id]: e.target.value }))}
                          >
                            <option value="">(Skip Role)</option>
                            {userAvatars.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                      <button 
                        onClick={handleApplyCast}
                        className="mt-2 w-full py-1.5 bg-primary text-on-primary font-bold rounded-lg text-xs"
                      >
                        Apply Cast & Play
                      </button>
                    </div>
                  )}
                </div>
              </div>
          )}
        </div>

        {/* Bottom Transport Controls */}
        <div className="bg-black/80 backdrop-blur-xl rounded-2xl border border-white/10 p-4 w-full max-w-7xl mx-auto flex items-center gap-4 pointer-events-auto shadow-2xl">
          
          <button 
            onClick={handlePlayPause}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-primary hover:bg-primary/90 text-on-primary transition-transform active:scale-95 flex-shrink-0 shadow-lg shadow-primary/20"
          >
            {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current ml-1" />}
          </button>

          <div className="flex-1 flex flex-col gap-1">
            <input 
              type="range" 
              min="0" max="1" step="0.001" 
              value={timeline} 
              onChange={handleSeek}
              className="w-full accent-primary h-2 bg-white/20 rounded-full appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-white/40 font-mono">
              <span>{(timeline * duration).toFixed(2)}s</span>
              <span>{duration.toFixed(2)}s</span>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white/5 rounded-full px-3 py-1 border border-white/10">
            <FastForward size={14} className="text-white/60" />
            <select 
              value={speed} 
              onChange={(e) => handleSpeed(parseFloat(e.target.value))}
              className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
            >
              <option value={0.5} className="bg-slate-900">0.5x</option>
              <option value={1.0} className="bg-slate-900">1.0x</option>
              <option value={1.5} className="bg-slate-900">1.5x</option>
              <option value={2.0} className="bg-slate-900">2.0x</option>
            </select>
          </div>

          {webCodecs && (
            <>
              <div className="w-px h-8 bg-white/20 mx-2"></div>

              {captureSession.isRecording ? (
                <button 
                  onClick={captureSession.stop}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-red-600 rounded-full text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-white/20"
                >
                  <Square size={16} className="fill-current" /> Stop
                </button>
              ) : captureSession.hasRecording ? (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={captureSession.download}
                    className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-full text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-secondary/20"
                  >
                    <Download size={16} /> Save
                  </button>
                  <button 
                    onClick={captureSession.start}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-all text-white/80"
                    title="Record Again"
                  >
                    <Video size={16} />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={captureSession.start}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-red-600/20"
                >
                  <Video size={16} /> Record
                </button>
              )}
            </>
          )}

        </div>
      </div>

      {/* Add Actor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <form onSubmit={handleAddActor} className="bg-slate-900 rounded-3xl p-6 w-full max-w-sm border border-white/10 shadow-2xl">
            <h2 className="text-lg font-bold mb-4">Add Model to Stage</h2>
            
            <div className="flex flex-col gap-2 mb-6 max-h-[40vh] overflow-y-auto">
              {userAvatars.length === 0 ? (
                <div className="text-white/40 text-sm italic text-center p-4 bg-black/20 rounded-xl">No ready avatars found.</div>
              ) : (
                userAvatars.map(avatar => (
                  <div 
                    key={avatar.id}
                    onClick={() => {
                      const url = resolveAvatarGlbUrl(avatar);
                      if (!url) return;
                      if (mobile && actors.length >= 2) {
                        alert("Mobile devices are limited to 2 actors to preserve memory.");
                        return;
                      }
                      sceneController.addActor(url, { label: avatar.name });
                      setShowAddModal(false);
                      setAddingAssetId("");
                    }}
                    className="flex items-center gap-3 p-3 bg-black/40 hover:bg-black/60 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-primary/50"
                  >
                    {avatar.imageUrl ? (
                      <img src={avatar.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover bg-black" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-xs">No img</div>
                    )}
                    <span className="font-medium text-sm flex-1 truncate">{avatar.name}</span>
                    <Plus size={16} className="text-white/40 group-hover:text-primary" />
                  </div>
                ))
              )}
            </div>

            <details className="mb-6 group">
              <summary className="text-xs text-white/40 hover:text-white cursor-pointer select-none mb-2 outline-none">
                Advanced: Paste URL
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <input 
                  type="text" 
                  placeholder="Asset ID or GLB URL..." 
                  value={addingAssetId}
                  onChange={(e) => setAddingAssetId(e.target.value)}
                  className="w-full bg-black/50 border border-white/20 rounded-xl p-3 text-sm outline-none focus:border-primary transition-colors"
                />
                <button 
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 text-white hover:bg-white/20 transition-colors self-end"
                >
                  Add Custom
                </button>
              </div>
            </details>

            <div className="flex gap-3 justify-between items-center">
              <label className="flex items-center gap-2 text-xs font-bold bg-black/60 px-3 py-1.5 rounded-full border border-white/10 pointer-events-auto">
                <span className="text-white/60">PRO MODE</span>
                <input type="checkbox" checked={proMode} onChange={e => setProMode(e.target.checked)} className="accent-primary" />
              </label>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white/60 hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
          </form>
        </div>
      )}
      </div>
    </AnimatorErrorBoundary>
  );
}
