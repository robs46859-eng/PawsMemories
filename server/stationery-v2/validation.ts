import {
  StationeryValidationReportSchema,
  TemplateVersionSpecSchema,
  TextLayoutMeasurementSchema,
  type StationeryValidationReport,
  type TemplateVersionSpec,
  type TextLayoutMeasurement,
  type ValidationFinding,
} from "./contracts.ts";

const EPSILON_IN = 0.000_001;
const EPSILON_PX = 0.01;

function within(container: { x: number; y: number; width: number; height: number }, item: { x: number; y: number; width: number; height: number }): boolean {
  return item.x + EPSILON_IN >= container.x
    && item.y + EPSILON_IN >= container.y
    && item.x + item.width <= container.x + container.width + EPSILON_IN
    && item.y + item.height <= container.y + container.height + EPSILON_IN;
}

function error(ruleId: string, subject: string, message: string, detail: Partial<ValidationFinding> = {}): ValidationFinding {
  return { ruleId, severity: "error", subject, message, ...detail };
}

export function validateTemplateSpec(rawSpec: TemplateVersionSpec): StationeryValidationReport {
  const spec = TemplateVersionSpecSchema.parse(rawSpec);
  const findings: ValidationFinding[] = [];
  const fullBleed = {
    x: -spec.bleedIn.left,
    y: -spec.bleedIn.top,
    width: spec.trimIn.width + spec.bleedIn.left + spec.bleedIn.right,
    height: spec.trimIn.height + spec.bleedIn.top + spec.bleedIn.bottom,
  };
  const safeArea = {
    x: spec.safeAreaIn.left,
    y: spec.safeAreaIn.top,
    width: spec.trimIn.width - spec.safeAreaIn.left - spec.safeAreaIn.right,
    height: spec.trimIn.height - spec.safeAreaIn.top - spec.safeAreaIn.bottom,
  };

  if (safeArea.width <= 0 || safeArea.height <= 0) {
    findings.push(error("geometry.safe_area_valid", "template", "Safe-area insets consume the entire trim area."));
  }
  if (!within(spec.backgroundCoverageIn, fullBleed)) {
    findings.push(error("geometry.background_covers_bleed", "background", "Background artwork does not cover the full bleed area."));
  }

  const licensedFonts = new Map(spec.fontLicenses.map((font) => [font.family.toLocaleLowerCase(), font]));
  for (const slot of spec.slots) {
    const allowedArea = slot.kind === "image" && slot.allowBleed ? fullBleed : safeArea;
    if (!within(allowedArea, slot.boundsIn)) {
      findings.push(error(
        slot.kind === "text" ? "geometry.text_safe_area" : "geometry.image_bounds",
        slot.slotId,
        slot.kind === "text" ? "Text slot extends outside the safe area." : "Image slot extends outside its permitted area.",
      ));
    }
    if (slot.kind === "text") {
      const license = licensedFonts.get(slot.fontFamily.toLocaleLowerCase());
      if (!license || !license.commercialUse || !license.embeddingAllowed) {
        findings.push(error("rights.font_print_license", slot.slotId, "Text slot font lacks recorded commercial-use and embedding rights."));
      }
    }
  }

  for (const preset of spec.presets) {
    const includeBleed = preset.includeBleed;
    const physicalWidth = spec.trimIn.width + (includeBleed ? spec.bleedIn.left + spec.bleedIn.right : 0);
    const physicalHeight = spec.trimIn.height + (includeBleed ? spec.bleedIn.top + spec.bleedIn.bottom : 0);
    const expectedWidth = Math.round(physicalWidth * preset.targetDpi);
    const expectedHeight = Math.round(physicalHeight * preset.targetDpi);
    const effectiveDpiX = preset.widthPx / physicalWidth;
    const effectiveDpiY = preset.heightPx / physicalHeight;

    if (preset.widthPx !== expectedWidth || preset.heightPx !== expectedHeight) {
      findings.push(error(
        "pixels.exact_dimensions",
        preset.presetId,
        `Preset must be exactly ${expectedWidth}x${expectedHeight}px for its physical size and declared DPI.`,
      ));
    }
    if (effectiveDpiX + EPSILON_PX < preset.targetDpi || effectiveDpiY + EPSILON_PX < preset.targetDpi) {
      findings.push(error(
        "pixels.minimum_dpi",
        preset.presetId,
        "Preset has insufficient pixels for its declared physical size and DPI.",
        { measured: Math.min(effectiveDpiX, effectiveDpiY), required: preset.targetDpi, unit: "dpi" },
      ));
    }
    if (preset.purpose === "print") {
      if (!preset.includeBleed) {
        findings.push(error("bleed.print_included", preset.presetId, "Print presets must include bleed pixels."));
      }
      const minimumActualBleed = Math.min(spec.bleedIn.top, spec.bleedIn.right, spec.bleedIn.bottom, spec.bleedIn.left);
      if (minimumActualBleed + EPSILON_IN < preset.minimumBleedIn) {
        findings.push(error(
          "bleed.minimum_size",
          preset.presetId,
          "Template bleed is below the provider preset minimum.",
          { measured: minimumActualBleed, required: preset.minimumBleedIn, unit: "in" },
        ));
      }
    }
  }

  return StationeryValidationReportSchema.parse({
    schemaVersion: "stationery.validation.v1",
    templateUuid: spec.templateUuid,
    templateVersionNumber: spec.versionNumber,
    findings,
    overallPass: findings.every((finding) => finding.severity !== "error"),
  });
}

export function findTextOverflow(rawMeasurements: TextLayoutMeasurement[]): ValidationFinding[] {
  return rawMeasurements.flatMap((rawMeasurement) => {
    const measurement = TextLayoutMeasurementSchema.parse(rawMeasurement);
    const findings: ValidationFinding[] = [];
    if (measurement.measuredWidthPx > measurement.boxWidthPx + EPSILON_PX) {
      findings.push(error("text.width_overflow", measurement.slotId, "Measured text is wider than its text box.", {
        measured: measurement.measuredWidthPx,
        required: measurement.boxWidthPx,
        unit: "px",
      }));
    }
    if (measurement.measuredHeightPx > measurement.boxHeightPx + EPSILON_PX) {
      findings.push(error("text.height_overflow", measurement.slotId, "Measured text is taller than its text box.", {
        measured: measurement.measuredHeightPx,
        required: measurement.boxHeightPx,
        unit: "px",
      }));
    }
    if (measurement.lineCount > measurement.maxLines) {
      findings.push(error("text.line_overflow", measurement.slotId, "Measured text exceeds the configured line limit.", {
        measured: measurement.lineCount,
        required: measurement.maxLines,
        unit: "lines",
      }));
    }
    if (measurement.clippedGlyphCount > 0) {
      findings.push(error("text.clipped_glyphs", measurement.slotId, "The layout engine reported clipped glyphs.", {
        measured: measurement.clippedGlyphCount,
        required: 0,
        unit: "glyphs",
      }));
    }
    return findings;
  });
}
