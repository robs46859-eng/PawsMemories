import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const {
  PAWPRINT_CATEGORIES,
  PAWPRINT_MEDIA_MIME_TYPES,
  PawprintTemplateRegistryError,
  PawprintTemplateSchema,
  loadPawprintTemplates,
  loadPawprintTemplatesByCategory,
} = await import("../server/pawprintTemplates.ts");

function withTempRegistry(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pawprint-templates-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeDefinition(directory, fileName, definition) {
  fs.writeFileSync(path.join(directory, fileName), JSON.stringify(definition, null, 2));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("source-controlled Pawprint templates are publishable and complete", () => {
  const templates = loadPawprintTemplates();

  assert.deepEqual(
    templates.map((template) => template.id),
    ["grid-collage", "hero", "polaroid-floating-card", "split-screen"],
  );

  for (const template of templates) {
    assert.deepEqual(PawprintTemplateSchema.parse(template), template);
    assert.equal(template.status, "publishable");
    assert.match(template.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(template.categoryApplicability, PAWPRINT_CATEGORIES);

    assert.ok(template.customizableFields.text.length > 0);
    assert.ok(template.customizableFields.media.length > 0);
    assert.ok(template.customizableFields.colors.length >= 2);
    assert.equal(template.customizableFields.eventDetails.date.required, false);
    assert.equal(template.customizableFields.eventDetails.rsvp.required, false);

    for (const media of template.customizableFields.media) {
      assert.equal(media.referenceType, "managed-asset-id");
      assert.equal(media.altTextRequired, true);
      assert.ok(media.acceptedMimeTypes.every((mimeType) => PAWPRINT_MEDIA_MIME_TYPES.includes(mimeType)));
      assert.ok(media.acceptedMimeTypes.every((mimeType) => mimeType.startsWith("image/")));
    }

    for (const color of template.customizableFields.colors) {
      assert.match(color.default, /^#[0-9A-F]{6}$/);
      assert.ok(color.swatches.includes(color.default));
    }

    assert.equal(template.responsive.breakpoints.length, 3);
    assert.equal(template.accessibility.contrastTarget, "WCAG-AA");
    assert.equal(template.accessibility.altTextRequired, true);
    assert.equal(template.licensing.source.type, "original");
    assert.equal(template.licensing.binaryAssetsIncluded, false);
    assert.deepEqual(template.licensing.externalBinaryAssets, []);
    assert.doesNotMatch(JSON.stringify(template), /https?:\/\//i);
  }
});

test("layout definitions encode the four requested compositions", () => {
  const templates = new Map(loadPawprintTemplates().map((template) => [template.id, template]));

  const hero = templates.get("hero");
  assert.equal(hero.layout.media.placement, "top-edge-to-edge");
  assert.equal(hero.layout.text.placement, "bottom");
  assert.ok(hero.layout.text.regions.includes("footer-action"));

  const split = templates.get("split-screen");
  assert.equal(split.layout.media.placement, "left-vertical");
  assert.equal(split.layout.text.placement, "right-center");
  assert.equal(split.responsive.breakpoints[0].arrangement, "stack-media-first");

  const polaroid = templates.get("polaroid-floating-card");
  assert.equal(polaroid.layout.media.aspectRatio, "1:1");
  assert.equal(polaroid.layout.background.gradients, true);
  assert.ok(polaroid.layout.background.proceduralTextures.includes("paper"));
  assert.equal(polaroid.customizableFields.colors.find((field) => field.role === "card").default, "#FFFDF7");

  const collage = templates.get("grid-collage");
  assert.deepEqual(
    collage.layout.gridModes.map((mode) => mode.dimensions),
    ["2x2", "3x3"],
  );
  assert.equal(collage.layout.text.placement, "center-tile");
  assert.equal(collage.customizableFields.colors.find((field) => field.id === "text-tile-color").role, "card");
});

test("loading is deterministic regardless of source file names", (t) => {
  const directory = withTempRegistry(t);
  const templates = loadPawprintTemplates();

  for (const [index, template] of [...templates].reverse().entries()) {
    writeDefinition(directory, `${String(index).padStart(2, "0")}-arbitrary.json`, template);
  }

  assert.deepEqual(
    loadPawprintTemplates({ directory }).map((template) => template.id),
    templates.map((template) => template.id),
  );
});

test("category filtering returns only applicable templates", (t) => {
  const directory = withTempRegistry(t);
  const [first, second] = loadPawprintTemplates();
  const grievingTemplate = clone(first);
  const puppyTemplate = clone(second);
  grievingTemplate.categoryApplicability = ["grieving_loss"];
  puppyTemplate.categoryApplicability = ["new_puppy"];

  writeDefinition(directory, "one.json", grievingTemplate);
  writeDefinition(directory, "two.json", puppyTemplate);

  assert.deepEqual(
    loadPawprintTemplatesByCategory("grieving_loss", directory).map((template) => template.id),
    [grievingTemplate.id],
  );
  assert.deepEqual(loadPawprintTemplates({ directory, category: "miss_you" }), []);
  assert.throws(
    () => loadPawprintTemplates({ directory, category: "not-a-category" }),
    (error) => error instanceof PawprintTemplateRegistryError && error.code === "invalid_category",
  );
});

test("duplicate IDs fail the entire registry load", (t) => {
  const directory = withTempRegistry(t);
  const template = loadPawprintTemplates()[0];
  writeDefinition(directory, "first.json", template);
  writeDefinition(directory, "second.json", template);

  assert.throws(
    () => loadPawprintTemplates({ directory }),
    (error) =>
      error instanceof PawprintTemplateRegistryError &&
      error.code === "duplicate_id" &&
      /Duplicate Pawprint template id/.test(error.message),
  );
});

test("invalid shapes fail closed before category filtering", (t) => {
  const directory = withTempRegistry(t);
  const template = clone(loadPawprintTemplates()[0]);
  template.categoryApplicability = ["grieving_loss"];
  writeDefinition(directory, "valid-but-filtered-out.json", template);

  const invalid = clone(template);
  invalid.id = "invalid-shape";
  delete invalid.version;
  writeDefinition(directory, "invalid.json", invalid);

  assert.throws(
    () => loadPawprintTemplates({ directory, category: "new_puppy" }),
    (error) =>
      error instanceof PawprintTemplateRegistryError &&
      error.code === "invalid_template" &&
      /version/.test(error.message),
  );
});

test("unknown definition fields and malformed JSON are rejected", (t) => {
  const strictDirectory = withTempRegistry(t);
  const template = clone(loadPawprintTemplates()[0]);
  template.remoteAssetUrl = "https://example.invalid/preview.png";
  writeDefinition(strictDirectory, "unknown-field.json", template);

  assert.throws(
    () => loadPawprintTemplates({ directory: strictDirectory }),
    (error) => error instanceof PawprintTemplateRegistryError && error.code === "invalid_template",
  );

  const malformedDirectory = withTempRegistry(t);
  fs.writeFileSync(path.join(malformedDirectory, "broken.json"), "{ not valid JSON");
  assert.throws(
    () => loadPawprintTemplates({ directory: malformedDirectory }),
    (error) => error instanceof PawprintTemplateRegistryError && error.code === "invalid_json",
  );
});
