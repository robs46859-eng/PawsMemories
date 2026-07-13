import React, { useEffect, useMemo, useReducer, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { Download, FileUp, Plus, Redo2, Trash2, Undo2, X } from "lucide-react";
import { buildBim, importIfc, preflightBim } from "../api";
import { BIM_ELEMENT_TYPES, EMPTY_BIM_MODEL, bimHistoryReducer, snap, type BimElement, type BimElementType } from "../bim/model";
import { bimModelCost, type BimBuildMode } from "../pricing";
import type { UserProfile } from "../types";

const COLORS: Record<string, string> = { wall: "#c97545", slab: "#8b969c", roof: "#8a4937", opening: "#78a9c2", door: "#b07943", window: "#67b8cf", space: "#b7d59c", column: "#d4b15d", beam: "#d6a15e" };
const IFC_COLORS: Record<string, string> = { IfcWall: "#c97545", IfcSlab: "#8b969c", IfcRoof: "#8a4937", IfcDoor: "#b07943", IfcWindow: "#67b8cf", IfcSpace: "#b7d59c", IfcColumn: "#d4b15d", IfcBeam: "#d6a15e" };

function AuthoredScene({ elements, selected, onSelect, filter }: { elements: BimElement[]; selected: string; onSelect: (id: string) => void; filter: string }) {
  return <>{elements.filter((item) => filter === "all" || item.type === filter).map((item) => {
    const [x, y, z] = item.position;
    let width = item.width || 1, depth = item.depth || item.thickness || 0.2, height = item.height || 1;
    let rotation = 0;
    let center: [number, number, number] = [x + width / 2, z + height / 2, y + depth / 2];
    if (item.type === "wall" && item.end) {
      const dx = item.end[0] - x, dy = item.end[1] - y;
      width = Math.hypot(dx, dy); rotation = -Math.atan2(dy, dx);
      center = [(x + item.end[0]) / 2, z + height / 2, (y + item.end[1]) / 2];
    }
    return <mesh key={item.id} position={center} rotation={[0, rotation, 0]} onClick={(event) => { event.stopPropagation(); onSelect(item.id); }}>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={COLORS[item.type]} transparent={item.type === "space" || item.type === "opening"} opacity={item.type === "space" ? 0.18 : item.type === "opening" ? 0.35 : 1} emissive={selected === item.id ? "#fff0b8" : "#000000"} emissiveIntensity={selected === item.id ? 0.45 : 0} />
    </mesh>;
  })}</>;
}

function ImportedScene({ url, elements, filter, categoryColors, onSelect }: { url: string; elements: any[]; filter: string; categoryColors: boolean; onSelect: (id: string) => void }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let active = true;
    new GLTFLoader().load(url, (gltf) => {
      if (!active) return;
      const clone = gltf.scene.clone(true);
      clone.traverse((object: any) => {
        if (!object.isMesh) return;
        object.material = object.material.clone();
        const semantic = elements.find((item) => object.name.includes(item.globalId));
        object.userData.globalId = semantic?.globalId;
        object.visible = !semantic || filter === "all" || semantic.class === filter;
        if (categoryColors && semantic && IFC_COLORS[semantic.class]) object.material.color.set(IFC_COLORS[semantic.class]);
      });
      setScene(clone);
    });
    return () => { active = false; };
  }, [url, elements, filter, categoryColors]);
  if (!scene) return null;
  return <primitive object={scene} onClick={(event: any) => { event.stopPropagation(); const id = event.object.userData.globalId; if (id) onSelect(id); }} />;
}

function base64Download(base64: string, filename: string, mime: string) {
  const link = document.createElement("a"); link.href = `data:${mime};base64,${base64}`; link.download = filename; link.click();
}

