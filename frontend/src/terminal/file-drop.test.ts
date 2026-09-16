// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tauriMode = false;
vi.mock("../config/config", () => ({
  isTauri: () => tauriMode,
}));

type DragHandler = (event: { payload: any }) => void;
let tauriDragHandler: DragHandler | null = null;
const tauriUnlisten = vi.fn();
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: DragHandler) => {
      tauriDragHandler = handler;
      return tauriUnlisten;
    },
  }),
}));

import {
  DROP_HOVER_CLASS,
  formatDroppedPaths,
  installFileDropHandling,
  noteDropTargetFocus,
  registerDropTarget,
  resetDropTargets,
  shellQuote,
  unregisterDropTarget,
  type DropTarget,
} from "./file-drop";

function makeTarget(visible = true): DropTarget & { pasteText: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  Object.defineProperty(element, "offsetWidth", { value: visible ? 400 : 0 });
  Object.defineProperty(element, "offsetHeight", { value: visible ? 300 : 0 });
  return { element, pasteText: vi.fn(), focus: vi.fn() };
}

function dragEvent(
  type: "dragover" | "drop" | "dragleave",
  opts: { files?: string[]; types?: string[]; x?: number; y?: number; relatedTarget?: Element | null } = {},
): Event & { dataTransfer: any; defaultPrevented: boolean } {
  const e = new Event(type, { bubbles: true, cancelable: true }) as any;
  const files = (opts.files ?? []).map((name) => ({ name }));
  const types = opts.types ?? (files.length ? ["Files"] : []);
  e.dataTransfer = { types, files, dropEffect: "uninitialized" };
  e.clientX = opts.x ?? 0;
  e.clientY = opts.y ?? 0;
  e.relatedTarget = opts.relatedTarget === undefined ? document.body : opts.relatedTarget;
  return e;
}

