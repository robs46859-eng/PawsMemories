import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";

/**
 * UV8 acceptance gate — likeness scoring by palette distance.
 *
 * UV_TEXTURE_GENERATION_PLAN.md UV8 defines done as:
 *
 *   "a fixture avatar re-baked from its own reference views scores higher
 *    likeness (palette distance to reference) than its original Tripo texture."
 *
 * The bake pipeline shipped without any way to evaluate that sentence. The
 * worker reports coverage, views used, and materials retargeted — all of which
 * describe whether the bake RAN, none of which describe whether it HELPED. A
 * re-bake that faithfully projects the wrong colours scores identically to one
 * that fixes them. This module supplies the missing measurement.
 *
 * METHOD
 * ------
 * 1. Pull the base-color texture out of a GLB (the atlas the bake writes to).
 * 2. Quantize both that atlas and the user's reference photos to a small
 *    dominant palette, weighted by pixel population.
 * 3. Score distance between the two palettes in CIELAB using CIEDE2000.
 *
 * WHY CIEDE2000 AND NOT RGB DISTANCE
 * ----------------------------------
 * Euclidean RGB distance does not track human perception: it overstates
 * differences in green and understates them in blue, and it makes two dark
 * browns look further apart than two mid greys that are obviously different.
 * Pet coats live in exactly that dark-brown/tan/grey region, so an RGB metric
 * would report large distances for pairs a customer would call identical, and
 * the gate would be noise. CIEDE2000 is the current CIE recommendation and
 * includes the lightness, chroma, and hue weighting plus the blue-region hue
 * rotation term that make it behave sensibly there.
 *
 * WHY PALETTE DISTANCE AND NOT PER-PIXEL DIFF
 * -------------------------------------------
 * The atlas is a UV layout; the reference is a photograph. They share no
 * spatial correspondence whatsoever — pixel (x,y) in one has no relationship to
 * pixel (x,y) in the other. Only the colour DISTRIBUTION is comparable. This is
 * also why the score is a similarity heuristic and not a proof: it can tell you
 * the coat went from grey to brown, it cannot tell you the markings landed in
 * the right places. Seam and drift checks in the worker cover placement.
 */

/** A dominant colour with the share of sampled pixels it represents. */
export interface PaletteEntry {
  lab: [number, number, number];
  rgb: [number, number, number];
  /** Fraction of counted pixels, 0..1. Entries sum to ~1. */
  weight: number;
}

export interface LikenessScore {
  /** Weighted mean CIEDE2000 across the reference palette. Lower is closer. */
  distance: number;
  /** Palette entries actually compared, for debugging a surprising score. */
  modelColors: number;
  referenceColors: number;
}

export interface RebakeLikenessReport {
  before: number | null;
  after: number | null;
  /** before - after. Positive means the re-bake moved closer to the reference. */
  delta: number | null;
  improved: boolean | null;
  /** Populated instead of the numbers when scoring could not run. */
  note?: string;
}

/* ───────────────────────────── colour space ──────────────────────────── */

/** sRGB (0..255) → linear. */
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB → CIELAB under D65, the white point sRGB is defined against. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  // sRGB → XYZ (D65)
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.0;
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;

  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * CIEDE2000 colour difference.
 *
 * Implemented from Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference
 * Formula: Implementation Notes, Supplementary Test Data, and Mathematical
 * Observations". The hue-difference branches below are the ones every naive
 * implementation gets wrong — they are not simplifiable, and the test file
 * checks this function against that paper's published pair table.
 */
