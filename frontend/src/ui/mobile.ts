/**
 * Mobile UI coordinator for CADE.
 *
 * Manages the touch toolbar and full-pane screen stack.
 * Each screen (command menu, file explorer, file viewer) is a
 * MobileScreen pushed onto the ScreenManager.
 */

import type { Component, FileChangeMessage } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import { TouchToolbar } from "./touch-toolbar";
import { ScreenManager } from "./mobile/screen-manager";
import { CommandMenu, type OverflowTab } from "./mobile/command-menu";
import { FileExplorer } from "./mobile/file-explorer";
import { FileViewer } from "./mobile/file-viewer";

const MOBILE_BREAKPOINT = 768;

export interface MobileUICallbacks {
  sendInput: (data: string) => void;
  getTabs: () => OverflowTab[];
  onSwitchTab: (id: string) => void;
  getActiveWs: () => WebSocketClient;
  onTheme: () => void;
  getCurrentThemeName: () => string;
}

export class MobileUI implements Component {
  private hasUpdate = false;
  private lastChangedPath: string | null = null;
  private currentPath: string | null = null;

  private toolbar: TouchToolbar | null = null;
  private screenManager: ScreenManager;

  /** Track the active FileViewer so file-content events can update it */
  private activeViewer: FileViewer | null = null;

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

    if (MobileUI.isMobile()) {
      this.initializeToolbar();
    }

    window.addEventListener("resize", () => this.updateVisibility());
    this.updateVisibility();
  }

  private initializeToolbar(): void {
    this.toolbar = new TouchToolbar(
      (data) => this.callbacks.sendInput(data),
      () => this.openCommandMenu(),
    );
    this.toolbar.initialize();
  }

  private setupWebSocketListeners(): void {
    this.ws.on("file-change", (message: FileChangeMessage) => {
      if (message.path.endsWith(".md")) {
        this.showUpdateIndicator(message.path);
      }
    });

    this.ws.on("file-content", (message) => {
      if (!MobileUI.isMobile()) return;

      this.currentPath = message.path;

      // If a file viewer is currently on top, update it
      if (this.activeViewer) {
        this.activeViewer.showFile(
          message.path,
          message.content,
          message.fileType
        );
      }
    });
  }

  private updateVisibility(): void {
    const isMobile = MobileUI.isMobile();

    if (isMobile && !this.toolbar) {
      this.initializeToolbar();
    } else if (!isMobile && this.toolbar) {
      this.toolbar.hide();
    } else if (isMobile && this.toolbar) {
      this.toolbar.show();
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
      this.focusTerminal();
      return;
    }

    const menu = new CommandMenu({
      getTabs: () => this.callbacks.getTabs(),
      onSwitchTab: (id) => {
        this.screenManager.popToRoot();
        this.activeViewer = null;
        this.callbacks.onSwitchTab(id);
        this.focusTerminal();
      },
      onFiles: () => this.openFileExplorer(),
      onViewer: () => this.openFileViewer(),
      onReconnect: () => {
        this.screenManager.popToRoot();
        this.activeViewer = null;
        const ws = this.callbacks.getActiveWs();
        ws.disconnect();
        ws.connect();
      },
      onTheme: () => this.callbacks.onTheme(),
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
    this.clearUpdateIndicator();
  }

  private openFileExplorer(): void {
    const explorer = new FileExplorer({
      getActiveWs: () => this.callbacks.getActiveWs(),
      onFileSelect: (path: string) => {
        // Request file content then push viewer
        const ws = this.callbacks.getActiveWs();
        const viewer = new FileViewer({
          onBack: () => {
            this.screenManager.pop();
            this.activeViewer = null;
          },
        });
        this.activeViewer = viewer;
        this.screenManager.push(viewer);
        ws.requestFile(path);
      },
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
    const viewer = new FileViewer({
      onBack: () => {
        this.screenManager.pop();
        this.activeViewer = null;
      },
    });
    this.activeViewer = viewer;
    this.screenManager.push(viewer);

    // Load current/last-changed file
    const ws = this.callbacks.getActiveWs();
    if (this.hasUpdate && this.lastChangedPath !== null) {
      ws.requestFile(this.lastChangedPath);
      this.clearUpdateIndicator();
    } else if (this.currentPath !== null) {
      ws.requestFile(this.currentPath);
    } else {
      viewer.showEmpty();
    }
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
  }
}
