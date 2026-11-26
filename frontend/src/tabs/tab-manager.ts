/**
 * Tab state management with localStorage persistence.
 */

import { tabDisplayName } from "./session-title";
import { wrapIndex } from "@core/nav";
import { toWebSocketUrl } from "@core/platform/url-utils";
import { WebSocketClient } from "../platform/websocket";
import { buildTunnelArgs } from "../remote/profile-utils";
import type { EventHandler } from "../types";
import type { AppState, TabInfo, TabManagerEvents, TabState } from "./types";
import type { RemoteProfile } from "../remote/types";
import { arrangeByGroup, moveWithinRun, UNGROUPED, visibleTabs } from "./tab-groups";

const STORAGE_KEY = "cade-app-state";
const STATE_VERSION = 2;

/**
 * Saved state in the current shape, or null when it cannot be used. State
 * from before tab groups is carried over with no groups rather than dropped.
 */
export function migrateAppState(raw: unknown): AppState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const state = raw as Partial<AppState>;
  if (!Array.isArray(state.tabs)) return null;
  if (state.version !== 1 && state.version !== STATE_VERSION) return null;
  return {
    version: STATE_VERSION,
    tabs: state.tabs,
    activeTabId: typeof state.activeTabId === "string" ? state.activeTabId : "",
    collapsedGroups: Array.isArray(state.collapsedGroups)
      ? state.collapsedGroups.filter((g): g is string => typeof g === "string")
      : [],
  };
}

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
/**
 * Live sessions on the backend that this browser has no tab for yet: the
 * ones worth offering for adoption. Dead sessions are left out since
 * attaching to them would only spawn a replacement PTY.
 */
