import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const PAWPRINT_CATEGORIES = [
  "grieving_loss",
  "new_puppy",
  "veterinarian",
  "holiday_birthday",
  "environment",
  "postcard_travel",
  "get_well",
  "miss_you",
  "pet_business",
] as const;

export const PawprintCategorySchema = z.enum(PAWPRINT_CATEGORIES);
export type PawprintCategory = z.infer<typeof PawprintCategorySchema>;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case identifier");

const uniqueValues = <T>(values: T[]): boolean => new Set(values).size === values.length;

const TextFieldSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1).max(80),
    role: z.enum(["headline", "body", "caption", "footer_action", "event_details"]),
    required: z.boolean(),
    inputMode: z.literal("plain-text"),
    maxLength: z.number().int().min(1).max(500),
    default: z.string().max(500),
  })
  .strict()
  .refine((field) => field.default.length <= field.maxLength, {
    message: "default text exceeds maxLength",
    path: ["default"],
  });

export const PAWPRINT_MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;

const MediaFieldSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1).max(80),
    required: z.boolean(),
    referenceType: z.literal("managed-asset-id"),
    acceptedMimeTypes: z
      .array(z.enum(PAWPRINT_MEDIA_MIME_TYPES))
      .min(1)
      .refine(uniqueValues, "acceptedMimeTypes must not contain duplicates"),
    minItems: z.number().int().min(0).max(9),
    maxItems: z.number().int().min(1).max(9),
    maxVideoDurationSeconds: z.number().int().min(1).max(60).optional(),
    altTextRequired: z.literal(true),
  })
  .strict()
  .refine((field) => field.minItems <= field.maxItems, {
    message: "minItems must be less than or equal to maxItems",
    path: ["minItems"],
  });

const HexColorSchema = z.string().regex(/^#[0-9A-F]{6}$/, "must be an uppercase six-digit hex color");

const ColorFieldSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1).max(80),
    role: z.enum(["background", "card", "text", "accent"]),
    format: z.literal("hex"),
    default: HexColorSchema,
    swatches: z.array(HexColorSchema).min(2).max(12).refine(uniqueValues, "swatches must not contain duplicates"),
    allowCustom: z.boolean(),
  })
  .strict()
  .refine((field) => field.swatches.includes(field.default), {
    message: "default color must be included in swatches",
    path: ["default"],
  });

const EventDetailsSchema = z
  .object({
    date: z
      .object({
        id: IdentifierSchema,
        label: z.string().trim().min(1).max(80),
        required: z.literal(false),
        inputMode: z.literal("iso-date"),
        includeTime: z.boolean(),
      })
      .strict(),
    rsvp: z
      .object({
        id: IdentifierSchema,
        label: z.string().trim().min(1).max(80),
        required: z.literal(false),
        inputMode: z.literal("plain-text"),
        maxLength: z.number().int().min(1).max(200),
        allowExternalLinks: z.literal(false),
      })
      .strict(),
  })
  .strict();

const GridModeSchema = z
  .object({
    dimensions: z.enum(["2x2", "3x3"]),
    mediaItems: z.number().int().min(1).max(8),
    textTilePlacement: z.enum(["center-overlay", "center-cell"]),
  })
  .strict();

