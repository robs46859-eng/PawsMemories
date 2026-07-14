import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { loadPawprintTemplates } from "../server/pawprintTemplates.ts";
import { renderPawprint } from "../server/renderPawprint.ts";

const colors = ["#C94F3D", "#2D6F63", "#D39B2A", "#6D5A8C", "#596B9B", "#214F45", "#E7C7C2", "#303438"];

test("all four Pawprint layouts render valid, nonblank PNGs", async () => {
  const media = await Promise.all(colors.map((background) => sharp({
    create: { width: 160, height: 160, channels: 4, background },
  }).png().toBuffer()));

  const templates = loadPawprintTemplates();
  assert.deepEqual(templates.map((template) => template.id), ["grid-collage", "hero", "polaroid-floating-card", "split-screen"]);
  for (const template of templates) {
    const result = await renderPawprint({
      template,
      fields: {},
      media: template.id === "grid-collage" ? media : media.slice(0, 1),
      generatedText: "A favorite memory, made together.",
    });
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, "png");
    assert.ok((metadata.width || 0) >= 1000);
    assert.ok((metadata.height || 0) >= 900);
    const stats = await sharp(result).stats();
    assert.ok(stats.channels.some((channel) => channel.stdev > 5), `${template.id} should not be blank`);
  }
});

test("grid collage applies the selected center-tile color", async () => {
  const template = loadPawprintTemplates().find((item) => item.id === "grid-collage");
  assert.ok(template);
  const media = await Promise.all(colors.map((background) => sharp({
    create: { width: 160, height: 160, channels: 4, background },
  }).png().toBuffer()));
  const rendered = await renderPawprint({
    template,
    fields: { "text-tile-color": "#123456" },
    media,
    generatedText: "A favorite memory.",
  });
  const { data, info } = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });
  const sampleOffset = (410 * info.width + 410) * info.channels;
  assert.deepEqual([...data.subarray(sampleOffset, sampleOffset + 3)], [0x12, 0x34, 0x56]);
});
