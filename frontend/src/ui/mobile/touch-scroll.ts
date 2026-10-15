/**
 * Single-finger drag scrolling for the terminal on touch screens.
 *
 * xterm's own scrollback only moves on wheel events, and when the phone
 * mirrors a taller PTY the pane itself scrolls as well. One gesture has to
 * cover both: spend the drag on the pane until it hits its edge, then on
 * the terminal's scrollback.
 */

export interface ScrollPlan {
  /** Pixels to move the pane (positive = content moves up, i.e. scrollTop grows). */
  pane: number;
  /** Lines to scroll the terminal buffer (positive = towards newer output). */
  lines: number;
}

/**
 * Split a finger movement between the pane and the buffer.
 *
 * `dy` is the finger's travel since the last event (positive = finger
 * moved down, which means the content should move down: scroll towards
 * older output). `scrollTop`/`maxScroll` describe the pane; `cellHeight`
 * converts leftover pixels to buffer lines.
 */
export function planTouchScroll(
  dy: number,
  scrollTop: number,
  maxScroll: number,
  cellHeight: number,
): ScrollPlan {
  if (dy === 0 || cellHeight <= 0) return { pane: 0, lines: 0 };
  // Finger down → content down → pane scrolls up (towards its top).
  const wantPane = -dy;
  const room = wantPane < 0 ? -scrollTop : Math.max(0, maxScroll - scrollTop);
  const pane = wantPane < 0 ? Math.max(wantPane, room) : Math.min(wantPane, room);
  const leftover = wantPane - pane;
  // Leftover pixels go to the buffer. Content moving down = older lines.
  const lines = Math.trunc(leftover / cellHeight);
  return { pane: pane || 0, lines: lines || 0 };
}

export interface TouchScrollTarget {
  container: HTMLElement;
  /** Pixel height of one terminal row. */
  cellHeight: () => number;
  scrollLines: (n: number) => void;
}

export function setupTouchScroll(target: TouchScrollTarget): () => void {
  let lastY: number | null = null;
  let carry = 0; // sub-line remainder so slow drags still accumulate

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      lastY = null;
      return;
    }
    lastY = e.touches[0]!.clientY;
    carry = 0;
  };

  const onMove = (e: TouchEvent) => {
    if (e.touches.length !== 1 || lastY === null) return;
    const y = e.touches[0]!.clientY;
    const dy = y - lastY;
    lastY = y;
    const el = target.container;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const plan = planTouchScroll(dy + carry, el.scrollTop, maxScroll, target.cellHeight());
    carry = 0;
    if (plan.pane !== 0) el.scrollTop += plan.pane;
    if (plan.lines !== 0) {
      target.scrollLines(-plan.lines);
    } else if (plan.pane === 0) {
      carry = dy; // not enough for a line yet; keep it for the next move
    }
    // We moved things ourselves; the browser must not also scroll the page.
    e.preventDefault();
  };

  const onEnd = () => {
    lastY = null;
  };

  target.container.addEventListener("touchstart", onStart, { passive: true });
  target.container.addEventListener("touchmove", onMove, { passive: false });
  target.container.addEventListener("touchend", onEnd);
  target.container.addEventListener("touchcancel", onEnd);
  return () => {
    target.container.removeEventListener("touchstart", onStart);
    target.container.removeEventListener("touchmove", onMove);
    target.container.removeEventListener("touchend", onEnd);
    target.container.removeEventListener("touchcancel", onEnd);
  };
}