const LayoutSchema = z
  .object({
    kind: z.enum(["hero", "split-screen", "polaroid-floating-card", "grid-collage"]),
    canvasAspectRatio: z.enum(["4:5", "1:1", "16:9"]),
    media: z
      .object({
        placement: z.enum(["top-edge-to-edge", "left-vertical", "card-square", "grid"]),
        aspectRatio: z.enum(["16:9", "4:5", "1:1", "mixed"]),
        fit: z.enum(["cover", "contain"]),
        minItems: z.number().int().min(0).max(9),
        maxItems: z.number().int().min(1).max(9),
      })
      .strict(),
    text: z
      .object({
        placement: z.enum(["bottom", "right-center", "card-bottom", "center-tile"]),
        alignment: z.enum(["left", "center"]),
        regions: z
          .array(z.enum(["headline", "body", "caption", "event", "footer-action", "date", "rsvp"]))
          .min(1)
          .refine(uniqueValues, "text regions must not contain duplicates"),
      })
      .strict(),
    background: z
      .object({
        solidColor: z.literal(true),
        gradients: z.boolean(),
        proceduralTextures: z
          .array(z.enum(["paper", "linen", "film-grain"]))
          .max(3)
          .refine(uniqueValues, "proceduralTextures must not contain duplicates"),
      })
      .strict(),
    gridModes: z
      .array(GridModeSchema)
      .length(2)
      .refine((modes) => uniqueValues(modes.map((mode) => mode.dimensions)), "grid dimensions must not repeat")
      .optional(),
  })
  .strict()
  .superRefine((layout, ctx) => {
    if (layout.media.minItems > layout.media.maxItems) {
      ctx.addIssue({ code: "custom", path: ["media", "minItems"], message: "minItems must not exceed maxItems" });
    }
    if (layout.kind === "grid-collage" && !layout.gridModes) {
      ctx.addIssue({ code: "custom", path: ["gridModes"], message: "grid-collage requires 2x2 and 3x3 grid modes" });
    }
    if (layout.kind !== "grid-collage" && layout.gridModes) {
      ctx.addIssue({ code: "custom", path: ["gridModes"], message: "gridModes is only valid for grid-collage" });
    }
  });

const BreakpointSchema = z
  .object({
    name: z.enum(["mobile", "tablet", "desktop"]),
    minWidthPx: z.number().int().min(0).max(10000),
    maxWidthPx: z.number().int().min(1).max(10000).nullable(),
    arrangement: z.enum([
      "edge-to-edge",
      "two-column",
      "stack-media-first",
      "floating-card",
      "collage-grid",
    ]),
    columns: z.number().int().min(1).max(3),
    gapPx: z.number().int().min(0).max(64),
  })
  .strict();

const ResponsiveSchema = z
  .object({
    strategy: z.literal("fluid"),
    preserveReadingOrder: z.literal(true),
    safeAreaInsetPercent: z.number().min(0).max(20),
    breakpoints: z.array(BreakpointSchema).length(3),
  })
  .strict()
  .superRefine((responsive, ctx) => {
    const expectedNames = ["mobile", "tablet", "desktop"];
    const actualNames = responsive.breakpoints.map((breakpoint) => breakpoint.name);
    if (actualNames.some((name, index) => name !== expectedNames[index])) {
      ctx.addIssue({ code: "custom", path: ["breakpoints"], message: "breakpoints must be ordered mobile, tablet, desktop" });
    }
    for (let index = 1; index < responsive.breakpoints.length; index += 1) {
      if (responsive.breakpoints[index].minWidthPx <= responsive.breakpoints[index - 1].minWidthPx) {
        ctx.addIssue({ code: "custom", path: ["breakpoints", index, "minWidthPx"], message: "breakpoint minimums must increase" });
      }
    }
  });

const AccessibilitySchema = z
  .object({
    altTextRequired: z.literal(true),
    defaultAltText: z.string().trim().min(1).max(160),
    contrastTarget: z.literal("WCAG-AA"),
    minimumContrastRatio: z.number().min(4.5).max(21),
    readingOrder: z.array(IdentifierSchema).min(2).refine(uniqueValues, "readingOrder must not contain duplicates"),
    reducedMotion: z.literal("use-poster-frame"),
  })
  .strict();

const LicensingSchema = z
  .object({
    license: z.literal("PawsMemories-proprietary-template"),
    outputUsage: z.literal("personal-and-commercial"),
    source: z
      .object({
        type: z.literal("original"),
        name: z.literal("Paws & Memories design system"),
        attributionRequired: z.literal(false),
      })
      .strict(),
    binaryAssetsIncluded: z.literal(false),
    externalBinaryAssets: z.array(z.never()).length(0),
  })
  .strict();

