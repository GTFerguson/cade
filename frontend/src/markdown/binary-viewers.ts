/**
 * Viewers for files that arrive as bytes rather than text: PDFs rendered
 * page by page through pdf.js, images shown inline, and a size notice for
 * anything else. The text paths (syntax highlighting, markdown) must never
 * see these payloads; a PDF pushed through the highlighter freezes the pane.
 */

import type { FileContentEncoding } from "../types";

export interface BinaryPayload {
  fileType: string;
  content: string;
  encoding?: FileContentEncoding | undefined;
  size?: number | undefined;
  mime?: string | undefined;
}

export interface BinaryViewer {
  dispose(): void;
}

export function isBinaryPayload(payload: { encoding?: string | undefined }): boolean {
  return payload.encoding === "base64" || payload.encoding === "none";
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pages wider than this are downscaled to fit; narrower ones are not upscaled. */
const PDF_MAX_PAGE_WIDTH = 1200;

function notice(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "viewer-binary-notice";
  const p = document.createElement("p");
  p.textContent = text;
  el.appendChild(p);
  return el;
}

function renderImage(container: HTMLElement, payload: BinaryPayload, name: string): BinaryViewer {
  const wrap = document.createElement("div");
  wrap.className = "viewer-image";
  const img = document.createElement("img");
  img.alt = name;
  img.src = `data:${payload.mime ?? "application/octet-stream"};base64,${payload.content}`;
  wrap.appendChild(img);
  container.appendChild(wrap);
  return { dispose: () => wrap.remove() };
}

function renderPdf(container: HTMLElement, payload: BinaryPayload): BinaryViewer {
  const wrap = document.createElement("div");
  wrap.className = "viewer-pdf";
  const status = notice("Loading PDF…");
  wrap.appendChild(status);
  container.appendChild(wrap);

  let cancelled = false;
  let destroy: (() => void) | null = null;

  (async () => {
    try {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

      const task = pdfjs.getDocument({ data: decodeBase64(payload.content) });
      destroy = () => void task.destroy();
      const doc = await task.promise;
      if (cancelled) return;
      status.remove();

      const dpr = window.devicePixelRatio || 1;
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        const page = await doc.getPage(n);
        if (cancelled) return;

        const natural = page.getViewport({ scale: 1 });
        const available = Math.min(wrap.clientWidth || PDF_MAX_PAGE_WIDTH, PDF_MAX_PAGE_WIDTH);
        const scale = Math.min(1, available / natural.width);
        const viewport = page.getViewport({ scale });

        const pageEl = document.createElement("div");
        pageEl.className = "viewer-pdf-page";
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        pageEl.appendChild(canvas);
        wrap.appendChild(pageEl);

        await page.render({
          canvas,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        }).promise;
      }
    } catch (err) {
      if (cancelled) return;
      status.remove();
      wrap.appendChild(notice(`Could not render PDF: ${err instanceof Error ? err.message : String(err)}`));
    }
  })();

  return {
    dispose: () => {
      cancelled = true;
      destroy?.();
      wrap.remove();
    },
  };
}

/**
 * Render a non-text payload into `container`. Returns a handle that stops
 * any in-flight rendering and removes the elements.
 */
export function renderBinaryContent(
  container: HTMLElement,
  payload: BinaryPayload,
  name: string,
): BinaryViewer {
  const size = payload.size !== undefined ? formatBytes(payload.size) : "unknown size";

  if (payload.encoding === "none") {
    const el = notice(`${name} is too large to preview (${size}).`);
    container.appendChild(el);
    return { dispose: () => el.remove() };
  }

  if (payload.fileType === "pdf") return renderPdf(container, payload);
  if (payload.fileType === "image") return renderImage(container, payload, name);

  const el = notice(`${name} is a binary file (${size}) and cannot be shown as text.`);
  container.appendChild(el);
  return { dispose: () => el.remove() };
}
