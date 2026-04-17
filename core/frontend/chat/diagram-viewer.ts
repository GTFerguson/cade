/**
 * Fullscreen diagram viewer with zoom and pan.
 *
 * Opens when a mermaid diagram is clicked in the chat pane.
 * Mouse wheel zooms, click+drag pans, double-click resets,
 * Escape or backdrop click closes.
 */

import type { Component } from "@core/types";

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_FACTOR = 0.1;

export class DiagramViewer implements Component {
  private overlay: HTMLElement | null = null;
  private svgWrap: HTMLElement | null = null;
  private isVisible = false;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  private scale = 1;
  private translateX = 0;
  private translateY = 0;

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartTX = 0;
  private dragStartTY = 0;

  show(sourceContainer: HTMLElement): void {
    if (this.isVisible) return;

    const svg = sourceContainer.querySelector("svg");
    if (!svg) return;

    this.cleanup();
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;

    // Build overlay
    this.overlay = document.createElement("div");
    this.overlay.className = "diagram-viewer-overlay";

    // Backdrop click closes
    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // SVG container
    const content = document.createElement("div");
    content.className = "diagram-viewer-content";

    this.svgWrap = document.createElement("div");
    this.svgWrap.className = "diagram-viewer-svg";
    this.svgWrap.innerHTML = svg.outerHTML;

    // Let CSS handle sizing instead of mermaid's inline constraints
    const cloned = this.svgWrap.querySelector("svg");
    if (cloned) {
      cloned.removeAttribute("style");
      cloned.setAttribute("width", "100%");
      cloned.setAttribute("height", "100%");
    }

    // Zoom via wheel
    content.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_FACTOR : ZOOM_FACTOR;
      this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale + delta));
      this.applyTransform();
    }, { passive: false });

    // Pan via drag
    content.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) return;
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartTX = this.translateX;
      this.dragStartTY = this.translateY;
      content.style.cursor = "grabbing";
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      this.translateX = this.dragStartTX + (e.clientX - this.dragStartX);
      this.translateY = this.dragStartTY + (e.clientY - this.dragStartY);
      this.applyTransform();
    };

    const onMouseUp = () => {
      this.dragging = false;
      if (content) content.style.cursor = "grab";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Double-click resets
    content.addEventListener("dblclick", () => {
      this.scale = 1;
      this.translateX = 0;
      this.translateY = 0;
      this.applyTransform();
    });

    // Hint
    const hint = document.createElement("div");
    hint.className = "diagram-viewer-hint";
    hint.textContent = "scroll to zoom · drag to pan · dbl-click to reset · esc to close";

    content.appendChild(this.svgWrap);
    this.overlay.appendChild(content);
    this.overlay.appendChild(hint);
    document.body.appendChild(this.overlay);

    // Force reflow then animate in
    this.overlay.offsetHeight;
    this.overlay.classList.add("visible");
    this.isVisible = true;

    // Key handler (capture phase like HelpOverlay)
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };

    setTimeout(() => {
      if (this.boundKeyHandler) {
        document.addEventListener("keydown", this.boundKeyHandler, true);
      }
    }, 50);

    // Store cleanup refs on overlay element for dispose
    (this.overlay as any)._diagramCleanup = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }

  hide(): void {
    if (!this.isVisible || !this.overlay) return;

    if (this.boundKeyHandler) {
      document.removeEventListener("keydown", this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }

    const cleanup = (this.overlay as any)._diagramCleanup;
    if (cleanup) cleanup();

    this.overlay.classList.remove("visible");
    this.overlay.remove();
    this.overlay = null;
    this.svgWrap = null;
    this.isVisible = false;
  }

  private applyTransform(): void {
    if (!this.svgWrap) return;
    this.svgWrap.style.transform =
      `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  }

  private cleanup(): void {
    if (this.overlay) {
      const cleanup = (this.overlay as any)._diagramCleanup;
      if (cleanup) cleanup();
      this.overlay.remove();
      this.overlay = null;
    }
  }

  initialize(): void {}

  dispose(): void {
    this.hide();
  }
}
