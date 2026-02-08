/**
 * Main entry point for CADE frontend.
 */

import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/vs2015.css";
import "../styles/main.css";

import { basePath, config, isRemoteBrowserAccess } from "./config/config";
import { HelpOverlay } from "./ui/help-overlay";
import { ThemeSelector } from "./ui/theme-selector";
import { KeybindingManager } from "./input/keybindings";
import { MobileUI } from "./ui/mobile";
import { ProjectContextImpl, TabBar, TabManager } from "./tabs";
import { hasConnectedProfileTab } from "./tabs/tab-manager";
import type { TabState } from "./tabs";
import { pickProjectFolder, getUserHomePath } from "./platform/tauri-bridge";
import { setUserConfig, getUserConfig, matchesKeybinding } from "./config/user-config";
import { applySavedTheme, onThemeChange, getSavedThemeId, themes } from "./config/themes";
import { RemoteProfileManager } from "./remote/profile-manager";
import { RemoteProjectSelector } from "./remote/RemoteProjectSelector";
import { Splash } from "./ui/splash";
import type { RemoteProfile } from "./remote/types";
import { getAuthToken, setAuthToken } from "./auth/tokenManager";

class App {
  private tabManager: TabManager;
  private tabBar: TabBar | null = null;
  private mobileUI: MobileUI | null = null;
  private tabContentContainer: HTMLElement | null = null;
  private defaultProjectPath: string;
  private keybindingManager: KeybindingManager;
  private helpOverlay: HelpOverlay;
  private themeSelector: ThemeSelector;
  private profileManager: RemoteProfileManager;
  private activeAuthDialogs = new Set<string>();
  private startSplash: Splash | null = null;
  private resumeInProgress = false;

