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

import { AgentOverviewPane, type AgentManager } from "../agents";
import type { PaneKeyHandler } from "../input/keybindings";
import { MarkdownViewer } from "../markdown/markdown";
import { NeovimPane } from "../neovim";
import type { Component } from "../types";
import type { WebSocketClient } from "../platform/websocket";

export type RightPaneMode = "markdown" | "neovim" | "agents";

export class RightPaneManager implements Component, PaneKeyHandler {
  private mode: RightPaneMode = "markdown";
  private viewer: MarkdownViewer;
  private neovimPane: NeovimPane | null = null;
  private agentPane: AgentOverviewPane | null = null;
  private neovimContainer: HTMLElement;
  private viewerContainer: HTMLElement;
  private agentsContainer: HTMLElement;
  private onModeChangeCallback: (() => void) | null = null;
  private onAgentSelectCallback: ((agentId: string) => void) | null = null;

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

    this.agentsContainer = document.createElement("div");
    this.agentsContainer.className = "right-pane-agents";
    this.agentsContainer.style.width = "100%";
    this.agentsContainer.style.height = "100%";
    this.agentsContainer.style.display = "none";

    this.container.appendChild(this.viewerContainer);
    this.container.appendChild(this.neovimContainer);
    this.container.appendChild(this.agentsContainer);

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

    // Use "" (not "block") to remove inline style and let CSS `display: flex` apply
    this.viewerContainer.style.display = mode === "markdown" ? "" : "none";
    this.neovimContainer.style.display = mode === "neovim" ? "" : "none";
    this.agentsContainer.style.display = mode === "agents" ? "" : "none";

    if (mode === "agents") {
      this.agentPane?.render();
    }

    this.onModeChangeCallback?.();
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
   * NOTE: Neovim pane is excluded — calling focus() on its xterm textarea
   * causes WebView2 to lose all keyboard input.  Neovim input is handled
   * entirely via key forwarding through the keybinding manager.
   */
  focus(): void {
    // Neovim: no-op (key forwarding handles input)
  }

  /**
   * Initialize the agent overview pane with an agent manager.
   */
  setAgentManager(agentManager: AgentManager): void {
    this.agentPane = new AgentOverviewPane(this.agentsContainer, this.ws, agentManager);
    this.agentPane.initialize();

    if (this.onAgentSelectCallback) {
      this.agentPane.onAgentSelect(this.onAgentSelectCallback);
    }
  }

  /**
   * Register callback for agent card clicks.
   */
  setOnAgentSelect(callback: (agentId: string) => void): void {
    this.onAgentSelectCallback = callback;
    this.agentPane?.onAgentSelect(callback);
  }

  /**
   * Get the agent overview pane.
   */
  getAgentPane(): AgentOverviewPane | null {
    return this.agentPane;
  }

  /**
   * Open a file in Neovim for editing, returning to the viewer on exit.
   */
  editFileInNeovim(filePath: string): void {
    // Show container BEFORE initializing xterm.js so terminal.open() renders
    // into a visible container with real dimensions (not 0×0).
    this.mode = "neovim";
    this.viewerContainer.style.display = "none";
    this.neovimContainer.style.display = "";
    this.agentsContainer.style.display = "none";

    this.ensureNeovimPane();

    this.neovimPane!.onExit(() => {
      this.setMode("markdown");
      this.viewer.refresh();
    });

    // Do NOT call focus() here. WebView2 loses ALL keyboard input when
    // focus() is called on xterm's hidden textarea — even from user gesture
    // context. Instead, the keybinding manager's capture handler delegates
    // keystrokes to NeovimPane.handleKeydown which forwards via WebSocket.

    // Defer fit+spawn to next animation frame so the browser has reflowed
    // the container after display:none→flex. Without this, proposeDimensions()
    // measures stale/zero heights and the PTY spawns at wrong size.
    requestAnimationFrame(() => {
      this.neovimPane!.fit();
      this.neovimPane!.spawnForFile(filePath);
    });
    this.onModeChangeCallback?.();
  }


  /**
   * Ensure NeovimPane exists without spawning a process.
   * Used by editFileInNeovim which handles spawning itself.
   */
  private ensureNeovimPane(): void {
    if (this.neovimPane != null) return;

    this.neovimPane = new NeovimPane(this.neovimContainer, this.ws);
    this.neovimPane.initialize();
  }

  dispose(): void {
    this.viewer.dispose();
    this.neovimPane?.dispose();
    this.agentPane?.dispose();
  }
}
