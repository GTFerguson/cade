/**
 * Per-project component container.
 *
 * Manages the DOM structure and components (Terminal, FileTree, MarkdownViewer)
 * for a single project tab.
 */

import { FileTree } from "../file-tree";
import { Layout } from "../layout";
import { MarkdownViewer } from "../markdown";
import { Terminal } from "../terminal";
import type { SessionState } from "../types";
import type { WebSocketClient } from "../websocket";
import type { ProjectContext as IProjectContext } from "./types";

export class ProjectContextImpl implements IProjectContext {
  readonly container: HTMLElement;
  private layout: Layout | null = null;
  private terminal: Terminal | null = null;
  private fileTree: FileTree | null = null;
  private viewer: MarkdownViewer | null = null;
  private saveTimeout: number | null = null;
  private pendingSession: SessionState | null = null;
  private isVisible = false;

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

    this.terminal = new Terminal(terminalEl, this.ws);
    this.terminal.initialize();

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

    this.ws.on("session-restored", (message) => {
      console.log(`[${this.name}] Session restored:`, message.sessionId);
      if (message.scrollback) {
        this.terminal?.reset();
        this.terminal?.write(message.scrollback);
      }
    });

    this.ws.on("connected", (message) => {
      console.log(`[${this.name}] Connected to server:`, message.workingDir);
      if (message.session != null) {
        this.pendingSession = message.session;
      }
    });

    this.ws.on("file-tree", () => {
      if (this.pendingSession != null) {
        this.restoreSession(this.pendingSession);
        this.pendingSession = null;
      }
    });

    this.ws.on("disconnected", () => {
      console.log(`[${this.name}] Disconnected from server`);
    });

    this.ws.on("error", (message) => {
      console.error(`[${this.name}] Server error:`, message.code, message.message);
    });

    this.hide();
  }

  /**
   * Show this project context.
   */
  show(): void {
    this.container.style.display = "block";
    this.isVisible = true;

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
   * Focus the terminal.
   */
  focus(): void {
    if (this.isVisible) {
      this.terminal?.focus();
    }
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

    this.terminal?.dispose();
    this.fileTree?.dispose();
    this.viewer?.dispose();
    this.layout?.dispose();

    this.container.remove();
  }
}
