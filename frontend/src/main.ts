/**
 * Main entry point for CADE frontend.
 */

import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/vs2015.css";
import "../styles/main.css";

import { loadFonts } from "./terminal/web-fonts";
import { installFileDropHandling } from "./terminal/file-drop";
import { installShellListeners } from "./platform/shell-listeners";

// Kick the bundled monospace fetch immediately so the network request is
// in flight before any UI mounts. The actual await happens inside
// DOMContentLoaded below — this top-level call just starts the fetch
// early. loadFonts is idempotent (FontFace.load() returns the in-flight
// promise on subsequent calls), so awaiting it later is safe.
loadFonts().catch(() => {
  // Fall through — the await in DOMContentLoaded reports the real error.
});

import { basePath, config, isRemoteBrowserAccess, isTauri } from "./config/config";
import { HelpOverlay } from "./ui/help-overlay";
import { ThemeSelector } from "./ui/theme-selector";
import { KeybindingManager } from "./input/keybindings";
import { MobileUI } from "./ui/mobile";
import { notifyAttention } from "./ui/attention-notify";
import { sessionTitleFromTerminal, tabDisplayName } from "./tabs/session-title";
import { registerServiceWorker } from "./push";
import type { AttentionState, LiveSessionInfo } from "./types";
import { WebSocketClient } from "./platform/websocket";
import { sessionsToAdopt } from "./tabs/tab-manager";
import {
  groupColourVar,
  newGroupName,
  withAutoAdd,
  withGroupDef,
  withGroupRenamed,
  withoutGroupDef,
  type TabGroupDef,
} from "./tabs/tab-groups";
import { attachOptionLabel } from "./ui/splash-attach";
import { ProjectContextImpl, TabBar, TabManager } from "./tabs";
import { hasConnectedProfileTab } from "./tabs/tab-manager";
import type { TabState } from "./tabs";
import type { LaunchPreset } from "./types";
import { SessionKey } from "@core/platform/protocol";
import { openExternal, pickProjectFolder, getUserHomePath } from "@core/platform/tauri-bridge";
import { setUserConfig } from "./config/user-config";
import { applySavedTheme, onThemeChange, getSavedThemeId, themes } from "./config/themes";
import { setMermaidConfig } from "@core/chat/markdown-renderer";
import { getMermaidConfig } from "./markdown/mermaid-theme";
import { RemoteProfileManager } from "./remote/profile-manager";
import { RemoteProjectSelector } from "./remote/RemoteProjectSelector";
import { ProjectPicker } from "./local/project-picker";
import { handoffPrompt } from "./local/picker-model";
import { WorkspaceSwitcher, type WorkspaceRow } from "./tabs/workspace-switcher";
import { BoardScreen } from "./board/board-screen";
import { loadRecentProjects, rememberRecentProject } from "./local/recent-projects";
import { Splash } from "./ui/splash";
import type { RemoteProfile } from "./remote/types";
import { getAuthToken, setAuthToken } from "./auth/tokenManager";
import { setStoredIdToken } from "./auth/googleAuth";
import { registerParadraxViewers, registerParadraxSections } from "./padarax/register";
import { KnowledgeEntityResolver } from "./padarax/knowledge-refs";
import { setEntityResolver } from "./platform/entity-resolver";

class App {
  private tabManager: TabManager;
  private tabBar: TabBar | null = null;
  private workspaceSwitcher: WorkspaceSwitcher | null = null;
  private mobileUI: MobileUI | null = null;
  /** Tabs that produced output while another tab was active. */
  private unreadTabs = new Set<string>();
  /** Per-tab agent attention, from the session-attention hook events. */
  private attentionByTab = new Map<string, AttentionState>();
  /** Colour and auto-add folders of each tab group, as the backend holds them. */
  private groupDefs: TabGroupDef[] = [];
  private projectPickerOpen = false;
  /** Polls the backend's live sessions while the start splash is up. */
  private splashSessionTimer: number | null = null;
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
  /**
   * Raw ?project=<path> URL param, used to scope ?dashboard= and ?provider=
   * overrides to tabs whose projectPath matches. Without this, a user who
   * bookmarks ?project=X&dashboard=Y and then opens a new tab for project Z
   * would wrongly have Y applied to Z.
   */
  private urlProjectPath: string | null;

