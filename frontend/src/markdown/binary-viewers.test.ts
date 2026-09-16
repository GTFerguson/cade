// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

const renderMock = vi.fn(() => ({ promise: Promise.resolve() }));
const destroyMock = vi.fn();
const getDocumentMock = vi.fn((_opts: unknown) => ({
  destroy: destroyMock,
  promise: Promise.resolve({
    numPages: 2,
    getPage: async (_n: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: renderMock,
    }),
  }),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (opts: unknown) => getDocumentMock(opts),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/worker.mjs" }));

import {
  decodeBase64,
  formatBytes,
  isBinaryPayload,
  renderBinaryContent,
} from "./binary-viewers";

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("binary payload helpers", () => {
  it("recognises base64 and capped payloads as binary, text as not", () => {
    expect(isBinaryPayload({ encoding: "base64" })).toBe(true);
    expect(isBinaryPayload({ encoding: "none" })).toBe(true);
    expect(isBinaryPayload({ encoding: "utf-8" })).toBe(false);
    expect(isBinaryPayload({})).toBe(false);
  });

  it("decodes base64 into bytes", () => {
    expect(Array.from(decodeBase64(btoa("%PDF")))).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("formats sizes for the statusline", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("renderBinaryContent", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderMock.mockClear();
    destroyMock.mockClear();
    getDocumentMock.mockClear();
  });

  it("shows an image inline from its bytes", () => {
    renderBinaryContent(
      container,
      { fileType: "image", content: "AAAA", encoding: "base64", mime: "image/png", size: 3 },
      "shot.png",
    );
    const img = container.querySelector("img")!;
    expect(img.src).toBe("data:image/png;base64,AAAA");
    expect(img.alt).toBe("shot.png");
  });

  it("explains a capped file instead of rendering nothing", () => {
    renderBinaryContent(
      container,
      { fileType: "pdf", content: "", encoding: "none", size: 40 * 1024 * 1024 },
      "huge.pdf",
    );
    expect(container.textContent).toContain("too large to preview");
    expect(container.textContent).toContain("40.0 MB");
  });

  it("names an unrenderable binary rather than dumping it as text", () => {
    renderBinaryContent(
      container,
      { fileType: "binary", content: "AAAA", encoding: "base64", size: 3 },
      "blob.bin",
    );
    expect(container.textContent).toContain("binary file");
    expect(container.querySelector("pre, code")).toBeNull();
  });

  it("renders every PDF page to its own canvas", async () => {
    renderBinaryContent(
      container,
      { fileType: "pdf", content: btoa("%PDF"), encoding: "base64", mime: "application/pdf", size: 4 },
      "paper.pdf",
    );
    await settle();
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".viewer-pdf-page canvas").length).toBe(2);
    expect(renderMock).toHaveBeenCalledTimes(2);
  });

  it("stops rendering and tears down when disposed", async () => {
    const viewer = renderBinaryContent(
      container,
      { fileType: "pdf", content: btoa("%PDF"), encoding: "base64", size: 4 },
      "paper.pdf",
    );
    viewer.dispose();
    await settle();
    expect(container.querySelector(".viewer-pdf")).toBeNull();
    expect(renderMock).not.toHaveBeenCalled();
  });
});
