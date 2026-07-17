export type WardrobeKind = "neck" | "head" | "body" | "back" | "face";

export interface WardrobeItem {
  id: string;
  name: string;
  kind: WardrobeKind;
  color: string;
  sourceUnits: "meter";
  conversionToMeters: 1;
  dimensionsMeters: [number, number, number];
  anchorMeters: [number, number, number];
  axes: "right-handed-y-up";
  sourceLibrary: string;
  sourceUrl: string;
  license: "CC0-1.0";
  geometry: "procedural-web-derivative";
}

const SOURCE_LIBRARY = "Quaternius Modular Character Outfits - Fantasy";
const SOURCE_URL = "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html";

const item = (
  id: string,
  name: string,
  kind: WardrobeKind,
  color: string,
  dimensionsMeters: [number, number, number],
  anchorMeters: [number, number, number],
): WardrobeItem => ({
  id, name, kind, color, dimensionsMeters, anchorMeters,
  sourceUnits: "meter", conversionToMeters: 1, axes: "right-handed-y-up",
  sourceLibrary: SOURCE_LIBRARY, sourceUrl: SOURCE_URL, license: "CC0-1.0",
  geometry: "procedural-web-derivative",
});

/** Web-safe wardrobe derivatives; one Three.js unit is one meter. */
export const WARDROBE_CATALOG: WardrobeItem[] = [
  item("scarlet-collar", "Scarlet Collar", "neck", "#b4232f", [0.42, 0.06, 0.42], [0, 0.92, 0]),
  item("forest-collar", "Forest Collar", "neck", "#276749", [0.42, 0.06, 0.42], [0, 0.92, 0]),
  item("gold-bow", "Golden Bow Tie", "neck", "#d69e2e", [0.34, 0.18, 0.1], [0, 0.83, 0.2]),
  item("blue-bandana", "Blue Bandana", "neck", "#2b6cb0", [0.42, 0.3, 0.08], [0, 0.8, 0.18]),
  item("ranger-cape", "Ranger Cape", "back", "#355e3b", [0.62, 0.72, 0.08], [0, 0.68, -0.22]),
  item("royal-cape", "Royal Cape", "back", "#6b46c1", [0.62, 0.72, 0.08], [0, 0.68, -0.22]),
  item("party-hat", "Party Hat", "head", "#ed64a6", [0.3, 0.42, 0.3], [0, 1.42, 0]),
  item("wizard-hat", "Wizard Hat", "head", "#44337a", [0.48, 0.58, 0.48], [0, 1.42, 0]),
  item("ranger-hood", "Ranger Hood", "head", "#2f855a", [0.46, 0.42, 0.4], [0, 1.25, 0]),
  item("gold-crown", "Golden Crown", "head", "#d6ad29", [0.38, 0.3, 0.38], [0, 1.4, 0]),
  item("round-glasses", "Round Glasses", "face", "#2d3748", [0.42, 0.16, 0.04], [0, 1.2, 0.24]),
  item("heart-glasses", "Heart Glasses", "face", "#e53e3e", [0.46, 0.18, 0.04], [0, 1.2, 0.24]),
  item("adventure-vest", "Adventure Vest", "body", "#975a16", [0.58, 0.52, 0.34], [0, 0.68, 0]),
  item("winter-vest", "Winter Vest", "body", "#3182ce", [0.6, 0.54, 0.36], [0, 0.68, 0]),
  item("hero-medallion", "Hero Medallion", "neck", "#ecc94b", [0.18, 0.24, 0.05], [0, 0.78, 0.22]),
];

export const WARDROBE_ITEM_IDS = new Set(WARDROBE_CATALOG.map(({ id }) => id));