export const PawprintTemplateSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be a semantic version"),
    status: z.literal("publishable"),
    categoryApplicability: z.array(PawprintCategorySchema).min(1),
    layout: LayoutSchema,
    customizableFields: z
      .object({
        text: z.array(TextFieldSchema).min(1),
        media: z.array(MediaFieldSchema).min(1),
        colors: z.array(ColorFieldSchema).min(2),
        eventDetails: EventDetailsSchema,
      })
      .strict(),
    responsive: ResponsiveSchema,
    accessibility: AccessibilitySchema,
    licensing: LicensingSchema,
  })
  .strict()
  .superRefine((template, ctx) => {
    if (!uniqueValues(template.categoryApplicability)) {
      ctx.addIssue({ code: "custom", path: ["categoryApplicability"], message: "categories must not repeat" });
    }

    const fieldIds = [
      ...template.customizableFields.text.map((field) => field.id),
      ...template.customizableFields.media.map((field) => field.id),
      ...template.customizableFields.colors.map((field) => field.id),
      template.customizableFields.eventDetails.date.id,
      template.customizableFields.eventDetails.rsvp.id,
    ];
    if (!uniqueValues(fieldIds)) {
      ctx.addIssue({ code: "custom", path: ["customizableFields"], message: "field IDs must be unique within a template" });
    }

    const mediaField = template.customizableFields.media[0];
    if (mediaField.minItems !== template.layout.media.minItems || mediaField.maxItems !== template.layout.media.maxItems) {
      ctx.addIssue({
        code: "custom",
        path: ["customizableFields", "media", 0],
        message: "media field limits must match layout media limits",
      });
    }

    const knownReadingOrderIds = new Set(fieldIds);
    for (const fieldId of template.accessibility.readingOrder) {
      if (!knownReadingOrderIds.has(fieldId)) {
        ctx.addIssue({
          code: "custom",
          path: ["accessibility", "readingOrder"],
          message: `readingOrder references unknown field ${fieldId}`,
        });
      }
    }
  });

export type PawprintTemplate = z.infer<typeof PawprintTemplateSchema>;

export const DEFAULT_PAWPRINT_TEMPLATE_DIRECTORY = path.resolve(
  process.cwd(),
  "content",
  "pawprints",
  "templates",
);

export type PawprintTemplateRegistryErrorCode =
  | "directory_unavailable"
  | "empty_registry"
  | "invalid_category"
  | "invalid_json"
  | "invalid_template"
  | "duplicate_id"
  | "non_regular_file";

export class PawprintTemplateRegistryError extends Error {
  readonly code: PawprintTemplateRegistryErrorCode;
  readonly sourceFile?: string;

  constructor(
    code: PawprintTemplateRegistryErrorCode,
    message: string,
    options: { sourceFile?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PawprintTemplateRegistryError";
    this.code = code;
    this.sourceFile = options.sourceFile;
  }
}

export interface LoadPawprintTemplatesOptions {
  directory?: string;
  category?: PawprintCategory | string;
}

function compareIds(left: PawprintTemplate, right: PawprintTemplate): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function validationSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("; ");
}

function readTemplateFile(directory: string, fileName: string): PawprintTemplate {
  const sourceFile = path.join(directory, fileName);
  let raw: unknown;

  try {
    raw = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  } catch (cause) {
    throw new PawprintTemplateRegistryError("invalid_json", `Invalid JSON in Pawprint template ${fileName}`, {
      sourceFile,
      cause,
    });
  }

  const parsed = PawprintTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PawprintTemplateRegistryError(
      "invalid_template",
      `Invalid Pawprint template ${fileName}: ${validationSummary(parsed.error)}`,
      { sourceFile, cause: parsed.error },
    );
  }

  return parsed.data;
}

/**
 * Load and validate the complete source-controlled registry before applying an
 * optional category filter. Any unreadable, malformed, or duplicate definition
 * rejects the entire load; callers never receive a partial registry.
 */
