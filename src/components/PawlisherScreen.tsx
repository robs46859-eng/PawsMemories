import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bounds, Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { UserProfile, Avatar } from "../types";
import { Brush, Lock, Film, Sparkles, Mic, Upload, CheckCircle2, X, Lightbulb, ZoomIn, RotateCw, Scissors, Save, Trash2, Shirt, Wand2, Move3D, Gauge, Footprints, Grid3X3, Volume2 } from "lucide-react";
import { createVoiceCloneAsset, fetchAvatars } from "../api";
import { AnimatorErrorBoundary } from "../animator/components/AnimatorErrorBoundary";

interface PawlisherScreenProps {
  userProfile: UserProfile;
  onGoToAnimator?: (assetId: string) => void;
  onGoToPawprints?: () => void;
}

type LightMode = "warm" | "neutral" | "bright";
type MotionPreset = "idle" | "happy" | "sit" | "walk" | "prance";
type BodyPreset = "head" | "torso" | "limbs" | "digits";

const lightSettings: Record<LightMode, { color: string; intensity: number; label: string }> = {
  warm: { color: "#ffd59a", intensity: 1.2, label: "Warm" },
  neutral: { color: "#fff7df", intensity: 1.55, label: "Neutral" },
  bright: { color: "#ffffff", intensity: 2.1, label: "Bright" },
};

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

function isMobile(): boolean {
  return window.matchMedia?.("(max-width: 760px), (pointer: coarse)").matches ?? false;
}

function PawlisherModel({ url, motion, part, microMesh, soften }: { url: string; motion: MotionPreset; part: BodyPreset; microMesh: boolean; soften: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(url);
  const model = useMemo(() => {
    const cloned = skeletonClone(scene) as THREE.Object3D;
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    cloned.position.x -= center.x;
    cloned.position.z -= center.z;
    cloned.position.y -= box.min.y;
    const targetHeight = size.y > 1.2 ? 1.55 : 0.85;
    cloned.scale.setScalar(targetHeight / (size.y || 1));
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat: any) => {
        if ("roughness" in mat) mat.roughness = soften ? 0.82 : 0.55;
        if ("metalness" in mat) mat.metalness = 0.02;
        if ("normalScale" in mat && microMesh) mat.normalScale = new THREE.Vector2(0.35, 0.35);
      });
    });
    return cloned;
  }, [scene, microMesh, soften]);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.x = part === "torso" ? Math.sin(t * 1.4) * 0.04 : 0;
    g.rotation.z = part === "head" ? Math.sin(t * 2) * 0.06 : 0;
    g.position.y = motion === "happy" ? Math.abs(Math.sin(t * 4)) * 0.04 : motion === "prance" ? Math.abs(Math.sin(t * 7)) * 0.08 : 0;
    if (motion === "sit") g.rotation.x = -0.08;
    if (motion === "walk") g.position.x = Math.sin(t * 2) * 0.04;
  });

  return <primitive ref={group} object={model} />;
}

function SceneTools({ onCanvasReady }: { onCanvasReady: (canvas: HTMLCanvasElement) => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => onCanvasReady(gl.domElement), [gl, onCanvasReady]);
  return null;
}

