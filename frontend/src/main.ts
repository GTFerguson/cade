/**
 * Main entry point for CADE frontend.
 */

import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/vs2015.css";
import "../styles/main.css";

import { basePath, config } from "./config/config";
import { HelpOverlay } from "./ui/help-overlay";
import { KeybindingManager } from "./input/keybindings";
import { MobileUI } from "./ui/mobile";
import { ProjectContextImpl, TabBar, TabManager } from "./tabs";
import { hasConnectedProfileTab } from "./tabs/tab-manager";
import type { TabState } from "./tabs";
import { pickProjectFolder, getUserHomePath } from "./platform/tauri-bridge";
import { setUserConfig, getUserConfig, matchesKeybinding } from "./config/user-config";
import { RemoteProfileManager } from "./remote/profile-manager";
import { RemoteConnectionModal } from "./remote/RemoteConnectionModal";
import { AuthTokenDialog } from "./remote/AuthTokenDialog";
import { Splash } from "./ui/splash";
import type { RemoteProfile } from "./remote/types";

class App {
  private tabManager: TabManager;
  private tabBar: TabBar | null = null;
  private mobileUI: MobileUI | null = null;
  private tabContentContainer: HTMLElement | null = null;
  private defaultProjectPath: string;
  private keybindingManager: KeybindingManager;
  private helpOverlay: HelpOverlay;
  private profileManager: RemoteProfileManager;
  private activeAuthDialogs = new Set<string>();
  private startSplash: Splash | null = null;

  constructor() {
    this.tabManager = new TabManager();
    this.defaultProjectPath = this.getDefaultProjectPath();
    this.keybindingManager = new KeybindingManager();
    this.helpOverlay = new HelpOverlay();
    this.profileManager = new RemoteProfileManager();
  }

  /**
   * Get the default project path from config or use a fallback.
   */
  private getDefaultProjectPath(): string {
    const searchParams = new URLSearchParams(window.location.search);
    const pathParam = searchParams.get("project");
    if (pathParam) {
      return pathParam;
    }
    return getUserHomePath() ?? config.defaultProjectPath ?? ".";
  }

