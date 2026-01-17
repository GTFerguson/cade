/**
 * Main entry point for ccplus frontend.
 */

import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/vs2015.css";
import "../styles/main.css";

import { config } from "./config";
import { HelpOverlay } from "./help-overlay";
import { KeybindingManager } from "./keybindings";
import { MobileUI } from "./mobile";
import { ProjectContextImpl, TabBar, TabManager } from "./tabs";
import type { TabState } from "./tabs";

class App {
  private tabManager: TabManager;
  private tabBar: TabBar | null = null;
  private mobileUI: MobileUI | null = null;
  private tabContentContainer: HTMLElement | null = null;
  private defaultProjectPath: string;
  private keybindingManager: KeybindingManager;
  private helpOverlay: HelpOverlay;

  constructor() {
    this.tabManager = new TabManager();
    this.defaultProjectPath = this.getDefaultProjectPath();
    this.keybindingManager = new KeybindingManager();
    this.helpOverlay = new HelpOverlay();
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
    return config.defaultProjectPath || ".";
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

    this.tabManager.on("tab-created", (tab) => {
      this.initializeTabContext(tab);
    });

    this.tabManager.on("tab-switched", (tab) => {
      this.handleTabSwitch(tab);
    });

    this.tabManager.on("tabs-changed", (tabs) => {
      this.tabBar?.render(tabs, this.tabManager.getActiveTabId());
    });

    if (!this.tabManager.hasTabs()) {
      this.tabManager.createTab(this.defaultProjectPath);
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

    const initialActiveTab = this.tabManager.getActiveTab();
    if (initialActiveTab) {
      this.mobileUI = new MobileUI(initialActiveTab.ws);
      this.mobileUI.initialize();
    }

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
    });

    tab.ws.on("disconnected", () => {
      this.tabManager.setConnected(tab.id, false);
    });

    tab.ws.sendSetProject(tab.projectPath, tab.id);
    tab.ws.connect();

    // Set up terminal key handler for prefix key interception
    context.setTerminalKeyHandler((e) => {
      // Intercept Ctrl-a (prefix key)
      if (e.ctrlKey && e.key === "a" && !e.shiftKey && !e.altKey && !e.metaKey) {
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
    const tabs = this.tabManager.getTabs();

    if (tabs.length <= 1) {
      return;
    }

    this.tabManager.closeTab(id);
  }

  /**
   * Handle add tab button click.
   */
  private handleAddTab(): void {
    const path = window.prompt(
      "Enter project path:",
      this.defaultProjectPath
    );

    if (path) {
      const tab = this.tabManager.createTab(path);
      this.tabManager.switchTab(tab.id);
    }
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

document.addEventListener("DOMContentLoaded", () => {
  app.initialize().catch((e) => {
    console.error("Failed to initialize app:", e);
  });
});
