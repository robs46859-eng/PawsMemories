import React, { useEffect, useState, useRef, useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { Play, Pause, FastForward, Video, Plus, X, List, Clapperboard, Download, Square, Sun, CloudRain, Volume2, VolumeX, Mic } from "lucide-react";
import { useSceneController, SceneTicker } from "../controller/useSceneController.ts";
import { useCaptureSession } from "../capture/useCaptureSession.ts";
import { ANIMATOR_DEFAULTS } from "../defaults.ts";
import { WeatherSystem, WeatherType } from "../scenes/weather/WeatherSystem.tsx";
import { SoundSystem } from "../scenes/sound/SoundSystem.tsx";
import { evaluateSequence, SceneSequence } from "../scenes/SceneSequence.ts";
import { lightingFor } from "../scenes/lightingRig.ts";

// The viewport rendering the SceneController's scene
function Viewport({ 
  sceneController, 
  environment, 
  weather, 
  cameraState,
  soundMuted,
}: { 
  sceneController: ReturnType<typeof useSceneController>,
  environment: any,
  weather: WeatherType,
  cameraState: { position: [number, number, number], fov: number },
  soundMuted: boolean,
}) {
  const scene = sceneController.getScene();
  
  const lighting = useMemo(() => {
    if (environment) {
      return lightingFor("afternoon", environment);
    }
    return null;
  }, [environment]);

  return (
    <>
      {/* Per-frame controller tick — must live inside <Canvas> */}
      <SceneTicker controller={sceneController} />

      <primitive object={scene} />

      <WeatherSystem weather={weather} />
      
      {environment && (
        <SoundSystem 
          ambientUrl={environment.ambientSound} 
          weather={weather} 
          volume={soundMuted ? 0 : ANIMATOR_DEFAULTS.sound.volume} 
        />
      )}

      {environment ? (
        <Environment preset={environment.hdriBucketUrl ? undefined : "city"} files={environment.hdriBucketUrl} background={!!environment.hdriBucketUrl} />
      ) : (
        <Environment preset="city" />
      )}
      
      <ContactShadows 
        resolution={1024} 
        scale={10} 
        blur={ANIMATOR_DEFAULTS.shadows.contactShadowBlur} 
        opacity={ANIMATOR_DEFAULTS.shadows.contactShadowOpacity} 
        far={10} 
      />
      
      <OrbitControls 
        makeDefault 
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
  
  const [activeEnvId, setActiveEnvId] = useState<string>("");
  const [weather, setWeather] = useState<WeatherType>("clear");
  const [soundMuted, setSoundMuted] = useState(false);
  const [activeSequenceId, setActiveSequenceId] = useState<string>("");
  
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

      rafRef.current = requestAnimationFrame(updateTimeline);
    };
    rafRef.current = requestAnimationFrame(updateTimeline);
    return () => cancelAnimationFrame(rafRef.current!);
  }, [activeController, activeSequence]);

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

  return (
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
        <Canvas 
          ref={canvasRef}
          camera={{ 
            position: cameraState.position, 
            fov: cameraState.fov 
          }}
          gl={{
            toneMapping: (React as any).useMemo(() => (THREE as any)[ANIMATOR_DEFAULTS.renderer.toneMapping], []),
            outputColorSpace: ANIMATOR_DEFAULTS.renderer.outputColorSpace,
          }}
          dpr={[1, ANIMATOR_DEFAULTS.renderer.dprMax]}
          shadows={{ type: ANIMATOR_DEFAULTS.renderer.shadowMapType as any }}
        >
          <Viewport 
            sceneController={sceneController} 
            environment={activeEnv}
            weather={weather}
            cameraState={cameraState}
            soundMuted={soundMuted}
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
              </div>

              {/* Clips Panel */}
              {activeController && (
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto max-w-[300px] max-h-[40vh] overflow-y-auto">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">Animations</h3>
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

        </div>
      </div>

      {/* Add Actor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <form onSubmit={handleAddActor} className="bg-slate-900 rounded-3xl p-6 w-full max-w-sm border border-white/10 shadow-2xl">
            <h2 className="text-lg font-bold mb-4">Add Model to Stage</h2>
            <p className="text-xs text-white/60 mb-4">
              Enter an Asset ID, URL, or select from your dashboard. (Phase 3 currently supports pasting the Asset ID).
            </p>
            <input 
              type="text" 
              placeholder="Asset ID or URL..." 
              value={addingAssetId}
              onChange={(e) => setAddingAssetId(e.target.value)}
              className="w-full bg-black/50 border border-white/20 rounded-xl p-3 text-sm mb-6 outline-none focus:border-primary transition-colors"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white/60 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:brightness-110 transition-colors"
              >
                Add Actor
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