  /**
   * Initialize the application.
   */
  async initialize(): Promise<void> {
    const tabBarContainer = document.getElementById("tab-bar");
    if (tabBarContainer == null) {
      throw new Error("Tab bar container not found");
    }

    this.tabContentContainer = document.getElementById("tab-content");
    if (this.tabContentContainer == null) {
      throw new Error("Tab content container not found");
    }

    // Initialize keybinding manager and help overlay FIRST
    // This ensures event listeners are ready before any other UI components
    this.keybindingManager.initialize();
    this.helpOverlay.initialize();

    this.tabBar = new TabBar(tabBarContainer);
    this.tabBar.initialize();

    await this.tabManager.initialize();

    this.tabBar.on("tab-select", (id) => {
      this.tabManager.switchTab(id);
    });

    this.tabBar.on("tab-close", (id) => {
      this.handleTabClose(id);
    });

    this.tabBar.on("tab-add", () => {
      this.handleAddTab();
    });

    this.tabBar.on("tab-add-remote", () => {
      console.log("[CADE] tab-add-remote event received in main.ts");
      this.handleAddRemoteTab();
    });

    this.tabManager.on("tab-created", (tab) => {
      this.initializeTabContext(tab);
      this.initMobileUIIfNeeded();
    });

    this.tabManager.on("tab-switched", (tab) => {
      this.handleTabSwitch(tab);
    });

    this.tabManager.on("tabs-changed", (tabs) => {
      this.tabBar?.render(tabs, this.tabManager.getActiveTabId());
      if (tabs.length === 0) {
        this.showStartSplash();
      } else {
        this.hideStartSplash();
      }
    });

    if (!this.tabManager.hasTabs()) {
      this.showStartSplash();
    } else {
      const tabs = this.tabManager.getTabs();
      for (const tab of tabs) {
        await this.initializeTabContext(tab);
      }
      this.tabBar.render(tabs, this.tabManager.getActiveTabId());

      const restoredActiveTab = this.tabManager.getActiveTab();
      if (restoredActiveTab) {
        this.handleTabSwitch(restoredActiveTab);
      }
    }

    this.initMobileUIIfNeeded();

    // Set up keybinding callbacks (manager already initialized above)
    this.keybindingManager.setCallbacks({
      focusPane: (direction) => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.cycleFocus(direction);
      },
      resizePane: (direction) => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.getLayout()?.adjustByKeyboard(direction);
      },
      nextTab: () => {
        this.tabManager.nextTab();
      },
      previousTab: () => {
        this.tabManager.previousTab();
      },
      goToTab: (index) => {
        this.tabManager.goToTab(index);
      },
      createTab: () => {
        this.handleAddTab();
      },
      createRemoteTab: () => {
        this.handleAddRemoteTab();
      },
      closeTab: () => {
        const activeId = this.tabManager.getActiveTabId();
        if (activeId) {
          this.handleTabClose(activeId);
        }
      },
      showHelp: () => {
        this.helpOverlay.show();
      },
      toggleTerminal: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.toggleTerminal();
      },
      toggleViewerCycle: () => {
        const activeTab = this.tabManager.getActiveTab();
        const viewer = activeTab?.context?.getViewer();
        const layout = activeTab?.context?.getLayout();

        // If plan is active, close it first
        if (viewer?.isPlanActive()) {
          viewer.closePlanOverlay();
          // Hide viewer if no main content to show
          if (!viewer.hasContent()) {
            layout?.hideViewer();
          }
          return;
        }

        // Otherwise toggle viewer visibility
        if (layout?.isViewerVisible()) {
          layout.hideViewer();
        } else {
          layout?.showViewer();
        }
      },
      toggleNeovim: () => {
        const activeTab = this.tabManager.getActiveTab();
        const layout = activeTab?.context?.getLayout();
        // Ensure viewer pane is visible before toggling mode
        if (!layout?.isViewerVisible()) {
          layout?.showViewer();
        }
        activeTab?.context?.toggleNeovim();
      },
      viewLatestPlan: () => {
        const activeTab = this.tabManager.getActiveTab();
        const layout = activeTab?.context?.getLayout();
        // Show viewer if hidden before requesting plan
        if (!layout?.isViewerVisible()) {
          layout?.showViewer();
        }
        activeTab?.ws.requestLatestPlan();
      },
      scrollTerminalToTop: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.getTerminalManager()?.scrollToTop();
      },
      scrollTerminalToBottom: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.getTerminalManager()?.scrollToBottom();
      },
      cycleAgentNext: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.cycleAgent("next");
      },
      cycleAgentPrev: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.cycleAgent("prev");
      },
      getFocusedPane: () => {
        const activeTab = this.tabManager.getActiveTab();
        return activeTab?.context?.getFocusedPane() ?? "terminal";
      },
      getPaneHandler: (pane) => {
        const activeTab = this.tabManager.getActiveTab();
        return activeTab?.context?.getPaneHandler(pane) ?? null;
      },
    });

    window.addEventListener("beforeunload", () => {
      this.dispose();
    });
  }

  /**
   * Initialize context for a tab.
   */
  private async initializeTabContext(tab: TabState): Promise<void> {
    if (tab.context != null || this.tabContentContainer == null) {
      return;
    }

    const context = new ProjectContextImpl(
      tab.id,
      tab.projectPath,
      tab.name,
      tab.ws,
      this.tabContentContainer
    );

    tab.context = context;

    await context.initialize();

    tab.ws.on("connected", (message) => {
      this.tabManager.setConnected(tab.id, true);
      if (message.workingDir) {
        this.tabManager.updateTabPath(tab.id, message.workingDir);
      }
      // Apply user config from server
      if (message.config) {
        setUserConfig(message.config);
        console.log("[main] Applied user config from server");
      }
    });

    tab.ws.on("disconnected", () => {
      this.tabManager.setConnected(tab.id, false);
    });

    tab.ws.on("auth-failed", async () => {
      if (!tab.remoteProfileId) return;

      // Only show one auth dialog per profile — close duplicate tabs silently
      if (this.activeAuthDialogs.has(tab.remoteProfileId)) {
        await this.tabManager.closeTab(tab.id);
        return;
      }

      // If another tab on the same profile is already connected, this tab
      // is stale (e.g. restored from session with an old token). Close it
      // silently instead of prompting the user again.
      if (hasConnectedProfileTab(this.tabManager.getTabs(), tab.id, tab.remoteProfileId)) {
        await this.tabManager.closeTab(tab.id);
        return;
      }

      this.activeAuthDialogs.add(tab.remoteProfileId);

      await this.profileManager.loadProfiles();
      const profile = await this.profileManager.getProfile(tab.remoteProfileId);

      // Use profile name if available, fall back to tab name
      const displayName = profile?.name ?? tab.name.split(":")[0]?.trim() ?? "Remote";
      const dialog = new AuthTokenDialog(displayName);
      const newToken = await dialog.show();

      // Close the dead tab — restored tabs have no SSH tunnel running
      await this.tabManager.closeTab(tab.id);
      this.activeAuthDialogs.delete(tab.remoteProfileId!);

      if (newToken) {
        if (profile) {
          profile.authToken = newToken;
          await this.profileManager.saveProfile(profile);
          const newTab = await this.tabManager.createRemoteTab(profile);
          this.tabManager.switchTab(newTab.id);
        } else if (tab.remoteUrl) {
          // Profile lost (storage failure) — reconstruct from tab metadata
          const fallbackProfile: RemoteProfile = {
            id: tab.remoteProfileId!,
            name: displayName,
            url: tab.remoteUrl,
            authToken: newToken,
            connectionType: "direct",
            defaultPath: tab.projectPath,
          };
          await this.profileManager.saveProfile(fallbackProfile);
          const newTab = await this.tabManager.createRemoteTab(fallbackProfile);
          this.tabManager.switchTab(newTab.id);
        }
      }
    });

    tab.ws.sendSetProject(tab.projectPath, tab.id);
    tab.ws.connect();

    // Set up terminal key handler for prefix key interception
    context.setTerminalKeyHandler((e) => {
      // Intercept configured prefix key
      const prefixKey = getUserConfig().keybindings.global.prefix;
      if (matchesKeybinding(e, prefixKey)) {
        return true; // Prevent terminal from handling, let keybinding manager handle it
      }
      // If prefix is active, intercept all keys
      if (this.keybindingManager.isPrefixActive()) {
        return true;
      }
      return false;
    });

    if (this.tabManager.getActiveTabId() === tab.id) {
      context.show();
      context.focus();
    }
  }

  /**
   * Handle tab switch.
   */
  private handleTabSwitch(tab: TabState): void {
    for (const t of this.tabManager.getTabs()) {
      if (t.id === tab.id) {
        t.context?.show();
      } else {
        t.context?.hide();
      }
    }

    tab.context?.focus();

    this.tabBar?.render(
      this.tabManager.getTabs(),
      this.tabManager.getActiveTabId()
    );
  }

  /**
   * Handle tab close.
   */
  private handleTabClose(id: string): void {
    this.tabManager.closeTab(id);
  }

  /**
   * Handle add tab button click.
   */
  private async handleAddTab(): Promise<void> {
    const path = await pickProjectFolder(this.defaultProjectPath);

    if (path) {
      const tab = this.tabManager.createTab(path);
      this.tabManager.switchTab(tab.id);
    }
  }

  /**
   * Handle add remote tab action.
   */
  private async handleAddRemoteTab(): Promise<void> {
    console.log("[CADE] handleAddRemoteTab called");
    try {
      console.log("[CADE] Creating RemoteConnectionModal");
      const modal = new RemoteConnectionModal(this.profileManager);
      console.log("[CADE] Showing modal");
      const profile = await modal.show();
      console.log("[CADE] Modal result:", profile);

      if (profile) {
        const tab = await this.tabManager.createRemoteTab(profile);
        this.tabManager.switchTab(tab.id);
      }
    } catch (error) {
      console.error("Failed to create remote tab:", error);
      alert(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Show the start splash with project type options.
   * Appears when there are no tabs open.
   */
  private showStartSplash(): void {
    if (this.startSplash?.isVisible()) return;
    if (!this.tabContentContainer) return;

    this.startSplash = new Splash(this.tabContentContainer);
    this.startSplash.setOptions([
      { label: "LOCAL PROJECT", action: () => this.handleAddTab() },
      { label: "REMOTE PROJECT", action: () => this.handleAddRemoteTab() },
    ]);
  }

  /**
   * Hide the start splash when a tab is created.
   */
  private hideStartSplash(): void {
    this.startSplash?.hide();
    this.startSplash = null;
  }

  /**
   * Initialize MobileUI on first available tab.
   * Deferred because the start splash may show before any tab exists.
   */
  private initMobileUIIfNeeded(): void {
    if (this.mobileUI) return;

    const tab = this.tabManager.getActiveTab();
    if (!tab) return;

    this.mobileUI = new MobileUI(tab.ws, {
      sendInput: (data) => {
        const active = this.tabManager.getActiveTab();
        active?.context?.getTerminalManager()?.sendInput(data);
      },
      getTabs: () => {
        const activeId = this.tabManager.getActiveTabId();
        return this.tabManager.getTabs().map((t) => ({
          id: t.id,
          name: t.name,
          projectPath: t.projectPath,
          isActive: t.id === activeId,
        }));
      },
      onSwitchTab: (id) => {
        this.tabManager.switchTab(id);
      },
      getActiveWs: () => {
        return this.tabManager.getActiveTab()?.ws ?? tab.ws;
      },
    });
    this.mobileUI.initialize();
  }

  /**
   * Dispose of all resources.
   */
  async dispose(): Promise<void> {
    this.keybindingManager.dispose();
    this.helpOverlay.dispose();
    this.mobileUI?.dispose();
    this.tabBar?.dispose();
    this.tabManager.dispose();
  }
}

const app = new App();

/**
 * Check HTTP-level auth before loading the app.
 * Redirects to /login if the server rejects the session.
 * Skipped in Tauri mode (desktop app handles auth differently).
 */
async function checkAuth(): Promise<boolean> {
  const isTauri =
    window.location.hostname === "tauri.localhost" ||
    (window as any).__TAURI__ === true;

  if (isTauri) {
    return true;
  }

  try {
    const res = await fetch(basePath + "/api/auth/check", { credentials: "same-origin" });
    if (res.status === 401) {
      window.location.href = basePath + "/login";
      return false;
    }
    return true;
  } catch {
    // Network error — let the app try to connect anyway;
    // WebSocket auth will be the fallback gate
    return true;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const authed = await checkAuth();
  if (!authed) return;

  app.initialize().catch((e) => {
    console.error("Failed to initialize app:", e);
  });
});
