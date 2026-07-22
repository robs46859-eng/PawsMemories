import React, { useEffect, useMemo, useReducer, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { Download, FileUp, Home, Plus, Redo2, Trash2, Undo2, X } from "lucide-react";
import { buildBim, importIfc, listBimBuilds, preflightBim, proposeBim, type BimCalibrationInput, type BimImageView, type BimProposalImage, type SavedBimBuild } from "../api";
import { BIM_ELEMENT_TYPES, EMPTY_BIM_MODEL, bimHistoryReducer, snap, type BimElement, type BimElementType } from "../bim/model";
import { BIM_PREFABS, prefabInsertOrigin, type BimPrefab } from "../bim/prefabs";
import { bimModelCost, type BimBuildMode } from "../pricing";
import type { UserProfile } from "../types";

const COLORS: Record<string, string> = { wall: "#c97545", slab: "#8b969c", roof: "#8a4937", opening: "#78a9c2", door: "#b07943", window: "#67b8cf", space: "#b7d59c", column: "#d4b15d", beam: "#d6a15e" };
const IFC_COLORS: Record<string, string> = { IfcWall: "#c97545", IfcSlab: "#8b969c", IfcRoof: "#8a4937", IfcDoor: "#b07943", IfcWindow: "#67b8cf", IfcSpace: "#b7d59c", IfcColumn: "#d4b15d", IfcBeam: "#d6a15e" };
const BIM_V2_ENABLED = import.meta.env.VITE_BIM_V2_ENABLED === "true";
const IMAGE_VIEWS: BimImageView[] = ["front", "left", "right", "rear", "plan", "interior", "detail"];

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
  const [savedBuilds, setSavedBuilds] = useState<SavedBimBuild[]>([]);
  const [sourceKind, setSourceKind] = useState<"text" | "image">("text");
  const [sourceDescription, setSourceDescription] = useState("");
  const [sourceView, setSourceView] = useState<BimImageView>("front");
  const [sourceImages, setSourceImages] = useState<BimProposalImage[]>([]);
  const [measurements, setMeasurements] = useState({ width: "", depth: "", height: "" });
  const [coordinateReference, setCoordinateReference] = useState("");
  const [confirmedAssumptions, setConfirmedAssumptions] = useState("");
  const refreshSavedBuilds = () => listBimBuilds().then(setSavedBuilds).catch(() => setSavedBuilds([]));
  useEffect(() => { refreshSavedBuilds(); }, []);
  const selectedElement = imported?.sidecar?.elements?.find((item: any) => item.globalId === selected) || history.present.elements.find((item) => item.id === selected);
  const classes = useMemo(() => Array.from(new Set((imported?.sidecar?.elements || []).map((item: any) => item.class))) as string[], [imported]);
  const price = bimModelCost(buildMode);
  const calibration = useMemo<BimCalibrationInput>(() => ({
    sourceKind,
    sourceDescription,
    imageViews: sourceKind === "image" ? sourceImages.map((image) => image.view) : [],
    synthesizedImageViews: [],
    measurements: (Object.entries(measurements) as Array<["width" | "depth" | "height", string]>)
      .filter(([, value]) => Number(value) > 0)
      .map(([axis, value]) => ({ id: `overall-${axis}`, axis, value: Number(value), unit: "m", source: "user_measurement" })),
    coordinateReference: coordinateReference.trim() || undefined,
    userConfirmedAssumptions: confirmedAssumptions.split("\n").map((value) => value.trim()).filter(Boolean),
  }), [confirmedAssumptions, coordinateReference, measurements, sourceDescription, sourceImages, sourceKind]);
  useEffect(() => { setPreflight(null); setPostBuild(null); }, [history.present, buildMode, calibration]);

  const addElement = (type: BimElementType) => {
    const index = history.present.elements.length + 1;
    const element: BimElement = { id: `${type}-${crypto.randomUUID()}`, type, name: `${type[0].toUpperCase()}${type.slice(1)} ${index}`, levelId: history.present.levels[0].id, position: [snap(index * 0.4, snapIncrement), 0, type === "roof" ? 3 : 0], width: type === "slab" || type === "roof" || type === "space" ? 4 : 1, depth: type === "slab" || type === "roof" || type === "space" ? 3 : 0.2, height: type === "door" ? 2.1 : type === "window" ? 1.2 : type === "slab" || type === "roof" ? 0.2 : 3 };
    if (type === "wall") { element.end = [snap(element.position[0] + 4, snapIncrement), element.position[1]]; element.thickness = 0.2; }
    if (type === "opening") element.hostId = history.present.elements.find((item) => item.type === "wall")?.id;
    if (type === "door" || type === "window") element.openingId = history.present.elements.find((item) => item.type === "opening")?.id;
    dispatch({ type: "add-element", element }); setSelected(element.id);
  };

  const addPrefab = (prefab: BimPrefab) => {
    const origin = prefabInsertOrigin(history.present.elements);
    const elements = prefab.build(history.present.levels[0].id, origin, snapIncrement);
    dispatch({ type: "add-elements", elements });
    setSelected(elements[0]?.id || "");
    setMessage(`Inserted ${prefab.label} (${elements.length} related elements) at x = ${origin[0]} m.`);
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

  const handleSourceImage = async (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setMessage("Use a JPEG, PNG, or WebP source image.");
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    const image = { view: sourceView, mimeType: file.type as BimProposalImage["mimeType"], data };
    setSourceImages((current) => [...current.filter((item) => item.view !== sourceView), image]);
    setMessage(`Added observed ${sourceView} view. Add at least one other angle before creating an image proposal.`);
  };

  const handlePropose = async () => {
    setBusy("Creating calibrated building proposal");
    try {
      const result = await proposeBim(calibration, buildMode, sourceImages);
      dispatch({ type: "replace", model: result.model });
      setImported(null);
      setPreflight(null);
      setMessage("The editable proposal is ready. Review every inferred element, then run the independent pre-build verification.");
    } catch (error: any) { setMessage(error.message); } finally { setBusy(""); }
  };

  const handleVerify = async () => {
    setBusy("Running pre-build verification");
    try {
      const result = await preflightBim(history.present as any, buildMode, BIM_V2_ENABLED ? calibration : undefined); setPreflight(result.verification);
      setMessage(result.verification.passed ? `Pre-build verification passed: ${result.verification.elementCount} elements and ${result.verification.levelCount} levels. Review warnings, then build.` : result.verification.errors.join(" "));
    } catch (error: any) { setMessage(error.message); } finally { setBusy(""); }
  };

  const handleBuild = async () => {
    if (!preflight?.passed) return setMessage("Run and pass pre-build verification first.");
    if (!userProfile.isAdmin && userProfile.credits < price) return setMessage(`You need ${price} credits for this build.`);
    setBusy(`Building and running post-build ${buildMode === "ifc" ? "IFC semantic" : "GLB accuracy"} verification`);
    try {
      const result = await buildBim(history.present as any, buildMode, BIM_V2_ENABLED ? calibration : undefined);
      const filename = history.present.name.replace(/\W+/g, "-");
      if (buildMode === "ifc") base64Download(result.ifc_base64, `${filename}.ifc`, "application/x-step");
      else base64Download(result.glb_base64, `${filename}.glb`, "model/gltf-binary");
      setPostBuild(result.postBuild); setImported({ ...result, sidecar: result.sidecar || { elements: [] }, glbUrl: `data:model/gltf-binary;base64,${result.glb_base64}` });
      refreshSavedBuilds();
      if (!userProfile.isAdmin && Number.isFinite(result.balance)) onUpdateUser({ ...userProfile, credits: result.balance });
      setMessage(`${buildMode === "ifc" ? "IFC/BIM" : "Shell"} model passed post-build verification. ${price} credits charged.`);
    } catch (error: any) { setMessage(error.message); } finally { setBusy(""); }
  };

  return <div className="fixed inset-0 z-[90] bg-[#efe9dc] text-[#28302c] overflow-auto">
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#28302c]/20 bg-[#efe9dc]/95 px-5 py-3 backdrop-blur sm:px-6">
      <div><h2 className="font-headline-xl text-xl font-black">Scaled Building Lab</h2><p className="text-xs text-[#59655f]">IFC semantics, metric constraints, and reversible authoring</p></div>
      <div className="flex gap-2"><button onClick={() => dispatch({ type: "undo" })} disabled={!history.past.length} className="rounded-lg border p-2 disabled:opacity-30" title="Undo"><Undo2 size={17}/></button><button onClick={() => dispatch({ type: "redo" })} disabled={!history.future.length} className="rounded-lg border p-2 disabled:opacity-30" title="Redo"><Redo2 size={17}/></button><button onClick={onClose} className="rounded-lg bg-[#28302c] p-2 text-white"><X size={17}/></button></div>
    </header>
    <main className="grid min-h-[calc(100vh-65px)] lg:grid-cols-[280px_1fr_320px]">
      <aside className="border-r border-[#28302c]/15 p-5 sm:p-6 lg:p-4">
        {BIM_V2_ENABLED && <section className="mb-5 rounded-2xl border border-[#234f46]/25 bg-white p-3">
          <h3 className="text-xs font-black uppercase tracking-wider">Calibrated source</h3>
          <p className="mt-1 text-[10px] text-[#59655f]">Measurements are checked before construction and against the delivered file. Images never establish concealed conditions.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">{(["text", "image"] as const).map((kind) => <button key={kind} onClick={() => { setSourceKind(kind); if (kind === "text") setSourceImages([]); }} className={`rounded-lg border px-2 py-2 text-xs font-bold capitalize ${sourceKind === kind ? "border-[#234f46] bg-[#234f46]/10" : "border-[#28302c]/15"}`}>{kind} evidence</button>)}</div>
          <textarea value={sourceDescription} onChange={(event) => setSourceDescription(event.target.value)} placeholder="Describe only what the evidence supports..." className="mt-2 min-h-20 w-full rounded-lg border p-2 text-xs" maxLength={4000}/>
          {sourceKind === "image" && <div className="mt-2 rounded-lg bg-[#efe9dc] p-2">
            <div className="flex gap-2"><select value={sourceView} onChange={(event) => setSourceView(event.target.value as BimImageView)} className="min-w-0 flex-1 rounded border bg-white p-2 text-xs">{IMAGE_VIEWS.map((view) => <option key={view} value={view}>{view}</option>)}</select><label className="cursor-pointer rounded bg-[#28302c] px-3 py-2 text-xs font-black text-white">Add photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { void handleSourceImage(event.target.files?.[0]); event.currentTarget.value = ""; }}/></label></div>
            <div className="mt-2 flex flex-wrap gap-1">{sourceImages.map((image) => <button key={image.view} onClick={() => setSourceImages((current) => current.filter((item) => item.view !== image.view))} className="rounded-full border bg-white px-2 py-1 text-[10px]" title="Remove view">{image.view} ×</button>)}</div>
          </div>}
          <div className="mt-2 grid grid-cols-3 gap-2">{(["width", "depth", "height"] as const).map((axis) => <label key={axis} className="text-[9px] font-black uppercase">{axis} (m)<input type="number" min="0.001" step="0.01" value={measurements[axis]} onChange={(event) => setMeasurements((current) => ({ ...current, [axis]: event.target.value }))} className="mt-1 w-full rounded border p-2 text-xs normal-case"/></label>)}</div>
          <input value={coordinateReference} onChange={(event) => setCoordinateReference(event.target.value)} placeholder="Coordinate reference (optional)" className="mt-2 w-full rounded-lg border p-2 text-xs" maxLength={200}/>
          <textarea value={confirmedAssumptions} onChange={(event) => setConfirmedAssumptions(event.target.value)} placeholder={buildMode === "ifc" ? "Confirm each IFC assumption, one per line (required)" : "Confirmed assumptions, one per line"} className="mt-2 min-h-16 w-full rounded-lg border p-2 text-xs" maxLength={4000}/>
          <button onClick={handlePropose} disabled={!!busy || sourceDescription.trim().length < 10 || calibration.measurements.length < 1 || (sourceKind === "image" && sourceImages.length < 2) || (buildMode === "ifc" && (!confirmedAssumptions.trim() || calibration.measurements.length < 3))} className="mt-2 w-full rounded-lg bg-[#c85d3b] px-3 py-2 text-xs font-black text-white disabled:opacity-40">Create editable proposal</button>
        </section>}
        <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#c85d3b] px-4 py-3 text-sm font-black text-white"><FileUp size={17}/> Import IFC<input type="file" accept=".ifc" className="hidden" onChange={(event) => handleImport(event.target.files?.[0])}/></label>
        <div className="mb-4"><label className="text-[11px] font-black uppercase tracking-wider">Snap grid (m)</label><input type="number" min="0.001" step="0.01" value={snapIncrement} onChange={(event) => setSnapIncrement(Math.max(0.001, Number(event.target.value)))} className="mt-1 w-full rounded-lg border bg-white p-2"/></div>
        <h3 className="mb-2 text-xs font-black uppercase tracking-wider">Author elements</h3>
        <div className="grid grid-cols-2 gap-2">{BIM_ELEMENT_TYPES.map((type) => <button key={type} onClick={() => addElement(type)} className="flex items-center gap-1 rounded-lg border border-[#28302c]/20 bg-white px-2 py-2 text-xs font-bold capitalize"><Plus size={12}/>{type}</button>)}</div>
        <button onClick={() => dispatch({ type: "add-level", level: { id: crypto.randomUUID(), name: `Level ${history.present.levels.length + 1}`, elevation: history.present.levels.length * 3.2 } })} className="mt-3 w-full rounded-lg border px-3 py-2 text-xs font-bold">Add 3.2 m level</button>
        <h3 className="mb-2 mt-5 text-xs font-black uppercase tracking-wider">Prefabs</h3>
        <div className="space-y-2">{BIM_PREFABS.map((prefab) => <button key={prefab.id} onClick={() => addPrefab(prefab)} title={prefab.description} className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs font-bold ${prefab.id === "studio-apartment" ? "border-[#234f46] bg-[#234f46]/10" : "border-[#28302c]/20 bg-white"}`}><Home size={12}/>{prefab.label}<span className="ml-auto text-[9px] font-normal text-[#59655f]">{prefab.footprint[0]}×{prefab.footprint[1]} m</span></button>)}</div>
        <div className="mt-5 text-xs"><strong>{history.present.levels.length}</strong> levels · <strong>{history.present.elements.length}</strong> authored elements</div>
        <h3 className="mb-2 mt-5 border-b pb-2 text-xs font-black uppercase tracking-wider">My models</h3>
        {savedBuilds.length ? <ul className="space-y-2 text-xs">{savedBuilds.map((build) => <li key={build.id} className="rounded-lg border border-[#28302c]/15 bg-white p-2">
          <p className="font-bold">{build.name} <span className="rounded bg-[#234f46]/10 px-1 text-[9px] uppercase text-[#234f46]">{build.mode}</span></p>
          <p className="text-[10px] text-[#59655f]">{new Date(build.createdAt).toLocaleDateString()} · {build.elementCount} elements · {(build.sizeBytes / 1024).toFixed(0)} KB</p>
          <p className="mt-1 flex gap-3">
            {build.glbUrl && <a href={build.glbUrl} download className="font-black text-[#c85d3b] underline">GLB</a>}
            {build.ifcUrl && <a href={build.ifcUrl} download className="font-black text-[#234f46] underline">IFC</a>}
            {build.sidecarUrl && <a href={build.sidecarUrl} download className="text-[#59655f] underline">Sidecar</a>}
          </p>
        </li>)}</ul> : <p className="text-[11px] text-[#59655f]">Verified builds are stored to your account and re-downloadable here.</p>}
      </aside>
      <section className="relative min-h-[55vh] bg-[#d9e0db]">
        <Canvas camera={{ position: [10, 8, 10], fov: 45 }} shadows onPointerMissed={() => setSelected("")}><color attach="background" args={["#d9e0db"]}/><ambientLight intensity={1.4}/><directionalLight position={[6,10,4]} intensity={2}/><Grid args={[80,80]} cellSize={snapIncrement} sectionSize={1} fadeDistance={40}/><AuthoredScene elements={history.present.elements} selected={selected} onSelect={setSelected} filter={imported ? "none" : filter}/>{imported?.glbUrl && <ImportedScene url={imported.glbUrl} elements={imported.sidecar.elements} filter={filter} categoryColors={categoryColors} onSelect={setSelected}/>}<OrbitControls makeDefault/></Canvas>
        {busy && <div className="absolute inset-0 grid place-items-center bg-[#28302c]/55 text-sm font-black text-white">{busy}...</div>}
        <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-white/90 p-3 text-xs shadow">{message}</div>
      </section>
      <aside className="border-l border-[#28302c]/15 p-5 sm:p-6 lg:p-4">
        <h3 className="mb-2 text-xs font-black uppercase tracking-wider">Choose model type</h3>
        <div className="mb-3 grid grid-cols-2 gap-2"><button onClick={() => setBuildMode("shell")} className={`rounded-xl border p-3 text-left ${buildMode === "shell" ? "border-[#c85d3b] bg-[#c85d3b]/10" : "bg-white"}`}><strong className="block text-sm">Shell</strong><span className="text-[10px]">Scaled visual GLB<br/>{bimModelCost("shell")} credits</span></button><button onClick={() => setBuildMode("ifc")} className={`rounded-xl border p-3 text-left ${buildMode === "ifc" ? "border-[#234f46] bg-[#234f46]/10" : "bg-white"}`}><strong className="block text-sm">IFC / BIM</strong><span className="text-[10px]">Semantic IFC4 + GLB<br/>{bimModelCost("ifc")} credits</span></button></div>
        <div className="mb-3 rounded-xl border bg-white p-3 text-xs"><strong>Gate 1 · Before build</strong><p className={preflight?.passed ? "text-green-700" : "text-[#59655f]"}>{preflight ? preflight.passed ? "Passed" : "Failed" : "Not run"}</p>{preflight?.warnings?.map((warning: string) => <p key={warning} className="mt-1 text-amber-700">{warning}</p>)}{preflight?.dimensionComparisons?.map((item: any) => <p key={item.id} className={item.passed ? "mt-1 text-green-700" : "mt-1 text-red-700"}>{item.axis}: {item.actualMeters?.toFixed(3)} m / {item.expectedMeters.toFixed(3)} m</p>)}<strong className="mt-2 block">Gate 2 · After build</strong><p className={postBuild?.passed ? "text-green-700" : "text-[#59655f]"}>{postBuild ? postBuild.passed ? `Passed · ${postBuild.format}` : "Failed and refunded" : "Runs after construction"}</p>{postBuild?.dimensionComparisons?.map((item: any) => <p key={item.id} className={item.passed ? "mt-1 text-green-700" : "mt-1 text-red-700"}>{item.axis}: Δ {item.deltaMeters?.toFixed(3)} m (limit {item.toleranceMeters.toFixed(3)} m)</p>)}</div>
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
