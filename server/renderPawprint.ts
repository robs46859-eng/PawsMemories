import sharp from "sharp";
import type { PawprintTemplate } from "./pawprintTemplates";

export interface RenderPawprintInput {
  template: PawprintTemplate;
  fields: Record<string, string | string[]>;
  media: Buffer[];
  generatedText: string;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] || character);
}

function value(input: RenderPawprintInput, key: string, fallback = ""): string {
  const current = input.fields[key];
  return typeof current === "string" && current.trim() ? current.trim() : fallback;
}

function color(input: RenderPawprintInput, role: string, fallback: string): string {
  const field = input.template.customizableFields.colors.find((candidate) => candidate.role === role);
  return field ? value(input, field.id, field.default) : fallback;
}

function wrapText(text: string, maxCharacters: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const rawWord of words) {
    const chunks = rawWord.match(new RegExp(`.{1,${Math.max(1, maxCharacters)}}`, "g")) || [rawWord];
    for (const word of chunks) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharacters) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function canvasFor(aspectRatio: PawprintTemplate["layout"]["canvasAspectRatio"]): { width: number; height: number } {
  if (aspectRatio === "16:9") return { width: 1600, height: 900 };
  if (aspectRatio === "1:1") return { width: 1200, height: 1200 };
  return { width: 1000, height: 1250 };
}

function textSvg(input: RenderPawprintInput, options: {
  width: number;
  height: number;
  x: number;
  y: number;
  maxWidth: number;
  bottomY?: number;
  align?: "left" | "center";
  handwritten?: boolean;
}): Buffer {
  const headlineField = input.template.customizableFields.text.find((field) => field.role === "headline" || field.role === "caption");
  const bodyField = input.template.customizableFields.text.find((field) => field.role === "body");
  const eventField = input.template.customizableFields.text.find((field) => field.role === "event_details");
  const footerField = input.template.customizableFields.text.find((field) => field.role === "footer_action");
  const headline = headlineField ? value(input, headlineField.id, headlineField.default) : "";
  const body = bodyField ? value(input, bodyField.id, input.generatedText || bodyField.default) : input.generatedText;
  const event = eventField ? value(input, eventField.id, eventField.default) : "";
  const dateField = input.template.customizableFields.eventDetails.date;
  const rsvpField = input.template.customizableFields.eventDetails.rsvp;
  const date = value(input, dateField.id);
  const rsvp = value(input, rsvpField.id);
  const footer = footerField ? value(input, footerField.id, footerField.default) : "";
  const fill = color(input, "text", "#202124");
  const anchor = options.align === "center" ? "middle" : "start";
  const x = options.align === "center" ? options.x + options.maxWidth / 2 : options.x;
  const headlineFamily = options.handwritten ? "cursive" : "Georgia, serif";
  const headlineSize = options.maxWidth < 520 ? 40 : 54;
  const detailSize = options.maxWidth < 520 ? 24 : 28;
  const headlineLineHeight = Math.round(headlineSize * 1.16);
  const detailLineHeight = Math.round(detailSize * 1.35);
  const bottomY = options.bottomY ?? options.height - 32;
  const headlineLines = wrapText(headline, Math.max(8, Math.floor(options.maxWidth / (headlineSize * 0.58)))).slice(0, 2);
  const detailLines = [body, event, date, rsvp, footer]
    .filter(Boolean)
    .flatMap((line) => wrapText(line, Math.max(12, Math.floor(options.maxWidth / (detailSize * 0.56)))).slice(0, 2));
  const elements: string[] = [];
  let cursorY = options.y;

  for (const line of headlineLines) {
    if (cursorY > bottomY) break;
    elements.push(`<text x="${x}" y="${cursorY}" text-anchor="${anchor}" font-family="${headlineFamily}" font-size="${headlineSize}" font-weight="700" fill="${fill}">${escapeXml(line)}</text>`);
    cursorY += headlineLineHeight;
  }
  cursorY += 12;
  for (const line of detailLines) {
    if (cursorY > bottomY) break;
    elements.push(`<text x="${x}" y="${cursorY}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${detailSize}" fill="${fill}">${escapeXml(line)}</text>`);
    cursorY += detailLineHeight;
  }
  return Buffer.from(`
    <svg width="${options.width}" height="${options.height}" xmlns="http://www.w3.org/2000/svg">
      ${elements.join("")}
    </svg>
  `);
}

async function cover(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buffer).resize(width, height, { fit: "cover" }).png().toBuffer();
}

