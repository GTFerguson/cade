// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  installShellListeners,
  nextZoom,
  resetShellListenersForTest,
} from "./shell-listeners";

const setZoom = vi.fn(async (_factor: number) => {});
const startDragging = vi.fn(async () => {});
const toggleMaximize = vi.fn(async () => {});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging, toggleMaximize }),
}));

function press(key: string, mods: KeyboardEventInit = { ctrlKey: true }): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  window.dispatchEvent(e);
  return e;
}

function setShell(tauri: boolean, live: boolean): void {
  (window as any).__TAURI__ = tauri ? true : undefined;
  (window as any).__LIVE_FRONTEND__ = live ? true : undefined;
}

describe("nextZoom", () => {
  it("steps in and out and resets", () => {
    expect(nextZoom(1, "=")).toBeCloseTo(1 + ZOOM_STEP);
    expect(nextZoom(1, "+")).toBeCloseTo(1 + ZOOM_STEP);
    expect(nextZoom(1, "-")).toBeCloseTo(1 - ZOOM_STEP);
    expect(nextZoom(2.4, "0")).toBe(1);
  });

  it("stays within the zoom range", () => {
    expect(nextZoom(MIN_ZOOM, "-")).toBe(MIN_ZOOM);
    expect(nextZoom(MAX_ZOOM, "=")).toBe(MAX_ZOOM);
  });
});

describe("installShellListeners", () => {
  beforeEach(() => {
    setZoom.mockClear();
    startDragging.mockClear();
    toggleMaximize.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetShellListenersForTest();
    setShell(false, false);
  });

  it("zooms the webview on Ctrl+= in a live-loaded desktop window", async () => {
    setShell(true, true);
    installShellListeners();
    const e = press("=");
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledTimes(1));
    expect(setZoom.mock.calls[0]![0]).toBeCloseTo(1 + ZOOM_STEP);
    expect(e.defaultPrevented).toBe(true);
  });

  it("accumulates steps and Ctrl+0 resets", async () => {
    setShell(true, true);
    installShellListeners();
    press("-");
    press("-");
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledTimes(2));
    expect(setZoom.mock.calls[1]![0]).toBeCloseTo(1 - 2 * ZOOM_STEP);
    press("0");
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledTimes(3));
    expect(setZoom.mock.calls[2]![0]).toBe(1);
  });

  it("restores the saved zoom when the page loads again", async () => {
    setShell(true, true);
    installShellListeners();
    press("=");
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledTimes(1));
    resetShellListenersForTest();
    setZoom.mockClear();

    installShellListeners();
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledTimes(1));
    expect(setZoom.mock.calls[0]![0]).toBeCloseTo(1 + ZOOM_STEP);
  });

  it("ignores plain typing and other Ctrl keys", async () => {
    setShell(true, true);
    installShellListeners();
    press("=", {});
    press("c");
    await Promise.resolve();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("does nothing in a browser tab", async () => {
    setShell(false, false);
    installShellListeners();
    press("=");
    await Promise.resolve();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("leaves the embedded page to the shell's own listeners", async () => {
    // Without the live load the shell's listeners are intact; a second set
    // would zoom two steps per key press.
    setShell(true, false);
    installShellListeners();
    press("=");
    await Promise.resolve();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("drags the window from a drag region, and maximises on double click", async () => {
    setShell(true, true);
    installShellListeners();
    const region = document.createElement("div");
    region.setAttribute("data-tauri-drag-region", "");
    const child = document.createElement("button");
    region.appendChild(child);
    document.body.appendChild(region);

    region.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    await vi.waitFor(() => expect(startDragging).toHaveBeenCalledTimes(1));

    region.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 2 }));
    await vi.waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1));

    // A control inside the region is clicked, not dragged.
    child.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    region.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2, detail: 1 }));
    await Promise.resolve();
    expect(startDragging).toHaveBeenCalledTimes(1);
  });
});
