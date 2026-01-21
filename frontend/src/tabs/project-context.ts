/**
 * Per-project component container.
 *
 * Manages the DOM structure and components (Terminal, FileTree, MarkdownViewer)
 * for a single project tab.
 */

import { FileTree } from "../file-tree";
import type { PaneKeyHandler, PaneType } from "../keybindings";
import { Layout } from "../layout";
import { MarkdownViewer } from "../markdown";
import { Splash } from "../splash";
import { TerminalManager } from "../terminal-manager";
import type { CustomKeyHandler } from "../terminal";
import type { ConnectedMessage, SessionState } from "../types";
import type { WebSocketClient } from "../websocket";
import type { ProjectContext as IProjectContext } from "./types";

const PANE_ORDER: PaneType[] = ["file-tree", "terminal", "viewer"];

export class ProjectContextImpl implements IProjectContext {
  readonly container: HTMLElement;
  private layout: Layout | null = null;
  private terminalManager: TerminalManager | null = null;
  private fileTree: FileTree | null = null;
  private viewer: MarkdownViewer | null = null;
  private splash: Splash | null = null;
  private saveTimeout: number | null = null;
  private pendingSession: SessionState | null = null;
  private isVisible = false;
  private focusedPane: PaneType = "terminal";
  private boundHandlers = {
    startupStatus: (msg: any) => {
      if (this.splash?.isVisible()) {
        this.splash.setStatus(msg.message);
      }
    },
    sessionRestored: (msg: any) => {
      console.log(`[${this.name}] Session restored:`, msg.sessionId, msg.sessionKey);
    },
    connected: (msg: ConnectedMessage) => {
      console.log(`[${this.name}] Connected to server:`, msg.workingDir);
      if (msg.session != null) {
        this.pendingSession = msg.session;
      }
      if (this.splash?.isVisible()) {
        const shouldSkip = this.shouldSkipSplash(msg);
        if (shouldSkip) {
          this.splash.autoSkip(() => this.terminalManager?.focus());
        } else {
          this.splash.setReady(() => this.terminalManager?.focus());
        }
      }
    },
    fileTree: () => {
      if (this.pendingSession != null) {
        this.restoreSession(this.pendingSession);
        this.pendingSession = null;
      }
    },
    disconnected: () => {
      console.log(`[${this.name}] Disconnected from server`);
    },
    error: (msg: any) => {
      console.error(`[${this.name}] Server error:`, msg.code, msg.message);
    },
  };

  constructor(
    readonly id: string,
    readonly projectPath: string,
    readonly name: string,
    private ws: WebSocketClient,
    private parentContainer: HTMLElement
  ) {
    this.container = document.createElement("div");
    this.container.className = "project-context";
    this.container.dataset["projectId"] = id;
  }

  /**
   * Initialize the project context and its components.
   */
  async initialize(): Promise<void> {
    this.container.innerHTML = `
      <div class="app-container project-container">
        <div class="pane file-tree-pane"></div>
        <div class="resize-handle resize-handle-left"></div>
        <div class="pane terminal-pane"></div>
        <div class="resize-handle resize-handle-right"></div>
        <div class="pane viewer-pane"></div>
      </div>
    `;

    this.parentContainer.appendChild(this.container);

    const appContainer = this.container.querySelector(
      ".app-container"
    ) as HTMLElement;

    this.layout = new Layout(appContainer);
    this.layout.initialize();

    const fileTreeEl = this.container.querySelector(
      ".file-tree-pane"
    ) as HTMLElement;
    const terminalEl = this.container.querySelector(
      ".terminal-pane"
    ) as HTMLElement;
    const viewerEl = this.container.querySelector(
      ".viewer-pane"
    ) as HTMLElement;

    this.terminalManager = new TerminalManager(terminalEl, this.ws);
    this.terminalManager.initialize();

    // Create splash overlay in terminal pane
    this.splash = new Splash(terminalEl);

    this.fileTree = new FileTree(fileTreeEl, this.ws);
    this.fileTree.initialize();

    this.viewer = new MarkdownViewer(viewerEl, this.ws);
    this.viewer.initialize();

    this.fileTree.on("file-select", (path) => {
      this.viewer?.loadFile(path);
      this.scheduleSave();
    });

    this.fileTree.onExpandChange(() => {
      this.scheduleSave();
    });

    this.viewer.on("link-click", (path) => {
      this.viewer?.loadFile(path);
      this.fileTree?.revealFile(path);
      this.scheduleSave();
    });

    this.layout.onChange(() => {
      this.scheduleSave();
    });

    this.ws.on("startup-status", this.boundHandlers.startupStatus);
    this.ws.on("session-restored", this.boundHandlers.sessionRestored);
    this.ws.on("connected", this.boundHandlers.connected);
    this.ws.on("file-tree", this.boundHandlers.fileTree);
    this.ws.on("disconnected", this.boundHandlers.disconnected);
    this.ws.on("error", this.boundHandlers.error);

    this.hide();
  }

  /**
   * Show this project context.
   */
  show(): void {
    this.container.style.display = "block";
    this.isVisible = true;

    this.layout?.syncProportions();

    window.dispatchEvent(new Event("resize"));
  }

  /**
   * Hide this project context.
   */
  hide(): void {
    this.container.style.display = "none";
    this.isVisible = false;
  }

