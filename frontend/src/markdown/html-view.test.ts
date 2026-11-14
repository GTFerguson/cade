// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HTML_VIEW_SANDBOX, renderHtmlDocument } from "./html-view";

describe("renderHtmlDocument", () => {
  let container: HTMLElement;
  let blobs: Blob[];
  const revoke = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    blobs = [];
    revoke.mockClear();
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b as Blob);
      return `blob:test/${blobs.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  });

  afterEach(() => vi.restoreAllMocks());

  it("mounts the document in a frame loaded from a blob URL", async () => {
    renderHtmlDocument(container, "<p>héllo</p>", "page.html");
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("blob:test/1");
    expect(frame.title).toBe("page.html");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(blobs[0]!.type).toBe("text/html;charset=utf-8");
    expect(await blobs[0]!.text()).toBe("<p>héllo</p>");
  });

  it("isolates the page from CADE's origin", () => {
    renderHtmlDocument(container, "<script>1</script>", "x.html");
    const tokens = container.querySelector("iframe")!.getAttribute("sandbox")!.split(/\s+/);
    expect(tokens).toEqual(HTML_VIEW_SANDBOX.split(/\s+/));
    expect(tokens).toContain("allow-scripts");
    // With both tokens a page can reach the parent and strip its own sandbox.
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).not.toContain("allow-top-navigation");
  });

  it("removes the frame and releases the blob on dispose", () => {
    const view = renderHtmlDocument(container, "<p>x</p>", "x.html");
    view.dispose();
    expect(container.querySelector("iframe")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
  });
});