  constructor() {
    this.tabManager = new TabManager();
    this.defaultProjectPath = this.getDefaultProjectPath();
    this.launchOverrides = App.parseLaunchOverrides();
    this.dashboardOverride = App.parseDashboardOverride();
    this.providerOverride = App.parseProviderOverride();
    this.urlProjectPath = App.parseUrlProjectPath();
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
   * Parse the raw ?project=<path> URL param (null if absent).
   * Unlike getDefaultProjectPath(), this does NOT fall back to the home
   * directory — callers need to know whether the value came from the URL
   * so ?dashboard= and ?provider= overrides can be scoped to matching tabs.
   */
  private static parseUrlProjectPath(): string | null {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("project");
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * URL overrides (?dashboard=, ?provider=) apply only to tabs whose
   * projectPath matches the ?project= URL param. Tabs for other projects
   * — including new tabs opened via the `+` button — get no override and
   * fall back to their project's launch.yml / default dashboard.yml.
   */
  private overridesMatchTab(tab: TabState): boolean {
    if (this.urlProjectPath === null) return false;
    return tab.projectPath === this.urlProjectPath;
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

    if (merged.view || (this.dashboardOverride && this.overridesMatchTab(tab))) {
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

    registerParadraxSections();
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
    setEntityResolver(new KnowledgeEntityResolver());

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

    this.tabBar.on("tab-rename", ({ tabId, name }) => {
      const tab = this.tabManager.renameTab(tabId, name);
      tab?.ws.sendSetLabel(tabDisplayName(tab));
      this.mobileUI?.refresh();
    });

    this.tabBar.on("tab-reorder", ({ tabId, toIndex }) => {
      this.tabManager.moveTab(tabId, toIndex);
    });

    this.wireTabGroupEvents(this.tabBar);
    this.loadGroupDefs();

    this.tabBar.on("tab-add", () => {
      this.handleAddTab();
    });

    this.tabBar.on("tab-add-remote", () => {
      console.log("[CADE] tab-add-remote event received in main.ts");
      this.handleAddRemoteTab();
    });

    // An upgrade that brings a new interface is offered, not applied: the
    // reload it needs redraws every terminal.
    this.tabBar.on("pr-open", (url) => void openExternal(url));
    this.tabBar.on("update-reload", () => WebSocketClient.reloadForUpdate());
    this.tabBar.setUpdateReady(WebSocketClient.isUpdateReady());
    WebSocketClient.onUpdateReady(() => {
      this.tabBar?.setUpdateReady(true);
      // The desktop window cannot be inspected, so the page reports what it
      // drew: whether the marker is in the bar and where it ended up.
      requestAnimationFrame(() => {
        const marker = document.querySelector(".tab-update-marker")?.getBoundingClientRect();
        const where = marker
          ? `marker at x=${Math.round(marker.x)} y=${Math.round(marker.y)} w=${Math.round(marker.width)} h=${Math.round(marker.height)}`
          : "no marker in the tab bar";
        this.tabManager.getActiveTab()?.ws.sendDiagnostic(
          "update-ready",
          `${where}; window ${window.innerWidth}x${window.innerHeight}`,
        );
      });
    });

    this.tabManager.on("tab-created", (tab) => {
      this.initializeTabContext(tab);
      this.initMobileUIIfNeeded();
    });

    this.tabManager.on("tab-switched", (tab) => {
      this.unreadTabs.delete(tab.id);
      this.handleTabSwitch(tab);
      this.initMobileUIIfNeeded();
      this.mobileUI?.refresh();
    });

    this.tabManager.on("tabs-changed", (tabs) => {
      this.renderTabBar();
      for (const id of this.unreadTabs) {
        if (!tabs.some((t) => t.id === id)) this.unreadTabs.delete(id);
      }
      this.mobileUI?.refresh();
      if (this.resumeInProgress) return;
      if (tabs.length === 0) {
        this.showStartSplash();
      }
      // Splash is hidden by first shell output, not by tab creation
    });

    // Check for ?project= URL param to skip splash (used in demo/testing)
    const urlParams = new URLSearchParams(window.location.search);
    const autoProject = urlParams.get("project");
    const isDemoMode = import.meta.env.DEV && urlParams.has("demo");
    if (isDemoMode) {
      // Demo mode: skip splash entirely, create a tab with a fake path
      const tab = this.tabManager.createTab("/demo");
      this.tabManager.switchTab(tab.id);
    } else if (autoProject) {
      // Mount the splash even on auto-project so the Google Sign-In flow
      // (fired from `google-auth-required`) has a host to render its button.
      // Splash hides itself on first shell output, exactly as the manual flow.
      if (this.tabContentContainer) {
        this.startSplash = new Splash(this.tabContentContainer);
        this.startSplash.setLoading();
      }
      const tab = this.tabManager.createTab(autoProject);
      this.tabManager.switchTab(tab.id);
    } else if (WebSocketClient.takeResumeAfterUpgrade() && this.tabManager.hasSavedSession()) {
      // This page replaced one that reloaded for an upgrade. The user did
      // not close anything, so their tabs come back without the start screen
      // asking; until they do, every agent's prompts would go unseen.
      if (this.tabContentContainer) {
        this.startSplash = new Splash(this.tabContentContainer);
        this.startSplash.setLoading();
        this.startSplashTimeout();
      }
      void this.handleResumeSession();
    } else {
      // Always show splash on startup - user chooses to resume or start fresh
      this.showStartSplash();
    }

    this.initMobileUIIfNeeded();
    registerServiceWorker();

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
      openBoard: () => void this.handleOpenBoard(),
      nextWorkspace: () => this.stepWorkspace(1),
      previousWorkspace: () => this.stepWorkspace(-1),
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

        if (currentMode === "markdown") {
          // Markdown → Plans & Handoffs
          activeTab?.context?.setRightPaneMode("plans");
          rightPane?.getPlansPane().refresh();
        } else if (currentMode === "plans" && hasDashboard) {
          activeTab?.context?.setRightPaneMode("dashboard");
        } else if ((currentMode === "plans" || currentMode === "dashboard") && hasAgents) {
          // Plans/dashboard → agents (when agents exist)
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
          const modes = ["plan", "code", "research", "review"];
          const current = chatPane.getMode();
          const next = modes[(modes.indexOf(current) + 1) % modes.length]!;
          activeTab?.ws.sendChatMessage(`/${next}`);
        }
      },
      cycleModePrev: () => {
        const activeTab = this.tabManager.getActiveTab();
        const chatPane = activeTab?.context?.getTerminalManager()?.getChatPane();
        if (chatPane) {
          const modes = ["plan", "code", "research", "review"];
          const current = chatPane.getMode();
          const prev = modes[(modes.indexOf(current) + modes.length - 1) % modes.length]!;
          activeTab?.ws.sendChatMessage(`/${prev}`);
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
      focusChatInput: () => {
        const activeTab = this.tabManager.getActiveTab();
        activeTab?.context?.getTerminalManager()?.getChatPane()?.focus();
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
      setMermaidConfig(getMermaidConfig());
      for (const tab of this.tabManager.getTabs()) {
        tab.context?.getTerminalManager()?.updateTheme();
      }
    });

    window.addEventListener("beforeunload", () => {
      this.dispose();
    });

    // Dev-only handle so demo scenarios (demo.ts) can drive the UI, e.g.
    // switch the right pane to the Plans mode after injecting a plans-list.
    if (import.meta.env.DEV) {
      (window as any).__cadeApp = this;
    }
  }

  /**
   * Initialize context for a tab.
   */
  /**
   * Spawn a new tab in the same project, primed on a plan/handoff doc.
   * "cli" boots the Claude Code CLI with an initial prompt; "chat" opens the
   * enhanced chat seeded with the handoff.
   */
  private launchPlanInTab(
    projectPath: string,
    relPath: string,
    kind: "cli" | "chat",
  ): void {
    const opts =
      kind === "cli"
        ? { initialPrompt: handoffPrompt(relPath) }
        : { chatHandoff: relPath };
    const tab = this.tabManager.createTab(projectPath, opts);
    this.tabManager.switchTab(tab.id);
  }

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

    // An unnamed tab follows the session title the agent sets on its
    // terminal; the backend label follows too, for listings and push.
    context.setOnAgentTitle((raw) => {
      const changed = this.tabManager.setAgentTitle(tab.id, sessionTitleFromTerminal(raw));
      if (changed) {
        changed.ws.sendSetLabel(tabDisplayName(changed));
        this.mobileUI?.refresh();
      }
    });

    // Plans pane → spawn a primed tab (CLI or enhanced chat).
    context.setOnLaunchPlan((relPath, kind) =>
      this.launchPlanInTab(tab.projectPath, relPath, kind),
    );

    // A chat-seeded tab opens straight into enhanced chat and primes the agent
    // with the chosen handoff. Sent as a normal chat message so it works for
    // any provider; one-shot so a reconnect doesn't re-fire it.
    if (tab.chatHandoff) {
      const seedRel = tab.chatHandoff;
      let primed = false;
      tab.ws.on("connected", () => {
        if (primed) return; // one-shot: don't re-fire on reconnect
        primed = true;
        tab.context?.getTerminalManager()?.setEnhanced(true);
        tab.ws.sendChatMessage(handoffPrompt(seedRel));
      });
    }

    // Demo mode: synthetic events injected by demo.ts; no server contact.
    const isDemoTab =
      import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");

    // In demo mode there's no start splash, but we still skip the per-tab
    // splash so it doesn't sit undismissed (no output event fires in demo).
    const splashActive = isDemoTab || (this.startSplash?.isVisible() ?? false);
    await context.initialize(splashActive);

    tab.ws.on("connected", (message) => {
      this.tabManager.setConnected(tab.id, true);
      // The session decides its group. A backend that predates groups sends
      // none, and the tab then keeps the group it has.
      if (message.group !== undefined) this.adoptGroupFromBackend(tab, message.group);
      // Only accept the server's workingDir if this tab had no saved path.
      // The server echoes back whatever the frontend sent — letting it
      // overwrite an existing tab path causes drift when the backend
      // defaults to a different cwd (e.g. started from a different project).
      if (message.workingDir && !tab.projectPath) {
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

    // The socket is attached to exactly this tab's session, so every
    // attention frame on it is about this tab.
    tab.ws.on("group-changed", (msg) => this.adoptGroupFromBackend(tab, msg.group));

    tab.ws.on("session-pr", (msg) => this.tabBar?.setPullRequest(tab.id, msg.pr));

    tab.ws.on("session-attention", (msg) => {
      const previous = this.attentionByTab.get(tab.id) ?? null;
      this.attentionByTab.set(tab.id, msg.attention);
      this.tabBar?.setAttention(tab.id, msg.attention, msg.message ?? null);
      this.mobileUI?.refresh();
      // Starting work is not worth interrupting anyone for.
      if ((msg.attention === "input" || msg.attention === "idle") && msg.attention !== previous) {
        notifyAttention(tabDisplayName(tab), msg.attention, msg.message ?? null, () => {
          this.tabManager.switchTab(tab.id);
        });
      }
    });

    // Output in a background tab is worth a dot on the phone's session strip.
    tab.ws.on("output", () => {
      if (this.tabManager.getActiveTabId() === tab.id) return;
      if (this.unreadTabs.has(tab.id)) return;
      this.unreadTabs.add(tab.id);
      this.mobileUI?.refresh();
    });

    if (!isDemoTab) {
      const matches = this.overridesMatchTab(tab);
      tab.ws.sendSetProject(
        tab.projectPath,
        tab.id,
        matches ? (this.dashboardOverride ?? undefined) : undefined,
        matches ? (this.providerOverride ?? undefined) : undefined,
        tab.initialPrompt,
        tab.chatHandoff,
        tabDisplayName(tab),
        tab.group,
        tab.agent,
        tab.startAgent,
      );

      // Auth is project-driven now: connect first; if the project's launch.yml
      // declares Google auth, the server sends an `auth-required` frame with
      // the client_id then closes with 1008. A stored id_token from a previous
      // sign-in is attached automatically inside connect().
      tab.ws.connect();
    }

    // Set up terminal key handler so global shortcuts don't leak into the shell.
    // Returning true makes xterm ignore the key (the KeybindingManager, running
    // on document in the capture phase, performs the actual action).
    context.setTerminalKeyHandler((e) => {
      return this.keybindingManager.wouldHandleGlobally(e);
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

    this.renderTabBar();
  }

  /**
   * Handle tab close.
   */
  private handleTabClose(id: string): void {
    // Closing a tab ends its session; only losing the connection keeps it.
    this.tabManager.getTabs().find((t) => t.id === id)?.ws.sendCloseSession();
    this.tabManager.closeTab(id);
  }

  /**
   * Handle add tab button click.
   */
  private async handleAddTab(): Promise<void> {
    // The key that opens the picker must not stack a second one on top.
    if (!this.tabContentContainer || this.projectPickerOpen) return;
    this.projectPickerOpen = true;
    const activeTabId = this.tabManager.getActiveTabId();
    const tabs = this.tabManager.getTabs();
    const picker = new ProjectPicker(this.tabContentContainer, {
      // A remote tab's path is on another machine; it is not a project to open here.
      openTabs: tabs
        .filter((t) => !t.isRemote)
        .map((t) => ({ path: t.projectPath, isActive: t.id === activeTabId })),
      recents: loadRecentProjects(),
      groups: [...new Set([...this.tabManager.getGroupNames(), ...this.groupDefs.map((d) => d.name)])],
      // A new tab belongs with the work on screen unless told otherwise.
      group: this.tabManager.getOpenWorkspace(),
      native: isTauri(),
      loadSessions: async () =>
        sessionsToAdopt(await WebSocketClient.fetchSessionList(), tabs.map((t) => t.id)),
    });
    const choice = await picker.show().finally(() => {
      this.projectPickerOpen = false;
    });
    if (!choice) return;

    if (choice.kind === "attach") {
      this.attachFromSplash(choice.session);
      return;
    }

    const path =
      choice.kind === "system" ? await pickProjectFolder(this.defaultProjectPath) : choice.path;
    if (!path) return;

    rememberRecentProject(path);
    this.startSplash?.setLoading();
    this.startSplashTimeout();
    const tab = this.tabManager.createTab(path, {
      ...(choice.group && { group: choice.group }),
      ...(choice.agent && { agent: choice.agent }),
      // Choosing here is asking for the agent, whatever the idle-shell setting says.
      startAgent: true,
      // The agent is handed the brief's path; what to do with it is the user's to say.
      ...(choice.kind === "project" &&
        choice.handoff && { initialPrompt: handoffPrompt(choice.handoff) }),
    });
    this.tabManager.switchTab(tab.id);
  }

  /**
   * Show the board for the project of the tab in front, and open a tab on
   * whatever is chosen there.
   */
  private async handleOpenBoard(): Promise<void> {
    const active = this.tabManager.getActiveTab();
    // A remote tab's project is on another machine, which this backend cannot read.
    if (!this.tabContentContainer || this.projectPickerOpen || !active || active.isRemote) return;
    this.projectPickerOpen = true;
    const board = new BoardScreen(this.tabContentContainer, {
      project: active.projectPath,
      openUrl: (url) => void openExternal(url),
    });
    const choice = await board.show().finally(() => {
      this.projectPickerOpen = false;
    });
    if (!choice) return;

    const group = this.tabManager.getOpenWorkspace();
    const tab = this.tabManager.createTab(choice.path, {
      ...(group && { group }),
      // The board has no agent toggle of its own: the new tab runs what the tab in front runs.
      ...(active.agent && { agent: active.agent }),
      startAgent: true,
      ...(choice.handoff && { initialPrompt: handoffPrompt(choice.handoff) }),
    });
    this.tabManager.switchTab(tab.id);
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

    // Remote browser/mobile: require auth before showing menu — but only when
    // the backend actually wants it. If /api/auth/check already accepted this
    // session (auth disabled, or valid cookie) the token splash is a dead end.
    if (isRemoteBrowserAccess() && !getAuthToken() && !serverAuthSatisfied) {
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
    this.pollSplashSessions(options);
  }

  /**
   * Sessions already running on this backend (started on another device,
   * or before this browser's storage was cleared) are offered on the splash
   * as ATTACH entries. A phone with no saved tabs has no other way in.
   */
  private pollSplashSessions(baseOptions: { label: string; action: () => void }[]): void {
    this.stopSplashSessionPoll();
    let shownIds = "";
    const tick = async () => {
      if (!this.startSplash?.isVisible()) {
        this.stopSplashSessionPoll();
        return;
      }
      const sessions = await WebSocketClient.fetchSessionList();
      if (!this.startSplash?.isVisible()) return;
      const live = sessionsToAdopt(sessions, this.tabManager.getTabs().map((t) => t.id));
      const ids = live.map((s) => s.id).join(",");
      if (ids === shownIds) return;
      shownIds = ids;
      const attach = live.map((session) => ({
        label: attachOptionLabel(session),
        action: () => this.attachFromSplash(session),
      }));
      this.startSplash?.setOptions([...attach, ...baseOptions]);
    };
    void tick();
    this.splashSessionTimer = window.setInterval(() => void tick(), 4000);
  }

  private stopSplashSessionPoll(): void {
    if (this.splashSessionTimer !== null) {
      window.clearInterval(this.splashSessionTimer);
      this.splashSessionTimer = null;
    }
  }

  private attachFromSplash(session: LiveSessionInfo): void {
    this.stopSplashSessionPoll();
    this.startSplash?.setLoading();
    this.startSplashTimeout();
    const tab = this.tabManager.adoptSession(
      session.id,
      session.projectPath,
      session.label,
      session.group,
    );
    this.tabManager.switchTab(tab.id);
  }

  private renderTabBar(): void {
    this.tabBar?.render(this.tabManager.getTabs(), this.tabManager.getActiveTabId(), {
      collapsed: this.tabManager.getCollapsedGroups(),
      defs: this.groupDefs,
    });
    // The phone's session strip draws the group in its colour too.
    this.mobileUI?.refresh();
  }

  /** Keep the new group definitions, redraw, and store them on the backend. */
  private setGroupDefs(defs: TabGroupDef[]): void {
    if (defs === this.groupDefs) return;
    this.groupDefs = defs;
    this.renderTabBar();
    WebSocketClient.saveTabGroups(defs)
      .then((ok) => {
        if (!ok) console.warn("[CADE] Backend refused the tab group definitions");
      })
      .catch((e) => console.warn("[CADE] Could not save tab group definitions:", e));
  }

  /** Move a tab to a group (null for none) and tell its session. */
  private moveTabToGroup(tabId: string, group: string | null): void {
    const moved = this.tabManager.setTabGroup(tabId, group);
    moved?.ws.sendSetGroup(group);
    this.mobileUI?.refresh();
  }

  /** A group the session's backend reported; nothing to send back. */
  private adoptGroupFromBackend(tab: TabState, group: string | null): void {
    tab.ws.noteGroup(group);
    this.tabManager.setTabGroup(tab.id, group);
    // A group named by a folder rule may have been defined on another device.
    if (group && !this.groupDefs.some((d) => d.name === group)) this.loadGroupDefs();
  }

  private loadGroupDefs(): void {
    WebSocketClient.fetchTabGroups()
      .then((defs) => {
        this.groupDefs = defs;
        this.renderTabBar();
      })
      .catch((e) => console.warn("[CADE] Could not load tab group definitions:", e));
  }

  /** Move to the next or previous workspace; holding the key lists them. */
  private stepWorkspace(step: number): void {
    if (this.tabManager.getWorkspaces().length < 2) return;
    this.tabManager.switchWorkspace(this.tabManager.workspaceAt(step));
    this.workspaceSwitcher ??= new WorkspaceSwitcher(document.body, () => this.workspaceRows());
    this.workspaceSwitcher.noteSwitch();
  }

  private workspaceRows(): WorkspaceRow[] {
    const tabs = this.tabManager.getTabs();
    const open = this.tabManager.getOpenWorkspace();
    return this.tabManager.getWorkspaces().map((name) => {
      const members = tabs.filter((t) => (t.group ?? null) === name);
      return {
        name,
        colour: this.groupDefs.find((d) => d.name === name)?.colour,
        tabs: members.length,
        waiting: members.filter((t) => this.tabBar?.attentionOf(t.id) === "input").length,
        open: name === open,
      };
    });
  }

  private wireTabGroupEvents(tabBar: TabBar): void {
    tabBar.on("tab-set-group", ({ tabId, group }) => this.moveTabToGroup(tabId, group));

    tabBar.on("tab-new-group", (tabId) => {
      const taken = [...this.tabManager.getGroupNames(), ...this.groupDefs.map((d) => d.name)];
      const name = newGroupName(taken);
      this.setGroupDefs(withGroupDef(this.groupDefs, name));
      this.moveTabToGroup(tabId, name);
      // Straight into naming it, as the placeholder name is never the one wanted.
      tabBar.startGroupRename(name);
    });

    // One workspace is open at a time, so a chip is a way into its workspace.
    tabBar.on("group-toggle", (group) => this.tabManager.switchWorkspace(group || null));
    tabBar.on("group-solo", (group) => this.tabManager.switchWorkspace(group || null));

    tabBar.on("group-rename", ({ group, name }) => {
      const moved = this.tabManager.renameGroup(group, name);
      if (moved.length === 0) return;
      const renamed = moved[0]!.group!;
      for (const tab of moved) tab.ws.sendSetGroup(renamed);
      this.setGroupDefs(withGroupRenamed(withGroupDef(this.groupDefs, group), group, renamed));
    });

    tabBar.on("group-colour", ({ group, colour }) => {
      this.setGroupDefs(withGroupDef(this.groupDefs, group, { colour }));
    });

    tabBar.on("group-ungroup", (group) => {
      for (const tab of this.tabManager.ungroup(group)) tab.ws.sendSetGroup(null);
      // Its folder rule goes too, or the next tab opened there would bring
      // the group straight back.
      this.setGroupDefs(withoutGroupDef(this.groupDefs, group));
    });

    tabBar.on("group-auto-add", ({ group, folder, enabled }) => {
      const def = this.groupDefs.find((d) => d.name === group);
      this.setGroupDefs(
        withGroupDef(this.groupDefs, group, { paths: withAutoAdd(def, folder, enabled) }),
      );
    });
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
          const newTab = await this.tabManager.createRemoteTab(profile, resumePath, tab.group);
          this.tabManager.switchTab(newTab.id);
        } catch (error) {
          console.error("Failed to reconnect remote tab:", error);
        }
      }
    } finally {
      this.resumeInProgress = false;
    }

    const updatedTabs = this.tabManager.getTabs();
    this.renderTabBar();

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
  /** Send an anomaly to the backend log through whichever tab is connected. */
  reportDiagnostic(kind: string, detail: string): void {
    this.tabManager.getActiveTab()?.ws.sendDiagnostic(kind, detail);
  }

  private initMobileUIIfNeeded(): void {
    if (this.mobileUI) return;

    const tab = this.tabManager.getActiveTab();
    if (!tab) return;

    this.mobileUI = new MobileUI(tab.ws, {
      sendInput: (data) => {
        const active = this.tabManager.getActiveTab();
        active?.context?.getTerminalManager()?.sendInput(data);
      },
      sendComposed: (text) => {
        const active = this.tabManager.getActiveTab();
        active?.context?.getTerminalManager()?.sendComposed(text);
      },
      setKeyboardOpen: (open) => {
        const active = this.tabManager.getActiveTab();
        active?.context?.getTerminalManager()?.setKeyboardOpen(open);
      },
      onRepaint: () => {
        const active = this.tabManager.getActiveTab();
        active?.context?.getTerminalManager()?.requestRepaint();
      },
      getTabs: () => {
        const activeId = this.tabManager.getActiveTabId();
        return this.tabManager.getTabs().map((t) => ({
          id: t.id,
          name: tabDisplayName(t),
          projectPath: t.projectPath,
          isActive: t.id === activeId,
          unread: this.unreadTabs.has(t.id),
          attention: this.attentionByTab.get(t.id) ?? null,
          ...(t.group && {
            group: t.group,
            groupColour: groupColourVar(this.groupDefs.find((d) => d.name === t.group)?.colour),
          }),
        }));
      },
      onSwitchTab: (id) => {
        this.tabManager.switchTab(id);
      },
      getOpenTabIds: () => this.tabManager.getTabs().map((t) => t.id),
      onCloseActiveTab: () => {
        // The phone's action is "detach": it says it leaves the session
        // running, so it only drops the tab and does not end the session.
        const id = this.tabManager.getActiveTabId();
        if (id) this.tabManager.closeTab(id);
      },
      onAdoptSession: (session) => {
        const adopted = this.tabManager.adoptSession(
          session.id,
          session.projectPath,
          session.label,
          session.group,
        );
        this.tabManager.switchTab(adopted.id);
      },
      getActiveWs: () => {
        return this.tabManager.getActiveTab()?.ws ?? tab.ws;
      },
      onTheme: () => this.themeSelector.toggle(),
      getCurrentThemeName: () => {
        const id = getSavedThemeId();
        return themes.find((t) => t.id === id)?.name ?? id;
      },
      getDashboardContainer: () =>
        this.tabManager.getActiveTab()?.context?.getDashboardFullContainer() ??
        null,
      dashboardHasConfig: () =>
        this.tabManager.getActiveTab()?.context?.hasDashboard() ?? false,
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
    this.workspaceSwitcher?.dispose();
    this.tabManager.dispose();
  }
}

const app = new App();

// Set once the backend confirms it accepts this session (auth disabled, or a
// valid session cookie). When true, the frontend must not impose its own
// remote-access token gate — the backend isn't asking for one (e.g. CADE sat
// behind an external auth proxy with CADE_AUTH_ENABLED=false).
let serverAuthSatisfied = false;

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
    serverAuthSatisfied = true;
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

  // Installed before any terminal exists so a stray drop during startup can
  // never navigate the page away.
  installFileDropHandling();
  installShellListeners((detail) => app.reportDiagnostic("app-zoom", detail));

  // Block app init until every registered font face is loaded. Chrome returns
  // FontFace.family with quotes for multi-word families ("JetBrains Mono"),
  // so filtering by family === "JetBrains Mono" silently matches nothing.
  // Loading all faces is safe — only JetBrains Mono is registered — and
  // guarantees the OffscreenCanvas-visible load that document.fonts.ready
  // alone does not. See docs/reference/xterm-webfont-loading.md.
  try {
    await document.fonts.ready;
    await Promise.all(Array.from(document.fonts).map((f) => f.load()));
  } catch (e) {
    console.warn("[main] font load failed, using fallback:", e);
  }

  app.initialize().catch((e) => {
    console.error("Failed to initialize app:", e);
  });
});