export async function renderPawprint(input: RenderPawprintInput): Promise<Buffer> {
  if (input.media.length === 0) throw new Error("Pawprint rendering requires media.");
  const { width, height } = canvasFor(input.template.layout.canvasAspectRatio);
  const background = color(input, "background", "#FFFFFF");
  const card = color(input, "card", "#FFFDF7");
  const accent = color(input, "accent", "#C94F3D");
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];

  if (input.template.layout.kind === "hero") {
    const mediaHeight = Math.round(height * 0.58);
    composites.push({ input: await cover(input.media[0], width, mediaHeight), left: 0, top: 0 });
    composites.push({ input: textSvg(input, { width, height, x: 72, y: mediaHeight + 100, maxWidth: width - 144, bottomY: height - 48 }), left: 0, top: 0 });
    composites.push({ input: Buffer.from(`<svg width="${width}" height="12"><rect width="${width}" height="12" fill="${accent}"/></svg>`), left: 0, top: mediaHeight });
  } else if (input.template.layout.kind === "split-screen") {
    const mediaWidth = Math.round(width * 0.5);
    composites.push({ input: await cover(input.media[0], mediaWidth, height), left: 0, top: 0 });
    composites.push({ input: Buffer.from(`<svg width="10" height="${height}"><rect width="10" height="${height}" fill="${accent}"/></svg>`), left: mediaWidth, top: 0 });
    composites.push({ input: textSvg(input, { width, height, x: mediaWidth + 60, y: Math.round(height * 0.3), maxWidth: width - mediaWidth - 120, bottomY: height - 60, align: "center" }), left: 0, top: 0 });
  } else if (input.template.layout.kind === "polaroid-floating-card") {
    const margin = Math.round(width * 0.12);
    const cardWidth = width - margin * 2;
    const cardTop = Math.round(height * 0.08);
    const cardHeight = Math.round(height * 0.76);
    const mediaSize = cardWidth - 80;
    const texture = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><filter id="n"><feTurbulence baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .05 0"/></filter><rect width="100%" height="100%" filter="url(#n)" opacity=".2"/></svg>`);
    composites.push({ input: texture, left: 0, top: 0 });
    composites.push({ input: Buffer.from(`<svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="${cardWidth - 16}" height="${cardHeight - 16}" rx="4" fill="${card}" stroke="rgba(0,0,0,.12)" stroke-width="2"/></svg>`), left: margin, top: cardTop });
    composites.push({ input: await cover(input.media[0], mediaSize, mediaSize), left: margin + 40, top: cardTop + 40 });
    composites.push({ input: Buffer.from(`<svg width="${Math.round(cardWidth * 0.28)}" height="8"><rect width="100%" height="8" fill="${accent}"/></svg>`), left: margin + Math.round(cardWidth * 0.36), top: cardTop + cardHeight - 30 });
    composites.push({ input: textSvg(input, { width, height, x: margin + 60, y: cardTop + mediaSize + 100, maxWidth: cardWidth - 120, bottomY: cardTop + cardHeight - 48, align: "center", handwritten: true }), left: 0, top: 0 });
  } else {
    const gridSize = input.media.length >= 8 ? 3 : 2;
    const gap = 12;
    const cell = Math.floor((width - gap * (gridSize - 1)) / gridSize);
    const centerIndex = gridSize === 3 ? 4 : -1;
    let mediaIndex = 0;
    for (let index = 0; index < gridSize * gridSize; index += 1) {
      const left = (index % gridSize) * (cell + gap);
      const top = Math.floor(index / gridSize) * (cell + gap);
      if (index === centerIndex) {
        composites.push({ input: Buffer.from(`<svg width="${cell}" height="${cell}"><rect width="100%" height="100%" fill="${card}"/></svg>`), left, top });
        continue;
      }
      const selected = input.media[Math.min(mediaIndex, input.media.length - 1)];
      composites.push({ input: await cover(selected, cell, cell), left, top });
      mediaIndex += 1;
    }
    const panelWidth = gridSize === 3 ? cell : Math.round(width * 0.62);
    const panelHeight = gridSize === 3 ? cell : 250;
    const panelLeft = gridSize === 3 ? cell + gap : Math.round((width - panelWidth) / 2);
    const panelTop = gridSize === 3 ? cell + gap : Math.round((height - panelHeight) / 2);
    if (gridSize === 2) {
      composites.push({ input: Buffer.from(`<svg width="${panelWidth}" height="${panelHeight}"><rect width="100%" height="100%" rx="8" fill="${card}"/></svg>`), left: panelLeft, top: panelTop });
    }
    composites.push({ input: textSvg(input, { width, height, x: panelLeft + 24, y: panelTop + 68, maxWidth: panelWidth - 48, bottomY: panelTop + panelHeight - 24, align: "center" }), left: 0, top: 0 });
  }

  return sharp({
    create: { width, height, channels: 4, background },
  }).composite(composites).png().toBuffer();
}