  /**
   * Focus the terminal (default focus action).
   */
  focus(): void {
    if (this.isVisible) {
      this.focusPane("terminal");
    }
  }

  /**
   * Get the currently focused pane type.
   */
  getFocusedPane(): PaneType {
    return this.focusedPane;
  }

  /**
   * Focus a specific pane.
   */
  focusPane(pane: PaneType): void {
    this.focusedPane = pane;
    this.updatePaneFocusVisual();

    if (pane === "terminal") {
      this.terminalManager?.focus();
    }
  }

  /**
   * Cycle focus to an adjacent pane.
   * Direction "left" moves focus left, "right" moves right.
   */
  cycleFocus(direction: "left" | "right"): void {
    const currentIndex = PANE_ORDER.indexOf(this.focusedPane);
    const delta = direction === "left" ? -1 : 1;
    const newIndex =
      (currentIndex + delta + PANE_ORDER.length) % PANE_ORDER.length;
    const newPane = PANE_ORDER[newIndex];
    if (newPane) {
      this.focusPane(newPane);
    }
  }

  /**
   * Update visual indicators for focused pane.
   */
  private updatePaneFocusVisual(): void {
    const fileTreePane = this.container.querySelector(".file-tree-pane");
    const terminalPane = this.container.querySelector(".terminal-pane");
    const viewerPane = this.container.querySelector(".viewer-pane");

    fileTreePane?.classList.toggle("pane-focused", this.focusedPane === "file-tree");
    terminalPane?.classList.toggle("pane-focused", this.focusedPane === "terminal");
    viewerPane?.classList.toggle("pane-focused", this.focusedPane === "viewer");
  }

  /**
   * Determine if splash screen should be skipped based on session state.
   */
  private shouldSkipSplash(message: ConnectedMessage): boolean {
    const splash = message.config?.behavior?.splash;
    const mode = splash?.mode ?? "auto";

    if (mode === "always") return false;
    if (mode === "never") return true;

    // "auto" mode logic
    if (!message.sessionRestored) return false;
    if (!message.wslHealthy) return false;

    const idleThreshold = splash?.idleThreshold ?? 1800;
    return (message.idleSeconds ?? 0) < idleThreshold;
  }

  /**
   * Get the keyboard handler for a specific pane.
   */
  getPaneHandler(pane: PaneType): PaneKeyHandler | null {
    switch (pane) {
      case "file-tree":
        return this.fileTree;
      case "viewer":
        return this.viewer;
      default:
        return null;
    }
  }

  /**
   * Get the layout instance for resize operations.
   */
  getLayout(): Layout | null {
    return this.layout;
  }

  /**
   * Get the markdown viewer instance.
   */
  getViewer(): MarkdownViewer | null {
    return this.viewer;
  }

  /**
   * Get the terminal manager for scroll operations.
   */
  getTerminalManager(): TerminalManager | null {
    return this.terminalManager;
  }

  /**
   * Set a custom key handler for the terminal.
   */
  setTerminalKeyHandler(handler: CustomKeyHandler | null): void {
    this.terminalManager?.setCustomKeyHandler(handler);
  }

  /**
   * Toggle between Claude and Manual terminals.
   */
  toggleTerminal(): void {
    this.terminalManager?.toggle();
  }

  /**
   * Restore session state.
   */
  private restoreSession(session: SessionState): void {
    if (session.expandedPaths != null && this.fileTree != null) {
      this.fileTree.setExpandedPaths(session.expandedPaths);
    }

    if (session.layout != null && this.layout != null) {
      this.layout.setProportions(session.layout);
    }

    if (session.viewerPath != null && this.viewer != null) {
      this.viewer.loadFile(session.viewerPath);
      this.fileTree?.revealFile(session.viewerPath);
    }
  }

  /**
   * Build current session state.
   */
  private buildSessionState(): Partial<SessionState> {
    return {
      expandedPaths: this.fileTree?.getExpandedPaths() ?? [],
      viewerPath: this.viewer?.getCurrentPath() ?? null,
      layout: this.layout?.getProportions() ?? null,
    };
  }

  /**
   * Schedule a debounced session save.
   */
  private scheduleSave(): void {
    if (this.saveTimeout != null) {
      window.clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      this.saveTimeout = null;
      this.saveSessionNow();
    }, 500);
  }

  /**
   * Save session immediately.
   */
  private saveSessionNow(): void {
    if (this.saveTimeout != null) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.ws.saveSession(this.buildSessionState());
  }

  /**
   * Dispose of all components and resources.
   */
  dispose(): void {
    if (this.saveTimeout != null) {
      window.clearTimeout(this.saveTimeout);
    }

    this.saveSessionNow();

    // Unregister WebSocket handlers
    this.ws.off("startup-status", this.boundHandlers.startupStatus);
    this.ws.off("session-restored", this.boundHandlers.sessionRestored);
    this.ws.off("connected", this.boundHandlers.connected);
    this.ws.off("file-tree", this.boundHandlers.fileTree);
    this.ws.off("disconnected", this.boundHandlers.disconnected);
    this.ws.off("error", this.boundHandlers.error);

    this.terminalManager?.dispose();
    this.fileTree?.dispose();
    this.viewer?.dispose();
    this.layout?.dispose();

    this.container.remove();
  }
}
