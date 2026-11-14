// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// mertex.md is a sibling checkout that the test runner cannot resolve, and
// HTML files never reach the markdown renderer.
vi.mock("@core/chat/markdown-renderer", () => ({ MarkdownRenderer: class {} }));
vi.mock("@core/chat/diagram-viewer", () => ({ DiagramViewer: class {} }));

import { MarkdownViewer } from "./markdown";
import type { WebSocketClient } from "../platform/websocket";

type Handler = (message: unknown) => void;

function fakeWs() {
  const handlers = new Map<string, Handler>();
  const ws = {
    on: (type: string, h: Handler) => handlers.set(type, h),
    off: (type: string) => handlers.delete(type),
    requestFile: vi.fn(),
  };
  return {
    ws: ws as unknown as WebSocketClient,
    deliver: (type: string, message: unknown) => handlers.get(type)!(message),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const PAGE = "<!doctype html><h1>Drawn</h1><script>document.title = 'x'</script>";

describe("MarkdownViewer with HTML files", () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;
  let deliver: ReturnType<typeof fakeWs>["deliver"];
  const revoke = vi.fn();

  beforeEach(() => {
    let n = 0;
    revoke.mockClear();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++n}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
    // Left detached: happy-dom tries to fetch a connected frame's src.
    container = document.createElement("div");
    const fake = fakeWs();
    deliver = fake.deliver;
    viewer = new MarkdownViewer(container, fake.ws);
    viewer.initialize();
  });

  afterEach(() => {
    viewer.dispose();
    vi.restoreAllMocks();
  });

  async function open(path = ".cade/canvas/flow.html", content = PAGE): Promise<void> {
    deliver("file-content", { path, content, fileType: "html", encoding: "utf-8" });
    await settle();
  }

  function modeButton(label: string): HTMLButtonElement {
    const btn = [...container.querySelectorAll<HTMLButtonElement>(".viewer-mode-btn")]
      .find((b) => b.textContent === label);
    if (!btn) throw new Error(`no ${label} button`);
    return btn;
  }

  it("shows an HTML file as a live page, not as source", async () => {
    await open();
    expect(container.querySelector("iframe.viewer-html-frame")).not.toBeNull();
    expect(container.querySelector(".viewer-content")!.classList.contains("html-viewer")).toBe(true);
    // The markup must reach the frame only; none of it may land in CADE's own DOM.
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(modeButton("[page]").classList.contains("viewer-mode-btn--active")).toBe(true);
  });

  it("switches to highlighted source and back", async () => {
    await open();
    modeButton("[source]").click();
    await settle();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".viewer-content")!.classList.contains("code-viewer")).toBe(true);
    expect(container.querySelector(".viewer-content")!.textContent).toContain("Drawn");
    expect(revoke).toHaveBeenCalledWith("blob:test/1");

    modeButton("[page]").click();
    await settle();
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("replaces the page when the file is redrawn, releasing the old one", async () => {
    await open();
    await open(".cade/canvas/flow.html", "<p>second</p>");
    const frames = container.querySelectorAll("iframe");
    expect(frames.length).toBe(1);
    expect(frames[0]!.getAttribute("src")).toBe("blob:test/2");
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
  });

  it("releases the page when the viewer moves to another file", async () => {
    await open();
    deliver("file-content", { path: "a.py", content: "x = 1", fileType: "python", encoding: "utf-8" });
    await settle();
    expect(container.querySelector("iframe")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
  });
});
