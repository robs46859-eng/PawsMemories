export type PawprintLayoutId =
  | "classic"
  | "overlay"
  | "split"
  | "frame"
  | "story"
  | "filmstrip"
  | "circles"
  | "mosaic"
  | "polaroid"
  | "triptych"
  | "magazine"
  | "panorama";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: "rect" | "circle" | "arch";
}

export interface PawprintCollagePlan {
  photos: NormalizedRect[];
  text: NormalizedRect;
  textOverlay: boolean;
  insetFrame: boolean;
}

export const MAX_PAWPRINT_PHOTOS = 12;
const clampCount = (count: number) => Math.max(1, Math.min(MAX_PAWPRINT_PHOTOS, Math.floor(count) || 1));

function gridRects(count: number, area: NormalizedRect, gap: number): NormalizedRect[] {
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count * (area.width / area.height)))));
  const rows = Math.ceil(count / columns);
  const cellWidth = (area.width - gap * (columns - 1)) / columns;
  const cellHeight = (area.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const isLastIncompleteRow = row === rows - 1 && count % columns !== 0;
    const itemsInRow = isLastIncompleteRow ? count % columns : columns;
    const rowWidth = itemsInRow * cellWidth + (itemsInRow - 1) * gap;
    const rowStart = area.x + (area.width - rowWidth) / 2;
    return {
      x: rowStart + column * (cellWidth + gap),
      y: area.y + row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight,
    };
  });
}

/**
 * Pure, deterministic layout planning for Pawprints. Coordinates are normalized
 * to 0..1 so the same plan drives CSS previews and high-resolution canvas export.
 */
export function planPawprintCollage(layout: PawprintLayoutId, photoCount: number): PawprintCollagePlan {
  const count = clampCount(photoCount);
  if (layout === "classic") {
    const photoArea = { x: 0, y: 0, width: 1, height: 0.62 };
    if (count === 1) return { photos: [photoArea], text: { x: 0.075, y: 0.68, width: 0.85, height: 0.25 }, textOverlay: false, insetFrame: false };
    return {
      photos: [
        { x: 0, y: 0, width: 0.68, height: 0.62 },
        ...gridRects(count - 1, { x: 0.69, y: 0, width: 0.31, height: 0.62 }, 0.008),
      ],
      text: { x: 0.075, y: 0.68, width: 0.85, height: 0.25 },
      textOverlay: false,
      insetFrame: false,
    };
  }
  if (layout === "overlay") {
    return {
      photos: gridRects(count, { x: 0, y: 0, width: 1, height: 1 }, 0.006),
      text: { x: 0.075, y: 0.72, width: 0.85, height: 0.22 },
      textOverlay: true,
      insetFrame: false,
    };
  }
  if (layout === "split") {
    return {
      photos: count === 1
        ? [{ x: 0, y: 0, width: 0.58, height: 1 }]
        : [{ x: 0, y: 0, width: 0.58, height: 1 }, ...gridRects(count - 1, { x: 0.59, y: 0, width: 0.41, height: 0.42 }, 0.008)],
      text: { x: 0.64, y: 0.48, width: 0.31, height: 0.42 },
      textOverlay: false,
      insetFrame: false,
    };
  }
  if (layout === "frame") return {
    photos: gridRects(count, { x: 0.09, y: 0.08, width: 0.82, height: 0.66 }, 0.012),
    text: { x: 0.11, y: 0.79, width: 0.78, height: 0.14 },
    textOverlay: false,
    insetFrame: true,
  };
  if (layout === "story") {
    return {
      photos: count === 1
        ? [{ x: 0, y: 0, width: 1, height: 1 }]
        : [{ x: 0, y: 0, width: 1, height: 0.58 }, ...gridRects(count - 1, { x: 0.04, y: 0.59, width: 0.92, height: 0.24 }, 0.01)],
      text: { x: 0.07, y: 0.78, width: 0.86, height: 0.17 },
      textOverlay: true,
      insetFrame: false,
    };
  }
  if (layout === "filmstrip") {
    return {
      photos: gridRects(count, { x: 0.06, y: 0.2, width: 0.88, height: 0.72 }, 0.018),
      text: { x: 0.08, y: 0.055, width: 0.84, height: 0.12 },
      textOverlay: false,
      insetFrame: true,
    };
  }
  if (layout === "circles") {
    return {
      photos: gridRects(count, { x: 0.08, y: 0.06, width: 0.84, height: 0.69 }, 0.025).map((rect) => ({ ...rect, shape: "circle" as const })),
      text: { x: 0.1, y: 0.8, width: 0.8, height: 0.14 },
      textOverlay: false,
      insetFrame: false,
    };
  }
  if (layout === "mosaic") return {
    photos: count === 1
      ? [{ x: 0.04, y: 0.04, width: 0.92, height: 0.92, shape: "arch" }]
      : [{ x: 0.03, y: 0.03, width: 0.62, height: 0.94, shape: "arch" }, ...gridRects(count - 1, { x: 0.67, y: 0.03, width: 0.3, height: 0.72 }, 0.012)],
    text: { x: 0.67, y: 0.78, width: 0.3, height: 0.17 },
    textOverlay: false,
    insetFrame: false,
  };
  if (layout === "polaroid") return {
    photos: gridRects(count, { x: 0.08, y: 0.08, width: 0.84, height: 0.68 }, 0.035),
    text: { x: 0.1, y: 0.81, width: 0.8, height: 0.13 },
    textOverlay: false,
    insetFrame: false,
  };
  if (layout === "triptych") return {
    photos: count === 1
      ? [{ x: 0.08, y: 0.06, width: 0.84, height: 0.72 }]
      : gridRects(count, { x: 0.04, y: 0.06, width: 0.92, height: 0.72 }, 0.018),
    text: { x: 0.08, y: 0.82, width: 0.84, height: 0.12 },
    textOverlay: false,
    insetFrame: true,
  };
  if (layout === "magazine") return {
    photos: count === 1
      ? [{ x: 0, y: 0, width: 1, height: 1 }]
      : [{ x: 0, y: 0, width: 1, height: 0.7 }, ...gridRects(count - 1, { x: 0.56, y: 0.05, width: 0.39, height: 0.32 }, 0.012)],
    text: { x: 0.07, y: 0.66, width: 0.86, height: 0.27 },
    textOverlay: true,
    insetFrame: false,
  };
  return {
    photos: count === 1
      ? [{ x: 0, y: 0.1, width: 1, height: 0.62 }]
      : gridRects(count, { x: 0, y: 0.1, width: 1, height: 0.62 }, 0.008),
    text: { x: 0.08, y: 0.77, width: 0.84, height: 0.15 },
    textOverlay: false,
    insetFrame: false,
  };
}
