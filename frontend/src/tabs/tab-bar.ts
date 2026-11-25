/**
 * Tab bar UI component.
 */

import type { AttentionState, Component, EventHandler } from "../types";
import type { TabBarEvents, TabState } from "./types";
import { minimizeWindow, toggleMaximizeWindow, closeWindow } from "@core/platform/tauri-bridge";
import { TabDragController } from "./tab-drag";
import { tabDisplayName } from "./session-title";
import {
  GROUP_COLOURS,
  groupAutoAdds,
  groupColourVar,
  groupRollup,
  parentFolder,
  tabRuns,
  type TabGroupDef,
} from "./tab-groups";
import { openTabMenu, type MenuEntry } from "./tab-menu";

/** Two clicks on a tab's name within this window start a rename. */
const RENAME_DOUBLE_CLICK_MS = 400;

interface TabStatus {
  state: AttentionState;
  message: string | null;
}

/** What the bar needs to know about groups beyond each tab's own group name. */
export interface TabBarGroups {
  collapsed: ReadonlySet<string>;
  defs: TabGroupDef[];
}

const NO_GROUPS: TabBarGroups = { collapsed: new Set(), defs: [] };

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

  // One per run of tabs, so a drag stays inside the tab's own group.
  private drags: TabDragController[] = [];
  // Tab updates that arrive mid-drag, applied on drop so a re-render can't
  // pull the tab out from under the pointer.
  private pendingRender: [TabState[], string | null, TabBarGroups] | null = null;

  private status = new Map<string, TabStatus>();
  private tabs: TabState[] = [];
  private activeTabId: string | null = null;
  private groups: TabBarGroups = NO_GROUPS;
  private updateReady = false;
  // A name being typed, of a tab or of a group. Holds back re-renders.
  private renaming = false;
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
  render(
    tabs: TabState[],
    activeTabId: string | null = null,
    groups: TabBarGroups = NO_GROUPS,
  ): void {
    // A re-render replaces every tab element, which would drop a tab being
    // dragged or throw away a name being typed.
    if (this.isDragging() || this.renaming) {
      this.pendingRender = [tabs, activeTabId, groups];
      return;
    }
    this.pendingRender = null;
    this.tabs = tabs;
    this.activeTabId = activeTabId;
    this.groups = groups;
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

    this.drags = [];
    for (const run of tabRuns(tabs)) {
      const collapsed = run.group !== null && groups.collapsed.has(run.group);
      const runEl = collapsed ? null : this.createRunElement(run.tabs, activeTabId);
      if (run.group === null) {
        tabList.appendChild(runEl!);
        continue;
      }
      const groupEl = document.createElement("div");
      groupEl.className = "tab-group";
      groupEl.dataset["group"] = run.group;
      groupEl.dataset["collapsed"] = String(collapsed);
      groupEl.style.setProperty("--group-colour", groupColourVar(this.groupDef(run.group)?.colour));
      groupEl.appendChild(this.createChipElement(run.group, collapsed));
      if (runEl) groupEl.appendChild(runEl);
      tabList.appendChild(groupEl);
    }

    tabArea.appendChild(tabList);

    const addButton = document.createElement("button");
    addButton.className = "tab-add-button";
    addButton.title = "Open new project (Shift+click for remote)";
    addButton.setAttribute("aria-label", "Open new project");
    // Drawn, not typed: a "+" glyph sits wherever its font puts it, which is
    // not the middle of the line the tab names are on.
    addButton.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
        <path d="M5.5 0.5v10M0.5 5.5h10" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    `;

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
    if (this.updateReady) tabArea.appendChild(this.createUpdateMarker());
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
   * Show or hide the marker for a newer interface waiting to be loaded.
   * Loading it redraws every terminal, so it waits for a click.
   */
  setUpdateReady(ready: boolean): void {
    if (this.updateReady === ready) return;
    this.updateReady = ready;
    this.render(this.tabs, this.activeTabId, this.groups);
  }

  private createUpdateMarker(): HTMLElement {
    const marker = document.createElement("button");
    marker.className = "tab-update-marker";
    marker.textContent = "update ready";
    marker.title = "A new version of CADE is installed. Click to reload; your tabs reopen.";
    marker.addEventListener("click", (e) => {
      e.stopPropagation();
      this.emit("update-reload", undefined);
    });
    return marker;
  }

  private isDragging(): boolean {
    return this.drags.some((d) => d.isDragging());
  }

  private groupDef(group: string): TabGroupDef | undefined {
    return this.groups.defs.find((d) => d.name === group);
  }

  /**
   * A run of tabs that can be reordered among themselves. Each run has its
   * own drag controller, which is what keeps a drag from crossing into or out
   * of a group.
   */
  private createRunElement(tabs: TabState[], activeTabId: string | null): HTMLElement {
    const runEl = document.createElement("div");
    runEl.className = "tab-run";
    const drag = new TabDragController(
      runEl,
      (tabId, toIndex) => this.emit("tab-reorder", { tabId, toIndex }),
      () => {
        if (this.pendingRender) this.render(...this.pendingRender);
      },
    );
    this.drags.push(drag);
    for (const tab of tabs) {
      const tabEl = this.createTabElement(tab, tab.id === activeTabId);
      drag.attach(tabEl);
      runEl.appendChild(tabEl);
    }
    return runEl;
  }

  /**
   * The chip that heads a group. Click collapses or expands the group;
   * collapsed, it stands in for the tabs and shows what they need.
   */
  private createChipElement(group: string, collapsed: boolean): HTMLElement {
    // Not a <button>: the name turns into a text field during a rename, and
    // a field inside a button cannot be clicked into or take a space.
    const chip = document.createElement("div");
    chip.className = "tab-group-chip";
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    chip.setAttribute("aria-expanded", String(!collapsed));

    const statusEl = document.createElement("span");
    statusEl.className = "tab-group-status";
    chip.appendChild(statusEl);

    const nameEl = document.createElement("span");
    nameEl.className = "tab-group-name";
    nameEl.textContent = group;
    chip.appendChild(nameEl);

    if (collapsed) {
      const countEl = document.createElement("span");
      countEl.className = "tab-group-count";
      countEl.textContent = String(this.tabs.filter((t) => t.group === group).length);
      chip.appendChild(countEl);
    }

    this.paintChip(chip, group, collapsed);
    chip.addEventListener("click", () => this.emit("group-toggle", group));
    chip.addEventListener("keydown", (e) => {
      if (e.target !== chip || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      this.emit("group-toggle", group);
    });
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openTabMenu(e.clientX, e.clientY, this.chipMenu(group));
    });
    return chip;
  }

  /** Show on a collapsed group's chip what the tabs inside it need. */
  private paintChip(chip: HTMLElement, group: string, collapsed: boolean): void {
    const members = this.tabs.filter((t) => t.group === group);
    const rollup = collapsed
      ? groupRollup(members.map((t) => this.status.get(t.id)?.state ?? null))
      : { state: "none" as const, waiting: 0 };
    const statusEl = chip.querySelector<HTMLElement>(".tab-group-status");
    chip.dataset["status"] = rollup.state;
    const names = members.map((t) => tabDisplayName(t)).join(", ");
    const action = collapsed ? "Click to expand" : "Click to collapse";
    if (statusEl) {
      statusEl.textContent =
        rollup.state === "none"
          ? ""
          : STATUS_DISPLAY[rollup.state].glyph + (rollup.waiting > 1 ? String(rollup.waiting) : "");
    }
    const needs =
      rollup.state === "input"
        ? `${rollup.waiting} waiting on you. `
        : rollup.state === "none"
          ? ""
          : `${STATUS_DISPLAY[rollup.state].title}. `;
    chip.title = `${group}: ${names}\n${needs}${action}, right-click for more`;
  }

  private findChip(group: string): HTMLElement | null {
    for (const el of this.container.querySelectorAll<HTMLElement>(".tab-group")) {
      if (el.dataset["group"] === group) return el.querySelector<HTMLElement>(".tab-group-chip");
    }
    return null;
  }

  private tabMenu(tab: TabState): MenuEntry[] {
    const entries: MenuEntry[] = [];
    const others = [...new Set(this.tabs.map((t) => t.group).filter((g): g is string => !!g))]
      .filter((g) => g !== tab.group);
    if (others.length > 0) {
      entries.push({ kind: "heading", label: "Move to group" });
      for (const group of others) {
        entries.push({
          kind: "action",
          label: group,
          action: () => this.emit("tab-set-group", { tabId: tab.id, group }),
        });
      }
      entries.push({ kind: "separator" });
    }
    entries.push({
      kind: "action",
      label: "New group",
      action: () => this.emit("tab-new-group", tab.id),
    });
    if (tab.group) {
      entries.push({
        kind: "action",
        label: "Remove from group",
        action: () => this.emit("tab-set-group", { tabId: tab.id, group: null }),
      });
    }
    entries.push({ kind: "separator" });
    entries.push({ kind: "action", label: "Rename tab", action: () => this.startRename(tab.id) });
    entries.push({ kind: "action", label: "Close tab", action: () => this.emit("tab-close", tab.id) });
    return entries;
  }

  private chipMenu(group: string): MenuEntry[] {
    const def = this.groupDef(group);
    const entries: MenuEntry[] = [
      { kind: "action", label: "Rename group", action: () => this.startGroupRename(group) },
      {
        kind: "swatches",
        label: "Group colour",
        options: GROUP_COLOURS.map((c) => ({ value: c, css: groupColourVar(c) })),
        selected: def?.colour ?? "",
        onPick: (colour) => this.emit("group-colour", { group, colour }),
      },
      { kind: "separator" },
      { kind: "action", label: "Show only this group", action: () => this.emit("group-solo", group) },
    ];
    // Offer the folder above each of the group's projects: "everything under
    // here belongs to this group" is the rule people mean.
    const folders = new Set<string>();
    for (const tab of this.tabs) {
      const folder = tab.group === group && !tab.isRemote ? parentFolder(tab.projectPath) : null;
      if (folder) folders.add(folder);
    }
    for (const path of def?.paths ?? []) folders.add(path);
    if (folders.size > 0) {
      entries.push({ kind: "separator" });
      entries.push({ kind: "heading", label: "Add new tabs under" });
      for (const folder of folders) {
        const enabled = groupAutoAdds(def, folder);
        entries.push({
          kind: "action",
          label: folder,
          checked: enabled,
          action: () => this.emit("group-auto-add", { group, folder, enabled: !enabled }),
        });
      }
    }
    entries.push({ kind: "separator" });
    entries.push({ kind: "action", label: "Ungroup", action: () => this.emit("group-ungroup", group) });
    return entries;
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
    tabEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openTabMenu(e.clientX, e.clientY, this.tabMenu(tab));
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
    const group = this.tabs.find((t) => t.id === tabId)?.group;
    const chip = group ? this.findChip(group) : null;
    if (chip && group) this.paintChip(chip, group, this.groups.collapsed.has(group));
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
    const nameEl = this.findTab(tabId)?.querySelector<HTMLElement>(".tab-name");
    if (nameEl) this.editName(nameEl, "Tab name", (name) => this.emit("tab-rename", { tabId, name }));
  }

  /** Swap a group chip's name for a text field, as for a tab. */
  startGroupRename(group: string): void {
    const nameEl = this.findChip(group)?.querySelector<HTMLElement>(".tab-group-name");
    if (nameEl) {
      this.editName(nameEl, "Group name", (name) => this.emit("group-rename", { group, name }));
    }
  }

  private editName(nameEl: HTMLElement, label: string, commit: (name: string) => void): void {
    if (this.renaming || this.isDragging()) return;

    const input = document.createElement("input");
    input.className = "tab-name-input";
    input.type = "text";
    input.value = nameEl.textContent ?? "";
    input.spellcheck = false;
    input.setAttribute("aria-label", label);

    let finished = false;
    const finish = (keep: boolean) => {
      if (finished) return;
      finished = true;
      const name = input.value;
      this.renaming = false;
      input.replaceWith(nameEl);
      if (keep) commit(name);
      if (this.pendingRender) this.render(...this.pendingRender);
    };

    input.addEventListener("keydown", (e) => {
      // Keep app-level shortcuts and the terminal from seeing the typing.
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    // Pressing inside the field must not start a tab drag, switch tabs or
    // collapse the group.
    for (const type of ["pointerdown", "mousedown", "click"] as const) {
      input.addEventListener(type, (e) => e.stopPropagation());
    }

    this.renaming = true;
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
