/**
 * Terminal font size: one setting shared by every terminal on this device.
 *
 * Kept per device (localStorage) rather than per session because it is a
 * property of the screen you are reading on, not of the shell. Pinch and
 * the A-/A+ keys on the phone, and the viewer, all read and write it here.
 */

const STORAGE_KEY = "cade.terminal.fontSize";

export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 7;
export const MAX_FONT_SIZE = 28;
export const FONT_SIZE_STEP = 1;

/** Approximate glyph advance as a fraction of font size for JetBrains Mono. */
export const MONO_CHAR_WIDTH_RATIO = 0.6;

type Listener = (px: number) => void;
const listeners = new Set<Listener>();
let current: number | null = null;

export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)));
}

export function getTerminalFontSize(): number {
  if (current !== null) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode, sandboxed preview): fall back.
  }
  current = stored !== null ? clampFontSize(Number(stored)) : DEFAULT_FONT_SIZE;
  return current;
}

export function setTerminalFontSize(px: number): number {
  const next = clampFontSize(px);
  if (next === current) return next;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Not persisted; still applied for this page.
  }
  for (const cb of listeners) cb(next);
  return next;
}

export function stepTerminalFontSize(direction: 1 | -1): number {
  return setTerminalFontSize(getTerminalFontSize() + direction * FONT_SIZE_STEP);
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onTerminalFontSizeChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Largest font size at which `cols` columns fit in `widthPx`, capped at
 * `maxPx`. Used when mirroring another device's wider PTY so the whole
 * line is visible instead of clipped.
 */
export function fontSizeForCols(cols: number, widthPx: number, maxPx: number): number {
  if (cols <= 0 || widthPx <= 0) return maxPx;
  const fit = Math.floor(widthPx / (cols * MONO_CHAR_WIDTH_RATIO));
  return Math.max(MIN_FONT_SIZE, Math.min(maxPx, fit));
}

/** Test hook: forget the cached value so the next read hits storage. */
export function resetTerminalFontSizeCache(): void {
  current = null;
}