describe("shell quoting", () => {
  it("leaves plain paths untouched", () => {
    expect(shellQuote("/home/gary/projects/cade/README.md")).toBe("/home/gary/projects/cade/README.md");
  });

  it("single-quotes paths with spaces or metacharacters", () => {
    expect(shellQuote("/tmp/my file.txt")).toBe("'/tmp/my file.txt'");
    expect(shellQuote("/tmp/a$b")).toBe("'/tmp/a$b'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("/tmp/it's.txt")).toBe("'/tmp/it'\\''s.txt'");
  });

  it("joins several paths with a trailing space", () => {
    expect(formatDroppedPaths(["/a", "/b c"])).toBe("/a '/b c' ");
  });
});

describe("file drop handling", () => {
  let uninstall: () => void;
  let elementAt: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tauriMode = false;
    tauriDragHandler = null;
    resetDropTargets();
    document.body.innerHTML = "";
    elementAt = vi.fn(() => null);
    (document as any).elementFromPoint = elementAt;
  });

  afterEach(() => {
    uninstall?.();
  });

  it("stops a file drop from navigating the page even with no terminal", () => {
    uninstall = installFileDropHandling();
    const over = dragEvent("dragover", { files: ["notes.md"] });
    document.body.dispatchEvent(over);
    const drop = dragEvent("drop", { files: ["notes.md"] });
    document.body.dispatchEvent(drop);
    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });

  it("ignores drags that carry no files, so in-page drag-and-drop keeps working", () => {
    uninstall = installFileDropHandling();
    const drop = dragEvent("drop", { types: ["text/plain"] });
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  it("pastes dropped file names into the terminal under the pointer", () => {
    uninstall = installFileDropHandling();
    const target = makeTarget();
    registerDropTarget(target);
    const inner = document.createElement("canvas");
    target.element.appendChild(inner);
    elementAt.mockReturnValue(inner);

    document.body.dispatchEvent(dragEvent("dragover", { files: ["a.txt"], x: 10, y: 10 }));
    expect(target.element.classList.contains(DROP_HOVER_CLASS)).toBe(true);

    document.body.dispatchEvent(dragEvent("drop", { files: ["a.txt", "b c.txt"], x: 10, y: 10 }));
    expect(target.pasteText).toHaveBeenCalledWith("a.txt 'b c.txt' ");
    expect(target.focus).toHaveBeenCalled();
    expect(target.element.classList.contains(DROP_HOVER_CLASS)).toBe(false);
  });

  it("falls back to the last focused visible terminal for drops elsewhere", () => {
    uninstall = installFileDropHandling();
    const hiddenTarget = makeTarget(false);
    const focused = makeTarget();
    registerDropTarget(hiddenTarget);
    registerDropTarget(focused);
    noteDropTargetFocus(focused);

    document.body.dispatchEvent(dragEvent("drop", { files: ["a.txt"] }));
    expect(focused.pasteText).toHaveBeenCalledWith("a.txt ");
    expect(hiddenTarget.pasteText).not.toHaveBeenCalled();
  });

  it("does not route to a hidden last-focused terminal", () => {
    uninstall = installFileDropHandling();
    const hiddenTarget = makeTarget(false);
    registerDropTarget(hiddenTarget);
    noteDropTargetFocus(hiddenTarget);

    const over = dragEvent("dragover", { files: ["a.txt"] });
    document.body.dispatchEvent(over);
    expect(over.dataTransfer.dropEffect).toBe("none");

    document.body.dispatchEvent(dragEvent("drop", { files: ["a.txt"] }));
    expect(hiddenTarget.pasteText).not.toHaveBeenCalled();
  });

  it("forgets a target once it unregisters", () => {
    uninstall = installFileDropHandling();
    const target = makeTarget();
    registerDropTarget(target);
    noteDropTargetFocus(target);
    unregisterDropTarget(target);

    document.body.dispatchEvent(dragEvent("drop", { files: ["a.txt"] }));
    expect(target.pasteText).not.toHaveBeenCalled();
  });

  it("clears the hover highlight when the drag leaves the window", () => {
    uninstall = installFileDropHandling();
    const target = makeTarget();
    registerDropTarget(target);
    noteDropTargetFocus(target);
    document.body.dispatchEvent(dragEvent("dragover", { files: ["a.txt"] }));
    expect(target.element.classList.contains(DROP_HOVER_CLASS)).toBe(true);
    document.body.dispatchEvent(dragEvent("dragleave", { relatedTarget: null }));
    expect(target.element.classList.contains(DROP_HOVER_CLASS)).toBe(false);
  });

  it("stops handling once uninstalled", () => {
    uninstall = installFileDropHandling();
    uninstall();
    const drop = dragEvent("drop", { files: ["a.txt"] });
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  describe("desktop app", () => {
    beforeEach(() => {
      tauriMode = true;
    });

    async function flush(): Promise<void> {
      await new Promise((r) => setTimeout(r, 0));
    }

    it("pastes full paths from the Tauri drop event, scaled to CSS pixels", async () => {
      uninstall = installFileDropHandling();
      await flush();
      expect(tauriDragHandler).not.toBeNull();

      const target = makeTarget();
      registerDropTarget(target);
      elementAt.mockImplementation((x: number, y: number) => (x === 50 && y === 20 ? target.element : null));
      Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

      tauriDragHandler!({ payload: { type: "enter", paths: ["/home/gary/my file.md"], position: { x: 100, y: 40 } } });
      expect(target.element.classList.contains(DROP_HOVER_CLASS)).toBe(true);

      tauriDragHandler!({ payload: { type: "drop", paths: ["/home/gary/my file.md"], position: { x: 100, y: 40 } } });
      expect(target.pasteText).toHaveBeenCalledWith("'/home/gary/my file.md' ");
      expect(target.focus).toHaveBeenCalled();
    });

    it("suppresses the HTML5 drop without pasting, so paths are not duplicated", async () => {
      uninstall = installFileDropHandling();
      await flush();
      const target = makeTarget();
      registerDropTarget(target);
      noteDropTargetFocus(target);

      const drop = dragEvent("drop", { files: ["my file.md"] });
      document.body.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
      expect(target.pasteText).not.toHaveBeenCalled();
    });

    it("unlistens from Tauri events on uninstall", async () => {
      uninstall = installFileDropHandling();
      await flush();
      uninstall();
      expect(tauriUnlisten).toHaveBeenCalled();
    });
  });
});
