/**
 * Two-finger pinch on an element, reported as a size change.
 *
 * The terminal is a canvas, so the browser's own pinch-zoom would scale
 * pixels rather than reflow columns. We intercept the gesture and turn the
 * finger spread into a font-size request. Reflowing xterm is expensive, so
 * during the gesture only a cheap preview (a CSS scale) is shown and the
 * font size is applied once when the fingers lift.
 */

export interface PinchZoomOptions {
  getSize: () => number;
  /** Called while the fingers move, with the scale relative to the start. */
  onPreview?: (scale: number) => void;
  /** Called once per gesture with the final size. */
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
  let lastScale = 1;

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    startDistance = distanceBetween(a, b);
    startSize = opts.getSize();
    lastScale = 1;
    active = true;
    e.preventDefault();
  };

  const onMove = (e: TouchEvent) => {
    if (!active || e.touches.length !== 2) return;
    e.preventDefault();
    const scale = distanceBetween(e.touches[0]!, e.touches[1]!) / Math.max(1, startDistance);
    lastScale = scale;
    if (pending !== null) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      opts.onPreview?.(lastScale);
    });
  };

  const onEnd = (e: TouchEvent) => {
    if (!active || e.touches.length >= 2) return;
    active = false;
    if (pending !== null) {
      cancelAnimationFrame(pending);
      pending = null;
    }
    opts.onPreview?.(1);
    const size = Math.round(pinchedSize(startSize, 1, lastScale));
    if (size !== startSize) opts.onSize(size);
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
