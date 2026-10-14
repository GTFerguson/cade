/**
 * Mobile UI coordinator for CADE.
 *
 * Manages the touch toolbar and full-pane screen stack.
 * Each screen (command menu, file explorer, file viewer) is a
 * MobileScreen pushed onto the ScreenManager.
 */

import type { Component, FileChangeMessage, LiveSessionInfo } from "../types";
import { sessionsToAdopt } from "../tabs/tab-manager";
import type { WebSocketClient } from "../platform/websocket";
import { TouchToolbar } from "./touch-toolbar";
import { ScreenManager } from "./mobile/screen-manager";
import { CommandMenu, type OverflowTab } from "./mobile/command-menu";
import { FileExplorer } from "./mobile/file-explorer";
import { FileViewer } from "./mobile/file-viewer";
import { DashboardScreen } from "./mobile/dashboard-screen";
import { SessionStrip, neighbourTab, type StripTab } from "./mobile/session-strip";
import { FileSearch } from "./mobile/file-search";
import { RecentFiles, recordChange, type RecentChange } from "./mobile/recent-files";
import { setupPinchZoom } from "./mobile/pinch-zoom";
import { disablePush, enablePush, getPushState, type PushState } from "../push";
import {
  getTerminalFontSize,
  onTerminalFontSizeChange,
  setTerminalFontSize,
  stepTerminalFontSize,
} from "../terminal/font-size";

const MOBILE_BREAKPOINT = 768;

export interface MobileUICallbacks {
  sendInput: (data: string) => void;
  /** A prompt from the composer: pasted as a block, then Enter. */
  sendComposed: (text: string) => void;
  /** On-screen keyboard opened or closed; the terminal locks its rows while open. */
  setKeyboardOpen: (open: boolean) => void;
  onRepaint: () => void;
  getTabs: () => OverflowTab[];
  onSwitchTab: (id: string) => void;
  /** Ids of tabs already open here, so live sessions can be offered once. */
  getOpenTabIds: () => string[];
  /** Open a tab onto a session that already runs on the backend. */
  onAdoptSession: (session: LiveSessionInfo) => void;
  getActiveWs: () => WebSocketClient;
  onTheme: () => void;
  getCurrentThemeName: () => string;
  /** Active tab's `.dashboard-full-container`, or null if none. */
  getDashboardContainer: () => HTMLElement | null;
  /** Whether the active tab has a dashboard config loaded. */
  dashboardHasConfig: () => boolean;
}

export class MobileUI implements Component {
  private hasUpdate = false;
  private lastChangedPath: string | null = null;
  private currentPath: string | null = null;

  private toolbar: TouchToolbar | null = null;
  private screenManager: ScreenManager;

  /** Track the active FileViewer so file-content events can update it */
  private activeViewer: FileViewer | null = null;

  /** Live sessions on the backend, refreshed each time the menu opens. */
  private liveSessions: LiveSessionInfo[] = [];
  private activeMenu: CommandMenu | null = null;

  private strip: SessionStrip | null = null;
  private cleanupPinch: (() => void) | null = null;
  private unsubscribeFontSize: (() => void) | null = null;

  /** Files changed on disk this session, newest first. */
  private recentChanges: RecentChange[] = [];
  private activeSearch: FileSearch | null = null;
  private pushState: PushState | "…" = "…";
  /** Agent adapter id from the connected payload, shown in the strip. */
  private agentLabel: string | null = null;

  constructor(
    private ws: WebSocketClient,
    private callbacks: MobileUICallbacks,
  ) {
    this.screenManager = new ScreenManager();
  }

