/**
 * Tab state management with localStorage persistence.
 */

import { wrapIndex } from "@core/nav";
import { toWebSocketUrl } from "@core/platform/url-utils";
import { WebSocketClient } from "../platform/websocket";
import { buildTunnelArgs } from "../remote/profile-utils";
import type { EventHandler } from "../types";
import type { AppState, TabInfo, TabManagerEvents, TabState } from "./types";
import type { RemoteProfile } from "../remote/types";

const STORAGE_KEY = "cade-app-state";
const STATE_VERSION = 1;

// Clear session state in dev-dummy mode for clean testing
const CLEAR_SESSION = import.meta.env.VITE_CLEAR_SESSION === "true";

/**
 * Generates a unique tab ID.
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain HTTP)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Extracts the folder name from a path.
 */
function getProjectName(path: string): string {
  if (path === "." || path === "") {
    return "Project";
  }
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Check whether another tab sharing the same remote profile is already
 * connected. Used to suppress redundant auth dialogs when a stale tab
 * fires auth-failed but the user already authenticated on a sibling tab.
 */
export function hasConnectedProfileTab(
  tabs: { id: string; remoteProfileId?: string; isConnected: boolean }[],
  excludeTabId: string,
  profileId: string,
): boolean {
  return tabs.some(
    (t) => t.id !== excludeTabId && t.remoteProfileId === profileId && t.isConnected,
  );
}

export class TabManager {
  private tabs: Map<string, TabState> = new Map();
  private activeTabId: string | null = null;
  private handlers: Map<
    keyof TabManagerEvents,
    Set<EventHandler<TabManagerEvents[keyof TabManagerEvents]>>
  > = new Map();
  // Evaluated at call time so it works even if Tauri injects
  // window.__TAURI__ after this class is constructed
  private get isTauri(): boolean {
    return typeof window !== "undefined" && (window as any).__TAURI__ === true;
  }

  constructor() {}

  /**
   * Initialize the tab manager (doesn't auto-restore - user chooses via splash).
   */
  async initialize(): Promise<void> {
    // Don't auto-restore - let user choose from splash screen
  }

  /**
   * Check if there's a saved session available to restore.
   */
  hasSavedSession(): boolean {
    const state = this.loadState();
    return state !== null && state.tabs.length > 0;
  }

  /**
   * Restore tabs from saved session.
   */
  async restoreSession(): Promise<void> {
    const state = this.loadState();

    if (state && state.tabs.length > 0) {
      for (const tabInfo of state.tabs) {
        const tabState = this.createTabState(tabInfo);
        this.tabs.set(tabInfo.id, tabState);
      }

      const activeId = state.activeTabId;
      if (this.tabs.has(activeId)) {
        this.activeTabId = activeId;
      } else {
        this.activeTabId = state.tabs[0]!.id;
      }

      this.emit("tabs-changed", this.getTabs());
    }
  }

  /**
   * Get all tabs.
   */
  getTabs(): TabState[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Get the active tab.
   */
  getActiveTab(): TabState | null {
    if (this.activeTabId === null) {
      return null;
    }
    return this.tabs.get(this.activeTabId) ?? null;
  }

  /**
   * Get the active tab ID.
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Check if there are any tabs.
   */
  hasTabs(): boolean {
    return this.tabs.size > 0;
  }

  /**
   * Create a new tab for a project.
   */
  createTab(projectPath: string): TabState {
    const id = generateId();
    const name = getProjectName(projectPath);

    const tabInfo: TabInfo = { id, projectPath, name };
    const tabState = this.createTabState(tabInfo);

    this.tabs.set(id, tabState);
    this.saveState();

    this.emit("tab-created", tabState);
    this.emit("tabs-changed", this.getTabs());

    return tabState;
  }

  /**
   * Create a new remote tab for a project.
   */
  async createRemoteTab(
    profile: RemoteProfile,
    projectPath?: string
  ): Promise<TabState> {
    if (!this.isTauri && profile.connectionType === "ssh-tunnel") {
      throw new Error(
        "SSH tunnels require the desktop app. " +
        "Either use the desktop app or edit this profile to use direct connection."
      );
    }

    const id = generateId();
    const path = projectPath || profile.defaultPath || "/";
    const name = `${profile.name}: ${getProjectName(path)}`;

    let tunnelPid: number | undefined;

    if (this.isTauri && profile.connectionType === "ssh-tunnel") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const args = buildTunnelArgs(profile);
        tunnelPid = await invoke<number>("start_ssh_tunnel", args);
        console.log(`SSH tunnel started: PID ${tunnelPid}`);

        // Probe the tunnel until it's forwarding (or timeout after 10s)
        // mode: "no-cors" avoids CORS rejection — an opaque response still
        // proves the tunnel is forwarding, while connection refused throws
        const probeUrl = `http://localhost:${profile.localPort}`;
        const deadline = Date.now() + 10_000;
        let tunnelReady = false;

        while (Date.now() < deadline) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 1500);
            await fetch(probeUrl, {
              method: "HEAD",
              mode: "no-cors",
              signal: controller.signal,
            });
            clearTimeout(timer);
            tunnelReady = true;
            break;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        }

        if (!tunnelReady) {
          console.warn("SSH tunnel probe timed out, proceeding anyway");
        }
      } catch (error) {
        console.error("Failed to start SSH tunnel:", error);
        throw new Error(`SSH tunnel failed: ${error}`);
      }
    }

    const tabInfo: TabInfo = {
      id,
      projectPath: path,
      name,
      isRemote: true,
      remoteProfileId: profile.id,
      remoteUrl: profile.url,
    };
    const tabState = this.createTabState(tabInfo, profile.authToken);
    if (tunnelPid !== undefined) {
      tabState.tunnelPid = tunnelPid;
    }

    this.tabs.set(id, tabState);
    this.saveState();

    this.emit("tab-created", tabState);
    this.emit("tabs-changed", this.getTabs());

    return tabState;
  }

  /**
   * Create a remote tab using an existing WebSocket connection.
   * Used when the connection was already established (e.g., for browsing).
   */
  async createRemoteTabWithWebSocket(
    profile: RemoteProfile,
    projectPath: string,
    ws: WebSocketClient,
    tunnelPid?: number
  ): Promise<TabState> {
    const id = generateId();
    const path = projectPath || profile.defaultPath || "/";
    const name = `${profile.name}: ${getProjectName(path)}`;

    const tabInfo: TabInfo = {
      id,
      projectPath: path,
      name,
      isRemote: true,
      remoteProfileId: profile.id,
      remoteUrl: profile.url,
    };

    // Use the provided WebSocket instead of creating a new one
    const tabState: TabState = {
      ...tabInfo,
      ws,
      context: null,
      isConnected: false,
    };
    if (tunnelPid !== undefined) {
      tabState.tunnelPid = tunnelPid;
    }

    this.tabs.set(id, tabState);
    this.saveState();

    this.emit("tab-created", tabState);
    this.emit("tabs-changed", this.getTabs());

    return tabState;
  }

  /**
   * Close a tab by ID.
   */
  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) {
      return;
    }

    tab.ws.disconnect();
    tab.context?.dispose();

    if (this.isTauri && tab.tunnelPid && tab.remoteProfileId) {
      const otherTabsUsingTunnel = Array.from(this.tabs.values()).filter(
        t => t.id !== id &&
             t.remoteProfileId === tab.remoteProfileId &&
             t.tunnelPid === tab.tunnelPid
      );

      if (otherTabsUsingTunnel.length === 0) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("stop_ssh_tunnel", {
            tunnelPid: tab.tunnelPid,
          });
          console.log(`SSH tunnel stopped: PID ${tab.tunnelPid}`);
        } catch (error) {
          console.error("Failed to stop SSH tunnel:", error);
        }
      }
    }

    this.tabs.delete(id);

    if (this.activeTabId === id) {
      const remaining = this.getTabs();
      this.activeTabId = remaining.length > 0 ? remaining[0]!.id : null;
      if (this.activeTabId) {
        const newActive = this.tabs.get(this.activeTabId);
        if (newActive) {
          this.emit("tab-switched", newActive);
        }
      }
    }

    this.saveState();
    this.emit("tab-closed", id);
    this.emit("tabs-changed", this.getTabs());
  }

  /**
   * Switch to a tab by ID.
   */
  switchTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || this.activeTabId === id) {
      return;
    }

    this.activeTabId = id;
    this.saveState();
    this.emit("tab-switched", tab);
  }

  /**
   * Switch to the next tab (cycling).
   */
  nextTab(): void {
    const tabs = this.getTabs();
    if (tabs.length <= 1) {
      return;
    }

    const currentIndex = tabs.findIndex((t) => t.id === this.activeTabId);
    const nextIndex = wrapIndex(currentIndex, 1, tabs.length);
    const nextTab = tabs[nextIndex];
    if (nextTab) {
      this.switchTab(nextTab.id);
    }
  }

  /**
   * Switch to the previous tab (cycling).
   */
  previousTab(): void {
    const tabs = this.getTabs();
    if (tabs.length <= 1) {
      return;
    }

    const currentIndex = tabs.findIndex((t) => t.id === this.activeTabId);
    const prevIndex = wrapIndex(currentIndex, -1, tabs.length);
    const prevTab = tabs[prevIndex];
    if (prevTab) {
      this.switchTab(prevTab.id);
    }
  }

  /**
   * Switch to a tab by index (0-9).
   */
  goToTab(index: number): void {
    const tabs = this.getTabs();
    const tab = tabs[index];
    if (tab) {
      this.switchTab(tab.id);
    }
  }

  /**
   * Update a tab's connection status.
   */
  setConnected(id: string, connected: boolean): void {
    const tab = this.tabs.get(id);
    if (tab) {
      tab.isConnected = connected;
    }
  }

  /**
   * Update a tab's project path and name (called when server confirms working dir).
   */
  updateTabPath(id: string, projectPath: string): void {
    const tab = this.tabs.get(id);
    if (tab) {
      tab.projectPath = projectPath;
      tab.name = getProjectName(projectPath);
      this.saveState();
      this.emit("tabs-changed", this.getTabs());
    }
  }

  /**
   * Register an event handler.
   */
  on<K extends keyof TabManagerEvents>(
    event: K,
    handler: EventHandler<TabManagerEvents[K]>
  ): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers
      .get(event)!
      .add(handler as EventHandler<TabManagerEvents[keyof TabManagerEvents]>);
  }

  /**
   * Remove an event handler.
   */
  off<K extends keyof TabManagerEvents>(
    event: K,
    handler: EventHandler<TabManagerEvents[K]>
  ): void {
    this.handlers
      .get(event)
      ?.delete(handler as EventHandler<TabManagerEvents[keyof TabManagerEvents]>);
  }

  /**
   * Emit an event.
   */
  private emit<K extends keyof TabManagerEvents>(
    event: K,
    data: TabManagerEvents[K]
  ): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in TabManager ${event} handler:`, e);
      }
    });
  }

  /**
   * Create a TabState from TabInfo.
   */
  private createTabState(info: TabInfo, authToken?: string): TabState {
    const ws = info.remoteUrl
      ? new WebSocketClient(
          toWebSocketUrl(info.remoteUrl),
          authToken,
          // Restored remote tabs have no auth token and no SSH tunnel —
          // skip retries so the recovery modal appears immediately
          authToken ? undefined : 0
        )
      : new WebSocketClient();

    return {
      ...info,
      ws,
      context: null,
      isConnected: false,
    };
  }

  /**
   * Load state from localStorage.
   */
  private loadState(): AppState | null {
    // Clear session state in dev-dummy mode for clean testing
    if (CLEAR_SESSION) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    try {
      const json = localStorage.getItem(STORAGE_KEY);
      if (!json) {
        return null;
      }

      const state = JSON.parse(json) as AppState;

      if (state.version !== STATE_VERSION) {
        return null;
      }

      return state;
    } catch {
      return null;
    }
  }

  /**
   * Save state to localStorage.
   */
  private saveState(): void {
    const tabs: TabInfo[] = this.getTabs().map((tab) => {
      const info: TabInfo = {
        id: tab.id,
        projectPath: tab.projectPath,
        name: tab.name,
      };
      if (tab.isRemote !== undefined) info.isRemote = tab.isRemote;
      if (tab.remoteProfileId !== undefined) info.remoteProfileId = tab.remoteProfileId;
      if (tab.remoteUrl !== undefined) info.remoteUrl = tab.remoteUrl;
      return info;
    });

    const state: AppState = {
      version: STATE_VERSION,
      tabs,
      activeTabId: this.activeTabId ?? "",
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save tab state:", e);
    }
  }

  /**
   * Dispose of all tabs and resources.
   */
  dispose(): void {
    for (const tab of this.tabs.values()) {
      tab.ws.disconnect();
      tab.context?.dispose();
    }
    this.tabs.clear();
    this.handlers.clear();
  }
}