  constructor() {
    this.tabManager = new TabManager();
    this.defaultProjectPath = this.getDefaultProjectPath();
    this.keybindingManager = new KeybindingManager();
    this.helpOverlay = new HelpOverlay();
    this.themeSelector = new ThemeSelector();
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
      this.initMobileUIIfNeeded();
    });

    this.tabManager.on("tabs-changed", (tabs) => {
      this.tabBar?.render(tabs, this.tabManager.getActiveTabId());
      if (this.resumeInProgress) return;
      if (tabs.length === 0) {
        this.showStartSplash();
      }
      // Splash is hidden by first shell output, not by tab creation
    });

    // Always show splash on startup - user chooses to resume or start fresh
    this.showStartSplash();

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
      showThemeSelector: () => {
        this.themeSelector.toggle();
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

    // Update all terminal themes when user switches themes
    onThemeChange(() => {
      for (const tab of this.tabManager.getTabs()) {
        tab.context?.getTerminalManager()?.updateTheme();
      }
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

    const splashActive = this.startSplash?.isVisible() ?? false;
    await context.initialize(splashActive);

    tab.ws.on("connected", (message) => {
      this.tabManager.setConnected(tab.id, true);
      if (message.workingDir) {
        this.tabManager.updateTabPath(tab.id, message.workingDir);
      }
      // Apply user config from server (keybindings, behavior, fonts, etc.)
      // then re-apply the saved theme so server colors don't stomp it
      if (message.config) {
        setUserConfig(message.config);
        applySavedTheme();
        console.log("[main] Applied user config from server");
      }
    });

    tab.ws.on("disconnected", () => {
      this.tabManager.setConnected(tab.id, false);
    });

    tab.ws.on("auth-failed", async () => {
      // Local tab on remote browser — prompt for server's auth token
      if (!tab.remoteProfileId && isRemoteBrowserAccess()) {
        const dialogKey = "__local_remote_browser__";

        if (this.activeAuthDialogs.has(dialogKey)) return;
        this.activeAuthDialogs.add(dialogKey);

        this.showAuthSplash("Server", (newToken) => {
          this.activeAuthDialogs.delete(dialogKey);

          if (newToken) {
            setAuthToken(newToken);
            tab.ws.setAuthToken(newToken);
            tab.ws.connect();
          }
        });
        return;
      }

      if (!tab.remoteProfileId) return;

      // Only show one auth splash per profile — close duplicate tabs silently
      if (this.activeAuthDialogs.has(tab.remoteProfileId)) {
        await this.tabManager.closeTab(tab.id);
        return;
      }

      // Stale tab: another tab on same profile already connected
      if (hasConnectedProfileTab(this.tabManager.getTabs(), tab.id, tab.remoteProfileId)) {
        await this.tabManager.closeTab(tab.id);
        return;
      }

      this.activeAuthDialogs.add(tab.remoteProfileId);

      await this.profileManager.loadProfiles();
      const profile = await this.profileManager.getProfile(tab.remoteProfileId);
      const displayName = profile?.name ?? tab.name.split(":")[0]?.trim() ?? "Remote";

      this.showAuthSplash(displayName, async (newToken) => {
        await this.tabManager.closeTab(tab.id);
        this.activeAuthDialogs.delete(tab.remoteProfileId!);

        if (newToken) {
          if (profile) {
            profile.authToken = newToken;
            await this.profileManager.saveProfile(profile);
            const newTab = await this.tabManager.createRemoteTab(profile);
            this.tabManager.switchTab(newTab.id);
          } else if (tab.remoteUrl) {
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
    });

    // Progress bar: advance through checkpoints until shell is ready
    if (this.startSplash?.isVisible()) {
      // Step 2: WebSocket connecting
      this.startSplash.setProgress(2, "connecting");

      // Step 3: backend acknowledged connection
      const onConnected = () => {
        tab.ws.off("connected", onConnected);
        this.startSplash?.setProgress(3, "starting shell");
      };
      tab.ws.on("connected", onConnected);

      // Step 4: shell produced output → dismiss
      const onFirstOutput = () => {
        tab.ws.off("output", onFirstOutput);
        this.startSplash?.setProgress(4, "ready");
        this.hideStartSplash();
      };
      tab.ws.on("output", onFirstOutput);
    }

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
      this.startSplash?.setLoading();
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
      if (!this.tabContentContainer) {
        throw new Error("Tab content container not found");
      }

      // Create container for selector
      const selectorContainer = document.createElement("div");
      this.tabContentContainer.appendChild(selectorContainer);

      console.log("[CADE] Creating RemoteProjectSelector");
      const selector = new RemoteProjectSelector(selectorContainer, this.profileManager);
      console.log("[CADE] Showing selector");
      const result = await selector.show();
      console.log("[CADE] Selector result:", result);

      if (result) {
        this.startSplash?.setLoading();
        // Use the WebSocket and tunnel from the selector (already connected)
        const tab = await this.tabManager.createRemoteTabWithWebSocket(
          result.profile,
          result.path,
          result.ws,
          result.tunnelPid
        );
        this.tabManager.switchTab(tab.id);
      }
    } catch (error) {
      console.error("Failed to create remote tab:", error);
      alert(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Show an auth splash screen for token re-entry.
   * Replaces the old AuthTokenDialog modal with a full-pane splash variant.
   */
  private showAuthSplash(profileName: string, onResult: (token: string | null) => void): void {
    if (!this.tabContentContainer) return;

    // Reuse the visible splash — just switch its mode to auth.
    // This avoids a destroy-recreate cycle that flashes the background.
    if (!this.startSplash?.isVisible()) {
      this.startSplash = new Splash(this.tabContentContainer);
    }

    this.startSplash.setAuthMode(profileName, (token) => {
      this.startSplash?.hide();
      this.startSplash = null;
      onResult(token);

      // Return to start splash if no tabs remain
      if (this.tabManager.getTabs().length === 0) {
        this.showStartSplash();
      }
    });
  }

  /**
   * Show the start splash with project type options.
   * Appears on startup or when all tabs are closed.
   *
   * When accessing via browser on a remote server, shows simplified options
   * since "LOCAL" means the server's filesystem and "REMOTE" is redundant.
   */
  private showStartSplash(): void {
    if (this.startSplash?.isVisible()) return;
    if (!this.tabContentContainer) return;

    // Remote browser/mobile: require auth before showing menu
    if (isRemoteBrowserAccess() && !getAuthToken()) {
      this.showAuthSplash("Server", (token) => {
        if (token) {
          setAuthToken(token);
          this.showStartSplashMenu();
        }
      });
      return;
    }

    this.showStartSplashMenu();
  }

  /**
   * Show the start splash menu with project type options.
   * Called directly (desktop) or after auth gate (remote browser).
   */
  private showStartSplashMenu(): void {
    if (!this.tabContentContainer) return;

    this.startSplash = new Splash(this.tabContentContainer);

    const options = [];

    if (this.tabManager.hasSavedSession()) {
      options.push({ label: "RESUME SESSION", action: () => {
        this.startSplash?.setLoading();
        this.handleResumeSession();
      }});
    }

    if (isRemoteBrowserAccess()) {
      options.push({ label: "PROJECT", action: () => this.handleAddTab() });
    } else {
      options.push({ label: "LOCAL PROJECT", action: () => this.handleAddTab() });
      options.push({ label: "REMOTE PROJECT", action: () => this.handleAddRemoteTab() });
    }

    this.startSplash.setOptions(options);
  }

  /**
   * Restore tabs from saved session.
   *
   * Local tabs are re-initialised directly. Remote tabs are re-created
   * via createRemoteTab() so the SSH tunnel is started and the auth
   * token (stored in the profile, not in tab state) is attached to the
   * WebSocket before connecting.
   */
  private async handleResumeSession(): Promise<void> {
    this.resumeInProgress = true;

    try {
      await this.tabManager.restoreSession();
      await this.profileManager.loadProfiles();

      const tabs = [...this.tabManager.getTabs()];
      const remoteReplacements: { tab: TabState; profile: RemoteProfile }[] = [];

      for (const tab of tabs) {
        if (tab.remoteProfileId) {
          const profile = await this.profileManager.getProfile(tab.remoteProfileId);
          if (profile) {
            remoteReplacements.push({ tab, profile });
          } else {
            await this.tabManager.closeTab(tab.id);
          }
        } else {
          await this.initializeTabContext(tab);
        }
      }

      // Replace dead remote tabs with properly-connected ones
      // (createRemoteTab starts the SSH tunnel and passes the stored auth token)
      for (const { tab, profile } of remoteReplacements) {
        tab.ws.disconnect();
        await this.tabManager.closeTab(tab.id);
        try {
          // Use saved tab path if meaningful, otherwise fall back to
          // the profile's most-recently-used project or defaultPath
          let resumePath: string | undefined = tab.projectPath;
          if (!resumePath || resumePath === "/") {
            const projects = profile.projects ?? [];
            const sorted = [...projects].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
            resumePath = sorted[0]?.path ?? profile.defaultPath ?? undefined;
          }
          const newTab = await this.tabManager.createRemoteTab(profile, resumePath);
          this.tabManager.switchTab(newTab.id);
        } catch (error) {
          console.error("Failed to reconnect remote tab:", error);
        }
      }
    } finally {
      this.resumeInProgress = false;
    }

    const updatedTabs = this.tabManager.getTabs();
    this.tabBar?.render(updatedTabs, this.tabManager.getActiveTabId());

    if (updatedTabs.length === 0) {
      this.showStartSplash();
      return;
    }

    // Splash is hidden by first shell output listener in initializeTabContext
    const activeTab = this.tabManager.getActiveTab();
    if (activeTab) {
      this.handleTabSwitch(activeTab);
    }
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
      onTheme: () => this.themeSelector.toggle(),
      getCurrentThemeName: () => {
        const id = getSavedThemeId();
        return themes.find((t) => t.id === id)?.name ?? id;
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
    this.themeSelector.dispose();
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
  // Apply saved theme immediately to prevent flash of default colors
  applySavedTheme();

  const authed = await checkAuth();
  if (!authed) return;

  app.initialize().catch((e) => {
    console.error("Failed to initialize app:", e);
  });
});
