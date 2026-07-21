import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drag-to-reposition for a fixed-position overlay.
 *
 * Randy sat at a hard-coded `bottom-22 right-5`, which parks him on top of
 * whatever a page happens to put in the bottom-right corner — action bars,
 * viewer controls, the FurBin grid. Rather than pick a different corner and
 * move the collision somewhere else, let the user drag him out of the way and
 * remember where they put him.
 *
 * Notes on the implementation:
 * - Pointer Events, not mouse+touch, so one code path covers mouse, touch and
 *   pen. `setPointerCapture` keeps the drag alive if the cursor outruns the
 *   element.
 * - A movement threshold distinguishes a drag from a click, so grabbing the
 *   launcher to move it doesn't also toggle the chat open.
 * - Position is stored as a top/left offset in px and clamped to the viewport
 *   on resize, so a saved position can't strand the widget off-screen after a
 *   rotation or window resize.
 */

const STORAGE_KEY = "paws_randy_position";
/** Movement in px before a pointer-down is treated as a drag, not a click. */
const DRAG_THRESHOLD = 4;
/** Keep at least this much of the widget on screen when clamping. */
const EDGE_MARGIN = 8;

export interface Position {
  x: number;
  y: number;
}

function readStored(): Position | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Position>;
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    // Private mode, quota, or corrupt JSON — fall back to the default corner.
    return null;
  }
}

function writeStored(position: Position) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Non-fatal: the widget still works, it just won't remember its spot.
  }
}

function clampToViewport(position: Position, size: { width: number; height: number }): Position {
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - size.width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - size.height - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(position.x, EDGE_MARGIN), maxX),
    y: Math.min(Math.max(position.y, EDGE_MARGIN), maxY),
  };
}

export interface UseDraggableResult {
  /** Ref for the element being positioned. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Inline style to spread onto the container. */
  style: React.CSSProperties;
  /** Spread onto whatever element should act as the drag handle. */
  handleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** True while a drag is in progress — use it to suppress click handlers. */
  isDragging: boolean;
  /** True if the user has moved the widget from its default corner. */
  hasMoved: boolean;
  /** Return the widget to its default corner. */
  reset: () => void;
  /**
   * Call from a click handler. Returns false (and swallows the click) if the
   * pointer sequence was a drag rather than a tap.
   */
  shouldAllowClick: () => boolean;
}

export function useDraggable(defaultOffset = { right: 20, bottom: 88 }): UseDraggableResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Position | null>(() => readStored());
  const [isDragging, setIsDragging] = useState(false);

  // Mutable drag bookkeeping — refs, not state, so pointermove doesn't rerender
  // once per frame just to track the grab offset.
  const dragState = useRef<{ offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const movedDuringDrag = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    const element = containerRef.current;
    if (!element) return;
    // Only primary button / single touch.
    if (event.button !== 0) return;

    const rect = element.getBoundingClientRect();
    dragState.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
    };
    movedDuringDrag.current = false;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }, []);

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const drag = dragState.current;
      const element = containerRef.current;
      if (!drag || !element) return;

      const travelled =
        Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (!movedDuringDrag.current && travelled < DRAG_THRESHOLD) return;

      if (!movedDuringDrag.current) {
        movedDuringDrag.current = true;
        setIsDragging(true);
      }

      // Stop the page scrolling under a touch-drag.
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      setPosition(
        clampToViewport(
          { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
          { width: rect.width, height: rect.height }
        )
      );
    }

    function handleUp() {
      if (!dragState.current) return;
      dragState.current = null;
      if (movedDuringDrag.current) {
        setIsDragging(false);
        setPosition((current) => {
          if (current) writeStored(current);
          return current;
        });
      }
    }

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, []);

  // A saved position from a larger window (or a different orientation) can put
  // the widget off-screen. Re-clamp whenever the viewport changes.
  useEffect(() => {
    if (!position) return;
    function handleResize() {
      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setPosition((current) =>
        current ? clampToViewport(current, { width: rect.width, height: rect.height }) : current
      );
    }
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [position]);

  const reset = useCallback(() => {
    setPosition(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* non-fatal */
    }
  }, []);

  const shouldAllowClick = useCallback(() => {
    if (movedDuringDrag.current) {
      movedDuringDrag.current = false;
      return false;
    }
    return true;
  }, []);

  const style: React.CSSProperties = position
    ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
    : { right: defaultOffset.right, bottom: defaultOffset.bottom };

  return {
    containerRef,
    style,
    handleProps: {
      onPointerDown,
      // touch-action:none is what stops the browser claiming the gesture for
      // scrolling before our pointermove handler ever fires.
      style: { touchAction: "none", cursor: isDragging ? "grabbing" : "grab" },
    },
    isDragging,
    hasMoved: position !== null,
    reset,
    shouldAllowClick,
  };
}
