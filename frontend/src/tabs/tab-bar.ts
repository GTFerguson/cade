/**
 * Tab bar UI component.
 */

import type { Component, EventHandler } from "../types";
import type { TabBarEvents, TabState } from "./types";

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

    const tabArea = document.createElement("div");
    tabArea.className = "tab-area";

    const tabList = document.createElement("div");
    tabList.className = "tab-list";

    for (const tab of tabs) {
      const tabEl = this.createTabElement(tab, tab.id === activeTabId);
      tabList.appendChild(tabEl);
    }

    const addButton = document.createElement("button");
    addButton.className = "tab-add-button";
    addButton.title = "Open new project";
    addButton.textContent = "+";
    addButton.addEventListener("click", () => {
      this.emit("tab-add", undefined);
    });

    tabArea.appendChild(tabList);
    tabArea.appendChild(addButton);
    this.container.appendChild(tabArea);
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
