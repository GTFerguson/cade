/**
 * Window-level behaviour the desktop shell normally provides for free.
 *
 * Tauri wires app zoom (Ctrl+= / Ctrl+- / Ctrl+0) and window dragging from
 * `data-tauri-drag-region` elements through listeners it adds to the page
 * before any of our code runs. The desktop loader then replaces the document
 * with the interface served by the backend (see shell/loader.ts), and
 * replacing a document discards every listener on it and on its window. The
 * interface loaded that way has to put them back itself.
 *
 * The embedded page is not replaced, so the shell's own listeners survive
 * there; installing a second set would act twice on every key press.
 */

import { isZoomHotkey } from "../terminal/zoom-keys";

const ZOOM_STORAGE_KEY = "cade.app.zoom";

export const ZOOM_STEP = 0.2;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 1;

const DRAG_REGION_ATTRIBUTE = "data-tauri-drag-region";

export function nextZoom(current: number, key: string): number {
  if (key === "0") return DEFAULT_ZOOM;
  const stepped = current + (key === "-" ? -ZOOM_STEP : ZOOM_STEP);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stepped));
}

function readSavedZoom(): number {
  try {
    const saved = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_ZOOM && saved <= MAX_ZOOM) return saved;
  } catch {
    // Storage unavailable: start from the default.
  }
  return DEFAULT_ZOOM;
}

let zoomQueue: Promise<unknown> = Promise.resolve();

function applyZoom(factor: number): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(factor));
  } catch {
    // Not persisted; still applied to this window.
  }
  // Queued behind the previous change so held keys land in the order pressed.
  zoomQueue = zoomQueue
    .then(() => import("@tauri-apps/api/webview"))
    .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(factor))
    .catch((e) => console.error("[shell-listeners] Failed to set zoom:", e));
}

function onMouseDown(e: MouseEvent): void {
  // Only the region itself drags: buttons and tabs inside it keep their clicks.
  const target = e.target;
  if (e.button !== 0 || !(target instanceof Element)) return;
  if (!target.hasAttribute(DRAG_REGION_ATTRIBUTE)) return;
  e.preventDefault();
  const maximise = e.detail === 2;
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      return maximise ? appWindow.toggleMaximize() : appWindow.startDragging();
    })
    .catch((err) => console.error("[shell-listeners] Failed to move window:", err));
}

let dispose: (() => void) | null = null;

export function installShellListeners(): void {
  if (dispose) return;
  const w = window as any;
  if (w.__TAURI__ !== true || w.__LIVE_FRONTEND__ !== true) return;

  let zoom = readSavedZoom();
  // Carry the chosen level over a page load, such as the one after an upgrade.
  if (zoom !== DEFAULT_ZOOM) applyZoom(zoom);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!isZoomHotkey(e)) return;
    e.preventDefault();
    zoom = nextZoom(zoom, e.key);
    applyZoom(zoom);
  };

  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("mousedown", onMouseDown);
  dispose = () => {
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("mousedown", onMouseDown);
  };
}

/** Test hook: remove the listeners so each test installs its own. */
export function resetShellListenersForTest(): void {
  dispose?.();
  dispose = null;
}
