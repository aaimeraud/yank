// Where the mini player sits, and how a drag ends. Pure, so the geometry is
// tested without a browser; components/player/useMiniDrag.ts does the moving.

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const CORNERS: readonly Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Pointer travel, in pixels, before a press counts as a drag and not a click. */
export const DRAG_THRESHOLD = 5;

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

/** The corner of the viewport closest to where the player was dropped. */
export function nearestCorner(centerX: number, centerY: number, width: number, height: number): Corner {
  const vertical = centerY < height / 2 ? "top" : "bottom";
  const horizontal = centerX < width / 2 ? "left" : "right";
  return `${vertical}-${horizontal}`;
}

/** A stored preference that no longer names a corner falls back to the default. */
export function validCorner(value: unknown): Corner {
  return CORNERS.includes(value as Corner) ? (value as Corner) : "bottom-right";
}