export default function PawlisherScreen({ userProfile, onGoToAnimator, onGoToPawprints }: PawlisherScreenProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [lightMode, setLightMode] = useState<LightMode>(() => (localStorage.getItem("pawlisher_light") as LightMode) || "warm");
  const [zoom, setZoom] = useState(100);
  const [turntable, setTurntable] = useState(true);
  const [turntableSpeed, setTurntableSpeed] = useState(0.8);
  const [motion, setMotion] = useState<MotionPreset>("idle");
  const [part, setPart] = useState<BodyPreset>("head");
  const [microMesh, setMicroMesh] = useState(false);
  const [soften, setSoften] = useState(false);
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [voicePitch, setVoicePitch] = useState(0);
  const [voiceTone, setVoiceTone] = useState("gentle");
  const [showVoiceConsent, setShowVoiceConsent] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceName, setVoiceName] = useState(`${userProfile.fullName || "My pet"} voice`);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [status, setStatus] = useState("Autosaved");
  const [webgl2] = useState(() => hasWebGL2());
  const [mobile] = useState(() => isMobile());
  const voiceInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    fetchAvatars().then((items) => {
      setAvatars(items);
      const firstReady = items.find((a) => a.rigged_model_url || a.model_url);
      if (firstReady) setSelectedId(firstReady.id);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("pawlisher_light", lightMode);
  }, [lightMode]);

  useEffect(() => {
    const id = window.setTimeout(() => setStatus("Autosaved"), 350);
    return () => window.clearTimeout(id);
  }, [lightMode, zoom, turntable, turntableSpeed, motion, part, microMesh, soften, voiceSpeed, voicePitch, voiceTone]);

  const selected = avatars.find((avatar) => avatar.id === selectedId);
  const modelUrl = selected?.rigged_model_url || selected?.model_url || "";
  const light = lightSettings[lightMode];

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const onVoiceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVoiceBusy(true);
    setVoiceMessage("");
    try {
      const asset = await createVoiceCloneAsset({
        name: voiceName.trim() || "Voice clone",
        audioBase64: await readFile(file),
        mimeType: file.type || "audio/webm",
        bytes: file.size,
        voiceConsent: true,
      });
      setVoiceMessage(`${asset.name} saved with consent recorded.`);
      setShowVoiceConsent(false);
      setVoiceConsent(false);
    } catch (err: any) {
      setVoiceMessage(err.message || "Could not save the voice.");
    } finally {
      setVoiceBusy(false);
      if (voiceInputRef.current) voiceInputRef.current.value = "";
    }
  };

  const downloadScreenshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selected?.name || "pawlisher"}-screenshot.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const saveState = () => {
    setStatus("Saved");
    window.setTimeout(() => setStatus("Autosaved"), 1600);
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      <div data-tour="pawlisher-title" className="flex items-center gap-3 mb-4">
        <Brush size={24} className="text-primary" />
        <h1 className="text-2xl font-extrabold text-on-surface">Pawlisher Studio</h1>
        <span className="text-xs font-bold text-on-surface-variant">{status}</span>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("randy:start-tour", { detail: { tourId: "use_pawlisher" } }))}
          className="ml-auto min-h-11 rounded-xl border border-primary/30 px-3 text-sm font-black text-primary"
        >
          Show me how
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)_320px] gap-4">
        <aside className="space-y-4">
          <section className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <label className="text-sm font-black text-on-surface">Model</label>
            <select value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value) || "")} className="mt-2 w-full min-h-12 rounded-xl border border-outline-variant bg-surface-container px-3 text-base">
              <option value="">Choose a model</option>
              {avatars.map((avatar) => (
                <option key={avatar.id} value={avatar.id} disabled={!avatar.rigged_model_url && !avatar.model_url}>
                  {avatar.name}{!avatar.rigged_model_url && !avatar.model_url ? " (not ready)" : ""}
                </option>
              ))}
            </select>
          </section>

          <section className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3"><Lightbulb size={18} className="text-primary" /><h3 className="font-black">Edison bulb</h3></div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(lightSettings) as LightMode[]).map((mode) => (
                <button key={mode} onClick={() => setLightMode(mode)} className={`min-h-12 rounded-xl text-sm font-black border ${lightMode === mode ? "bg-primary text-on-primary" : "border-outline-variant text-on-surface"}`}>{lightSettings[mode].label}</button>
              ))}
            </div>
          </section>

          <section className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3"><ZoomIn size={18} className="text-primary" /><h3 className="font-black">Zoom</h3></div>
            <input type="range" min={25} max={400} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" />
            <div className="text-sm font-black text-primary mt-1">{zoom}%</div>
            <label className="mt-4 flex items-center justify-between gap-3 text-sm font-bold">
              <span className="flex items-center gap-2"><RotateCw size={16} /> 360 turntable</span>
              <input type="checkbox" checked={turntable} onChange={(e) => setTurntable(e.target.checked)} className="h-5 w-5 accent-primary" />
            </label>
            <input type="range" min={0.1} max={2} step={0.1} value={turntableSpeed} onChange={(e) => setTurntableSpeed(Number(e.target.value))} className="w-full mt-3" />
          </section>

          <section className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3"><Scissors size={18} className="text-primary" /><h3 className="font-black">Tools</h3></div>
            <div className="grid grid-cols-4 gap-2">
              <button title="Screenshot" onClick={downloadScreenshot} className="min-h-12 rounded-xl bg-primary text-on-primary flex items-center justify-center"><Scissors size={18} /></button>
              <button title="Save" onClick={saveState} className="min-h-12 rounded-xl border border-outline-variant flex items-center justify-center"><Save size={18} /></button>
              <button title="Upload" onClick={() => setShowVoiceConsent(true)} className="min-h-12 rounded-xl border border-outline-variant flex items-center justify-center"><Upload size={18} /></button>
              <button title="Delete" className="min-h-12 rounded-xl border border-error/40 text-error flex items-center justify-center"><Trash2 size={18} /></button>
            </div>
          </section>
        </aside>

        <AnimatorErrorBoundary onClose={() => {}} hasWebGL2={webgl2}>
          <section className="relative min-h-[560px] overflow-hidden rounded-2xl border border-outline-variant/40 bg-[#f7f3eb]">
            {!webgl2 ? (
              <div className="h-full min-h-[560px] flex items-center justify-center p-8 text-center text-on-surface">This editor needs a browser with WebGL2.</div>
            ) : !modelUrl ? (
              <div className="h-full min-h-[560px] flex items-center justify-center p-8 text-center text-on-surface-variant">Choose a ready GLB model to begin polishing.</div>
            ) : (
              <Canvas
                shadows
                dpr={mobile ? [1, 1.25] : [1, 1.75]}
                camera={{ position: [0, 1.2, 3.2 / (zoom / 100)], fov: 42 }}
                gl={{ preserveDrawingBuffer: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false }}
              >
                <SceneTools onCanvasReady={(canvas) => { canvasRef.current = canvas; }} />
                <color attach="background" args={["#f7f3eb"]} />
                <ambientLight intensity={0.55} />
                <pointLight position={[0, 2.8, 0.4]} intensity={light.intensity} color={light.color} castShadow />
                <mesh position={[0, 2.15, 0.25]}>
                  <sphereGeometry args={[0.11, 24, 24]} />
                  <meshStandardMaterial color={light.color} emissive={light.color} emissiveIntensity={0.9} />
                </mesh>
                <mesh position={[0, 1.95, 0.25]}>
                  <cylinderGeometry args={[0.01, 0.01, 0.45, 10]} />
                  <meshStandardMaterial color="#4a342a" />
                </mesh>
                <Suspense fallback={<Html center>Loading GLB...</Html>}>
                  <Bounds fit clip observe margin={1.15}>
                    <group rotation-y={turntable ? performance.now() * 0.0002 * turntableSpeed : 0}>
                      <PawlisherModel url={modelUrl} motion={motion} part={part} microMesh={microMesh} soften={soften} />
                    </group>
                  </Bounds>
                </Suspense>
                <mesh rotation-x={-Math.PI / 2} receiveShadow>
                  <circleGeometry args={[1.2, 96]} />
                  <meshStandardMaterial color="#d8c7aa" roughness={0.8} />
                </mesh>
                <Environment preset="studio" />
                <OrbitControls enablePan={false} minDistance={1.2} maxDistance={5} autoRotate={turntable} autoRotateSpeed={turntableSpeed} />
              </Canvas>
            )}
          </section>
        </AnimatorErrorBoundary>

        <aside className="space-y-4">
          <section className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3"><Move3D size={18} className="text-primary" /><h3 className="font-black">Rigging</h3></div>
            <div className="grid grid-cols-2 gap-2">
              {(["head", "torso", "limbs", "digits"] as BodyPreset[]).map((item) => (
                <button key={item} onClick={() => setPart(item)} className={`min-h-11 rounded-xl text-sm font-black capitalize ${part === item ? "bg-primary text-on-primary" : "border border-outline-variant"}`}>{item}</button>
              ))}
            </div>
            <p className="mt-3 text-xs text-on-surface-variant">Simple mode applies safe presets. Advanced IK controls will unlock when a compatible rig exposes editable bones.</p>
          </section>

          <section className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3"><Footprints size={18} className="text-primary" /><h3 className="font-black">Posture & gait</h3></div>
            <div className="grid grid-cols-2 gap-2">
              {(["idle", "happy", "sit", "walk", "prance"] as MotionPreset[]).map((item) => (
                <button key={item} onClick={() => setMotion(item)} className={`min-h-11 rounded-xl text-sm font-black capitalize ${motion === item ? "bg-primary text-on-primary" : "border border-outline-variant"}`}>{item}</button>
              ))}
            </div>
          </section>

          <section data-tour="pawlisher-voice" className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3"><Mic size={18} className="text-primary" /><h3 className="font-black">Voice</h3></div>
            <select className="w-full min-h-11 rounded-xl border border-outline-variant bg-surface-container px-3 text-sm">
              <option>Randy gentle narrator</option>
              <option>Warm storyteller</option>
              <option>Bright announcer</option>
            </select>
            <label className="block mt-3 text-xs font-bold">Speed {voiceSpeed.toFixed(1)}x</label>
            <input type="range" min={0.6} max={1.4} step={0.1} value={voiceSpeed} onChange={(e) => setVoiceSpeed(Number(e.target.value))} className="w-full" />
            <label className="block mt-3 text-xs font-bold">Pitch {voicePitch}</label>
            <input type="range" min={-6} max={6} value={voicePitch} onChange={(e) => setVoicePitch(Number(e.target.value))} className="w-full" />
            <label className="block mt-3 text-xs font-bold">Tone</label>
            <select value={voiceTone} onChange={(e) => setVoiceTone(e.target.value)} className="w-full min-h-11 rounded-xl border border-outline-variant bg-surface-container px-3 text-sm">
              <option value="gentle">Gentle</option>
              <option value="playful">Playful</option>
              <option value="calm">Calm</option>
            </select>
            <button type="button" onClick={() => setShowVoiceConsent(true)} className="mt-4 w-full min-h-12 rounded-xl bg-primary text-on-primary font-black flex items-center justify-center gap-2"><Upload size={18} /> Clone voice</button>
            {voiceMessage && <p className="mt-3 text-xs font-bold text-primary">{voiceMessage}</p>}
          </section>

          <section className="glass-panel border border-outline-variant/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3"><Grid3X3 size={18} className="text-primary" /><h3 className="font-black">Surface</h3></div>
            <label className="flex items-center justify-between gap-3 text-sm font-bold">
              <span>Micro-mesh detail</span>
              <input type="checkbox" checked={microMesh} onChange={(e) => setMicroMesh(e.target.checked)} className="h-5 w-5 accent-primary" />
            </label>
            <label className="mt-3 flex items-center justify-between gap-3 text-sm font-bold">
              <span>Soft friendly shader</span>
              <input type="checkbox" checked={soften} onChange={(e) => setSoften(e.target.checked)} className="h-5 w-5 accent-primary" />
            </label>
          </section>
        </aside>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
        <button disabled className="glass-panel border border-outline-variant/40 rounded-2xl p-5 text-left opacity-70 cursor-not-allowed">
          <div className="flex items-center gap-2"><Shirt size={18} /><h3 className="font-black">Wardrobe</h3><Lock size={14} className="ml-auto" /></div>
          <p className="text-xs text-on-surface-variant mt-2">Coming soon.</p>
        </button>
        <button onClick={() => selected && onGoToAnimator?.(String(selected.id))} className="glass-panel border border-outline-variant/40 rounded-2xl p-5 text-left hover:border-primary/50">
          <div className="flex items-center gap-2"><Film size={18} className="text-primary" /><h3 className="font-black">Animation Creator</h3></div>
          <p className="text-xs text-on-surface-variant mt-2">Send this model to Animator.</p>
        </button>
        <button onClick={onGoToPawprints} className="glass-panel border border-outline-variant/40 rounded-2xl p-5 text-left hover:border-primary/50">
          <div className="flex items-center gap-2"><Sparkles size={18} className="text-primary" /><h3 className="font-black">Pawprints</h3></div>
          <p className="text-xs text-on-surface-variant mt-2">Make stationery with this pet.</p>
        </button>
      </div>

      {showVoiceConsent && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4">
          <section className="w-full max-w-lg rounded-2xl bg-surface text-on-surface border border-outline-variant shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-black">Voice permission</h2>
                <p className="text-lg leading-relaxed text-on-surface-variant mt-2">
                  Please confirm you own this voice or have documented permission to clone it.
                </p>
              </div>
              <button type="button" onClick={() => setShowVoiceConsent(false)} className="w-11 h-11 rounded-full border border-outline-variant flex items-center justify-center"><X size={20} /></button>
            </div>
            <label className="block text-sm font-bold text-on-surface mb-2" htmlFor="voice-name">Voice name</label>
            <input id="voice-name" value={voiceName} onChange={(e) => setVoiceName(e.target.value)} className="w-full min-h-12 rounded-xl border border-outline-variant bg-surface-container px-4 text-base mb-4" />
            <label className="flex items-start gap-3 rounded-xl border border-outline-variant/50 bg-surface-container p-4 text-base leading-relaxed cursor-pointer mb-5">
              <input type="checkbox" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} className="mt-1 h-6 w-6 accent-primary" />
              <span>I confirm I own this voice or have documented permission to clone it.</span>
            </label>
            <button type="button" disabled={!voiceConsent || voiceBusy} onClick={() => voiceInputRef.current?.click()} className="w-full min-h-14 rounded-xl bg-primary text-on-primary text-lg font-black disabled:opacity-50 flex items-center justify-center gap-2">
              {voiceBusy ? "Saving..." : <><CheckCircle2 size={20} /> Choose audio file</>}
            </button>
            <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={onVoiceFile} />
          </section>
        </div>
      )}
    </div>
  );
}
