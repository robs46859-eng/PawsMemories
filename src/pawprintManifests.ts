import { PawprintTemplateManifest } from "./types";

export const PAWPRINT_CATEGORIES = [
  "birthdays", "adoption", "memorial", "holidays", "thank-you",
  "milestones", "pet_posters", "invitations", "collages", "blank_stationery"
];

// Helper to duplicate a layout across categories
function expandCategories(base: Omit<PawprintTemplateManifest, "id" | "category">, idPrefix: string): PawprintTemplateManifest[] {
  return PAWPRINT_CATEGORIES.map(category => ({
    ...base,
    id: `${category}_${idPrefix}`,
    category
  }));
}

const polaroidBase: Omit<PawprintTemplateManifest, "id" | "category"> = {
  version: 1,
  name: "Polaroid Scrapbook",
  aspectRatio: "portrait",
  printSpec: { widthIn: 5, heightIn: 7, dpi: 300, bleedIn: 0.125 },
  fields: [
    { key: "photo1", kind: "image", label: "Main Photo", required: true },
    { key: "caption", kind: "short_text", label: "Handwritten Caption", required: false, maxLength: 60, defaultValue: "A day to remember" }
  ],
  slots: [
    // Polaroid image slot (1200x1200) centered horizontally, top offset
    { fieldKey: "photo1", x: 150, y: 150, width: 1200, height: 1200, styleToken: "polaroid_image" },
    // Text slot is virtualized, rendered by sharp via text overlay logic based on styleToken
    { fieldKey: "caption", x: 150, y: 1450, width: 1200, height: 400, styleToken: "handwritten_text" }
  ]
};

const heroBase: Omit<PawprintTemplateManifest, "id" | "category"> = {
  version: 1,
  name: "Hero Image Narrative",
  aspectRatio: "portrait",
  printSpec: { widthIn: 5, heightIn: 7, dpi: 300, bleedIn: 0.125 },
  fields: [
    { key: "photo1", kind: "image", label: "Full Bleed Photo", required: true },
    { key: "story", kind: "long_text", label: "Your Story", required: true, maxLength: 300, defaultValue: "Once upon a time..." }
  ],
  slots: [
    // Full bleed image
    { fieldKey: "photo1", x: 0, y: 0, width: 1500, height: 2100, styleToken: "full_bleed" },
    // Text overlay box
    { fieldKey: "story", x: 100, y: 1500, width: 1300, height: 500, styleToken: "glass_text_box" }
  ]
};

const gridBase: Omit<PawprintTemplateManifest, "id" | "category"> = {
  version: 1,
  name: "Chronological Grid",
  aspectRatio: "portrait",
  printSpec: { widthIn: 5, heightIn: 7, dpi: 300, bleedIn: 0.125 },
  fields: [
    { key: "photo1", kind: "image", label: "Photo 1", required: true },
    { key: "photo2", kind: "image", label: "Photo 2", required: true },
    { key: "photo3", kind: "image", label: "Photo 3", required: true },
    { key: "photo4", kind: "image", label: "Photo 4", required: true },
    { key: "title", kind: "short_text", label: "Grid Title", required: true, maxLength: 40, defaultValue: "The Journey" }
  ],
  slots: [
    { fieldKey: "photo1", x: 100, y: 300, width: 600, height: 600, styleToken: "grid_item" },
    { fieldKey: "photo2", x: 800, y: 300, width: 600, height: 600, styleToken: "grid_item" },
    { fieldKey: "photo3", x: 100, y: 1000, width: 600, height: 600, styleToken: "grid_item" },
    { fieldKey: "photo4", x: 800, y: 1000, width: 600, height: 600, styleToken: "grid_item" },
    { fieldKey: "title", x: 100, y: 100, width: 1300, height: 150, styleToken: "header_text" }
  ]
};

const timelineBase: Omit<PawprintTemplateManifest, "id" | "category"> = {
  version: 1,
  name: "Minimalist Timeline",
  aspectRatio: "portrait",
  printSpec: { widthIn: 5, heightIn: 7, dpi: 300, bleedIn: 0.125 },
  fields: [
    { key: "photo1", kind: "image", label: "Event 1 Photo", required: true },
    { key: "date1", kind: "date", label: "Event 1 Date", required: true },
    { key: "desc1", kind: "short_text", label: "Event 1 Description", required: true, maxLength: 100 },
    { key: "photo2", kind: "image", label: "Event 2 Photo", required: true },
    { key: "date2", kind: "date", label: "Event 2 Date", required: true },
    { key: "desc2", kind: "short_text", label: "Event 2 Description", required: true, maxLength: 100 }
  ],
  slots: [
    { fieldKey: "photo1", x: 200, y: 200, width: 400, height: 400, styleToken: "circle_crop" },
    { fieldKey: "date1", x: 700, y: 300, width: 600, height: 100, styleToken: "timeline_date" },
    { fieldKey: "desc1", x: 700, y: 400, width: 600, height: 200, styleToken: "timeline_desc" },
    
    { fieldKey: "photo2", x: 200, y: 1100, width: 400, height: 400, styleToken: "circle_crop" },
    { fieldKey: "date2", x: 700, y: 1200, width: 600, height: 100, styleToken: "timeline_date" },
    { fieldKey: "desc2", x: 700, y: 1300, width: 600, height: 200, styleToken: "timeline_desc" }
  ]
};

const collageBase: Omit<PawprintTemplateManifest, "id" | "category"> = {
  version: 1,
  name: "Thematic Collage",
  aspectRatio: "landscape",
  printSpec: { widthIn: 7, heightIn: 5, dpi: 300, bleedIn: 0.125 }, // 2100 x 1500
  fields: [
    { key: "photo1", kind: "image", label: "Large Photo", required: true },
    { key: "photo2", kind: "image", label: "Small Photo 1", required: true },
    { key: "photo3", kind: "image", label: "Small Photo 2", required: true },
    { key: "quote", kind: "long_text", label: "Reflective Quote", required: false, maxLength: 200, defaultValue: "Memories to cherish..." }
  ],
  slots: [
    { fieldKey: "photo1", x: 100, y: 100, width: 1200, height: 1300, styleToken: "collage_main" },
    { fieldKey: "photo2", x: 1400, y: 100, width: 600, height: 600, styleToken: "collage_sub" },
    { fieldKey: "photo3", x: 1400, y: 800, width: 600, height: 600, styleToken: "collage_sub" },
    { fieldKey: "quote", x: 150, y: 1100, width: 1100, height: 250, styleToken: "quote_overlay" }
  ]
};

export const PAWPRINT_MANIFESTS: PawprintTemplateManifest[] = [
  ...expandCategories(polaroidBase, "polaroid"),
  ...expandCategories(heroBase, "hero"),
  ...expandCategories(gridBase, "grid"),
  ...expandCategories(timelineBase, "timeline"),
  ...expandCategories(collageBase, "collage")
];
