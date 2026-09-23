/**
 * App zoom (Ctrl+= / Ctrl+- / Ctrl+0) is handled by Tauri's zoom-hotkey
 * script, which listens for keydown on `window` in the bubble phase. xterm
 * cancels and stops propagation of every key it translates, so without an
 * explicit pass-through the zoom keys would never leave a focused terminal.
 * Returning `false` from xterm's custom key handler for these keys leaves the
 * event untouched so it bubbles up to the zoom listener.
 */
export function isZoomHotkey(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  return e.key === "-" || e.key === "=" || e.key === "+" || e.key === "0";
}
