import React, { useEffect, useState, useRef } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { Play, Pause, FastForward, Video, Plus, X, List, Clapperboard, Download, Square } from "lucide-react";
import { useSceneController } from "../controller/useSceneController.ts";
import { useCaptureSession } from "../capture/useCaptureSession.ts";
import { ANIMATOR_DEFAULTS } from "../defaults.ts";
import type { SceneActor } from "../types.ts";

// The viewport rendering the SceneController's scene
function Viewport({ sceneController }: { sceneController: ReturnType<typeof useSceneController> }) {
  const scene = sceneController.getScene();
  return (
    <>
      <primitive object={scene} />
      <Environment preset="city" />
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
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
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
  const [addingAssetId, setAddingAssetId] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const rafRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureSession = useCaptureSession(canvasRef);

  const actors = sceneController.listActors();
  const activeActorId = sceneController.getActiveActorId();
  const activeController = activeActorId ? sceneController.getActorController(activeActorId) : null;
  
  const duration = activeController ? activeController.getDuration() : 10;
  
  // Sync timeline progress
  useEffect(() => {
    const updateTimeline = () => {
      if (activeController) {
        setTimeline(activeController.getCurrentTime() / (activeController.getDuration() || 1));
      }
      rafRef.current = requestAnimationFrame(updateTimeline);
    };
    rafRef.current = requestAnimationFrame(updateTimeline);
    return () => cancelAnimationFrame(rafRef.current!);
  }, [activeController]);

  // Load initial asset
  useEffect(() => {
    if (initialAssetId) {
      sceneController.addActor(initialAssetId).catch(console.error);
    }
  }, [initialAssetId, sceneController]);

  const handlePlayPause = () => {
    if (isPlaying) {
      sceneController.pauseAll();
    } else {
      sceneController.playAll();
    }
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

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col font-sans">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <Clapperboard className="text-primary" />
          <h1 className="font-extrabold text-lg tracking-tight">Studio Animator</h1>
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
            position: ANIMATOR_DEFAULTS.camera.position, 
            fov: ANIMATOR_DEFAULTS.camera.fov 
          }}
          gl={{
            toneMapping: (React as any).useMemo(() => (THREE as any)[ANIMATOR_DEFAULTS.renderer.toneMapping], []),
            outputColorSpace: ANIMATOR_DEFAULTS.renderer.outputColorSpace,
          }}
          dpr={[1, ANIMATOR_DEFAULTS.renderer.dprMax]}
          shadows={{ type: ANIMATOR_DEFAULTS.renderer.shadowMapType as any }}
        >
          <Viewport sceneController={sceneController} />
        </Canvas>
      </div>

      {/* HUD Overlays */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 flex flex-col gap-4 pointer-events-none">
        
        {/* Middle HUD: Left = Actors, Right = Clips */}
        <div className="flex justify-between items-end w-full max-w-7xl mx-auto">
          
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

          {/* Clips Panel (Active Actor) */}
          {activeController && (
            <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col gap-3 pointer-events-auto max-w-[300px] max-h-[40vh] overflow-y-auto">
              <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">Animations</h3>
              <div className="flex flex-wrap gap-2">
                {activeController.listClips().map((clip) => {
                  // highlight the current clip if we tracked it in SceneActor...
                  // For now, simple list.
                  return (
                    <button
                      key={clip.name}
                      onClick={() => activeController.selectClip(clip.name)}
                      className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-primary/40 border border-white/5 transition-all text-left truncate max-w-full"
                      title={clip.name}
                    >
                      {clip.name}
                    </button>
                  );
                })}
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
