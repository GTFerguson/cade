// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileTree } from "./file-tree";
import type { WebSocketClient } from "../platform/websocket";

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
    changes: paths.map((path) => ({ event: "created", path })),
  });

  // A build or eval run churning temp directories sends a stream of change
  // messages. Refetching the whole tree for each one pinned the webview's
  // main thread and froze terminal input.
  it("coalesces a stream of change messages into a single tree refetch", () => {
    for (let i = 0; i < 1000; i++) {
      emit("file-changes", change(`tmp${i}/scores.npz`));
    }
    expect(ws.requestTree).toHaveBeenCalledTimes(0);

    vi.runOnlyPendingTimers();
    expect(ws.requestTree).toHaveBeenCalledTimes(1);
  });

  it("refetches again for changes arriving after the previous burst settled", () => {
    emit("file-changes", change("a.txt"));
    vi.runOnlyPendingTimers();
    emit("file-changes", change("b.txt"));
    vi.runOnlyPendingTimers();
    expect(ws.requestTree).toHaveBeenCalledTimes(2);
  });

  it("does not rebuild the DOM once per change message", () => {
    const spy = vi.spyOn(container, "innerHTML", "set");
    for (let i = 0; i < 500; i++) {
      emit("file-changes", change(`tmp${i}`));
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("refetches once for a single large batch", () => {
    const paths = Array.from({ length: 5000 }, (_, i) => `tmp${i}/f.jpg`);
    emit("file-changes", change(...paths));
    vi.runOnlyPendingTimers();
    expect(ws.requestTree).toHaveBeenCalledTimes(1);
  });

  it("does not refetch after dispose", () => {
    emit("file-changes", change("a.txt"));
    tree.dispose();
    vi.runOnlyPendingTimers();
    expect(ws.requestTree).not.toHaveBeenCalled();
    // afterEach disposes again; that must be harmless
  });
});
