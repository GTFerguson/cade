/**
 * Renders an HTML document in the viewer as a live page.
 *
 * The page is agent- or file-authored and therefore untrusted: it runs in a
 * sandboxed frame with an opaque origin, so its scripts cannot reach CADE's
 * DOM, storage, or session.
 */

export interface HtmlView {
  dispose(): void;
}

/**
 * Scripts run, but without `allow-same-origin` the frame gets an opaque
 * origin. Never add `allow-same-origin` alongside `allow-scripts`: together
 * they let the page remove its own sandbox.
 */
export const HTML_VIEW_SANDBOX = "allow-scripts";

export function renderHtmlDocument(container: HTMLElement, html: string, title: string): HtmlView {
  // A blob URL rather than srcdoc: srcdoc inherits CADE's base URL, so a
  // relative link or asset in the page would load CADE itself inside the
  // frame. Against a blob URL relative references simply fail.
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));

  const frame = document.createElement("iframe");
  frame.className = "viewer-html-frame";
  frame.title = title;
  frame.setAttribute("sandbox", HTML_VIEW_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.src = url;
  container.appendChild(frame);

  return {
    dispose: () => {
      frame.remove();
      URL.revokeObjectURL(url);
    },
  };
}
