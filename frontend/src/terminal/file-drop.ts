/**
 * File drag-and-drop into terminals.
 *
 * A file dropped on a page that has no drop handler makes the webview
 * navigate to the file, replacing CADE with the file's contents. People drop
 * files to hand a path to Claude Code, so every file drop is captured and
 * pasted into a terminal as shell-quoted text instead.
 *
 * Two sources feed the same routing:
 *  - HTML5 drag events, in the browser. The File API exposes only the file
 *    name, never the full path, so that is what gets pasted.
 *  - Tauri's webview drag-drop event, in the desktop app. It carries full
 *    paths, so the HTML5 handler only suppresses navigation there.
 */

import { isTauri } from "../config/config";

/** Anything that can receive dropped paths as pasted text. */
export interface DropTarget {
  /** Root element whose area accepts drops. */
  readonly element: HTMLElement;
  pasteText(text: string): void;
  focus(): void;
}

/** Class applied to a target's element while a file drag hovers over it. */
export const DROP_HOVER_CLASS = "file-drop-hover";

const targets = new Set<DropTarget>();
let lastFocused: DropTarget | null = null;
let hovered: DropTarget | null = null;

export function registerDropTarget(target: DropTarget): void {
  targets.add(target);
}

export function unregisterDropTarget(target: DropTarget): void {
  targets.delete(target);
  if (lastFocused === target) lastFocused = null;
  if (hovered === target) setHovered(null);
}

/**
 * Remember the terminal the user last typed in. A drop that lands outside
 * any terminal (over the editor, the tab bar, the status line) goes there,
 * since the intent is almost always "give this path to the session I'm in".
 */
export function noteDropTargetFocus(target: DropTarget): void {
  lastFocused = target;
}

/** Test hook: forget every registered target and cached focus. */
export function resetDropTargets(): void {
  targets.clear();
  lastFocused = null;
  setHovered(null);
}

export function isFileDrag(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types).includes("Files");
}

/** Quote a path for a POSIX shell so spaces and metacharacters survive. */
export function shellQuote(path: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path;
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

/**
 * Join dropped paths the way terminal emulators do: quoted, space-separated,
 * with a trailing space so the user can keep typing.
 */
export function formatDroppedPaths(paths: string[]): string {
  return paths.map(shellQuote).join(" ") + " ";
}

function isVisible(el: HTMLElement): boolean {
  return el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0;
}

/**
 * Pick the target for a drop at CSS-pixel coordinates: the terminal under
 * the pointer, else the last focused terminal if it is still on screen.
 */
export function resolveDropTarget(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (el) {
    for (const target of targets) {
      if (target.element.contains(el)) return target;
    }
  }
  if (lastFocused && targets.has(lastFocused) && isVisible(lastFocused.element)) {
    return lastFocused;
  }
  return null;
}

function setHovered(target: DropTarget | null): void {
  if (hovered === target) return;
  hovered?.element.classList.remove(DROP_HOVER_CLASS);
  hovered = target;
  hovered?.element.classList.add(DROP_HOVER_CLASS);
}

function deliver(target: DropTarget | null, paths: string[]): void {
  setHovered(null);
  if (!target || paths.length === 0) return;
  target.pasteText(formatDroppedPaths(paths));
  target.focus();
}

/**
 * Install the document-level handlers. Returns a function that removes them.
 * Safe to call before any terminal exists; targets register themselves later.
 */
export function installFileDropHandling(): () => void {
  const tauri = isTauri();

  const onDragOver = (e: DragEvent): void => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    const target = resolveDropTarget(e.clientX, e.clientY);
    if (e.dataTransfer) e.dataTransfer.dropEffect = target ? "copy" : "none";
    setHovered(target);
  };

  const onDragLeave = (e: DragEvent): void => {
    // relatedTarget is null only when the pointer leaves the window.
    if (e.relatedTarget === null) setHovered(null);
  };

  const onDrop = (e: DragEvent): void => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    // The desktop webview reports the same drop with full paths through the
    // Tauri event below; pasting here as well would duplicate it.
    if (tauri) {
      setHovered(null);
      return;
    }
    const names = Array.from(e.dataTransfer?.files ?? []).map((f) => f.name);
    deliver(resolveDropTarget(e.clientX, e.clientY), names);
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);

  let unlistenTauri: (() => void) | null = null;
  let disposed = false;
  if (tauri) {
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "leave") {
            setHovered(null);
            return;
          }
          // Positions arrive in physical pixels; the DOM wants CSS pixels.
          const scale = window.devicePixelRatio || 1;
          const x = payload.position.x / scale;
          const y = payload.position.y / scale;
          const target = resolveDropTarget(x, y);
          if (payload.type === "drop") {
            deliver(target, payload.paths);
          } else {
            setHovered(target);
          }
        }),
      )
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenTauri = unlisten;
      })
      .catch((err) => {
        console.warn("[file-drop] Tauri drag-drop events unavailable:", err);
      });
  }

  return () => {
    disposed = true;
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
    unlistenTauri?.();
    unlistenTauri = null;
    setHovered(null);
  };
}