export function loadPawprintTemplates(options: LoadPawprintTemplatesOptions = {}): PawprintTemplate[] {
  const directory = path.resolve(options.directory ?? DEFAULT_PAWPRINT_TEMPLATE_DIRECTORY);
  let category: PawprintCategory | undefined;

  if (options.category !== undefined) {
    const parsedCategory = PawprintCategorySchema.safeParse(options.category);
    if (!parsedCategory.success) {
      throw new PawprintTemplateRegistryError(
        "invalid_category",
        `Unknown Pawprint category: ${String(options.category)}`,
        { cause: parsedCategory.error },
      );
    }
    category = parsedCategory.data;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    throw new PawprintTemplateRegistryError(
      "directory_unavailable",
      `Pawprint template directory is unavailable: ${directory}`,
      { cause },
    );
  }

  const jsonEntries = entries.filter((entry) => entry.name.endsWith(".json")).sort((a, b) => {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  if (jsonEntries.length === 0) {
    throw new PawprintTemplateRegistryError("empty_registry", `No Pawprint template JSON files found in ${directory}`);
  }

  const templates: PawprintTemplate[] = [];
  const sourceById = new Map<string, string>();

  for (const entry of jsonEntries) {
    if (!entry.isFile()) {
      throw new PawprintTemplateRegistryError(
        "non_regular_file",
        `Pawprint template path must be a regular file: ${entry.name}`,
        { sourceFile: path.join(directory, entry.name) },
      );
    }

    const template = readTemplateFile(directory, entry.name);
    const priorSource = sourceById.get(template.id);
    if (priorSource) {
      throw new PawprintTemplateRegistryError(
        "duplicate_id",
        `Duplicate Pawprint template id "${template.id}" in ${priorSource} and ${entry.name}`,
        { sourceFile: path.join(directory, entry.name) },
      );
    }
    sourceById.set(template.id, entry.name);
    templates.push(template);
  }

  templates.sort(compareIds);
  return category
    ? templates.filter((template) => template.categoryApplicability.includes(category))
    : templates;
}

export function loadPawprintTemplatesByCategory(
  category: PawprintCategory | string,
  directory = DEFAULT_PAWPRINT_TEMPLATE_DIRECTORY,
): PawprintTemplate[] {
  return loadPawprintTemplates({ directory, category });
}

export interface PawprintEditorField {
  key: string;
  type: "text" | "image" | "color" | "date";
  label: string;
  required: boolean;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  defaultValue?: string;
  swatches?: string[];
}

export interface PawprintEditorTemplate {
  category: PawprintCategory;
  layoutId: string;
  name: string;
  description: string;
  tone: string;
  sampleCopy: string[];
  fieldSchema: PawprintEditorField[];
  imagePromptTemplate: string;
  definition: PawprintTemplate;
}

function editorFields(template: PawprintTemplate): PawprintEditorField[] {
  const text: PawprintEditorField[] = template.customizableFields.text.map((field) => ({
    key: field.id,
    type: "text",
    label: field.label,
    required: field.required,
    maxLength: field.maxLength,
    defaultValue: field.default,
  }));
  const media: PawprintEditorField[] = template.customizableFields.media.map((field) => ({
    key: field.id,
    type: "image",
    label: field.label,
    required: field.required,
    minItems: field.minItems,
    maxItems: field.maxItems,
  }));
  const colors: PawprintEditorField[] = template.customizableFields.colors.map((field) => ({
    key: field.id,
    type: "color",
    label: field.label,
    required: true,
    defaultValue: field.default,
    swatches: field.swatches,
  }));
  const event: PawprintEditorField[] = [
    {
      key: template.customizableFields.eventDetails.date.id,
      type: "date",
      label: template.customizableFields.eventDetails.date.label,
      required: false,
    },
    {
      key: template.customizableFields.eventDetails.rsvp.id,
      type: "text",
      label: template.customizableFields.eventDetails.rsvp.label,
      required: false,
      maxLength: template.customizableFields.eventDetails.rsvp.maxLength,
    },
  ];
  return [...media, ...text, ...colors, ...event];
}

export function loadPawprintEditorTemplates(category?: PawprintCategory | string): PawprintEditorTemplate[] {
  const templates = loadPawprintTemplates(category ? { category } : {});
  return templates.flatMap((template) =>
    template.categoryApplicability
      .filter((candidate) => !category || candidate === category)
      .map((candidate) => ({
        category: candidate,
        layoutId: template.id,
        name: template.name,
        description: template.description,
        tone: template.layout.kind,
        sampleCopy: template.customizableFields.text
          .map((field) => field.default)
          .filter(Boolean),
        fieldSchema: editorFields(template),
        imagePromptTemplate: [
          `Create media for a ${template.name} digital stationery layout.`,
          template.description,
          `Composition: ${template.layout.media.placement}; text area: ${template.layout.text.placement}.`,
        ].join(" "),
        definition: template,
      })),
  );
}
