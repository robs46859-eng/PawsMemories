/**
 * PetHealthScreen — Pet health statistics & 3D vitals visual (H1)
 *
 * Features:
 *  • 3D-tilted SVG vitals orb with animated radial rings (food/water/energy/happiness)
 *  • Body Condition Score silhouette (1-9 BCS)
 *  • Stats cards: weight, next vet, next vaccine, age
 *  • SVG weight sparkline (last 90 days)
 *  • Health log feed with type-colour badges
 *  • Add-log drawer (weight, BCS, vet, vaccine, medication, symptom, note)
 *  • Edit health profile modal (vet info, birthday, microchip, insurance)
 *
 * API:
 *  GET  /api/health/:avatarId           → profile + vitals + logs
 *  POST /api/health/:avatarId/profile   → upsert profile
 *  POST /api/health/:avatarId/log       → add log entry
 *  DELETE /api/health/:avatarId/log/:id → delete log entry
 *  GET  /api/health/:avatarId/history   → time-series for sparkline
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowLeft, Calendar, CheckCircle2,
  ChevronDown, ChevronUp, ClipboardList, Droplets, Edit3,
  Heart, Plus, RefreshCw, Scale, Stethoscope, Syringe,
  Thermometer, Trash2, X, Zap,
} from "lucide-react";
import { authedFetch } from "../api";
import type { Avatar, UserProfile } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HealthVitals {
  food: number; water: number; energy: number;
  happiness: number; bladder: number; bowel: number;
}

interface HealthProfile {
  birthday: string | null;
  weight_kg: number | null;
  weight_unit: "kg" | "lb";
  target_weight_kg: number | null;
  body_condition_score: number | null;
  sterilized: boolean;
  microchip_id: string | null;
  vet_name: string | null;
  vet_phone: string | null;
  vet_email: string | null;
  next_vet_visit: string | null;
  next_vaccine_due: string | null;
  insurance_provider: string | null;
  notes: string | null;
}

interface HealthLog {
  id: number;
  log_type: string;
  logged_at: string;
  weight_kg: number | null;
  body_condition_score: number | null;
  value_numeric: number | null;
  value_text: string | null;
  notes: string | null;
  created_at: string;
}

interface HealthData {
  avatar: { id: number; name: string; image_url: string; animal_type: string | null; breed: string | null };
  vitals: HealthVitals;
  profile: HealthProfile | null;
  logs: HealthLog[];
}

interface HistoryPoint {
  logged_at: string;
  log_type: string;
  weight_kg: number | null;
  body_condition_score: number | null;
  value_numeric: number | null;
  value_text: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type IconComp = React.ComponentType<{ size?: number; className?: string }>;
const LOG_TYPE_META: Record<string, { label: string; color: string; icon: IconComp }> = {
  weight:          { label: "Weight",          color: "text-sky-600 bg-sky-50 border-sky-200",       icon: Scale },
  body_condition:  { label: "Body Condition",  color: "text-violet-600 bg-violet-50 border-violet-200", icon: Activity },
  vet_visit:       { label: "Vet Visit",       color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: Stethoscope },
  vaccine:         { label: "Vaccine",         color: "text-indigo-600 bg-indigo-50 border-indigo-200", icon: Syringe },
  medication:      { label: "Medication",      color: "text-amber-600 bg-amber-50 border-amber-200",  icon: Thermometer },
  symptom:         { label: "Symptom",         color: "text-red-600 bg-red-50 border-red-200",        icon: AlertCircle },
  dental:          { label: "Dental",          color: "text-teal-600 bg-teal-50 border-teal-200",     icon: CheckCircle2 },
  grooming:        { label: "Grooming",        color: "text-pink-600 bg-pink-50 border-pink-200",     icon: Heart },
  note:            { label: "Note",            color: "text-on-surface-variant bg-surface-container border-outline-variant", icon: ClipboardList },
};

const LOG_TYPES = Object.keys(LOG_TYPE_META) as string[];

// BCS descriptions (standard WSAVA 1-9 scale)
const BCS_LABELS: Record<number, string> = {
  1: "Emaciated", 2: "Very Thin", 3: "Thin", 4: "Underweight", 5: "Ideal",
  6: "Overweight", 7: "Heavy", 8: "Obese", 9: "Severely Obese",
};

// ---------------------------------------------------------------------------
// Helper: convert kg ↔ lb
// ---------------------------------------------------------------------------
const kgToLb = (kg: number) => Math.round(kg * 2.20462 * 10) / 10;
const lbToKg = (lb: number) => Math.round(lb / 2.20462 * 100) / 100;

function displayWeight(kg: number | null, unit: "kg" | "lb"): string {
  if (kg == null) return "—";
  const val = unit === "lb" ? kgToLb(kg) : kg;
  return `${val} ${unit}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

function ageFromBirthday(birthday: string | null): string {
  if (!birthday) return "—";
  const ms = Date.now() - new Date(birthday).getTime();
  const years = Math.floor(ms / (365.25 * 86400000));
  const months = Math.floor((ms % (365.25 * 86400000)) / (30.44 * 86400000));
  if (years === 0) return `${months}mo`;
  if (months === 0) return `${years}yr`;
  return `${years}yr ${months}mo`;
}

// ---------------------------------------------------------------------------
// 3D Vitals Orb
// ---------------------------------------------------------------------------

interface VitalRing {
  id: string; label: string; value: number; color: string; stroke: string; r: number;
}

function VitalsOrb({ vitals, animalType }: { vitals: HealthVitals; animalType: string | null }) {
  const cx = 120; const cy = 120;
  const rings: VitalRing[] = [
    { id: "happiness", label: "Joy",    value: vitals.happiness, color: "#f472b6", stroke: "#fce7f3", r: 105 },
    { id: "energy",    label: "Energy", value: vitals.energy,    color: "#facc15", stroke: "#fef9c3", r: 87  },
    { id: "water",     label: "Water",  value: vitals.water,     color: "#38bdf8", stroke: "#e0f2fe", r: 69  },
    { id: "food",      label: "Food",   value: vitals.food,      color: "#4ade80", stroke: "#dcfce7", r: 51  },
  ];

  const isDog = animalType?.toLowerCase().includes("dog") ?? true;

  // SVG path for stylized pet face (simple, scalable)
  const petEmoji = isDog ? "🐾" : "🐱";

  return (
    <div
      className="relative mx-auto flex items-center justify-center"
      style={{ width: 240, height: 240, perspective: 600 }}
    >
      <svg
        viewBox="0 0 240 240"
        width={240}
        height={240}
        style={{ transform: "rotateX(12deg) rotateY(-6deg)", transformStyle: "preserve-3d", filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.18))" }}
      >
        {/* Background orb */}
        <circle cx={cx} cy={cy} r={112} fill="var(--color-surface-container)" opacity={0.85} />
        <circle cx={cx} cy={cy} r={112} fill="none" stroke="var(--color-outline-variant)" strokeWidth={1} opacity={0.4} />

        {rings.map((ring) => {
          const circumference = 2 * Math.PI * ring.r;
          const pct = Math.max(0, Math.min(100, ring.value)) / 100;
          return (
            <g key={ring.id}>
              {/* Track */}
              <circle cx={cx} cy={cy} r={ring.r} fill="none" stroke={ring.stroke} strokeWidth={9} opacity={0.45} />
              {/* Progress */}
              <circle
                cx={cx} cy={cy} r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth={9}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - pct)}
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)" }}
              />
              {/* Label dot at ring end */}
              <circle
                cx={cx + ring.r * Math.cos((2 * Math.PI * pct - Math.PI / 2))}
                cy={cy + ring.r * Math.sin((2 * Math.PI * pct - Math.PI / 2))}
                r={5}
                fill={ring.color}
              />
            </g>
          );
        })}

        {/* Inner glow */}
        <circle cx={cx} cy={cy} r={38} fill="var(--color-surface)" opacity={0.9} />
        <circle cx={cx} cy={cy} r={35} fill="none" stroke="var(--color-primary)" strokeWidth={1.5} opacity={0.2} />

        {/* Pet emoji face — rendered via foreignObject for emoji support */}
        <foreignObject x={cx - 24} y={cy - 26} width={48} height={48}>
          <div style={{ fontSize: 36, textAlign: "center", lineHeight: "48px", userSelect: "none" }}>
            {isDog ? "🐾" : "🐾"}
          </div>
        </foreignObject>
      </svg>

      {/* Ring legend overlay */}
      <div className="absolute bottom-1 right-1 flex flex-col gap-0.5">
        {[...rings].reverse().map((r) => (
          <div key={r.id} className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full" style={{ background: r.color }} />
            <span className="text-[9px] font-bold text-on-surface-variant">{r.label} {r.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body Condition Score visual (1-9, simplified silhouette)
// ---------------------------------------------------------------------------

function BcsVisual({ score }: { score: number | null }) {
  const s = score ?? 5;
  // Map BCS to visual width of "body" ellipse: 1=very narrow, 9=very wide
  const widthMap: Record<number, number> = { 1:24, 2:28, 3:32, 4:36, 5:40, 6:46, 7:52, 8:58, 9:64 };
  const bodyW = widthMap[s] ?? 40;
  const color = s <= 3 ? "#38bdf8" : s <= 4 ? "#a78bfa" : s === 5 ? "#4ade80" : s <= 6 ? "#facc15" : s <= 7 ? "#fb923c" : "#f87171";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 80 60" width={80} height={60}>
        {/* Head */}
        <ellipse cx={40} cy={14} rx={12} ry={11} fill={color} opacity={0.8} />
        {/* Body — width encodes BCS */}
        <ellipse cx={40} cy={38} rx={bodyW / 2} ry={16} fill={color} opacity={0.75} />
        {/* Legs — 4 simple lines */}
        {[-14, -6, 6, 14].map((x) => (
          <line key={x} x1={40 + x} y1={52} x2={40 + x} y2={60} stroke={color} strokeWidth={3} strokeLinecap="round" opacity={0.7} />
        ))}
        {/* Eyes */}
        <circle cx={35} cy={13} r={2.5} fill="white" />
        <circle cx={45} cy={13} r={2.5} fill="white" />
        <circle cx={35.8} cy={13.2} r={1.2} fill="#1e293b" />
        <circle cx={45.8} cy={13.2} r={1.2} fill="#1e293b" />
      </svg>
      <div className="text-center">
        <div className="text-xs font-black" style={{ color }}>{BCS_LABELS[s] ?? "Unknown"}</div>
        <div className="text-[10px] text-on-surface-variant">BCS {s}/9</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weight sparkline (SVG)
// ---------------------------------------------------------------------------

function WeightSparkline({ history, unit }: { history: HistoryPoint[]; unit: "kg" | "lb" }) {
  const points = history
    .filter((h) => h.log_type === "weight" && h.weight_kg != null)
    .map((h) => ({
      date: h.logged_at,
      val: unit === "lb" ? kgToLb(h.weight_kg!) : h.weight_kg!,
    }));

  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-16 text-[11px] text-on-surface-variant">
        {points.length === 0 ? "No weight data yet" : "Log 2+ entries to see trend"}
      </div>
    );
  }

  const W = 240; const H = 56;
  const pad = { l: 24, r: 8, t: 6, b: 6 };
  const vals = points.map((p) => p.val);
  const minV = Math.min(...vals); const maxV = Math.max(...vals);
  const range = maxV - minV || 1;

  const toX = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / (points.length - 1);
  const toY = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - minV) / range);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.val).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${toX(points.length - 1).toFixed(1)},${H - pad.b} L${pad.l},${H - pad.b} Z`;

  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.val - first.val;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-black text-on-surface">{last.val} {unit}</span>
        <span className={`text-[10px] font-bold ${delta > 0 ? "text-amber-500" : delta < 0 ? "text-sky-500" : "text-on-surface-variant"}`}>
          {deltaStr} {unit} vs first entry
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#sparkGrad)" />
        <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* Min / Max labels */}
        <text x={pad.l - 2} y={toY(maxV) + 3.5} fontSize={8} fill="var(--color-on-surface-variant)" textAnchor="end">{maxV.toFixed(1)}</text>
        <text x={pad.l - 2} y={toY(minV) + 3.5} fontSize={8} fill="var(--color-on-surface-variant)" textAnchor="end">{minV.toFixed(1)}</text>
        {/* Dots for first and last */}
        {[0, points.length - 1].map((i) => (
          <circle key={i} cx={toX(i)} cy={toY(points[i].val)} r={3.5} fill="var(--color-primary)" />
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Log Drawer
// ---------------------------------------------------------------------------

interface AddLogDrawerProps {
  avatarId: number;
  weightUnit: "kg" | "lb";
  onClose: () => void;
  onAdded: () => void;
}

function AddLogDrawer({ avatarId, weightUnit, onClose, onAdded }: AddLogDrawerProps) {
  const [logType, setLogType] = useState<string>("weight");
  const [loggedAt, setLoggedAt] = useState(new Date().toISOString().split("T")[0]);
  const [weightVal, setWeightVal] = useState("");
  const [bcs, setBcs] = useState("5");
  const [valueText, setValueText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleSubmit = async () => {
    setErr(""); setBusy(true);
    try {
      const body: Record<string, unknown> = { log_type: logType, logged_at: loggedAt, notes: notes || undefined };
      if (logType === "weight") {
        const raw = parseFloat(weightVal);
        if (isNaN(raw) || raw <= 0) { setErr("Enter a valid weight."); return; }
        body.weight_kg = weightUnit === "lb" ? lbToKg(raw) : raw;
      } else if (logType === "body_condition") {
        body.body_condition_score = Number(bcs);
      } else if (["medication","symptom","vaccine","vet_visit","dental","grooming","note"].includes(logType)) {
        body.value_text = valueText || undefined;
      }
      const r = await authedFetch(`/api/health/${avatarId}/log`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed.");
      onAdded();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const meta = LOG_TYPE_META[logType];
  const IconComp = meta?.icon ?? ClipboardList;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-surface p-5 shadow-2xl border border-outline-variant/40">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <IconComp size={18} className="text-primary" />
            <h3 className="text-lg font-black text-on-surface">Add Health Log</h3>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Log type */}
          <div>
            <label className="text-xs font-black text-on-surface block mb-1">Entry type</label>
            <div className="grid grid-cols-3 gap-1.5">
              {LOG_TYPES.map((t) => {
                const m = LOG_TYPE_META[t];
                const Ic = m.icon;
                return (
                  <button
                    key={t} type="button"
                    onClick={() => setLogType(t)}
                    className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[10px] font-black transition-all ${logType === t ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant hover:border-primary/40"}`}
                  >
                    <Ic size={14} /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-xs font-black text-on-surface block mb-1">Date</label>
            <input type="date" value={loggedAt} onChange={(e) => setLoggedAt(e.target.value)}
              className="w-full min-h-11 rounded-xl border border-outline-variant bg-surface-container px-3 text-sm" />
          </div>

          {/* Type-specific inputs */}
          {logType === "weight" && (
            <div>
              <label className="text-xs font-black text-on-surface block mb-1">Weight ({weightUnit})</label>
              <input type="number" step="0.1" min="0.1" value={weightVal} onChange={(e) => setWeightVal(e.target.value)}
                placeholder={weightUnit === "lb" ? "e.g. 24.5" : "e.g. 11.1"}
                className="w-full min-h-11 rounded-xl border border-outline-variant bg-surface-container px-3 text-sm" />
            </div>
          )}
          {logType === "body_condition" && (
            <div>
              <label className="text-xs font-black text-on-surface block mb-1">Body Condition Score (1–9)</label>
              <div className="flex gap-1 flex-wrap">
                {[1,2,3,4,5,6,7,8,9].map((n) => (
                  <button key={n} type="button" onClick={() => setBcs(String(n))}
                    className={`h-9 w-9 rounded-lg border text-sm font-black transition-all ${bcs === String(n) ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface-variant hover:border-primary/50"}`}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-on-surface-variant mt-1">{BCS_LABELS[Number(bcs)] ?? ""}</p>
            </div>
          )}
          {["medication","symptom","vaccine","vet_visit","dental","grooming","note"].includes(logType) && (
            <div>
              <label className="text-xs font-black text-on-surface block mb-1">
                {logType === "medication" ? "Medication name / dose" : logType === "symptom" ? "Symptom description" : logType === "vaccine" ? "Vaccine name" : "Details"}
              </label>
              <input type="text" value={valueText} onChange={(e) => setValueText(e.target.value)}
                placeholder={logType === "medication" ? "e.g. Rimadyl 25mg" : logType === "vaccine" ? "e.g. Rabies booster" : "Notes..."}
                className="w-full min-h-11 rounded-xl border border-outline-variant bg-surface-container px-3 text-sm" />
            </div>
          )}

          {/* Notes (always optional) */}
          {logType !== "note" && (
            <div>
              <label className="text-xs font-black text-on-surface block mb-1">Notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-sm resize-none" />
            </div>
          )}
          {logType === "note" && (
            <div>
              <label className="text-xs font-black text-on-surface block mb-1">Note</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Write a note about your pet's health…"
                className="w-full rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-sm resize-none" />
            </div>
          )}

          {err && <p className="text-sm text-red-500 font-bold">{err}</p>}

          <button type="button" onClick={handleSubmit} disabled={busy}
            className="w-full min-h-12 rounded-xl bg-primary text-on-primary font-black flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />} Save Entry
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Profile Modal
// ---------------------------------------------------------------------------

interface EditProfileModalProps {
  avatarId: number;
  current: HealthProfile | null;
  onClose: () => void;
  onSaved: () => void;
}

function EditProfileModal({ avatarId, current, onClose, onSaved }: EditProfileModalProps) {
  const [form, setForm] = useState({
    birthday:           current?.birthday ?? "",
    weight_unit:        current?.weight_unit ?? "lb",
    target_weight:      current?.target_weight_kg != null
                          ? (current.weight_unit === "lb" ? String(kgToLb(current.target_weight_kg)) : String(current.target_weight_kg))
                          : "",
    sterilized:         current?.sterilized ?? false,
    microchip_id:       current?.microchip_id ?? "",
    vet_name:           current?.vet_name ?? "",
    vet_phone:          current?.vet_phone ?? "",
    vet_email:          current?.vet_email ?? "",
    next_vet_visit:     current?.next_vet_visit ?? "",
    next_vaccine_due:   current?.next_vaccine_due ?? "",
    insurance_provider: current?.insurance_provider ?? "",
    notes:              current?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setErr(""); setBusy(true);
    try {
      const targetNum = parseFloat(form.target_weight);
      const body: Record<string, unknown> = {
        birthday:           form.birthday || null,
        weight_unit:        form.weight_unit,
        target_weight_kg:   !isNaN(targetNum) && targetNum > 0
                              ? (form.weight_unit === "lb" ? lbToKg(targetNum) : targetNum)
                              : null,
        sterilized:         form.sterilized,
        microchip_id:       form.microchip_id || null,
        vet_name:           form.vet_name || null,
        vet_phone:          form.vet_phone || null,
        vet_email:          form.vet_email || null,
        next_vet_visit:     form.next_vet_visit || null,
        next_vaccine_due:   form.next_vaccine_due || null,
        insurance_provider: form.insurance_provider || null,
        notes:              form.notes || null,
      };
      const r = await authedFetch(`/api/health/${avatarId}/profile`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed.");
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, k: string, type = "text", placeholder = "") => (
    <div>
      <label className="text-xs font-black text-on-surface block mb-1">{label}</label>
      <input type={type} value={(form as any)[k]} onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-11 rounded-xl border border-outline-variant bg-surface-container px-3 text-sm" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl border border-outline-variant/40 m-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-on-surface flex items-center gap-2">
            <Edit3 size={18} className="text-primary" /> Health Profile
          </h3>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {field("Birthday", "birthday", "date")}
            <div>
              <label className="text-xs font-black text-on-surface block mb-1">Weight unit</label>
              <div className="flex gap-2">
                {(["lb","kg"] as const).map((u) => (
                  <button key={u} type="button" onClick={() => set("weight_unit", u)}
                    className={`flex-1 min-h-11 rounded-xl border font-black text-sm ${form.weight_unit === u ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant"}`}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {field(`Target weight (${form.weight_unit})`, "target_weight", "number", form.weight_unit === "lb" ? "e.g. 25" : "e.g. 11.3")}

          <div className="flex items-center gap-3">
            <input type="checkbox" id="sterilized" checked={form.sterilized} onChange={(e) => set("sterilized", e.target.checked)} className="w-4 h-4" />
            <label htmlFor="sterilized" className="text-sm font-bold text-on-surface">Spayed / Neutered</label>
          </div>

          {field("Microchip ID", "microchip_id", "text", "15-digit chip number")}

          <div className="border-t border-outline-variant/30 pt-3">
            <p className="text-xs font-black text-on-surface-variant mb-2 uppercase tracking-wide">Vet Info</p>
            <div className="space-y-2">
              {field("Vet name / clinic", "vet_name")}
              <div className="grid grid-cols-2 gap-2">
                {field("Vet phone", "vet_phone", "tel")}
                {field("Vet email", "vet_email", "email")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {field("Next vet visit", "next_vet_visit", "date")}
                {field("Next vaccine due", "next_vaccine_due", "date")}
              </div>
              {field("Insurance provider", "insurance_provider")}
            </div>
          </div>

          <div>
            <label className="text-xs font-black text-on-surface block mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3}
              placeholder="Allergies, ongoing conditions, special diet…"
              className="w-full rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-sm resize-none" />
          </div>

          {err && <p className="text-sm text-red-500 font-bold">{err}</p>}
          <button type="button" onClick={handleSave} disabled={busy}
            className="w-full min-h-12 rounded-xl bg-primary text-on-primary font-black flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Save Profile
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

interface Props {
  userProfile: UserProfile;
  selectedAvatarId?: number | null;
  onBack: () => void;
}

export default function PetHealthScreen({ userProfile, selectedAvatarId, onBack }: Props) {
  const [avatarList, setAvatarList] = useState<Avatar[]>([]);
  const [activeId, setActiveId] = useState<number | null>(selectedAvatarId ?? null);
  const [data, setData] = useState<HealthData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showAddLog, setShowAddLog] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [expandedLog, setExpandedLog] = useState(false);

  // Load avatar list
  useEffect(() => {
    authedFetch("/api/avatars").then((r) => r.json()).then((d) => {
      const avs: Avatar[] = d.avatars ?? [];
      setAvatarList(avs);
      if (!activeId && avs.length > 0) setActiveId(avs[0].id);
    }).catch(() => {});
  }, []);

  const load = useCallback(async (id: number) => {
    setLoading(true); setErr(""); setData(null);
    try {
      const [mainRes, histRes] = await Promise.all([
        authedFetch(`/api/health/${id}`),
        authedFetch(`/api/health/${id}/history?days=90`),
      ]);
      const mainData = await mainRes.json();
      const histData = await histRes.json();
      if (!mainRes.ok) throw new Error(mainData.error ?? "Could not load health data.");
      setData(mainData);
      setHistory(histData.history ?? []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (activeId) load(activeId); }, [activeId, load]);

  const handleDeleteLog = async (logId: number) => {
    if (!activeId || !window.confirm("Delete this log entry?")) return;
    await authedFetch(`/api/health/${activeId}/log/${logId}`, { method: "DELETE" });
    load(activeId);
  };

  const vitals = data?.vitals;
  const profile = data?.profile;
  const unit = profile?.weight_unit ?? "lb";

  const vetDays = daysUntil(profile?.next_vet_visit ?? null);
  const vacDays  = daysUntil(profile?.next_vaccine_due ?? null);

  const visibleLogs = expandedLog ? (data?.logs ?? []) : (data?.logs ?? []).slice(0, 8);

  return (
    <div className="flex flex-col min-h-[calc(100dvh-64px)] bg-surface overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-surface/90 backdrop-blur-xl border-b border-outline-variant/30 px-4 py-3 flex items-center gap-3">
        <button type="button" onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <Heart size={18} className="text-primary" />
          <h1 className="text-lg font-black text-on-surface">Pet Health</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {activeId && (
            <>
              <button type="button" onClick={() => setShowEditProfile(true)}
                className="flex items-center gap-1.5 rounded-xl border border-outline-variant/50 px-3 py-1.5 text-xs font-black hover:bg-surface-container">
                <Edit3 size={13} /> Profile
              </button>
              <button type="button" onClick={() => setShowAddLog(true)}
                className="flex items-center gap-1.5 rounded-xl bg-primary text-on-primary px-3 py-1.5 text-xs font-black">
                <Plus size={13} /> Log
              </button>
            </>
          )}
        </div>
      </div>

      {/* Avatar selector */}
      {avatarList.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-3 border-b border-outline-variant/20">
          {avatarList.map((av) => (
            <button key={av.id} type="button" onClick={() => setActiveId(av.id)}
              className={`shrink-0 flex items-center gap-2 rounded-2xl border px-3 py-1.5 transition-all ${activeId === av.id ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant hover:border-primary/40"}`}>
              {av.image_url && <img src={av.image_url} alt="" className="w-6 h-6 rounded-full object-cover" />}
              <span className="text-xs font-black truncate max-w-[72px]">{av.name}</span>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 text-on-surface-variant">
          <RefreshCw className="animate-spin mr-2" size={20} /> Loading health data…
        </div>
      )}
      {err && !loading && (
        <div className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600 flex items-center gap-2">
          <AlertCircle size={16} /> {err}
        </div>
      )}

      {data && !loading && (
        <div className="flex flex-col lg:flex-row gap-0 lg:gap-6 px-4 py-5 max-w-5xl mx-auto w-full">

          {/* Left column */}
          <div className="flex flex-col gap-4 lg:w-[280px] shrink-0">
            {/* Avatar info */}
            <div className="glass-panel rounded-2xl p-4 text-center">
              {data.avatar.image_url && (
                <img src={data.avatar.image_url} alt={data.avatar.name}
                  className="w-16 h-16 rounded-2xl object-cover mx-auto mb-2 ring-2 ring-primary/30" />
              )}
              <p className="text-base font-black text-on-surface">{data.avatar.name}</p>
              <p className="text-xs text-on-surface-variant capitalize">
                {data.avatar.breed ?? data.avatar.animal_type ?? "Pet"}{profile?.birthday ? ` · ${ageFromBirthday(profile.birthday)}` : ""}
              </p>
            </div>

            {/* 3D Vitals orb */}
            <div className="glass-panel rounded-2xl p-4">
              <p className="text-xs font-black text-on-surface-variant uppercase tracking-wide mb-3">Live Vitals</p>
              {vitals && <VitalsOrb vitals={vitals} animalType={data.avatar.animal_type} />}
            </div>

            {/* BCS */}
            <div className="glass-panel rounded-2xl p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-black text-on-surface-variant uppercase tracking-wide self-start">Body Condition</p>
              <BcsVisual score={profile?.body_condition_score ?? null} />
            </div>
          </div>

          {/* Right column */}
          <div className="flex-1 flex flex-col gap-4 mt-4 lg:mt-0">
            {/* Stats cards row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Weight */}
              <div className="glass-panel rounded-2xl p-3">
                <Scale size={14} className="text-sky-500 mb-1.5" />
                <div className="text-lg font-black text-on-surface">{displayWeight(profile?.weight_kg ?? null, unit)}</div>
                <div className="text-[10px] text-on-surface-variant">Weight</div>
                {profile?.target_weight_kg != null && (
                  <div className="text-[10px] text-primary">Goal: {displayWeight(profile.target_weight_kg, unit)}</div>
                )}
              </div>
              {/* Next vet */}
              <div className={`glass-panel rounded-2xl p-3 ${vetDays != null && vetDays <= 7 ? "ring-1 ring-amber-400" : ""}`}>
                <Stethoscope size={14} className={`mb-1.5 ${vetDays != null && vetDays <= 7 ? "text-amber-500" : "text-emerald-500"}`} />
                <div className="text-lg font-black text-on-surface">
                  {vetDays == null ? "—" : vetDays < 0 ? "Overdue" : vetDays === 0 ? "Today" : `${vetDays}d`}
                </div>
                <div className="text-[10px] text-on-surface-variant">Next Vet</div>
                {profile?.vet_name && <div className="text-[10px] text-primary truncate">{profile.vet_name}</div>}
              </div>
              {/* Next vaccine */}
              <div className={`glass-panel rounded-2xl p-3 ${vacDays != null && vacDays <= 14 ? "ring-1 ring-indigo-400" : ""}`}>
                <Syringe size={14} className={`mb-1.5 ${vacDays != null && vacDays <= 14 ? "text-indigo-500" : "text-violet-500"}`} />
                <div className="text-lg font-black text-on-surface">
                  {vacDays == null ? "—" : vacDays < 0 ? "Overdue" : vacDays === 0 ? "Today" : `${vacDays}d`}
                </div>
                <div className="text-[10px] text-on-surface-variant">Next Vaccine</div>
              </div>
              {/* Energy */}
              <div className="glass-panel rounded-2xl p-3">
                <Zap size={14} className="text-yellow-400 mb-1.5" />
                <div className="text-lg font-black text-on-surface">{vitals?.energy ?? "—"}%</div>
                <div className="text-[10px] text-on-surface-variant">Energy</div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-container overflow-hidden">
                  <div className="h-full rounded-full bg-yellow-400" style={{ width: `${vitals?.energy ?? 0}%`, transition: "width 1s ease" }} />
                </div>
              </div>
            </div>

            {/* Notes from profile */}
            {profile?.notes && (
              <div className="glass-panel rounded-2xl p-3">
                <p className="text-xs font-black text-on-surface-variant mb-1">Health Notes</p>
                <p className="text-sm text-on-surface">{profile.notes}</p>
              </div>
            )}

            {/* Weight sparkline */}
            <div className="glass-panel rounded-2xl p-4">
              <p className="text-xs font-black text-on-surface-variant uppercase tracking-wide mb-2">Weight Trend (90 days)</p>
              <WeightSparkline history={history} unit={unit} />
            </div>

            {/* Health log feed */}
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-black text-on-surface-variant uppercase tracking-wide">Health Log</p>
                <span className="text-[10px] text-on-surface-variant">{data.logs.length} entries</span>
              </div>

              {data.logs.length === 0 && (
                <p className="text-sm text-on-surface-variant text-center py-4">No log entries yet. Tap + Log to add one.</p>
              )}

              <div className="space-y-2">
                {visibleLogs.map((log) => {
                  const m = LOG_TYPE_META[log.log_type] ?? LOG_TYPE_META.note;
                  const Ic = m.icon;
                  return (
                    <div key={log.id} className="flex items-start gap-3 rounded-xl bg-surface-container px-3 py-2.5 group">
                      <div className={`shrink-0 mt-0.5 rounded-lg border p-1.5 ${m.color}`}>
                        <Ic size={13} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-black text-on-surface">{m.label}</span>
                          <span className="text-[10px] text-on-surface-variant">{log.logged_at}</span>
                        </div>
                        {log.log_type === "weight" && log.weight_kg != null && (
                          <p className="text-sm font-bold text-on-surface">{displayWeight(log.weight_kg, unit)}</p>
                        )}
                        {log.log_type === "body_condition" && log.body_condition_score != null && (
                          <p className="text-sm font-bold text-on-surface">BCS {log.body_condition_score}/9 — {BCS_LABELS[log.body_condition_score]}</p>
                        )}
                        {log.value_text && <p className="text-xs text-on-surface">{log.value_text}</p>}
                        {log.notes && <p className="text-[11px] text-on-surface-variant">{log.notes}</p>}
                      </div>
                      <button type="button" onClick={() => handleDeleteLog(log.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-error w-7 h-7 flex items-center justify-center rounded-full shrink-0">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {data.logs.length > 8 && (
                <button type="button" onClick={() => setExpandedLog((v) => !v)}
                  className="mt-2 w-full flex items-center justify-center gap-1 text-xs font-black text-primary py-2 hover:bg-primary/5 rounded-xl">
                  {expandedLog ? <><ChevronUp size={14} /> Show less</> : <><ChevronDown size={14} /> Show all {data.logs.length}</>}
                </button>
              )}
            </div>

            {/* Profile info cards */}
            {profile && (
              <div className="glass-panel rounded-2xl p-4">
                <p className="text-xs font-black text-on-surface-variant uppercase tracking-wide mb-3">Medical Info</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    { label: "Microchip",  value: profile.microchip_id || "—" },
                    { label: "Spayed/Neutered", value: profile.sterilized ? "Yes" : "No" },
                    { label: "Insurance", value: profile.insurance_provider || "—" },
                    { label: "Vet",       value: profile.vet_name || "—" },
                    { label: "Vet Phone", value: profile.vet_phone || "—" },
                    { label: "Vet Email", value: profile.vet_email || "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-surface-container px-3 py-2">
                      <div className="font-black text-on-surface-variant mb-0.5">{label}</div>
                      <div className="font-bold text-on-surface truncate">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddLog && activeId && (
        <AddLogDrawer
          avatarId={activeId}
          weightUnit={unit}
          onClose={() => setShowAddLog(false)}
          onAdded={() => { setShowAddLog(false); load(activeId); }}
        />
      )}
      {showEditProfile && activeId && (
        <EditProfileModal
          avatarId={activeId}
          current={data?.profile ?? null}
          onClose={() => setShowEditProfile(false)}
          onSaved={() => { setShowEditProfile(false); load(activeId); }}
        />
      )}
    </div>
  );
}
