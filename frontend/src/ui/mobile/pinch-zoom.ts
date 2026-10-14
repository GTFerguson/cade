/**
 * Two-finger pinch on an element, reported as a size change.
 *
 * The terminal is a canvas, so the browser's own pinch-zoom would scale
 * pixels rather than reflow columns. We intercept the gesture and turn the
 * finger spread into a font-size request instead.
 */

export interface PinchZoomOptions {
  getSize: () => number;
  onSize: (px: number) => void;
}

/** Size implied by the current finger spread relative to where it started. */
export function pinchedSize(startSize: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startSize;
  return startSize * (distance / startDistance);
}

function distanceBetween(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

export function setupPinchZoom(el: HTMLElement, opts: PinchZoomOptions): () => void {
  let startDistance = 0;
  let startSize = 0;
  let active = false;
  let pending: number | null = null;
  let lastSize = 0;

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    startDistance = distanceBetween(a, b);
    startSize = opts.getSize();
    lastSize = startSize;
    active = true;
    e.preventDefault();
  };

  const onMove = (e: TouchEvent) => {
    if (!active || e.touches.length !== 2) return;
    e.preventDefault();
    const size = pinchedSize(startSize, startDistance, distanceBetween(e.touches[0]!, e.touches[1]!));
    // One font change per frame: reflowing xterm is expensive.
    if (pending !== null) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      const rounded = Math.round(size);
      if (rounded !== lastSize) {
        lastSize = rounded;
        opts.onSize(rounded);
      }
    });
  };

  const onEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) active = false;
  };

  el.addEventListener("touchstart", onStart, { passive: false });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd);
  el.addEventListener("touchcancel", onEnd);

  return () => {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
    if (pending !== null) cancelAnimationFrame(pending);
  };
}
