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
import type { LaunchPreset } from "./types";
import { SessionKey } from "@core/platform/protocol";
import { pickProjectFolder, getUserHomePath } from "@core/platform/tauri-bridge";
import { setUserConfig, getUserConfig, matchesKeybinding } from "./config/user-config";
import { applySavedTheme, onThemeChange, getSavedThemeId, themes } from "./config/themes";
import { RemoteProfileManager } from "./remote/profile-manager";
import { RemoteProjectSelector } from "./remote/RemoteProjectSelector";
import { Splash } from "./ui/splash";
import type { RemoteProfile } from "./remote/types";
import { getAuthToken, setAuthToken } from "./auth/tokenManager";
import { setStoredIdToken } from "./auth/googleAuth";
import { registerParadraxViewers } from "./padarax/register";

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
  private splashTimeout: number | null = null;
  private resumeInProgress = false;
  private launchOverrides: LaunchPreset;
  /**
   * URL ?dashboard=<path> override forwarded to the backend in SET_PROJECT.
   * Overrides launch.yml's dashboard_file so a project shipping multiple
   * dashboards (e.g. a worldbuilding/reference one + a player-facing one)
   * can be opened on either via URL without editing launch.yml.
   */
  private dashboardOverride: string | null;
  /**
   * URL ?provider=<name|none> override forwarded to the backend in
   * SET_PROJECT. "none" skips launch.yml's provider registration so the
   * session uses CADE's default Claude Code chat — useful for opening
   * an authoring/admin view of a project that normally registers a
   * game-mode provider on connect.
   */
  private providerOverride: string | null;

  constructor() {
    this.tabManager = new TabManager();
    this.defaultProjectPath = this.getDefaultProjectPath();
    this.launchOverrides = App.parseLaunchOverrides();
    this.dashboardOverride = App.parseDashboardOverride();
    this.providerOverride = App.parseProviderOverride();
    this.keybindingManager = new KeybindingManager();
    this.helpOverlay = new HelpOverlay();
    this.themeSelector = new ThemeSelector();
    this.profileManager = new RemoteProfileManager();
  }

  /**
   * Parse the ?provider=<name|none> URL param.
   * "none" skips the project's launch.yml-registered provider so the
   * session uses CADE's normal Claude Code chat. Forwarded to the
   * backend via SET_PROJECT.
   */
  private static parseProviderOverride(): string | null {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("provider");
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Parse the ?dashboard=<path> URL param.
   * Returns the raw value (project-relative path or absolute) or null.
   * Forwarded to the backend via SET_PROJECT to override launch.yml's
   * dashboard_file. Aliases (e.g. "gm", "game") are project-specific and
   * not handled here — projects can bookmark whatever filename they ship.
   */
  private static parseDashboardOverride(): string | null {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("dashboard");
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Parse launch-preset overrides from the URL query string.
   * Supported params: ?enhanced=1, ?spawn=<cmd>, ?view=<id>, ?hide-tree=1.
   * Any value here overrides the matching field in the backend's
   * .cade/launch.yml preset (URL wins on conflict).
   */
  private static parseLaunchOverrides(): LaunchPreset {
    const params = new URLSearchParams(window.location.search);
    const out: LaunchPreset = {};

    const enhanced = params.get("enhanced");
    if (enhanced !== null) {
      out.enhanced = enhanced === "1" || enhanced === "true";
    }

    const spawn = params.get("spawn");
    if (spawn) {
      out.spawn = spawn;
    }

    const view = params.get("view");
    if (view) {
      out.view = view;
    }

    const hideTree = params.get("hide-tree") ?? params.get("hide_tree");
    if (hideTree !== null) {
      out.hide_tree = hideTree === "1" || hideTree === "true";
    }

    return out;
  }

  /**
   * Merge backend launch preset with URL overrides (URL wins) and apply.
   * Called once from the `connected` handler for each tab.
   */
  private applyLaunchPreset(tab: TabState, merged: LaunchPreset): void {
    const tm = tab.context?.getTerminalManager();
    if (tm == null) {
      console.warn("[launch] no terminal manager available, skipping preset");
      return;
    }

    if (merged.enhanced === true) {
      console.log("[launch] enabling enhanced mode");
      tm.setEnhanced(true);
    }

    if (merged.spawn) {
      console.log(`[launch] spawning in manual terminal: ${merged.spawn}`);
      // Switch to the manual (raw xterm shell) terminal so the spawn
      // command lands in a real bash shell, not Claude Code's chat
      // handler. switchTo creates the manual terminal on first use.
      tm.switchTo(SessionKey.MANUAL);
      // Give the PTY a beat to reach a shell prompt before writing input.
      // 500ms is conservative; local PTY start is usually <100ms.
      const cmd = merged.spawn;
      setTimeout(() => {
        tm.sendInput(cmd + "\n");
      }, 500);
    }

    if (merged.view || this.dashboardOverride) {
      console.log(`[launch] switching right pane to dashboard`);
      tab.context?.getRightPane()?.setMode("dashboard");
    }

    if (merged.hide_tree === true) {
      console.log("[launch] hiding file tree");
      tab.context?.getLayout()?.hideFileTree();
    } else if (merged.hide_tree === false) {
      console.log("[launch] showing file tree");
      tab.context?.getLayout()?.showFileTree();
    }

    if (merged.kiosk_mode === true) {
      // Kiosk locks down the raw shell on the backend (PTY input/resize
      // rejected in websocket.py); the middle pane in enhanced mode is
      // ChatPane, not a shell, so it must stay visible for game I/O.
      // Only hide the pane entirely if enhanced mode is off — then the
      // middle pane really would be a raw terminal with nothing to do.
      if (merged.enhanced !== true) {
        console.log("[launch] kiosk + non-enhanced — hiding terminal pane");
        tab.context?.getLayout()?.hideTerminal();
      } else {
        console.log("[launch] kiosk mode — shell locked, chat pane kept");
      }
    }

    if (merged.viewers && merged.viewers.length > 0) {
      console.log(`[launch] registering ${merged.viewers.length} viewer(s)`);
      registerParadraxViewers(merged.viewers);
    }
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

    // Check for ?project= URL param to skip splash (used in demo/testing)
    const urlParams = new URLSearchParams(window.location.search);
    const autoProject = urlParams.get("project");
    if (autoProject) {
      // Mount the splash even on auto-project so the Google Sign-In flow
      // (fired from `google-auth-required`) has a host to render its button.
      // Splash hides itself on first shell output, exactly as the manual flow.
      if (this.tabContentContainer) {
        this.startSplash = new Splash(this.tabContentContainer);
        this.startSplash.setLoading();
      }
      const tab = this.tabManager.createTab(autoProject);
      this.tabManager.switchTab(tab.id);
    } else {
      // Always show splash on startup - user chooses to resume or start fresh
      this.showStartSplash();
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
        const rightPane = activeTab?.context?.getRightPane();

        // If plan is active, close it first
        if (viewer?.isPlanActive()) {
          viewer.closePlanOverlay();
          // Hide viewer if no main content to show
          if (!viewer.hasContent()) {
            layout?.hideViewer();
          }
          return;
        }

        if (!layout?.isViewerVisible()) {
          // Hidden → show markdown
          layout?.showViewer();
          activeTab?.context?.setRightPaneMode("markdown");
          return;
        }

        const currentMode = rightPane?.getMode();
        const hasAgents = activeTab?.context?.getAgentManager()?.hasAgents();
        const hasDashboard = rightPane?.getDashboardPane()?.hasConfig();

        if (currentMode === "markdown" && hasDashboard) {
          // Markdown → dashboard (when config exists)
          activeTab?.context?.setRightPaneMode("dashboard");
        } else if ((currentMode === "markdown" || currentMode === "dashboard") && hasAgents) {
          // Markdown/dashboard → agents (when agents exist)
          activeTab?.context?.setRightPaneMode("agents");
        } else {
          // Last mode → hidden
          layout?.hideViewer();
        }
      },
      toggleDashboard: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.toggleViewMode();
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
      toggleEnhanced: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.getTerminalManager()?.toggleEnhanced();
      },
      cycleModeNext: () => {
        const activeTab = this.tabManager.getActiveTab();
        const chatPane = activeTab?.context?.getTerminalManager()?.getChatPane();
        if (chatPane) {
          const modes = ["architect", "code", "review", "orchestrator"];
          const current = chatPane.getMode();
          const next = modes[(modes.indexOf(current) + 1) % modes.length]!;
          const cmd = next === "architect" ? "plan" : next === "orchestrator" ? "orch" : next;
          activeTab?.ws.sendChatMessage(`/${cmd}`);
        }
      },
      cycleModePrev: () => {
        const activeTab = this.tabManager.getActiveTab();
        const chatPane = activeTab?.context?.getTerminalManager()?.getChatPane();
        if (chatPane) {
          const modes = ["architect", "code", "review", "orchestrator"];
          const current = chatPane.getMode();
          const prev = modes[(modes.indexOf(current) + modes.length - 1) % modes.length]!;
          const cmd = prev === "architect" ? "plan" : prev === "orchestrator" ? "orch" : prev;
          activeTab?.ws.sendChatMessage(`/${cmd}`);
        }
      },
      approveAgent: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.handleAgentApprove();
      },
      rejectAgent: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.handleAgentReject();
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

    // Demo mode: synthetic events injected by demo.ts; no server contact.
    const isDemoTab =
      import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");

    // In demo mode there's no start splash, but we still skip the per-tab
    // splash so it doesn't sit undismissed (no output event fires in demo).
    const splashActive = isDemoTab || (this.startSplash?.isVisible() ?? false);
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
      // Merge backend .cade/launch.yml preset with URL overrides (URL wins)
      // and apply: enhanced-mode toggle, spawn command in the manual terminal,
      // future view/hide_tree fields.
      const backendPreset = message.launchPreset ?? {};
      const merged: LaunchPreset = { ...backendPreset, ...this.launchOverrides };
      if (Object.keys(merged).length > 0) {
        this.applyLaunchPreset(tab, merged);
      }
    });

    tab.ws.on("disconnected", () => {
      this.tabManager.setConnected(tab.id, false);
    });

    // Project-level Google Sign-In gate. Fires when the server tells us
    // the project's launch.yml requires Google auth and we didn't present
    // a valid token. Client_id comes from the server so no build-time env
    // var is needed — IDE use on other projects stays unaffected.
    tab.ws.on("google-auth-required", ({ client_id }) => {
      if (!this.startSplash?.isVisible()) {
        // Without a visible splash (reconnect after connection loss on an
        // already-open tab), we have nowhere to render the button. Log and
        // let the user manually reload — this is rare in practice.
        console.warn("google-auth-required but no splash visible; user must reload");
        return;
      }
      this.startSplash.setGoogleAuthMode(client_id, (idToken) => {
        setStoredIdToken(idToken);
        tab.ws.setGoogleIdToken(idToken);
        tab.ws.connect();
      });
    });

    tab.ws.on("auth-failed", async () => {
      // Local tab on remote browser — authenticate to continue
      if (!tab.remoteProfileId && isRemoteBrowserAccess()) {
        const dialogKey = "__local_remote_browser__";

        if (this.activeAuthDialogs.has(dialogKey)) return;
        this.activeAuthDialogs.add(dialogKey);

        if (config.googleClientId) {
          if (!this.startSplash?.isVisible()) {
            this.startSplash = new Splash(this.tabContentContainer!);
          }
          this.startSplash.setGoogleAuthMode(config.googleClientId, (idToken) => {
            this.activeAuthDialogs.delete(dialogKey);
            setStoredIdToken(idToken);
            tab.ws.setGoogleIdToken(idToken);
            tab.ws.connect();
          });
        } else {
          this.showAuthSplash("Server", (newToken) => {
            this.activeAuthDialogs.delete(dialogKey);
            if (newToken) {
              setAuthToken(newToken);
              tab.ws.setAuthToken(newToken);
              tab.ws.connect();
            }
          });
        }
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

      if (config.googleClientId) {
        if (!this.startSplash?.isVisible()) {
          this.startSplash = new Splash(this.tabContentContainer!);
        }
        this.startSplash.setGoogleAuthMode(config.googleClientId, (idToken) => {
          this.activeAuthDialogs.delete(tab.remoteProfileId!);
          setStoredIdToken(idToken);
          tab.ws.setGoogleIdToken(idToken);
          tab.ws.connect();
        });
      } else {
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
      }
    });

    tab.ws.on("connection-lost", () => {
      console.warn(`[main] Connection lost for tab ${tab.id}, still retrying...`);
      this.tabManager.setConnected(tab.id, false);
    });

    tab.ws.on("connection-failed", () => {
      if (!tab.remoteProfileId) return;
      console.error(`[main] Connection failed for remote tab ${tab.id}`);
      this.showConnectionFailedSplash(tab);
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

    if (!isDemoTab) {
      tab.ws.sendSetProject(
        tab.projectPath,
        tab.id,
        this.dashboardOverride ?? undefined,
        this.providerOverride ?? undefined,
      );

      // Auth is project-driven now: connect first; if the project's launch.yml
      // declares Google auth, the server sends an `auth-required` frame with
      // the client_id then closes with 1008. A stored id_token from a previous
      // sign-in is attached automatically inside connect().
      tab.ws.connect();
    }

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
      this.startSplashTimeout();
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
        this.startSplashTimeout();
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
   * Show an error splash when a remote connection fails entirely.
   * Offers retry and close actions.
   */
  private showConnectionFailedSplash(tab: TabState): void {
    if (!this.tabContentContainer) return;

    // Cancel the loading splash timeout — we're taking over
    if (this.splashTimeout != null) {
      window.clearTimeout(this.splashTimeout);
      this.splashTimeout = null;
    }

    if (!this.startSplash?.isVisible()) {
      this.startSplash = new Splash(this.tabContentContainer);
    }

    const displayName = tab.name.split(":")[0]?.trim() ?? "Remote";

    this.startSplash.setErrorMode(
      `connection failed — ${displayName} unreachable`,
      [
        {
          label: "retry",
          action: () => {
            this.startSplash?.setLoading();
            this.startSplash?.setProgress(2, "connecting");
            this.startSplashTimeout();
            tab.ws.disconnect();
            tab.ws.connect();
          },
        },
        {
          label: "close",
          action: () => {
            this.hideStartSplash();
            this.tabManager.closeTab(tab.id);
          },
        },
      ]
    );
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
        this.startSplashTimeout();
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
    if (this.splashTimeout != null) {
      window.clearTimeout(this.splashTimeout);
      this.splashTimeout = null;
    }
    this.startSplash?.hide();
    this.startSplash = null;
  }

  /**
   * Start a safety timer that auto-dismisses the splash if the backend
   * never sends an "output" event (e.g. PTY dies silently, stale binary).
   */
  private startSplashTimeout(): void {
    if (this.splashTimeout != null) {
      window.clearTimeout(this.splashTimeout);
    }
    this.splashTimeout = window.setTimeout(() => {
      this.splashTimeout = null;
      if (this.startSplash?.isVisible()) {
        console.warn("Splash progress timed out after 15s, forcing dismiss");
        this.hideStartSplash();
      }
    }, 15_000);
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

    if (import.meta.env.DEV) {
      import("./demo").then(({ activateDemoMode }) => activateDemoMode(tab.ws));
    }
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