export function ciede2000(
  lab1: [number, number, number],
  lab2: [number, number, number],
): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const kL = 1, kC = 1, kH = 1;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  // Hue angles. atan2(0,0) is defined as 0 here per the paper.
  const h1p = C1p === 0 ? 0 : ((deg(Math.atan2(b1, a1p)) % 360) + 360) % 360;
  const h2p = C2p === 0 ? 0 : ((deg(Math.atan2(b2, a2p)) % 360) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.20 * Math.cos(rad(4 * hbarp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const RT = -RC * Math.sin(2 * rad(dTheta));

  const Lbarp50 = Math.pow(Lbarp - 50, 2);
  const SL = 1 + (0.015 * Lbarp50) / Math.sqrt(20 + Lbarp50);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  const termL = dLp / (kL * SL);
  const termC = dCp / (kC * SC);
  const termH = dHp / (kH * SH);

  return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH);
}

/* ─────────────────────────── palette extraction ──────────────────────── */

/** Colours this dark or this desaturated-white are treated as background. */
const MIN_LUMA = 12;
const MAX_LUMA = 247;
const MIN_ALPHA = 200;

/**
 * Quantize an image to `k` dominant colours.
 *
 * Uses a coarse RGB histogram (5 bits/channel) followed by weighted k-means in
 * Lab. The histogram keeps this O(pixels) with a tiny constant; k-means then
 * runs over at most 32768 bins rather than millions of pixels, so cost is
 * independent of input resolution.
 *
 * Near-black, near-white, and transparent pixels are dropped. Atlases are
 * mostly empty space padded with black or transparency, and photographs carry
 * blown highlights — counting either would make every palette converge on
 * "mostly background" and flatten the score.
 */
export async function extractPalette(image: Buffer, k = 6): Promise<PaletteEntry[]> {
  const { data, info } = await sharp(image)
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const a = channels >= 4 ? data[i + 3] : 255;
    if (a < MIN_ALPHA) continue;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < MIN_LUMA || luma > MAX_LUMA) continue;

    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key);
    if (bin) {
      bin.r += r; bin.g += g; bin.b += b; bin.n++;
    } else {
      bins.set(key, { r, g, b, n: 1 });
    }
  }

  if (bins.size === 0) return [];

  const points = [...bins.values()].map((v) => ({
    lab: rgbToLab(v.r / v.n, v.g / v.n, v.b / v.n),
    rgb: [v.r / v.n, v.g / v.n, v.b / v.n] as [number, number, number],
    w: v.n,
  }));

  const clusters = Math.min(k, points.length);

  // Seed deterministically: the most populous bins, spread apart in Lab so two
  // seeds don't start inside the same coat colour. A random seed would make the
  // score non-reproducible across runs, which is useless for a regression gate.
  const byWeight = [...points].sort((a, b) => b.w - a.w);
  const seeds: [number, number, number][] = [];
  for (const p of byWeight) {
    if (seeds.length >= clusters) break;
    if (seeds.every((s) => ciede2000(s, p.lab) > 8)) seeds.push(p.lab);
  }
  while (seeds.length < clusters) seeds.push(byWeight[seeds.length].lab);

  let centroids = seeds;
  for (let iter = 0; iter < 12; iter++) {
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, w: 0 }));
    for (const p of points) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = ciede2000(centroids[c], p.lab);
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best].l += p.lab[0] * p.w;
      sums[best].a += p.lab[1] * p.w;
      sums[best].b += p.lab[2] * p.w;
      sums[best].w += p.w;
    }
    const next = centroids.map((c, i) =>
      sums[i].w > 0
        ? ([sums[i].l / sums[i].w, sums[i].a / sums[i].w, sums[i].b / sums[i].w] as [number, number, number])
        : c,
    );
    const shift = next.reduce((m, c, i) => Math.max(m, ciede2000(c, centroids[i])), 0);
    centroids = next;
    if (shift < 0.25) break; // converged
  }

  // Final assignment for weights and representative RGB.
  const acc = centroids.map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (const p of points) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const d = ciede2000(centroids[c], p.lab);
      if (d < bestD) { bestD = d; best = c; }
    }
    acc[best].w += p.w;
    acc[best].r += p.rgb[0] * p.w;
    acc[best].g += p.rgb[1] * p.w;
    acc[best].b += p.rgb[2] * p.w;
  }

  const total = acc.reduce((s, a) => s + a.w, 0) || 1;
  return centroids
    .map((lab, i) => ({
      lab,
      rgb: [acc[i].r / (acc[i].w || 1), acc[i].g / (acc[i].w || 1), acc[i].b / (acc[i].w || 1)] as [number, number, number],
      weight: acc[i].w / total,
    }))
    .filter((e) => e.weight > 0.01)
    .sort((a, b) => b.weight - a.weight);
}

/* ──────────────────────────── GLB atlas access ───────────────────────── */

/**
 * Pull the largest base-color texture out of a GLB.
 *
 * "Largest" rather than "first" because a pet GLB often carries small extra
 * maps (an eye texture, a wardrobe attachment); the coat atlas is reliably the
 * biggest image in the file. Returns null rather than throwing when a model has
 * no textures at all, which is a legitimate state for an untextured mesh.
 */
