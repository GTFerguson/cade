/**
 * App zoom for a desktop window whose interface was loaded from the backend.
 *
 * Tauri wires Ctrl+= / Ctrl+- / Ctrl+0 through a listener it adds to the page
 * before any of our code runs. The desktop loader then replaces the document
 * with the interface served by the backend (see shell/loader.ts), after which
 * those keys no longer zoom. The interface loaded that way handles them itself.
 *
 * The embedded page is not replaced and keeps the shell's listener; a second
 * one would zoom two steps per key press.
 */

import { isZoomHotkey } from "../terminal/zoom-keys";

const ZOOM_STORAGE_KEY = "cade.app.zoom";

export const ZOOM_STEP = 0.2;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 1;

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

type Report = (detail: string) => void;

let zoomQueue: Promise<unknown> = Promise.resolve();

function applyZoom(factor: number, report: Report): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(factor));
  } catch {
    // Not persisted; still applied to this window.
  }
  // Queued behind the previous change so held keys land in the order pressed.
  zoomQueue = zoomQueue
    .then(() => import("@tauri-apps/api/webview"))
    .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(factor))
    .catch((e) => {
      console.error("[shell-listeners] Failed to set zoom:", e);
      report(`zoom to ${factor} failed: ${e instanceof Error ? e.message : String(e)}`);
    });
}

let dispose: (() => void) | null = null;

/**
 * `report` receives zoom requests that did not take effect. The desktop
 * window has no console to read, so the caller sends it to the backend log.
 */
export function installShellListeners(report: Report = () => {}): void {
  if (dispose) return;
  const w = window as any;
  if (w.__TAURI__ !== true) return;

  let zoom = readSavedZoom();
  const live = (): boolean => w.__LIVE_FRONTEND__ === true;
  // Carry the chosen level over a page load, such as the one after an upgrade.
  if (live() && zoom !== DEFAULT_ZOOM) applyZoom(zoom, report);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!isZoomHotkey(e)) return;
    if (!live()) return;
    e.preventDefault();
    zoom = nextZoom(zoom, e.key);
    applyZoom(zoom, report);
  };

  window.addEventListener("keydown", onKeyDown);
  dispose = () => {
    window.removeEventListener("keydown", onKeyDown);
  };
}

/** Test hook: remove the listeners so each test installs its own. */
export function resetShellListenersForTest(): void {
  dispose?.();
  dispose = null;
}
