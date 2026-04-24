/**
 * Per-project component container.
 *
 * Manages the DOM structure and components (Terminal, FileTree, MarkdownViewer)
 * for a single project tab.
 */

import { AgentManager, type AgentState } from "../agents";
import { FileTree } from "../file-tree";
import type { PaneKeyHandler, PaneType } from "../input/keybindings";
import { wrapIndex } from "@core/nav";
import { Layout } from "../ui/layout";
import { MarkdownViewer } from "../markdown/markdown";
import { RightPaneManager, type RightPaneMode } from "../right-pane";
import { Splash } from "../ui/splash";
import { TerminalManager } from "../terminal/terminal-manager";
import type { CustomKeyHandler } from "../terminal/terminal";
import { ErrorCode } from "@core/platform/protocol";
import type { ConnectedMessage, PtyExitedMessage, SessionState } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import type { ProjectContext as IProjectContext } from "./types";
import { createDefaultRegistry } from "../dashboard/registry";

const PANE_ORDER: PaneType[] = ["file-tree", "terminal", "viewer"];

export type TabViewMode = "workspace" | "dashboard";

export class ProjectContextImpl implements IProjectContext {
  readonly container: HTMLElement;
  private layout: Layout | null = null;
  private terminalManager: TerminalManager | null = null;
  private agentManager: AgentManager | null = null;
  private fileTree: FileTree | null = null;
  private rightPane: RightPaneManager | null = null;
  private splash: Splash | null = null;
  private saveTimeout: number | null = null;
  private pendingSession: SessionState | null = null;
  private isVisible = false;
  private focusedPane: PaneType = "terminal";
  private viewMode: TabViewMode = "workspace";
  connectionId = "";
  private dashboardFullContainer: HTMLElement | null = null;
  private dashboardFullPane: import("../dashboard").DashboardPane | null = null;
  private boundHandlers = {
    startupStatus: (_msg: any) => {
      // Progress bar handles visual feedback; no per-message status updates
    },
    sessionRestored: (msg: any) => {
      console.log(`[${this.name}] Session restored:`, msg.sessionId, msg.sessionKey);
    },
    connected: (msg: ConnectedMessage) => {
      console.log(`[${this.name}] Connected to server:`, msg.workingDir);
      if (msg.connectionId) {
        this.connectionId = msg.connectionId;
        this.terminalManager?.getChatPane()?.setConnectionId(msg.connectionId);
      }
      if (msg.session != null) {
        this.pendingSession = msg.session;
      }
      if (this.splash?.isVisible()) {
        this.splash.setProgress(3, "starting shell");
      }

      // Switch to appropriate mode based on default provider type
      if (msg.providers && msg.defaultProvider) {
        const defaultProv = msg.providers.find(
          (p) => p.name === msg.defaultProvider,
        );
        if (defaultProv?.type === "claude-code") {
          this.terminalManager?.setEnhanced(true);
          const chatMode = msg.chatMode ?? "code";
          this.terminalManager?.getChatPane()?.setMode(chatMode);
        } else if (defaultProv?.type === "api") {
          this.terminalManager?.setMode("chat");
        }
      }

      // Seed the chat `/` completion list before the first chat turn.
      // The provider's SystemInfo event refreshes this on stream start,
      // but without seeding here there would be no hints until then.
      if (msg.slashCommands) {
        this.terminalManager?.getChatPane()?.setSlashCommands(msg.slashCommands);
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
      if (
        msg.code === ErrorCode.PTY_SPAWN_FAILED ||
        msg.code === ErrorCode.PTY_READ_FAILED ||
        msg.code === ErrorCode.PTY_EXITED
      ) {
        // Dismiss splash if still showing so the error is visible
        this.splash?.hide();
        this.terminalManager?.write(
          `\r\n\x1b[1;31mError: ${msg.message}\x1b[0m\r\n`
        );
        this.terminalManager?.focusAtBottom();
      }
    },
    ptyExited: (msg: PtyExitedMessage) => {
      console.error(`[${this.name}] PTY exited:`, msg.message);
    },
    authFailed: () => {
      console.warn(`[${this.name}] Authentication failed`);
      if (this.splash?.isVisible()) {
        this.splash.setProgress(0, "auth failed");
      }
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
   * @param skipSplash - Don't create a per-tab splash (start splash is already showing)
   */
  async initialize(skipSplash = false): Promise<void> {
    this.container.innerHTML = `
      <div class="app-container project-container">
        <div class="pane file-tree-pane"></div>
        <div class="resize-handle resize-handle-left"></div>
        <div class="pane terminal-pane"></div>
        <div class="resize-handle resize-handle-right"></div>
        <div class="pane viewer-pane"></div>
      </div>
      <div class="dashboard-full-container" style="display:none"></div>
    `;

    this.parentContainer.appendChild(this.container);

    this.dashboardFullContainer = this.container.querySelector(
      ".dashboard-full-container",
    ) as HTMLElement;

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

    // Create agent manager for worker agent terminals
    this.agentManager = new AgentManager(terminalEl, this.ws, null);
    this.agentManager.initialize();
    this.terminalManager.setAgentManager(this.agentManager);

    // Coordinate visibility when switching between primary and agents
    this.agentManager.onAgentSwitch((agentId) => {
      if (agentId != null) {
        this.terminalManager?.hidePrimary();
      } else {
        this.terminalManager?.showPrimary();
      }
      this.terminalManager?.updateStatusIndicator();
      this.rightPane?.getAgentPane()?.setActiveAgent(agentId);
    });

    // Create splash overlay in terminal pane (skipped when start splash is active)
    if (!skipSplash) {
      this.splash = new Splash(terminalEl);
      this.splash.setLoading();

      // Dismiss on first shell output, chat stream, or file tree load
      // (enhanced mode doesn't emit output until user sends a message)
      const dismissSplash = () => {
        this.ws.off("output", dismissSplash);
        this.ws.off("chat-stream", dismissSplash);
        this.ws.off("file-tree", dismissSplash);
        this.splash?.setProgress(4, "ready");
        this.splash?.hide();

        if (this.terminalManager?.getMode() === "chat") {
          this.terminalManager?.getChatPane()?.focus();
        } else {
          this.terminalManager?.focusAtBottom();
        }

        // PTY spawn on Windows can steal OS-level focus from the WebView2.
        // Reclaim it once the shell is ready.
        if ((window as any).__TAURI__ === true) {
          import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
            getCurrentWindow().setFocus();
          }).catch(() => {});
        }
      };
      this.ws.on("output", dismissSplash);
      this.ws.on("chat-stream", dismissSplash);
      this.ws.on("file-tree", dismissSplash);
    }

    // Sync focusedPane when user clicks on a pane (fixes desync where
    // focusedPane stays on file-tree/viewer after clicking the terminal)
    fileTreeEl.addEventListener("mousedown", () => this.focusPane("file-tree"));
    terminalEl.addEventListener("mousedown", () => this.focusPane("terminal"));
    viewerEl.addEventListener("mousedown", () => this.focusPane("viewer"));

    this.fileTree = new FileTree(fileTreeEl, this.ws);
    this.fileTree.initialize();

    this.rightPane = new RightPaneManager(viewerEl, this.ws);
    this.rightPane.initialize();
    this.rightPane.getViewer().setProjectPath(this.projectPath);

    // Wire agent overview pane in the right pane
    this.rightPane.setAgentManager(this.agentManager);
    this.rightPane.setOnAgentSelect((agentId) => {
      this.agentManager?.switchToAgent(agentId);
    });

    // Wire dashboard pane in the right pane
    const { DashboardPane } = await import("../dashboard");
    const dashboardPane = new DashboardPane(
      (this.rightPane as any).dashboardContainer,
      this.ws,
    );
    dashboardPane.initialize();
    this.rightPane.setDashboardPane(dashboardPane);

    // Full-width dashboard pane (for dashboard tab mode)
    if (this.dashboardFullContainer) {
      this.dashboardFullPane = new DashboardPane(
        this.dashboardFullContainer,
        this.ws,
      );
      this.dashboardFullPane.initialize();

      // Click file in dashboard → switch to workspace, open in viewer
      this.dashboardFullPane.onViewFile((path, meta) => {
        this.setViewMode("workspace");
        this.rightPane?.setMode("markdown");
        const viewer = this.rightPane?.getViewer();
        if (viewer) {
          viewer.setDashboardReturn(() => {
            viewer.setDashboardReturn(null);
            viewer.setPreview(null);
            this.setViewMode("dashboard");
          });
          viewer.setPreview(buildPreviewEl(meta));
          viewer.loadFile(path, meta);
        }
      });
    }

    // Also wire the right-pane dashboard's view-file handler
    dashboardPane.onViewFile((path, meta) => {
      this.rightPane?.setMode("markdown");
      const viewer = this.rightPane?.getViewer();
      if (viewer) {
        viewer.setDashboardReturn(() => {
          viewer.setDashboardReturn(null);
          viewer.setPreview(null);
          this.rightPane?.setMode("dashboard");
        });
        viewer.setPreview(buildPreviewEl(meta));
        viewer.loadFile(path, meta);
      }
    });

    this.fileTree.on("file-select", (path) => {
      this.rightPane?.setMode("markdown");
      const viewer = this.rightPane?.getViewer();
      if (viewer) {
        viewer.setDashboardReturn(null);
        viewer.loadFile(path);
      }
      this.scheduleSave();
    });

    this.fileTree.onExpandChange(() => {
      this.scheduleSave();
    });

    this.terminalManager.setOnOpenFile((rawPath) => {
      const path = this.resolveAndFindFile(rawPath);
      this.rightPane?.setMode("markdown");
      const viewer = this.rightPane?.getViewer();
      if (viewer) {
        viewer.setDashboardReturn(null);
        viewer.loadFile(path);
        this.fileTree?.revealFile(path);
      }
    });

    this.rightPane.getViewer().on("link-click", async (path) => {
      this.rightPane?.setMode("markdown");
      let meta: Record<string, unknown> | undefined;
      if (/content\/worlds\/(?!.*-map\.json)[^/]+\.json$/.test(path)) {
        const mapPath = path.replace(/\.json$/, "-map.json");
        try {
          const mapContent = await this.ws.readFileAsync(mapPath);
          meta = { preview: { component: "graph", data: JSON.parse(mapContent) } };
        } catch { /* no map file — open world without map */ }
      }
      this.rightPane?.getViewer().loadFile(path, meta);
      this.fileTree?.revealFile(path);
      this.scheduleSave();
    });

    this.rightPane.getViewer().on("edit-in-neovim", (path) => {
      this.rightPane?.editFileInNeovim(path);
    });

    this.rightPane.onModeChange(() => {
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
    this.ws.on("pty-exited", this.boundHandlers.ptyExited);
    this.ws.on("auth-failed", this.boundHandlers.authFailed);

    // Agent lifecycle events
    this.ws.on("agent-spawned", (msg) => {
      this.agentManager?.createAgent(msg.agentId, msg.name, "worker", msg.task);
      // Auto-switch to the new agent tab (fires after user approved the spawn)
      this.agentManager?.switchToAgent(msg.agentId);
      this.terminalManager?.updateStatusIndicator();
      this.rightPane?.getAgentPane()?.render();
      // Show agent overview in right pane
      this.rightPane?.setMode("agents");
    });
    this.ws.on("agent-killed", (msg) => {
      this.agentManager?.destroyAgent(msg.agentId);
      this.terminalManager?.updateStatusIndicator();
      this.rightPane?.getAgentPane()?.render();
    });
    this.ws.on("agent-state-changed", (msg) => {
      this.agentManager?.updateAgentState(msg.agentId, msg.state as AgentState);
      this.terminalManager?.updateStatusIndicator();
      this.rightPane?.getAgentPane()?.render();
    });

    // Dashboard events — feed both right-pane and full-width dashboard
    this.ws.on("dashboard-config", (msg) => {
      this.rightPane?.getDashboardPane()?.setConfig(msg.config);
      this.dashboardFullPane?.setConfig(msg.config);
    });
    this.ws.on("dashboard-data", (msg) => {
      this.rightPane?.getDashboardPane()?.setData(msg.sources);
      this.dashboardFullPane?.setData(msg.sources);
    });
    this.ws.on("dashboard-cleared", () => {
      this.rightPane?.getDashboardPane()?.clearConfig();
      this.dashboardFullPane?.clearConfig();
    });
    this.ws.on("dashboard-focus-view", (msg) => {
      this.rightPane?.getDashboardPane()?.focusView(msg.view_id);
      this.dashboardFullPane?.focusView(msg.view_id);
    });
    this.ws.on("dashboard-hide-view", (msg) => {
      this.rightPane?.getDashboardPane()?.hideView(msg.view_id);
      this.dashboardFullPane?.hideView(msg.view_id);
    });

    // Agent-pushed panels
    this.ws.on("dashboard-push-panel", (msg) => {
      this.rightPane?.getDashboardPane()?.pushAgentPanel(msg.panel, msg.data);
      this.dashboardFullPane?.pushAgentPanel(msg.panel, msg.data);
    });

    // Notifications
    this.ws.on("notification", (msg) => {
      this.showNotification(msg.message, msg.style);
    });

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
   * Returns "chat" instead of "terminal" when enhanced CC mode is active
   * so keystrokes are delegated to the chat pane's handler.
   */
  getFocusedPane(): PaneType {
    if (this.focusedPane === "terminal" &&
        this.terminalManager?.isEnhanced() &&
        this.terminalManager?.getMode() === "chat") {
      return "chat";
    }
    return this.focusedPane;
  }

  /**
   * Focus a specific pane.
   */
  focusPane(pane: PaneType): void {
    // "chat" is a derived pane type — store as "terminal" internally
    this.focusedPane = pane === "chat" ? "terminal" : pane;
    this.updatePaneFocusVisual();

    if (pane === "terminal" || pane === "chat") {
      this.terminalManager?.focus();
    } else {
      // Blur terminal and chat so keystrokes reach the newly focused pane
      this.terminalManager?.blurTerminal();
      this.terminalManager?.blurChat();
      if (pane === "file-tree") {
        this.fileTree?.focus();
      }
    }
  }

  /**
   * Cycle focus to an adjacent pane.
   * Direction "left" moves focus left, "right" moves right.
   */
  cycleFocus(direction: "left" | "right"): void {
    const currentIndex = PANE_ORDER.indexOf(this.focusedPane);
    const delta = direction === "left" ? -1 : 1;
    const newIndex = wrapIndex(currentIndex, delta, PANE_ORDER.length);
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
   * Get the keyboard handler for a specific pane.
   */
  getPaneHandler(pane: PaneType): PaneKeyHandler | null {
    switch (pane) {
      case "file-tree":
        return this.fileTree;
      case "viewer":
        return this.rightPane;
      case "chat":
        return this.terminalManager?.getChatPane() ?? null;
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
    return this.rightPane?.getViewer() ?? null;
  }

  /**
   * Get the right pane manager.
   */
  getRightPane(): RightPaneManager | null {
    return this.rightPane;
  }


  /**
   * Set the right pane mode directly.
   */
  setRightPaneMode(mode: RightPaneMode): void {
    this.rightPane?.setMode(mode);
  }

  /**
   * Get the current tab view mode.
   */
  getViewMode(): TabViewMode {
    return this.viewMode;
  }

  /**
   * Toggle between workspace (3-pane) and full-width dashboard mode.
   */
  setViewMode(mode: TabViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;

    const workspace = this.container.querySelector(".app-container") as HTMLElement | null;

    if (mode === "dashboard") {
      if (workspace) workspace.style.display = "none";
      if (this.dashboardFullContainer) this.dashboardFullContainer.style.display = "";
    } else {
      if (workspace) workspace.style.display = "";
      if (this.dashboardFullContainer) this.dashboardFullContainer.style.display = "none";
      // Re-sync layout after showing workspace
      this.layout?.syncProportions();
      window.dispatchEvent(new Event("resize"));
    }
  }

  /**
   * Toggle between workspace and dashboard view modes.
   */
  toggleViewMode(): void {
    const hasDashboard = this.dashboardFullPane?.hasConfig() ?? false;
    if (!hasDashboard) return;
    this.setViewMode(this.viewMode === "workspace" ? "dashboard" : "workspace");
  }

  /**
   * Check if full-width dashboard is available.
   */
  hasDashboard(): boolean {
    return this.dashboardFullPane?.hasConfig() ?? false;
  }

  /**
   * Show a toast notification.
   */
  private showNotification(message: string, style: string = "info"): void {
    const toast = document.createElement("div");
    toast.className = `dash-notification dash-notification--${style}`;
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
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
   * Switch center pane to a specific agent, or null for primary.
   */
  switchToAgent(agentId: string | null): void {
    this.agentManager?.switchToAgent(agentId);
  }

  /**
   * Cycle through agents.
   */
  cycleAgent(direction: "next" | "prev"): void {
    this.agentManager?.cycleAgent(direction);
  }

  /**
   * Get the agent manager.
   */
  getAgentManager(): AgentManager | null {
    return this.agentManager;
  }

  /**
   * Handle keyboard-triggered agent approval (prefix+y).
   * Context-dependent: approves an agent report if viewing that agent,
   * otherwise approves the most recent pending spawn in the primary chat.
   */
  handleAgentApprove(): void {
    // If viewing an agent in "review" state, approve its report
    const activeState = this.agentManager?.getActiveAgentState();
    const activeId = this.agentManager?.getActiveAgentId();
    if (activeId && activeState === "review") {
      this.ws.sendAgentApproveReport(activeId);
      return;
    }

    const chatPane = this.terminalManager?.getChatPane();
    if (!chatPane) return;

    // Check for pending report review first
    const reportAgentId = chatPane.getPendingReportAgentId();
    if (reportAgentId) {
      chatPane.approveReport(reportAgentId);
      return;
    }

    // Otherwise, approve pending spawn
    const spawnAgentId = chatPane.getPendingApprovalAgentId();
    if (spawnAgentId) {
      chatPane.approveSpawn(spawnAgentId);
    }
  }

  /**
   * Handle keyboard-triggered agent rejection (prefix+n).
   */
  handleAgentReject(): void {
    const activeState = this.agentManager?.getActiveAgentState();
    const activeId = this.agentManager?.getActiveAgentId();
    if (activeId && activeState === "review") {
      this.ws.sendAgentRejectReport(activeId);
      return;
    }

    const chatPane = this.terminalManager?.getChatPane();
    if (!chatPane) return;

    const reportAgentId = chatPane.getPendingReportAgentId();
    if (reportAgentId) {
      chatPane.rejectReport(reportAgentId);
      return;
    }

    const spawnAgentId = chatPane.getPendingApprovalAgentId();
    if (spawnAgentId) {
      chatPane.rejectSpawn(spawnAgentId);
    }
  }

  /**
   * Restore session state.
   */
  private async restoreSession(session: SessionState): Promise<void> {
    if (session.expandedPaths != null && this.fileTree != null) {
      this.fileTree.setExpandedPaths(session.expandedPaths);
      await this.fileTree.loadExpandedChildren();
    }

    if (session.layout != null && this.layout != null) {
      this.layout.setProportions(session.layout);
    }

    if (session.viewerPath != null && this.rightPane != null) {
      this.rightPane.getViewer().loadFile(session.viewerPath);
      this.fileTree?.revealFile(session.viewerPath);
    }
  }

  /**
   * Build current session state.
   */
  private buildSessionState(): Partial<SessionState> {
    return {
      expandedPaths: this.fileTree?.getExpandedPaths() ?? [],
      viewerPath: this.rightPane?.getViewer().getCurrentPath() ?? null,
      layout: this.layout?.getProportions() ?? null,
    };
  }

  /**
   * Resolve a raw file path from a chat link to the best loadable path.
   *
   * Handles: absolute paths within the project (strips prefix), relative paths,
   * and fuzzy recovery when the file isn't in the known file tree.
   */
  private resolveAndFindFile(rawPath: string): string {
    // Normalize: strip projectPath prefix from absolute paths
    let normalized = rawPath;
    const base = this.projectPath.endsWith("/")
      ? this.projectPath
      : this.projectPath + "/";
    if (rawPath.startsWith(base)) {
      normalized = rawPath.slice(base.length);
    } else if (rawPath.startsWith("./")) {
      normalized = rawPath.slice(2);
    }

    const knownPaths = this.fileTree?.getFilePaths() ?? [];
    if (knownPaths.length === 0) return normalized;

    // Exact match first
    if (knownPaths.some((p) => p === normalized || p === rawPath)) {
      return knownPaths.find((p) => p === normalized || p === rawPath)!;
    }

    // Fuzzy: find paths that end with the normalized suffix
    const matches = knownPaths.filter((p) => {
      const rel = p.startsWith(base) ? p.slice(base.length) : p;
      return rel === normalized || rel.endsWith("/" + normalized);
    });

    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      // Prefer the shortest path (fewest extra parent dirs)
      return matches.reduce((a, b) => (a.length <= b.length ? a : b));
    }

    return normalized;
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
    this.ws.off("pty-exited", this.boundHandlers.ptyExited);
    this.ws.off("auth-failed", this.boundHandlers.authFailed);

    try {
      this.agentManager?.dispose();
      this.terminalManager?.dispose();
    } catch (e) {
      // xterm throws if terminal was never fully initialized (e.g. auth
      // failed before the terminal attached to the DOM)
      console.warn(`[${this.name}] Error disposing terminal:`, e);
    }
    this.fileTree?.dispose();
    this.rightPane?.dispose();
    this.dashboardFullPane?.dispose();
    this.layout?.dispose();

    this.container.remove();
  }
}

/**
 * Build an HTMLElement preview from view_file meta, if meta carries a
 * `preview: { component, data }` payload. Returns null when absent.
 */
function buildPreviewEl(meta: Record<string, unknown> | undefined): HTMLElement | null {
  if (!meta) return null;
  const preview = meta["preview"] as Record<string, unknown> | undefined;
  if (!preview) return null;

  const componentName = String(preview["component"] ?? "");
  const data = preview["data"];
  if (!componentName || data == null) return null;

  const registry = createDefaultRegistry();
  if (!registry.has(componentName)) return null;

  const el = document.createElement("div");
  el.className = "viewer-preview";
  try {
    const comp = registry.create(componentName);
    const rowData = typeof data === "object" && !Array.isArray(data)
      ? [data as Record<string, unknown>]
      : [];
    comp.render(el, {
      panel: {
        component: componentName,
        fields: [],
        columns: [],
        badges: [],
        filter: {},
        sortable: false,
        filterable: [],
        searchable: [],
        inline_edit: [],
        options: {},
        extra: {},
      },
      data: rowData,
      allData: {},
      config: { dashboard: { title: "" }, data_sources: {}, views: [], stats: [] },
      onAction: () => {},
    });
  } catch {
    return null;
  }
  return el;
}
