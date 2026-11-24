/**
 * Tab bar UI component.
 */

import type { AttentionState, Component, EventHandler } from "../types";
import type { TabBarEvents, TabState } from "./types";
import { minimizeWindow, toggleMaximizeWindow, closeWindow } from "@core/platform/tauri-bridge";
import { TabDragController } from "./tab-drag";
import { tabDisplayName } from "./session-title";

/** Two clicks on a tab's name within this window start a rename. */
const RENAME_DOUBLE_CLICK_MS = 400;

interface TabStatus {
  state: AttentionState;
  message: string | null;
}

/**
 * How each agent state reads on a tab. The glyph differs per state so the
 * meaning does not rest on colour alone.
 */
export const STATUS_DISPLAY: Record<"input" | "idle" | "working" | "none", { glyph: string; title: string }> = {
  input: { glyph: "!", title: "Needs you" },
  working: { glyph: "\u25cf", title: "Working" },
  idle: { glyph: "\u2713", title: "Finished, ready for the next prompt" },
  none: { glyph: "\u00b7", title: "No agent activity reported" },
};

export class TabBar implements Component {
  private handlers: Map<
    keyof TabBarEvents,
    Set<EventHandler<TabBarEvents[keyof TabBarEvents]>>
  > = new Map();

  private drag: TabDragController | null = null;
  // Tab updates that arrive mid-drag, applied on drop so a re-render can't
  // pull the tab out from under the pointer.
  private pendingRender: [TabState[], string | null] | null = null;

  private status = new Map<string, TabStatus>();
  private renamingTabId: string | null = null;
  // The first click of a double-click selects the tab, which re-renders the
  // bar and replaces the element, so the browser's own dblclick never fires.
  private lastNameClick: { tabId: string; at: number } | null = null;

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
    // A re-render replaces every tab element, which would drop a tab being
    // dragged or throw away a name being typed.
    if (this.drag?.isDragging() || this.renamingTabId !== null) {
      this.pendingRender = [tabs, activeTabId];
      return;
    }
    this.pendingRender = null;
    for (const id of this.status.keys()) {
      if (!tabs.some((t) => t.id === id)) this.status.delete(id);
    }
    this.container.innerHTML = "";
    this.container.classList.toggle("empty", tabs.length === 0);

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

    // Make the tab area background draggable in Tauri
    // Interactive elements have pointer-events: auto to override
    if (isTauri) {
      tabArea.setAttribute("data-tauri-drag-region", "");
    }

    const tabList = document.createElement("div");
    tabList.className = "tab-list";

    this.drag = new TabDragController(
      tabList,
      (tabId, toIndex) => this.emit("tab-reorder", { tabId, toIndex }),
      () => {
        if (this.pendingRender) this.render(...this.pendingRender);
      },
    );

    for (const tab of tabs) {
      const tabEl = this.createTabElement(tab, tab.id === activeTabId);
      this.drag.attach(tabEl);
      tabList.appendChild(tabEl);
    }

    tabArea.appendChild(tabList);

    const addButton = document.createElement("button");
    addButton.className = "tab-add-button";
    addButton.title = "Open new project (Shift+click for remote)";
    addButton.textContent = "+";

    // Capture shiftKey on mousedown before Tauri's drag region processing
    // can strip modifier keys from the synthesized click event
    let shiftHeld = false;
    addButton.addEventListener("mousedown", (e) => {
      shiftHeld = e.shiftKey;
    });
    addButton.addEventListener("click", (e) => {
      e.stopPropagation();
      console.log("[CADE] Add button clicked, shiftKey:", e.shiftKey, "shiftHeld:", shiftHeld);
      if (shiftHeld || e.shiftKey) {
        console.log("[CADE] Emitting tab-add-remote");
        this.emit("tab-add-remote", undefined);
      } else {
        console.log("[CADE] Emitting tab-add");
        this.emit("tab-add", undefined);
      }
      shiftHeld = false;
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

    if (tab.isRemote) {
      const icon = document.createElement("span");
      icon.className = "tab-remote-icon";

      if (tab.tunnelPid) {
        icon.textContent = "ssh";
        icon.title = `Remote via SSH tunnel (PID: ${tab.tunnelPid})`;
      } else {
        icon.textContent = "tcp";
        icon.title = "Remote direct connection";
      }

      tabEl.appendChild(icon);
    }

    const statusEl = document.createElement("span");
    statusEl.className = "tab-status";
    this.paintStatus(tabEl, statusEl, this.status.get(tab.id) ?? null);
    tabEl.appendChild(statusEl);

    const nameEl = document.createElement("span");
    nameEl.className = "tab-name";
    nameEl.textContent = tabDisplayName(tab);
    nameEl.title = `${tab.projectPath}\nDouble-click to rename`;
    nameEl.addEventListener("click", () => {
      const now = Date.now();
      const last = this.lastNameClick;
      if (last && last.tabId === tab.id && now - last.at <= RENAME_DOUBLE_CLICK_MS) {
        this.lastNameClick = null;
        // Let this click's own tab-select render finish first.
        queueMicrotask(() => this.startRename(tab.id));
      } else {
        this.lastNameClick = { tabId: tab.id, at: now };
      }
    });

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
   * Show what a tab's agent is doing. Updates the tab in place so a status
   * change never interrupts a drag or a rename.
   */
  setAttention(tabId: string, state: AttentionState, message: string | null = null): void {
    this.status.set(tabId, { state, message });
    const tabEl = this.findTab(tabId);
    const statusEl = tabEl?.querySelector<HTMLElement>(".tab-status");
    if (tabEl && statusEl) this.paintStatus(tabEl, statusEl, { state, message });
  }

  private findTab(tabId: string): HTMLElement | null {
    for (const el of this.container.querySelectorAll<HTMLElement>(".tab")) {
      if (el.dataset["tabId"] === tabId) return el;
    }
    return null;
  }

  private paintStatus(tabEl: HTMLElement, statusEl: HTMLElement, status: TabStatus | null): void {
    const key = status?.state ?? "none";
    const display = STATUS_DISPLAY[key];
    tabEl.dataset["status"] = key;
    statusEl.textContent = display.glyph;
    statusEl.title = status?.message ? `${display.title}: ${status.message}` : display.title;
    statusEl.setAttribute("aria-label", display.title);
  }

  /**
   * Swap a tab's name for a text field. Enter or clicking away keeps the new
   * name, Escape keeps the old one.
   */
  startRename(tabId: string): void {
    if (this.renamingTabId !== null || this.drag?.isDragging()) return;
    const tabEl = this.findTab(tabId);
    const nameEl = tabEl?.querySelector<HTMLElement>(".tab-name");
    if (!tabEl || !nameEl) return;

    const input = document.createElement("input");
    input.className = "tab-name-input";
    input.type = "text";
    input.value = nameEl.textContent ?? "";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Tab name");

    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      const name = input.value;
      this.renamingTabId = null;
      input.replaceWith(nameEl);
      if (commit) this.emit("tab-rename", { tabId, name });
      if (this.pendingRender) this.render(...this.pendingRender);
    };

    input.addEventListener("keydown", (e) => {
      // Keep app-level shortcuts and the terminal from seeing the typing.
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    // Pressing inside the field must not start a tab drag or switch tabs.
    for (const type of ["pointerdown", "mousedown", "click"] as const) {
      input.addEventListener(type, (e) => e.stopPropagation());
    }

    this.renamingTabId = tabId;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
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