  static isMobile(): boolean {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  initialize(): void {
    this.setupWebSocketListeners();
    // The viewer reads at the same size as the terminal.
    const applyViewerFont = (px: number) =>
      document.documentElement.style.setProperty("--mobile-code-font-size", `${px}px`);
    applyViewerFont(getTerminalFontSize());
    this.unsubscribeFontSize = onTerminalFontSizeChange(applyViewerFont);

    if (MobileUI.isMobile()) {
      this.initializeToolbar();
    }

    window.addEventListener("resize", () => this.updateVisibility());
    this.updateVisibility();
  }

  private initializeToolbar(): void {
    this.toolbar = new TouchToolbar({
      sendInput: (data) => this.callbacks.sendInput(data),
      sendComposed: (text) => this.callbacks.sendComposed(text),
      onCmd: () => this.openCommandMenu(),
      onFontStep: (direction) => stepTerminalFontSize(direction),
      onRepaint: () => this.callbacks.onRepaint(),
      onKeyboardChange: (open) => this.callbacks.setKeyboardOpen(open),
    });
    this.toolbar.initialize();

    if (!this.strip) {
      this.strip = new SessionStrip({
        onSwitchRelative: (direction) => this.switchRelative(direction),
        onOpenMenu: () => this.openCommandMenu(),
      });
      document.body.appendChild(this.strip.element);
    }
    this.strip.show();
    this.refresh();

    // Pinch anywhere on the tab content to change the terminal font size.
    const pane = document.getElementById("tab-content");
    if (pane && !this.cleanupPinch) {
      this.cleanupPinch = setupPinchZoom(pane, {
        getSize: () => getTerminalFontSize(),
        onSize: (px) => setTerminalFontSize(px),
      });
    }
  }

  private pushLabel(): string {
    switch (this.pushState) {
      case "on": return "push on";
      case "off": return "push off";
      case "denied": return "blocked in browser";
      case "unsupported": return "install to home screen first";
      default: return "…";
    }
  }

  private async togglePush(): Promise<void> {
    if (this.pushState === "…" || this.pushState === "unsupported" || this.pushState === "denied") {
      return;
    }
    const wasOn = this.pushState === "on";
    this.pushState = "…";
    this.activeMenu?.refresh();
    this.pushState = await (wasOn ? disablePush() : enablePush());
    this.activeMenu?.refresh();
  }

  /** Re-render the session strip from the current tab list. */
  refresh(): void {
    if (!this.strip || !MobileUI.isMobile()) return;
    const tabs: StripTab[] = this.callbacks.getTabs().map((t) => ({
      id: t.id,
      name: t.name,
      isActive: t.isActive,
      unread: t.unread ?? false,
      attention: t.attention ?? null,
    }));
    this.strip.render(tabs, this.agentLabel);
  }

  private switchRelative(direction: 1 | -1): void {
    const target = neighbourTab(this.callbacks.getTabs(), direction);
    if (!target) return;
    this.screenManager.popToRoot();
    this.activeViewer = null;
    this.activeMenu = null;
    this.callbacks.onSwitchTab(target.id);
  }

  private setupWebSocketListeners(): void {
    this.ws.on("connected", (message) => {
      this.agentLabel = message.cliAgent?.displayName ?? message.cliAgent?.id ?? null;
      this.refresh();
    });

    this.ws.on("file-change", (message: FileChangeMessage) => {
      this.recentChanges = recordChange(this.recentChanges, {
        path: message.path,
        event: message.event,
        at: Date.now(),
      });
      if (message.path.endsWith(".md")) {
        this.showUpdateIndicator(message.path);
      }
    });

    this.ws.on("file-list", (message) => {
      this.activeSearch?.setFiles(message.files, message.truncated);
    });

    this.ws.on("file-diff", (message) => {
      this.activeViewer?.showDiff(message.path, message.diff, message.untracked, message.error);
    });

    this.ws.on("file-content", (message) => {
      if (!MobileUI.isMobile()) return;

      this.currentPath = message.path;

      // If a file viewer is currently on top, update it
      if (this.activeViewer) {
        this.activeViewer.showFile(
          message.path,
          message.content,
          message.fileType,
          { encoding: message.encoding, size: message.size, mime: message.mime },
        );
      }
    });

    // Dashboard config/data arriving while on mobile flags the [cmd]
    // button so the user can open it from the command menu. The dot is
    // cleared when the command menu opens (clearUpdateIndicator).
    const flagDashboard = () => {
      if (MobileUI.isMobile()) this.toolbar?.showCmdIndicator();
    };
    this.ws.on("dashboard-config", flagDashboard);
    this.ws.on("dashboard-data", flagDashboard);

    this.ws.on("session-list", (message) => {
      this.liveSessions = message.sessions;
      this.activeMenu?.refresh();
    });
  }

  private updateVisibility(): void {
    const isMobile = MobileUI.isMobile();

    if (isMobile && !this.toolbar) {
      this.initializeToolbar();
    } else if (!isMobile && this.toolbar) {
      this.toolbar.hide();
      this.strip?.hide();
    } else if (isMobile && this.toolbar) {
      this.toolbar.show();
      this.strip?.show();
      this.refresh();
    }

    // Close all screens when resizing to desktop
    if (!isMobile && this.screenManager.depth > 0) {
      this.screenManager.popToRoot();
      this.activeViewer = null;
    }
  }

  // ─── Screen navigation ───────────────────────────────

  private openCommandMenu(): void {
    // Toggle: if menu is already open, close it
    if (this.screenManager.depth > 0) {
      this.screenManager.popToRoot();
      this.activeViewer = null;
      this.activeMenu = null;
      this.focusTerminal();
      return;
    }

    const menu = new CommandMenu({
      getTabs: () => this.callbacks.getTabs(),
      onSwitchTab: (id) => {
        this.screenManager.popToRoot();
        this.activeViewer = null;
        this.activeMenu = null;
        this.callbacks.onSwitchTab(id);
        this.focusTerminal();
      },
      getLiveSessions: () =>
        sessionsToAdopt(this.liveSessions, this.callbacks.getOpenTabIds()),
      onAdoptSession: (session) => {
        this.screenManager.popToRoot();
        this.activeViewer = null;
        this.activeMenu = null;
        this.callbacks.onAdoptSession(session);
        this.focusTerminal();
      },
      onFiles: () => this.openFileExplorer(),
      onSearch: () => this.openFileSearch(),
      onRecent: () => this.openRecentFiles(),
      getRecentCount: () => this.recentChanges.length,
      onViewer: () => this.openFileViewer(),
      onDashboard: () => this.openDashboard(),
      isDashboardAvailable: () => this.callbacks.dashboardHasConfig(),
      onReconnect: () => {
        this.screenManager.popToRoot();
        this.activeViewer = null;
        const ws = this.callbacks.getActiveWs();
        ws.disconnect();
        ws.connect();
      },
      onTheme: () => this.callbacks.onTheme(),
      getPushState: () => this.pushLabel(),
      onTogglePush: () => void this.togglePush(),
      onBack: () => {
        this.screenManager.pop();
        this.activeViewer = null;
        this.focusTerminal();
      },
      getCurrentFileName: () => {
        if (!this.currentPath) return null;
        return this.currentPath.split("/").pop() ?? this.currentPath;
      },
      getCurrentThemeName: () => this.callbacks.getCurrentThemeName(),
    });

    this.screenManager.push(menu);
    this.activeMenu = menu;
    this.clearUpdateIndicator();
    void getPushState().then((state) => {
      this.pushState = state;
      this.activeMenu?.refresh();
    });
    // Ask for the backend's live sessions; the menu re-renders on reply.
    const ws = this.callbacks.getActiveWs();
    if (ws.isConnected()) ws.requestSessionList();
  }

  /** Push a viewer for `path` (or an empty one) and request its content. */
  private pushViewer(path: string | null): FileViewer {
    const ws = this.callbacks.getActiveWs();
    const viewer = new FileViewer({
      onBack: () => {
        this.screenManager.pop();
        this.activeViewer = null;
      },
      onRequestDiff: (p) => ws.requestFileDiff(p),
    });
    this.activeViewer = viewer;
    this.screenManager.push(viewer);
    if (path !== null) ws.requestFile(path);
    else viewer.showEmpty();
    return viewer;
  }

  private openFileSearch(): void {
    const search = new FileSearch({
      requestFiles: () => this.callbacks.getActiveWs().requestFileList(),
      onFileSelect: (path) => this.pushViewer(path),
      onBack: () => {
        this.screenManager.pop();
        this.activeSearch = null;
      },
    });
    this.activeSearch = search;
    this.screenManager.push(search);
  }

  private openRecentFiles(): void {
    const recent = new RecentFiles({
      getChanges: () => this.recentChanges,
      onFileSelect: (path) => this.pushViewer(path),
      onBack: () => this.screenManager.pop(),
    });
    this.screenManager.push(recent);
  }

  private openFileExplorer(): void {
    const explorer = new FileExplorer({
      getActiveWs: () => this.callbacks.getActiveWs(),
      onFileSelect: (path: string) => this.pushViewer(path),
      onBack: () => {
        this.screenManager.pop();
      },
      getProjectPath: () => {
        const tabs = this.callbacks.getTabs();
        const active = tabs.find((t) => t.isActive);
        return active?.projectPath ?? "~";
      },
    });

    this.screenManager.push(explorer);
  }

  private openFileViewer(): void {
    // Load current/last-changed file
    if (this.hasUpdate && this.lastChangedPath !== null) {
      this.pushViewer(this.lastChangedPath);
      this.clearUpdateIndicator();
    } else {
      this.pushViewer(this.currentPath);
    }
  }

  private openDashboard(): void {
    const screen = new DashboardScreen({
      getContainer: () => this.callbacks.getDashboardContainer(),
      onBack: () => {
        this.screenManager.pop();
        this.focusTerminal();
      },
    });
    this.screenManager.push(screen);
  }

  private focusTerminal(): void {
    // Dispatch resize so xterm re-fits, then focus the terminal
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
  }

  // ─── Notification indicator ───────────────────────────

  showUpdateIndicator(path: string): void {
    if (!MobileUI.isMobile()) return;
    this.hasUpdate = true;
    this.lastChangedPath = path;
    this.toolbar?.showCmdIndicator();
  }

  private clearUpdateIndicator(): void {
    this.hasUpdate = false;
    this.toolbar?.clearCmdIndicator();
  }

  dispose(): void {
    this.screenManager.dispose();
    this.activeViewer = null;
    this.toolbar?.dispose();
    this.cleanupPinch?.();
    this.cleanupPinch = null;
    this.unsubscribeFontSize?.();
    this.unsubscribeFontSize = null;
    this.strip?.dispose();
    this.strip = null;
  }
}
