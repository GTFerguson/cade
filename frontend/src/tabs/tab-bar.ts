/**
 * Tab bar UI component.
 */

import type { Component, EventHandler } from "../types";
import type { TabBarEvents, TabState } from "./types";
import { minimizeWindow, toggleMaximizeWindow, closeWindow } from "../tauri-bridge";

export class TabBar implements Component {
  private handlers: Map<
    keyof TabBarEvents,
    Set<EventHandler<TabBarEvents[keyof TabBarEvents]>>
  > = new Map();

  constructor(private container: HTMLElement) {}

  /**
   * Initialize the tab bar.
   */
  initialize(): void {
    this.render([]);
  }

  /**
   * Render the tab bar with the given tabs.
   */
  render(tabs: TabState[], activeTabId: string | null = null): void {
    this.container.innerHTML = "";

    const isTauri = (window as any).__TAURI__ === true;

    // Add draggable spacers for empty grid areas (replaces ::before and ::after)
    if (isTauri) {
      const spacerLeft = document.createElement("div");
      spacerLeft.className = "tab-bar-spacer-left";
      spacerLeft.setAttribute("data-tauri-drag-region", "");
      this.container.appendChild(spacerLeft);
    }

    const tabArea = document.createElement("div");
    tabArea.className = "tab-area";

    const tabList = document.createElement("div");
    tabList.className = "tab-list";

    for (const tab of tabs) {
      const tabEl = this.createTabElement(tab, tab.id === activeTabId);
      tabList.appendChild(tabEl);
    }

    tabArea.appendChild(tabList);

    const addButton = document.createElement("button");
    addButton.className = "tab-add-button";
    addButton.title = "Open new project";
    addButton.textContent = "+";
    addButton.addEventListener("click", (e) => {
      e.stopPropagation();
      this.emit("tab-add", undefined);
    });

    tabArea.appendChild(addButton);
    this.container.appendChild(tabArea);

    if (isTauri) {
      const spacerRight = document.createElement("div");
      spacerRight.className = "tab-bar-spacer-right";
      spacerRight.setAttribute("data-tauri-drag-region", "");
      this.container.appendChild(spacerRight);

      const windowControls = this.createWindowControls();
      this.container.appendChild(windowControls);
    }
  }

  /**
   * Create a tab element.
   */
  private createTabElement(tab: TabState, isActive: boolean): HTMLElement {
    const tabEl = document.createElement("div");
    tabEl.className = `tab${isActive ? " active" : ""}`;
    tabEl.dataset["tabId"] = tab.id;

    const nameEl = document.createElement("span");
    nameEl.className = "tab-name";
    nameEl.textContent = tab.name;
    nameEl.title = tab.projectPath;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.title = "Close tab";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.emit("tab-close", tab.id);
    });

    tabEl.appendChild(nameEl);
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener("click", () => {
      this.emit("tab-select", tab.id);
    });

    return tabEl;
  }

  /**
   * Create window control buttons for Tauri.
   */
  private createWindowControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "tab-bar-window-controls";
    controls.setAttribute("data-tauri-drag-region", "false");

    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "window-control-button window-minimize";
    minimizeBtn.setAttribute("aria-label", "Minimize");
    minimizeBtn.innerHTML = `
      <svg width="10" height="1" viewBox="0 0 10 1">
        <rect fill="currentColor" width="10" height="1"/>
      </svg>
    `;
    minimizeBtn.addEventListener("click", () => {
      minimizeWindow();
    });

    const maximizeBtn = document.createElement("button");
    maximizeBtn.className = "window-control-button window-maximize";
    maximizeBtn.setAttribute("aria-label", "Maximize");
    maximizeBtn.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10">
        <rect fill="none" stroke="currentColor" stroke-width="1" x="0.5" y="0.5" width="9" height="9"/>
      </svg>
    `;
    maximizeBtn.addEventListener("click", () => {
      toggleMaximizeWindow();
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "window-control-button window-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10">
        <line stroke="currentColor" stroke-width="1" x1="0" y1="0" x2="10" y2="10"/>
        <line stroke="currentColor" stroke-width="1" x1="10" y1="0" x2="0" y2="10"/>
      </svg>
    `;
    closeBtn.addEventListener("click", () => {
      closeWindow();
    });

    controls.appendChild(minimizeBtn);
    controls.appendChild(maximizeBtn);
    controls.appendChild(closeBtn);

    return controls;
  }

  /**
   * Register an event handler.
   */
  on<K extends keyof TabBarEvents>(
    event: K,
    handler: EventHandler<TabBarEvents[K]>
  ): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers
      .get(event)!
      .add(handler as EventHandler<TabBarEvents[keyof TabBarEvents]>);
  }

  /**
   * Remove an event handler.
   */
  off<K extends keyof TabBarEvents>(
    event: K,
    handler: EventHandler<TabBarEvents[K]>
  ): void {
    this.handlers
      .get(event)
      ?.delete(handler as EventHandler<TabBarEvents[keyof TabBarEvents]>);
  }

  /**
   * Emit an event.
   */
  private emit<K extends keyof TabBarEvents>(
    event: K,
    data: TabBarEvents[K]
  ): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in TabBar ${event} handler:`, e);
      }
    });
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.container.innerHTML = "";
    this.handlers.clear();
  }
}