export async function extractBaseColorTexture(glb: Buffer): Promise<Buffer | null> {
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(glb));

  let best: Uint8Array | null = null;
  for (const material of doc.getRoot().listMaterials()) {
    const tex = material.getBaseColorTexture();
    const img = tex?.getImage();
    if (img && (!best || img.byteLength > best.byteLength)) best = img;
  }

  // Fall back to any image in the file — some exporters attach the atlas
  // through an extension slot the material API doesn't surface.
  if (!best) {
    for (const texture of doc.getRoot().listTextures()) {
      const img = texture.getImage();
      if (img && (!best || img.byteLength > best.byteLength)) best = img;
    }
  }

  return best ? Buffer.from(best) : null;
}

/* ─────────────────────────────── scoring ─────────────────────────────── */

/**
 * Distance from a model palette to a reference palette.
 *
 * For each reference colour we take its nearest model colour and weight that
 * distance by how much of the reference the colour represents. Asymmetric on
 * purpose: the question is "does the model contain the pet's colours", not
 * "does the model contain ONLY the pet's colours". A model carrying an extra
 * colour the photo lacks (a background tint baked into an occluded region) is a
 * much smaller failure than a model missing the coat colour entirely, and a
 * symmetric metric would score those the same.
 */
export function palettesDistance(model: PaletteEntry[], reference: PaletteEntry[]): number | null {
  if (!model.length || !reference.length) return null;
  let acc = 0;
  let wsum = 0;
  for (const ref of reference) {
    let nearest = Infinity;
    for (const m of model) {
      const d = ciede2000(ref.lab, m.lab);
      if (d < nearest) nearest = d;
    }
    acc += nearest * ref.weight;
    wsum += ref.weight;
  }
  return wsum > 0 ? acc / wsum : null;
}

/** Merge several reference photos into one palette, averaging their weights. */
export async function referencePalette(images: Buffer[], k = 6): Promise<PaletteEntry[]> {
  const all: PaletteEntry[] = [];
  for (const img of images) {
    const p = await extractPalette(img, k).catch(() => [] as PaletteEntry[]);
    for (const e of p) all.push({ ...e, weight: e.weight / images.length });
  }
  return all.sort((a, b) => b.weight - a.weight);
}

export async function scoreModelAgainstReference(
  glb: Buffer,
  referenceImages: Buffer[],
): Promise<LikenessScore | null> {
  const atlas = await extractBaseColorTexture(glb);
  if (!atlas) return null;
  const [modelPalette, refPalette] = await Promise.all([
    extractPalette(atlas),
    referencePalette(referenceImages),
  ]);
  const distance = palettesDistance(modelPalette, refPalette);
  if (distance === null) return null;
  return {
    distance,
    modelColors: modelPalette.length,
    referenceColors: refPalette.length,
  };
}

/**
 * The UV8 gate itself: did the re-bake move the model closer to the reference?
 *
 * Never throws. A likeness score is diagnostic metadata attached to a bake that
 * has already succeeded and already been uploaded — failing the job because a
 * PNG decode choked would destroy a good result to protect a metric. Errors
 * surface as a `note` and null numbers.
 */
export async function scoreRebake(
  originalGlb: Buffer,
  rebakedGlb: Buffer,
  referenceImages: Buffer[],
): Promise<RebakeLikenessReport> {
  try {
    if (!referenceImages.length) {
      return { before: null, after: null, delta: null, improved: null, note: "no reference views" };
    }
    const refPalette = await referencePalette(referenceImages);
    if (!refPalette.length) {
      return { before: null, after: null, delta: null, improved: null, note: "reference views yielded no palette" };
    }

    const [origAtlas, bakedAtlas] = await Promise.all([
      extractBaseColorTexture(originalGlb),
      extractBaseColorTexture(rebakedGlb),
    ]);
    if (!origAtlas || !bakedAtlas) {
      return { before: null, after: null, delta: null, improved: null, note: "model has no base-color texture" };
    }

    const [origPalette, bakedPalette] = await Promise.all([
      extractPalette(origAtlas),
      extractPalette(bakedAtlas),
    ]);

    const before = palettesDistance(origPalette, refPalette);
    const after = palettesDistance(bakedPalette, refPalette);
    if (before === null || after === null) {
      return { before, after, delta: null, improved: null, note: "palette extraction empty" };
    }

    const delta = before - after;
    return {
      before: Number(before.toFixed(3)),
      after: Number(after.toFixed(3)),
      delta: Number(delta.toFixed(3)),
      improved: delta > 0,
    };
  } catch (err: any) {
    return {
      before: null, after: null, delta: null, improved: null,
      note: `scoring failed: ${String(err?.message || err).slice(0, 160)}`,
    };
  }
}
