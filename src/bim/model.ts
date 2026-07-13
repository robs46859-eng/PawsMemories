export const BIM_ELEMENT_TYPES = ["wall", "slab", "roof", "opening", "door", "window", "space", "column", "beam"] as const;
export type BimElementType = typeof BIM_ELEMENT_TYPES[number];
export type Point3 = [number, number, number];

export interface BimLevel { id: string; name: string; elevation: number }
export interface BimElement {
  id: string; type: BimElementType; name: string; levelId: string;
  position: Point3; end?: [number, number]; width?: number; depth?: number;
  height?: number; thickness?: number; hostId?: string; openingId?: string;
  properties?: Record<string, string | number | boolean>;
}
export interface BimModel { name: string; siteName: string; buildingName: string; levels: BimLevel[]; elements: BimElement[] }
export interface BimHistory { past: BimModel[]; present: BimModel; future: BimModel[] }
export interface BimPreflightReport {
  stage: "pre-build"; passed: boolean; errors: string[]; warnings: string[];
  levelCount: number; elementCount: number; bounds: { min: Point3; max: Point3 } | null;
}

export const EMPTY_BIM_MODEL: BimModel = {
  name: "Scaled building", siteName: "Site", buildingName: "Building",
  levels: [{ id: "level-0", name: "Ground Floor", elevation: 0 }], elements: [],
};

export function snap(value: number, increment = 0.1): number {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) throw new Error("Snap values must be finite and positive");
  return Number((Math.round(value / increment) * increment).toFixed(12));
}

export function validateBimModel(model: BimModel): string[] {
  const errors: string[] = [];
  if (!model || !Array.isArray(model.levels) || !Array.isArray(model.elements)) return ["Model requires levels and elements arrays."];
  const levelIds = new Set(model.levels.map((level) => level?.id).filter((id): id is string => typeof id === "string" && !!id));
  const elements = new Map(model.elements.filter(Boolean).map((element) => [element.id, element]));
  if (!model.levels.length) errors.push("At least one level is required.");
  if (!model.elements.length) errors.push("At least one building element is required.");
  if (model.levels.some((level) => !level || typeof level.id !== "string" || !level.id || !Number.isFinite(level.elevation))) errors.push("Every level requires a stable ID and finite elevation.");
  if (levelIds.size !== model.levels.length) errors.push("Level IDs must be unique.");
  if (elements.size !== model.elements.length) errors.push("Element IDs must be unique.");
  for (const element of model.elements) {
    if (!element || typeof element.id !== "string" || !element.id || typeof element.name !== "string") {
      errors.push("Every element requires a stable ID and name.");
      continue;
    }
    if (!BIM_ELEMENT_TYPES.includes(element.type)) errors.push(`${element.id}: unsupported type.`);
    if (!levelIds.has(element.levelId)) errors.push(`${element.id}: level does not exist.`);
    if (!Array.isArray(element.position) || element.position.length !== 3 || element.position.some((value) => !Number.isFinite(value))) {
      errors.push(`${element.id}: position must contain three finite coordinates.`);
      continue;
    }
    if (element.type === "wall" && (!element.end || (element.end[0] === element.position[0] && element.end[1] === element.position[1]))) errors.push(`${element.id}: wall needs a non-zero end point.`);
    if (element.type === "opening" && (!element.hostId || !elements.get(element.hostId)?.type.includes("wall"))) errors.push(`${element.id}: opening needs a wall host.`);
    if ((element.type === "door" || element.type === "window") && (!element.openingId || elements.get(element.openingId)?.type !== "opening")) errors.push(`${element.id}: filling needs an opening.`);
    for (const value of [element.width, element.depth, element.height, element.thickness].filter((item) => item !== undefined)) {
      if (!Number.isFinite(value) || value! <= 0) errors.push(`${element.id}: dimensions must be positive.`);
    }
  }
  return errors;
}

export function preflightBimModel(model: BimModel): BimPreflightReport {
  const errors = validateBimModel(model);
  const warnings: string[] = [];
  if (!model || !Array.isArray(model.levels) || !Array.isArray(model.elements)) {
    return { stage: "pre-build", passed: false, errors, warnings, levelCount: 0, elementCount: 0, bounds: null };
  }
  if (!model.elements.some((item) => item?.type === "space")) warnings.push("No spaces are defined; room schedules will be empty.");
  if (!model.elements.some((item) => item?.type === "slab")) warnings.push("No slab is defined.");
  const points: Point3[] = [];
  for (const item of model.elements) {
    if (!item || !Array.isArray(item.position) || item.position.length !== 3 || item.position.some((value) => !Number.isFinite(value))) continue;
    const [x, y, z] = item.position;
    const width = item.width || 0;
    const depth = item.depth || item.thickness || 0;
    const height = item.height || 0;
    points.push([x, y, z], [x + width, y + depth, z + height]);
    if (item.end) points.push([item.end[0], item.end[1], z + height]);
  }
  const bounds = points.length ? {
    min: [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.min(...points.map((p) => p[2]))] as Point3,
    max: [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1])), Math.max(...points.map((p) => p[2]))] as Point3,
  } : null;
  return { stage: "pre-build", passed: errors.length === 0, errors, warnings, levelCount: model.levels.length, elementCount: model.elements.length, bounds };
}

export type BimAction =
  | { type: "replace"; model: BimModel }
  | { type: "add-level"; level: BimLevel }
  | { type: "add-element"; element: BimElement }
  | { type: "remove-element"; id: string }
  | { type: "undo" }
  | { type: "redo" };

export function bimHistoryReducer(state: BimHistory, action: BimAction): BimHistory {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
  }
  let present: BimModel;
  if (action.type === "replace") present = structuredClone(action.model);
  else if (action.type === "add-level") present = { ...state.present, levels: [...state.present.levels, action.level] };
  else if (action.type === "add-element") present = { ...state.present, elements: [...state.present.elements, action.element] };
  else present = { ...state.present, elements: state.present.elements.filter((element) => element.id !== action.id && element.hostId !== action.id && element.openingId !== action.id) };
  return { past: [...state.past.slice(-49), state.present], present, future: [] };
}
