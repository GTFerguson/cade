// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileTree } from "./file-tree";
import type { WebSocketClient } from "../platform/websocket";
import type { FileNode } from "../types";

type Handler = (message: any) => void;

function makeWs() {
  const handlers = new Map<string, Set<Handler>>();
  const ws = {
    on: (event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    },
    isConnected: () => false,
    requestTree: vi.fn(),
    requestChildren: vi.fn(),
  };
  const emit = (event: string, message: any) => {
    for (const h of handlers.get(event) ?? []) h(message);
  };
  return { ws, emit };
}

describe("FileTree file-change handling", () => {
  let container: HTMLElement;
  let tree: FileTree;
  let ws: ReturnType<typeof makeWs>["ws"];
  let emit: ReturnType<typeof makeWs>["emit"];

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    ({ ws, emit } = makeWs());
    tree = new FileTree(container, ws as unknown as WebSocketClient);
    tree.initialize();
  });

  afterEach(() => {
    tree.dispose();
    vi.useRealTimers();
  });

  const change = (...paths: string[]) => ({
    type: "file-changes",
    changes: paths.map((path) => ({ event: "created", path, isDir: false })),
  });
  const node = (
    path: string,
    type: "file" | "directory" = "file",
    extra: Partial<FileNode> = {}
  ): FileNode => ({ name: path.split("/").pop()!, path, type, ...extra });
  const rows = () =>
    Array.from(container.querySelectorAll<HTMLElement>(".file-tree-row")).map(
      (r) => r.dataset["path"]
    );
  const loadTree = (data: FileNode[]) => {
    emit("file-tree", { type: "file-tree", data });
  };
  const settle = () => vi.runOnlyPendingTimers();

  // Refetching the tree for every change meant a directory walk on the
  // backend, a full re-render and one more fetch per expanded folder below
  // the preloaded depth, in every tab, for one saved file. Events carry
  // enough to patch the tree in place instead.
  it("inserts a created file in sort order without refetching", () => {
    loadTree([node("src", "directory"), node("b.txt"), node("d.txt")]);
    emit("file-changes", change("c.txt"));
    settle();
    expect(ws.requestTree).not.toHaveBeenCalled();
    expect(rows()).toEqual(["src", "b.txt", "c.txt", "d.txt"]);
  });

  it("inserts a created directory before files and lets it load on expand", () => {
    loadTree([node("b.txt")]);
    emit("file-changes", {
      type: "file-changes",
      changes: [{ event: "created", path: "zeta", isDir: true }],
    });
    settle();
    expect(rows()).toEqual(["zeta", "b.txt"]);
    expect(container.querySelector('[data-path="zeta"] .file-tree-chevron')).not.toBeNull();
  });

  it("inserts into an open folder whose children are loaded", () => {
    loadTree([node("src", "directory", { children: [node("src/a.ts")] })]);
    tree.setExpandedPaths(["src"]);
    emit("file-changes", change("src/b.ts"));
    settle();
    expect(rows()).toEqual(["src", "src/a.ts", "src/b.ts"]);
    expect(ws.requestTree).not.toHaveBeenCalled();
    expect(ws.requestChildren).not.toHaveBeenCalled();
  });

  it("gives a collapsed, unloaded folder a chevron when something lands in it", () => {
    loadTree([node("empty", "directory")]);
    expect(container.querySelector('[data-path="empty"] .file-tree-chevron')).not.toBeNull();
    emit("file-changes", change("empty/new.txt"));
    settle();
    expect(ws.requestTree).not.toHaveBeenCalled();
    expect(ws.requestChildren).not.toHaveBeenCalled();
    // Expanding now fetches, because the folder has contents to show.
    tree.setExpandedPaths(["empty"]);
    (tree as any).requestChildrenIfNeeded("empty");
    expect(ws.requestChildren).toHaveBeenCalledTimes(1);
  });

  it("removes a deleted file, and a folder's chevron with its last entry", () => {
    loadTree([node("src", "directory", { children: [node("src/a.ts")] }), node("b.txt")]);
    tree.setExpandedPaths(["src"]);
    emit("file-changes", {
      type: "file-changes",
      changes: [
        { event: "deleted", path: "b.txt" },
        { event: "deleted", path: "src/a.ts" },
      ],
    });
    settle();
    expect(rows()).toEqual(["src"]);
    expect(ws.requestTree).not.toHaveBeenCalled();
  });

  it("forgets the expansion of a deleted folder", () => {
    loadTree([node("src", "directory", { children: [node("src/a.ts")] })]);
    tree.setExpandedPaths(["src"]);
    emit("file-changes", {
      type: "file-changes",
      changes: [
        { event: "deleted", path: "src/a.ts" },
        { event: "deleted", path: "src" },
      ],
    });
    settle();
    expect(rows()).toEqual([]);
    expect(tree.getExpandedPaths()).toEqual([]);
  });

  it("orders a burst so parents exist before their children", () => {
    loadTree([]);
    emit("file-changes", {
      type: "file-changes",
      changes: [
        { event: "created", path: "pkg/mod/x.py", isDir: false },
        { event: "created", path: "pkg", isDir: true },
        { event: "created", path: "pkg/mod", isDir: true },
      ],
    });
    settle();
    expect(rows()).toEqual(["pkg"]);
    expect(ws.requestTree).not.toHaveBeenCalled();
  });

  it("skips ignored entries while ignored files are hidden", () => {
    loadTree([node("a.txt")]);
    (tree as any).toggleIgnored();
    ws.requestTree.mockClear();
    emit("file-changes", {
      type: "file-changes",
      changes: [{ event: "created", path: "out.log", isDir: false, ignored: true }],
    });
    settle();
    expect(rows()).toEqual(["a.txt"]);
    expect(ws.requestTree).not.toHaveBeenCalled();
  });

  it("does not rebuild the DOM once per change message", () => {
    loadTree([node("a.txt")]);
    const spy = vi.spyOn(container, "innerHTML", "set");
    for (let i = 0; i < 500; i++) {
      emit("file-changes", change(`tmp${i}`));
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("costs nothing for a large burst under a collapsed folder", () => {
    loadTree([node("output", "directory", { hasMore: true })]);
    const spy = vi.spyOn(container, "innerHTML", "set");
    const paths = Array.from({ length: 5000 }, (_, i) => `output/run/tmp${i}/f.jpg`);
    emit("file-changes", change(...paths));
    settle();
    expect(ws.requestTree).not.toHaveBeenCalled();
    expect(ws.requestChildren).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not render after dispose", () => {
    loadTree([node("a.txt")]);
    emit("file-changes", change("b.txt"));
    tree.dispose();
    settle();
    expect(ws.requestTree).not.toHaveBeenCalled();
    // afterEach disposes again; that must be harmless
  });
});
