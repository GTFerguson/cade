/**
 * Three-pane layout with resizable panels.
 * Supports both desktop (three-pane) and mobile (terminal-only) layouts.
 */

import type { Component, LayoutProportions } from "./types";

const DEFAULT_PROPORTIONS: LayoutProportions = {
  fileTree: 0.2,
  terminal: 0.5,
  viewer: 0.3,
};

const MOBILE_BREAKPOINT = 768;

export class Layout implements Component {
  private proportions: LayoutProportions;
  private isDragging = false;
  private activeHandle: "left" | "right" | null = null;
  private startX = 0;
  private startProportions: LayoutProportions | null = null;
  private mobileMode = false;
  private onChangeCallback: (() => void) | null = null;
  private boundHandleResize: (() => void) | null = null;
  private boundOnDrag: ((e: MouseEvent) => void) | null = null;
  private boundEndDrag: (() => void) | null = null;
  private rafId: number | null = null;
  private savedViewerProportion: number | null = null;

  constructor(private container: HTMLElement) {
    this.proportions = { ...DEFAULT_PROPORTIONS };
  }

  /**
   * Check if current viewport is mobile-sized.
   */
  isMobile(): boolean {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  /**
   * Initialize the layout.
   */
  initialize(): void {
    this.mobileMode = this.isMobile();

    if (this.mobileMode) {
      this.initMobileLayout();
    } else {
      this.initDesktopLayout();
    }

    // Store bound handler and attach
    this.boundHandleResize = () => this.handleResize();
    window.addEventListener("resize", this.boundHandleResize);
  }

  /**
   * Initialize desktop three-pane layout.
   */
  private initDesktopLayout(): void {
    this.container.classList.remove("mobile-layout");
    this.applyProportions();
    this.setupResizeHandlers();
  }

  /**
   * Initialize mobile full-screen terminal layout.
   */
  private initMobileLayout(): void {
    this.container.classList.add("mobile-layout");
  }

  /**
   * Handle viewport resize.
   */
  private handleResize(): void {
    const wasMobile = this.mobileMode;
    this.mobileMode = this.isMobile();

    if (wasMobile !== this.mobileMode) {
      if (this.mobileMode) {
        this.initMobileLayout();
      } else {
        this.initDesktopLayout();
      }
    }
  }

  /**
   * Get container elements.
   */
  getContainers(): {
    fileTree: HTMLElement;
    terminal: HTMLElement;
    viewer: HTMLElement;
  } {
    return {
      fileTree: this.container.querySelector("#file-tree") as HTMLElement,
      terminal: this.container.querySelector("#terminal") as HTMLElement,
      viewer: this.container.querySelector("#viewer") as HTMLElement,
    };
  }

  /**
   * Apply current proportions to the layout.
   */
  private applyProportions(): void {
    const { fileTree, terminal, viewer } = this.proportions;

    this.container.style.gridTemplateColumns = [
      `${fileTree * 100}%`,
      "4px",
      `${terminal * 100}%`,
      "4px",
      `${viewer * 100}%`,
    ].join(" ");

    // Sync proportions to CSS custom properties for tab bar alignment
    document.documentElement.style.setProperty(
      "--layout-file-tree",
      `${fileTree * 100}%`
    );
    document.documentElement.style.setProperty(
      "--layout-terminal",
      `${terminal * 100}%`
    );
    document.documentElement.style.setProperty(
      "--layout-viewer",
      `${viewer * 100}%`
    );

    // Force browser reflow so tab bar recalculates its grid layout
    const tabBar = document.getElementById("tab-bar");
    if (tabBar != null) {
      void tabBar.offsetWidth;
    }
  }

  /**
   * Setup resize handle event listeners.
   */
  private setupResizeHandlers(): void {
    const leftHandle = this.container.querySelector(
      ".resize-handle-left"
    ) as HTMLElement;
    const rightHandle = this.container.querySelector(
      ".resize-handle-right"
    ) as HTMLElement;

    // Store bound handlers
    this.boundOnDrag = (e: MouseEvent) => this.onDrag(e);
    this.boundEndDrag = () => this.endDrag();

    if (leftHandle != null) {
      leftHandle.addEventListener("mousedown", (e) => {
        this.startDrag(e, "left");
      });
    }

    if (rightHandle != null) {
      rightHandle.addEventListener("mousedown", (e) => {
        this.startDrag(e, "right");
      });
    }

    // DO NOT attach mousemove/mouseup here
    // They are attached in startDrag() and removed in endDrag()
  }

  /**
   * Start dragging a resize handle.
   */
  private startDrag(e: MouseEvent, handle: "left" | "right"): void {
    e.preventDefault();
    this.isDragging = true;
    this.activeHandle = handle;
    this.startX = e.clientX;
    this.startProportions = { ...this.proportions };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    // Attach drag listeners ONLY when dragging starts
    if (this.boundOnDrag && this.boundEndDrag) {
      document.addEventListener("mousemove", this.boundOnDrag);
      document.addEventListener("mouseup", this.boundEndDrag);
    }
  }

  /**
   * Handle drag movement.
   */
  private onDrag(e: MouseEvent): void {
    if (!this.isDragging || this.startProportions === null) {
      return;
    }

    const containerWidth = this.container.offsetWidth;
    const delta = (e.clientX - this.startX) / containerWidth;

    const minProportion = 0.1;
    const maxProportion = 0.6;

    if (this.activeHandle === "left") {
      let newFileTree = this.startProportions.fileTree + delta;
      newFileTree = Math.max(minProportion, Math.min(maxProportion, newFileTree));

      const diff = newFileTree - this.startProportions.fileTree;
      let newTerminal = this.startProportions.terminal - diff;
      newTerminal = Math.max(minProportion, newTerminal);

      this.proportions = {
        fileTree: newFileTree,
        terminal: newTerminal,
        viewer: 1 - newFileTree - newTerminal,
      };
    } else if (this.activeHandle === "right") {
      let newViewer = this.startProportions.viewer - delta;
      newViewer = Math.max(minProportion, Math.min(maxProportion, newViewer));

      const diff = newViewer - this.startProportions.viewer;
      let newTerminal = this.startProportions.terminal - diff;
      newTerminal = Math.max(minProportion, newTerminal);

      this.proportions = {
        fileTree: 1 - newTerminal - newViewer,
        terminal: newTerminal,
        viewer: newViewer,
      };
    }

    if (this.proportions.viewer < minProportion) {
      this.proportions.viewer = minProportion;
      this.proportions.terminal =
        1 - this.proportions.fileTree - this.proportions.viewer;
    }

    // Debounce with RAF instead of immediate apply
    if (this.rafId == null) {
      this.rafId = requestAnimationFrame(() => {
        this.applyProportions();
        this.rafId = null;
      });
    }
  }

  /**
   * End dragging.
   */
  private endDrag(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.activeHandle = null;
    this.startProportions = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    // Remove drag listeners when drag ends
    if (this.boundOnDrag && this.boundEndDrag) {
      document.removeEventListener("mousemove", this.boundOnDrag);
      document.removeEventListener("mouseup", this.boundEndDrag);
    }

    this.onChangeCallback?.();

    window.dispatchEvent(new Event("resize"));
  }

  /**
   * Get current layout proportions.
   */
  getProportions(): LayoutProportions {
    return { ...this.proportions };
  }

  /**
   * Set layout proportions.
   */
  setProportions(proportions: LayoutProportions): void {
    if (
      typeof proportions.fileTree === "number" &&
      typeof proportions.terminal === "number" &&
      typeof proportions.viewer === "number"
    ) {
      this.proportions = { ...proportions };
      this.applyProportions();
      window.dispatchEvent(new Event("resize"));
    }
  }

  /**
   * Register callback for proportion changes.
   */
  onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  /**
   * Reset to default proportions.
   */
  resetProportions(): void {
    this.proportions = { ...DEFAULT_PROPORTIONS };
    this.applyProportions();
    this.onChangeCallback?.();
  }

  /**
   * Sync current proportions to CSS custom properties.
   * Call this when showing a hidden layout to update the tab bar.
   */
  syncProportions(): void {
    this.applyProportions();
  }

  /**
   * Adjust proportions via keyboard shortcut.
   * Direction "left" shrinks left pane / grows right.
   * Direction "right" grows left pane / shrinks right.
   */
  adjustByKeyboard(direction: "left" | "right"): void {
    const STEP = 0.05;
    const MIN_PROPORTION = 0.1;
    const MAX_PROPORTION = 0.6;

    if (direction === "left") {
      // Shrink file tree, grow viewer
      const newFileTree = Math.max(MIN_PROPORTION, this.proportions.fileTree - STEP);
      const diff = this.proportions.fileTree - newFileTree;
      const newViewer = Math.min(MAX_PROPORTION, this.proportions.viewer + diff);

      this.proportions = {
        fileTree: newFileTree,
        terminal: 1 - newFileTree - newViewer,
        viewer: newViewer,
      };
    } else {
      // Grow file tree, shrink viewer
      const newFileTree = Math.min(MAX_PROPORTION, this.proportions.fileTree + STEP);
      const diff = newFileTree - this.proportions.fileTree;
      const newViewer = Math.max(MIN_PROPORTION, this.proportions.viewer - diff);

      this.proportions = {
        fileTree: newFileTree,
        terminal: 1 - newFileTree - newViewer,
        viewer: newViewer,
      };
    }

    this.applyProportions();
    this.onChangeCallback?.();
    window.dispatchEvent(new Event("resize"));
  }

  /**
   * Hide the viewer pane by setting its proportion to 0.
   */
  hideViewer(): void {
    if (this.proportions.viewer <= 0) return;
    this.savedViewerProportion = this.proportions.viewer;
    // Redistribute viewer space to terminal
    this.proportions.terminal += this.proportions.viewer;
    this.proportions.viewer = 0;
    this.applyProportions();
    this.onChangeCallback?.();
    window.dispatchEvent(new Event("resize"));
  }

  /**
   * Show the viewer pane by restoring its saved proportion.
   */
  showViewer(): void {
    if (this.savedViewerProportion === null || this.savedViewerProportion <= 0) {
      this.savedViewerProportion = DEFAULT_PROPORTIONS.viewer;
    }
    const restored = this.savedViewerProportion;
    // Take space from terminal
    this.proportions.terminal -= restored;
    this.proportions.viewer = restored;
    this.savedViewerProportion = null;
    this.applyProportions();
    this.onChangeCallback?.();
    window.dispatchEvent(new Event("resize"));
  }

  /**
   * Check if the viewer pane is visible.
   */
  isViewerVisible(): boolean {
    return this.proportions.viewer > 0;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    // Remove window resize listener
    if (this.boundHandleResize) {
      window.removeEventListener("resize", this.boundHandleResize);
      this.boundHandleResize = null;
    }

    // Clean up any active drag listeners (in case disposal happens during drag)
    if (this.boundOnDrag && this.boundEndDrag) {
      document.removeEventListener("mousemove", this.boundOnDrag);
      document.removeEventListener("mouseup", this.boundEndDrag);
      this.boundOnDrag = null;
      this.boundEndDrag = null;
    }

    // Clean up any pending RAF
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
