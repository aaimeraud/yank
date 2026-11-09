import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { isDrag, nearestCorner, type Corner } from "../../lib/miniCorner";

/** Presses on these keep their own meaning instead of moving the player. */
const NOT_A_HANDLE = "button, a, input, select, .queue-panel";

/** Matches the feel of the app's other quick transitions. */
const SNAP = "translate 240ms cubic-bezier(0.2, 0.9, 0.3, 1)";

/**
 * Drag the mini player anywhere and let it snap to the nearest corner.
 *
 * Uses the `translate` property, not `transform`: the entrance animation
 * holds `transform` for good (fill mode both), and an animation beats any
 * inline style. A drag that ends swallows the click that follows it, or
 * releasing over the picture would open the full player.
 */
export function useMiniDrag(
  shellRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onCorner: (corner: Corner) => void,
) {
  const report = useRef(onCorner);
  report.current = onCorner;

  useEffect(() => {
    const shell = shellRef.current;
    if (!enabled || !shell) return;

    let start: { x: number; y: number; id: number } | null = null;
    let dragging = false;
    // Esc let go of the player, but the button is still down.
    let cancelled = false;

    const onGlideEnd = (event: TransitionEvent) => {
      // Buttons inside the player have transitions of their own.
      if (event.target === shell && event.propertyName === "translate") clear();
    };

    const clear = () => {
      shell.removeEventListener("transitionend", onGlideEnd);
      shell.style.translate = "";
      shell.style.transition = "";
      shell.classList.remove("dragging");
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      start = null;
      dragging = false;
      cancelled = false;
    };

    const onMove = (event: PointerEvent) => {
      if (!start || cancelled || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragging) {
        if (!isDrag(dx, dy)) return;
        dragging = true;
        shell.removeEventListener("transitionend", onGlideEnd);
        shell.classList.add("dragging");
        shell.style.transition = "none";
      }
      shell.style.translate = `${dx}px ${dy}px`;
    };

    const swallowNextClick = () => {
      const swallow = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };
      shell.addEventListener("click", swallow, { capture: true, once: true });
      // No click follows a release outside the element.
      window.setTimeout(() => shell.removeEventListener("click", swallow, { capture: true }), 50);
    };

    const snapBack = () => {
      if (!dragging) return;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        clear();
        return;
      }
      shell.style.transition = SNAP;
      shell.style.translate = "0px 0px";
      shell.classList.remove("dragging");
      shell.addEventListener("transitionend", onGlideEnd);
    };

    const onUp = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      if (cancelled) {
        swallowNextClick();
        stop();
        return;
      }
      if (!dragging) {
        stop();
        return;
      }
      const before = shell.getBoundingClientRect();
      const corner = nearestCorner(before.left + before.width / 2, before.top + before.height / 2, window.innerWidth, window.innerHeight);
      swallowNextClick();
      shell.style.translate = "";
      // Commit the corner now to measure where it lands, then start from
      // where the pointer left it and glide there.
      flushSync(() => report.current(corner));
      const after = shell.getBoundingClientRect();
      shell.style.transition = "none";
      shell.style.translate = `${before.left - after.left}px ${before.top - after.top}px`;
      void shell.offsetWidth;
      snapBack();
      stop();
    };

    const onCancel = () => {
      snapBack();
      stop();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragging) return;
      snapBack();
      dragging = false;
      cancelled = true;
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element | null)?.closest(NOT_A_HANDLE)) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    };

    shell.addEventListener("pointerdown", onDown);
    return () => {
      shell.removeEventListener("pointerdown", onDown);
      stop();
      clear();
    };
  }, [enabled, shellRef]);
}
