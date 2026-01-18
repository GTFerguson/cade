/**
 * Tab state management with localStorage persistence.
 */

import { config } from "../config";
import { WebSocketClient } from "../websocket";
import type { EventHandler } from "../types";
import type { AppState, TabInfo, TabManagerEvents, TabState } from "./types";

const STORAGE_KEY = "ccplus-app-state";
const STATE_VERSION = 1;

// Clear session state in dev-dummy mode for clean testing
const CLEAR_SESSION = import.meta.env.VITE_CLEAR_SESSION === "true";

/**
 * Generates a unique tab ID.
 */
function generateId(): string {
  return crypto.randomUUID();
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

export class TabManager {
  private tabs: Map<string, TabState> = new Map();
  private activeTabId: string | null = null;
  private handlers: Map<
    keyof TabManagerEvents,
    Set<EventHandler<TabManagerEvents[keyof TabManagerEvents]>>
  > = new Map();

  /**
   * Initialize the tab manager and restore state from localStorage.
   */
  async initialize(): Promise<void> {
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
   * Close a tab by ID.
   */
  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) {
      return;
    }

    tab.ws.disconnect();
    tab.context?.dispose();

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
    const nextIndex = (currentIndex + 1) % tabs.length;
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
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
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
  private createTabState(info: TabInfo): TabState {
    const ws = new WebSocketClient(config.wsUrl);

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
    const tabs: TabInfo[] = this.getTabs().map((tab) => ({
      id: tab.id,
      projectPath: tab.projectPath,
      name: tab.name,
    }));

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