export function sessionsToAdopt<S extends { id: string; alive: boolean }>(
  sessions: S[],
  openTabIds: Iterable<string>,
): S[] {
  const open = new Set(openTabIds);
  return sessions.filter((s) => s.alive && !open.has(s.id));
}

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
  // The tab last active in each workspace, so that coming back to one
  // returns to where the user was. Ungrouped tabs are keyed by "".
  private lastTabInWorkspace = new Map<string, string>();
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
      for (const tabInfo of arrangeByGroup(state.tabs)) {
        const tabState = this.createTabState(tabInfo);
        this.tabs.set(tabInfo.id, tabState);
      }

      const activeId = state.activeTabId;
      if (this.tabs.has(activeId)) {
        this.activeTabId = activeId;
      } else {
        this.activeTabId = state.tabs[0]!.id;
      }
      this.rememberActive();

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
  createTab(
    projectPath: string,
    opts?: {
      initialPrompt?: string;
      chatHandoff?: string;
      group?: string;
      agent?: string;
      startAgent?: boolean;
      handoff?: string;
    },
  ): TabState {
    const id = generateId();
    const name = getProjectName(projectPath);

    const tabInfo: TabInfo = { id, projectPath, name };
    if (opts?.initialPrompt) tabInfo.initialPrompt = opts.initialPrompt;
    if (opts?.chatHandoff) tabInfo.chatHandoff = opts.chatHandoff;
    if (opts?.group) tabInfo.group = opts.group;
    if (opts?.agent) tabInfo.agent = opts.agent;
    if (opts?.startAgent) tabInfo.startAgent = true;
    if (opts?.handoff) tabInfo.handoff = opts.handoff;
    const tabState = this.createTabState(tabInfo);

    this.tabs.set(id, tabState);
    this.reorder(arrangeByGroup(this.getTabs()));
    this.saveState();

    this.emit("tab-created", tabState);
    this.emit("tabs-changed", this.getTabs());

    return tabState;
  }

  /**
   * Open a tab onto a session that already runs on the backend (created by
   * another device, or by this browser before its storage was cleared).
   * The tab id *is* the session id, so connecting attaches rather than
   * spawning a new PTY. Returns the existing tab if one is already open.
   */
  adoptSession(
    sessionId: string,
    projectPath: string,
    label?: string | null,
    group?: string | null,
  ): TabState {
    const existing = this.tabs.get(sessionId);
    if (existing) return existing;

    const name = label && label.trim() ? label.trim() : getProjectName(projectPath);
    const tabState = this.createTabState({
      id: sessionId,
      projectPath,
      name,
      // A label that differs from the folder name was chosen by someone.
      ...(name !== getProjectName(projectPath) && { customName: true }),
      ...(group && { group }),
    });

    this.tabs.set(sessionId, tabState);
    this.reorder(arrangeByGroup(this.getTabs()));
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
    projectPath?: string,
    group?: string,
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
      ...(group && { group }),
    };
    const tabState = this.createTabState(tabInfo, profile.authToken);
    if (tunnelPid !== undefined) {
      tabState.tunnelPid = tunnelPid;
    }

    this.tabs.set(id, tabState);
    this.reorder(arrangeByGroup(this.getTabs()));
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

    const closedGroup = this.tabs.get(id)?.group ?? null;
    this.tabs.delete(id);

    if (this.activeTabId === id) {
      const remaining = this.getTabs();
      // Stay in the workspace the closed tab was in while it has tabs left.
      const next =
        remaining.find((t) => (t.group ?? null) === closedGroup) ?? remaining[0] ?? null;
      this.activeTabId = next ? next.id : null;
      if (next) {
        this.rememberActive();
        this.emit("tab-switched", next);
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

    const before = this.getOpenWorkspace();
    this.activeTabId = id;
    this.rememberActive();
    this.saveState();
    this.emit("tab-switched", tab);
    // Moving to another workspace closes the one left and opens this one.
    if (this.getOpenWorkspace() !== before) this.emit("tabs-changed", this.getTabs());
  }

  /**
   * Switch to the next tab (cycling).
   */
  nextTab(): void {
    const tabs = this.getVisibleTabs();
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
    const tabs = this.getVisibleTabs();
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
    const tabs = this.getVisibleTabs();
    const tab = tabs[index];
    if (tab) {
      this.switchTab(tab.id);
    }
  }

  /**
   * Move a tab to a new position among the tabs it sits with: its group, or
   * the ungrouped tabs beside it. `toIndex` counts within that run.
   */
  moveTab(id: string, toIndex: number): void {
    const tabs = this.getTabs();
    const moved = moveWithinRun(tabs, id, toIndex);
    if (moved === tabs) return;
    this.reorder(moved);
    this.saveState();
    this.emit("tabs-changed", this.getTabs());
  }

  /** Tabs on show: those of the open workspace. */
  getVisibleTabs(): TabState[] {
    return visibleTabs(this.getTabs(), this.getCollapsedGroups());
  }

  /**
   * The workspace on show: the active tab's group, or null when that tab is
   * in none. Only one is open at a time, so that next, previous and numbered
   * tab keys stay inside it however many sessions are running.
   */
  getOpenWorkspace(): string | null {
    return this.getActiveTab()?.group ?? null;
  }

  /**
   * Every workspace but the open one, the ungrouped tabs counting as one
   * (UNGROUPED). Derived, so it cannot go stale.
   */
  getCollapsedGroups(): ReadonlySet<string> {
    const open = this.getOpenWorkspace();
    return new Set(
      this.getWorkspaces().filter((g) => g !== open).map((g) => g ?? UNGROUPED),
    );
  }

  /**
   * The stops when moving between workspaces, in tab bar order: each group,
   * and null for the ungrouped tabs when there are any.
   */
  getWorkspaces(): (string | null)[] {
    const seen = new Set<string | null>();
    for (const tab of this.getTabs()) seen.add(tab.group ?? null);
    return [...seen];
  }

  /**
   * Open a workspace, on the tab that was last active in it. Opening the one
   * already open changes nothing.
   */
  switchWorkspace(group: string | null): void {
    if (group === this.getOpenWorkspace() && this.activeTabId !== null) return;
    const members = this.getTabs().filter((t) => (t.group ?? null) === group);
    const remembered = this.lastTabInWorkspace.get(group ?? "");
    const target = members.find((t) => t.id === remembered) ?? members[0];
    if (target) this.switchTab(target.id);
  }

  /** The workspace `step` stops along from the open one, wrapping. */
  workspaceAt(step: number): string | null {
    const stops = this.getWorkspaces();
    if (stops.length === 0) return null;
    const at = Math.max(0, stops.indexOf(this.getOpenWorkspace()));
    return stops[wrapIndex(at, step, stops.length)] ?? null;
  }

  private rememberActive(): void {
    const active = this.getActiveTab();
    if (active) this.lastTabInWorkspace.set(active.group ?? "", active.id);
  }

  /** Names of the groups that hold at least one tab, in tab bar order. */
  getGroupNames(): string[] {
    const names = new Set<string>();
    for (const tab of this.tabs.values()) if (tab.group) names.add(tab.group);
    return [...names];
  }

  /**
   * Put a tab in a group, or take it out with null. It joins the end of the
   * group. Returns the tab when its group changed.
   */
  setTabGroup(id: string, group: string | null): TabState | null {
    const tab = this.tabs.get(id);
    const name = group?.trim() || null;
    if (!tab || (tab.group ?? null) === name) return null;

    const from = this.getTabs().findIndex((t) => t.id === id);
    const tabs = this.getTabs().filter((t) => t.id !== id);
    // The tab goes to the end of the group it joins, or just past the group
    // it leaves. With no such group on the bar it stays where it is.
    const anchor = name ?? tab.group ?? null;
    const last = tabs.map((t) => t.group ?? null).lastIndexOf(anchor);
    if (name === null) delete tab.group;
    else tab.group = name;
    tabs.splice(last !== -1 ? last + 1 : Math.min(from, tabs.length), 0, tab);
    this.reorder(arrangeByGroup(tabs));
    if (id === this.activeTabId) this.rememberActive();
    this.saveState();
    this.emit("tabs-changed", this.getTabs());
    return tab;
  }

  /**
   * Rename a group, merging into an existing group of the new name. Returns
   * the tabs that moved, whose sessions need telling.
   */
  renameGroup(group: string, name: string): TabState[] {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group) return [];
    const moved = this.getTabs().filter((t) => t.group === group);
    for (const tab of moved) tab.group = trimmed;
    this.reorder(arrangeByGroup(this.getTabs()));
    this.saveState();
    this.emit("tabs-changed", this.getTabs());
    return moved;
  }

  /** Take every tab out of a group. Returns the tabs that left it. */
  ungroup(group: string): TabState[] {
    const moved = this.getTabs().filter((t) => t.group === group);
    for (const tab of moved) delete tab.group;
    this.saveState();
    this.emit("tabs-changed", this.getTabs());
    return moved;
  }

  private reorder(tabs: TabState[]): void {
    // Map iteration order is insertion order, so rebuilding it is the reorder.
    this.tabs = new Map(tabs.map((t) => [t.id, t]));
  }

  /**
   * Give a tab a name of the user's choosing. Returns the tab when the name
   * changed; a blank or unchanged name is ignored.
   */
  renameTab(id: string, name: string): TabState | null {
    const tab = this.tabs.get(id);
    const trimmed = name.trim();
    if (!tab || !trimmed || trimmed === tabDisplayName(tab)) return null;
    tab.name = trimmed;
    tab.customName = true;
    this.saveState();
    this.emit("tabs-changed", this.getTabs());
    return tab;
  }

  /**
   * Record the session name the agent's terminal reports (null when it
   * reports none). Returns the tab when what it is called on screen changed.
   */
  setAgentTitle(id: string, title: string | null): TabState | null {
    const tab = this.tabs.get(id);
    if (!tab || (tab.agentTitle ?? null) === title) return null;
    const before = tabDisplayName(tab);
    if (title === null) delete tab.agentTitle;
    else tab.agentTitle = title;
    if (tabDisplayName(tab) === before) return null;
    this.emit("tabs-changed", this.getTabs());
    return tab;
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
      if (!tab.customName) tab.name = getProjectName(projectPath);
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

      return migrateAppState(JSON.parse(json));
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
      if (tab.customName) info.customName = true;
      if (tab.group) info.group = tab.group;
      if (tab.agent) info.agent = tab.agent;
      if (tab.handoff) info.handoff = tab.handoff;
      if (tab.isRemote !== undefined) info.isRemote = tab.isRemote;
      if (tab.remoteProfileId !== undefined) info.remoteProfileId = tab.remoteProfileId;
      if (tab.remoteUrl !== undefined) info.remoteUrl = tab.remoteUrl;
      return info;
    });

    const state: AppState = {
      version: STATE_VERSION,
      tabs,
      activeTabId: this.activeTabId ?? "",
      // Only groups that still have tabs, so the list cannot grow for ever.
      collapsedGroups: [...this.getCollapsedGroups()].filter((g) => g !== UNGROUPED),
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