export default function BimModelBuilder({ onClose, userProfile, onUpdateUser }: { onClose: () => void; userProfile: UserProfile; onUpdateUser: (user: UserProfile) => void }) {
  const [history, dispatch] = useReducer(bimHistoryReducer, { past: [], present: structuredClone(EMPTY_BIM_MODEL), future: [] });
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [snapIncrement, setSnapIncrement] = useState(0.1);
  const [categoryColors, setCategoryColors] = useState(true);
  const [imported, setImported] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Author in meters, or import IFC2X3 / IFC4 / IFC4X3.");
  const [notes, setNotes] = useState("");
  const [buildMode, setBuildMode] = useState<BimBuildMode>("shell");
  const [preflight, setPreflight] = useState<any>(null);
  const [postBuild, setPostBuild] = useState<any>(null);
  const selectedElement = imported?.sidecar?.elements?.find((item: any) => item.globalId === selected) || history.present.elements.find((item) => item.id === selected);
  const classes = useMemo(() => Array.from(new Set((imported?.sidecar?.elements || []).map((item: any) => item.class))) as string[], [imported]);
  const price = bimModelCost(buildMode);
  useEffect(() => { setPreflight(null); setPostBuild(null); }, [history.present, buildMode]);

  const addElement = (type: BimElementType) => {
    const index = history.present.elements.length + 1;
    const element: BimElement = { id: `${type}-${crypto.randomUUID()}`, type, name: `${type[0].toUpperCase()}${type.slice(1)} ${index}`, levelId: history.present.levels[0].id, position: [snap(index * 0.4, snapIncrement), 0, type === "roof" ? 3 : 0], width: type === "slab" || type === "roof" || type === "space" ? 4 : 1, depth: type === "slab" || type === "roof" || type === "space" ? 3 : 0.2, height: type === "door" ? 2.1 : type === "window" ? 1.2 : type === "slab" || type === "roof" ? 0.2 : 3 };
    if (type === "wall") { element.end = [snap(element.position[0] + 4, snapIncrement), element.position[1]]; element.thickness = 0.2; }
    if (type === "opening") element.hostId = history.present.elements.find((item) => item.type === "wall")?.id;
    if (type === "door" || type === "window") element.openingId = history.present.elements.find((item) => item.type === "opening")?.id;
    dispatch({ type: "add-element", element }); setSelected(element.id);
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    setBusy("Importing IFC");
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      const result = await importIfc(base64); setImported({ ...result, glbUrl: `data:model/gltf-binary;base64,${result.glb_base64}` });
      setMessage(`Imported ${result.sidecar.elementCount} elements in ${result.sidecar.sourceUnit}; source hash ${result.sourceHash?.slice(0, 12)}.`);
    } catch (error: any) { setMessage(error.message); } finally { setBusy(""); }
  };

  const handleVerify = async () => {
    setBusy("Running pre-build verification");
    try {
      const result = await preflightBim(history.present as any, buildMode); setPreflight(result.verification);
      setMessage(result.verification.passed ? `Pre-build verification passed: ${result.verification.elementCount} elements and ${result.verification.levelCount} levels. Review warnings, then build.` : result.verification.errors.join(" "));
    } catch (error: any) { setMessage(error.message); } finally { setBusy(""); }
  };

  const handleBuild = async () => {
    if (!preflight?.passed) return setMessage("Run and pass pre-build verification first.");
    if (!userProfile.isAdmin && userProfile.credits < price) return setMessage(`You need ${price} credits for this build.`);
    setBusy(`Building and running post-build ${buildMode === "ifc" ? "IFC semantic" : "GLB accuracy"} verification`);
    try {
      const result = await buildBim(history.present as any, buildMode);
      const filename = history.present.name.replace(/\W+/g, "-");
      if (buildMode === "ifc") base64Download(result.ifc_base64, `${filename}.ifc`, "application/x-step");
      else base64Download(result.glb_base64, `${filename}.glb`, "model/gltf-binary");
      setPostBuild(result.postBuild); setImported({ ...result, sidecar: result.sidecar || { elements: [] }, glbUrl: `data:model/gltf-binary;base64,${result.glb_base64}` });
      if (!userProfile.isAdmin && Number.isFinite(result.balance)) onUpdateUser({ ...userProfile, credits: result.balance });
      setMessage(`${buildMode === "ifc" ? "IFC/BIM" : "Shell"} model passed post-build verification. ${price} credits charged.`);
    } catch (error: any) { setMessage(error.message); } finally { setBusy(""); }
  };

  return <div className="fixed inset-0 z-[90] bg-[#efe9dc] text-[#28302c] overflow-auto">
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#28302c]/20 bg-[#efe9dc]/95 px-4 py-3 backdrop-blur">
      <div><h2 className="font-headline-xl text-xl font-black">Scaled Building Lab</h2><p className="text-xs text-[#59655f]">IFC semantics, metric constraints, and reversible authoring</p></div>
      <div className="flex gap-2"><button onClick={() => dispatch({ type: "undo" })} disabled={!history.past.length} className="rounded-lg border p-2 disabled:opacity-30" title="Undo"><Undo2 size={17}/></button><button onClick={() => dispatch({ type: "redo" })} disabled={!history.future.length} className="rounded-lg border p-2 disabled:opacity-30" title="Redo"><Redo2 size={17}/></button><button onClick={onClose} className="rounded-lg bg-[#28302c] p-2 text-white"><X size={17}/></button></div>
    </header>
    <main className="grid min-h-[calc(100vh-65px)] lg:grid-cols-[280px_1fr_320px]">
      <aside className="border-r border-[#28302c]/15 p-4">
        <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#c85d3b] px-4 py-3 text-sm font-black text-white"><FileUp size={17}/> Import IFC<input type="file" accept=".ifc" className="hidden" onChange={(event) => handleImport(event.target.files?.[0])}/></label>
        <div className="mb-4"><label className="text-[11px] font-black uppercase tracking-wider">Snap grid (m)</label><input type="number" min="0.001" step="0.01" value={snapIncrement} onChange={(event) => setSnapIncrement(Math.max(0.001, Number(event.target.value)))} className="mt-1 w-full rounded-lg border bg-white p-2"/></div>
        <h3 className="mb-2 text-xs font-black uppercase tracking-wider">Author elements</h3>
        <div className="grid grid-cols-2 gap-2">{BIM_ELEMENT_TYPES.map((type) => <button key={type} onClick={() => addElement(type)} className="flex items-center gap-1 rounded-lg border border-[#28302c]/20 bg-white px-2 py-2 text-xs font-bold capitalize"><Plus size={12}/>{type}</button>)}</div>
        <button onClick={() => dispatch({ type: "add-level", level: { id: crypto.randomUUID(), name: `Level ${history.present.levels.length + 1}`, elevation: history.present.levels.length * 3.2 } })} className="mt-3 w-full rounded-lg border px-3 py-2 text-xs font-bold">Add 3.2 m level</button>
        <div className="mt-5 text-xs"><strong>{history.present.levels.length}</strong> levels · <strong>{history.present.elements.length}</strong> authored elements</div>
      </aside>
      <section className="relative min-h-[55vh] bg-[#d9e0db]">
        <Canvas camera={{ position: [10, 8, 10], fov: 45 }} shadows onPointerMissed={() => setSelected("")}><color attach="background" args={["#d9e0db"]}/><ambientLight intensity={1.4}/><directionalLight position={[6,10,4]} intensity={2}/><Grid args={[80,80]} cellSize={snapIncrement} sectionSize={1} fadeDistance={40}/><AuthoredScene elements={history.present.elements} selected={selected} onSelect={setSelected} filter={imported ? "none" : filter}/>{imported?.glbUrl && <ImportedScene url={imported.glbUrl} elements={imported.sidecar.elements} filter={filter} categoryColors={categoryColors} onSelect={setSelected}/>}<OrbitControls makeDefault/></Canvas>
        {busy && <div className="absolute inset-0 grid place-items-center bg-[#28302c]/55 text-sm font-black text-white">{busy}...</div>}
        <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-white/90 p-3 text-xs shadow">{message}</div>
      </section>
      <aside className="border-l border-[#28302c]/15 p-4">
        <h3 className="mb-2 text-xs font-black uppercase tracking-wider">Choose model type</h3>
        <div className="mb-3 grid grid-cols-2 gap-2"><button onClick={() => setBuildMode("shell")} className={`rounded-xl border p-3 text-left ${buildMode === "shell" ? "border-[#c85d3b] bg-[#c85d3b]/10" : "bg-white"}`}><strong className="block text-sm">Shell</strong><span className="text-[10px]">Scaled visual GLB<br/>{bimModelCost("shell")} credits</span></button><button onClick={() => setBuildMode("ifc")} className={`rounded-xl border p-3 text-left ${buildMode === "ifc" ? "border-[#234f46] bg-[#234f46]/10" : "bg-white"}`}><strong className="block text-sm">IFC / BIM</strong><span className="text-[10px]">Semantic IFC4 + GLB<br/>{bimModelCost("ifc")} credits</span></button></div>
        <div className="mb-3 rounded-xl border bg-white p-3 text-xs"><strong>Gate 1 · Before build</strong><p className={preflight?.passed ? "text-green-700" : "text-[#59655f]"}>{preflight ? preflight.passed ? "Passed" : "Failed" : "Not run"}</p>{preflight?.warnings?.map((warning: string) => <p key={warning} className="mt-1 text-amber-700">{warning}</p>)}<strong className="mt-2 block">Gate 2 · After build</strong><p className={postBuild?.passed ? "text-green-700" : "text-[#59655f]"}>{postBuild ? postBuild.passed ? `Passed · ${postBuild.format}` : "Failed and refunded" : "Runs after construction"}</p></div>
        <div className="mb-3 flex gap-2"><button onClick={handleVerify} disabled={!!busy} className="flex-1 rounded-xl border border-[#234f46] px-3 py-3 text-xs font-black text-[#234f46] disabled:opacity-40">Verify before build</button><button onClick={handleBuild} disabled={!!busy || !preflight?.passed || (!userProfile.isAdmin && userProfile.credits < price)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#234f46] px-3 py-3 text-xs font-black text-white disabled:opacity-40"><Download size={15}/> Build · {price} cr</button>{selected && !imported && <button onClick={() => { dispatch({ type: "remove-element", id: selected }); setSelected(""); }} className="rounded-xl border border-red-300 p-3 text-red-700"><Trash2 size={16}/></button>}</div>
        <label className="mb-3 block text-[11px] font-black uppercase">Visibility filter<select value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2 normal-case"><option value="all">All categories</option>{(imported ? classes : BIM_ELEMENT_TYPES).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        {imported && <label className="mb-4 flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={categoryColors} onChange={(event) => setCategoryColors(event.target.checked)}/> BIM category colors</label>}
        <h3 className="border-b pb-2 text-xs font-black uppercase tracking-wider">Selection</h3>
        {selectedElement ? <div className="space-y-2 py-3 text-xs"><p className="text-base font-black">{selectedElement.name || selectedElement.class}</p><p><strong>ID:</strong> {selectedElement.globalId || selectedElement.id}</p><p><strong>Class:</strong> {selectedElement.class || selectedElement.type}</p><p><strong>Storey:</strong> {selectedElement.storeyName || selectedElement.levelId}</p><p><strong>Position:</strong> {(selectedElement.placement || selectedElement.position || []).map((value: number) => value.toFixed(3)).join(", ")} m</p><pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-[10px]">{JSON.stringify(selectedElement.properties || {}, null, 2)}</pre></div> : <p className="py-4 text-xs text-[#59655f]">Select an element to inspect its GlobalId, placement, properties, and quantities.</p>}
        <h3 className="mt-3 border-b pb-2 text-xs font-black uppercase tracking-wider">Review notes</h3><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record scale checks, clash observations, or handoff comments..." className="mt-3 min-h-28 w-full rounded-lg border bg-white p-2 text-xs"/>
      </aside>
    </main>
  </div>;
}
