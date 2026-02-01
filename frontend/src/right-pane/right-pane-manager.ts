/**
 * Modal right pane manager.
 *
 * Manages the right pane content, switching between modes:
 * - markdown: MarkdownViewer (default, existing)
 * - neovim: NeovimPane (renders Neovim TUI)
 *
 * Follows the same show/hide pattern as TerminalManager for
 * Claude/Manual terminal switching.
 */

import type { PaneKeyHandler } from "../input/keybindings";
import { MarkdownViewer } from "../markdown/markdown";
import { NeovimPane } from "../neovim";
import type { Component } from "../types";
import type { WebSocketClient } from "../platform/websocket";

export type RightPaneMode = "markdown" | "neovim";

export class RightPaneManager implements Component, PaneKeyHandler {
  private mode: RightPaneMode = "markdown";
  private viewer: MarkdownViewer;
  private neovimPane: NeovimPane | null = null;
  private neovimContainer: HTMLElement;
  private viewerContainer: HTMLElement;
  private onModeChangeCallback: (() => void) | null = null;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
  ) {
    // Create sub-containers so we can show/hide independently
    this.viewerContainer = document.createElement("div");
    this.viewerContainer.className = "right-pane-viewer";
    this.viewerContainer.style.width = "100%";
    this.viewerContainer.style.height = "100%";

    this.neovimContainer = document.createElement("div");
    this.neovimContainer.className = "right-pane-neovim";
    this.neovimContainer.style.width = "100%";
    this.neovimContainer.style.height = "100%";
    this.neovimContainer.style.display = "none";

    this.container.appendChild(this.viewerContainer);
    this.container.appendChild(this.neovimContainer);

    this.viewer = new MarkdownViewer(this.viewerContainer, this.ws);
  }

  initialize(): void {
    this.viewer.initialize();
  }

  /**
   * Get the current right pane mode.
   */
  getMode(): RightPaneMode {
    return this.mode;
  }

  /**
   * Switch to a specific mode.
   * Spawns Neovim on first switch to neovim mode.
   */
  setMode(mode: RightPaneMode): void {
    if (mode === this.mode) return;

    this.mode = mode;

    if (mode === "markdown") {
      this.viewerContainer.style.display = "block";
      this.neovimContainer.style.display = "none";
    } else if (mode === "neovim") {
      this.viewerContainer.style.display = "none";
      this.neovimContainer.style.display = "block";
      this.ensureNeovim();
    }

    this.onModeChangeCallback?.();
  }

  /**
   * Toggle between markdown and neovim modes.
   */
  toggleNeovim(): void {
    this.setMode(this.mode === "neovim" ? "markdown" : "neovim");
  }

  /**
   * PaneKeyHandler — delegates to the active mode's handler.
   */
  handleKeydown(e: KeyboardEvent): boolean {
    if (this.mode === "neovim" && this.neovimPane != null) {
      return this.neovimPane.handleKeydown(e);
    }

    // Markdown viewer's key handler
    return this.viewer.handleKeydown(e);
  }

  /**
   * Register callback for mode changes (for session persistence).
   */
  onModeChange(callback: () => void): void {
    this.onModeChangeCallback = callback;
  }

  /**
   * Get the MarkdownViewer (for backward compatibility with ProjectContext).
   */
  getViewer(): MarkdownViewer {
    return this.viewer;
  }

  /**
   * Get the NeovimPane (may be null if never activated).
   */
  getNeovimPane(): NeovimPane | null {
    return this.neovimPane;
  }

  /**
   * Focus the active mode's component.
   */
  focus(): void {
    if (this.mode === "neovim" && this.neovimPane != null) {
      this.neovimPane.focus();
    }
  }

  /**
   * Lazily create and spawn NeovimPane on first use.
   */
  private ensureNeovim(): void {
    if (this.neovimPane != null) {
      // Already created — just trigger fit in case container resized
      this.neovimPane.fit();
      if (!this.neovimPane.isReady()) {
        this.neovimPane.spawn();
      }
      return;
    }

    this.neovimPane = new NeovimPane(this.neovimContainer, this.ws);
    this.neovimPane.initialize();
    this.neovimPane.spawn();
  }

  dispose(): void {
    this.viewer.dispose();
    this.neovimPane?.dispose();
  }
}
