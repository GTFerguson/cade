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
  UNGROUPED,
  type GroupRollup,
  type TabGroupDef,
} from "./tab-groups";
import { openTabMenu, type MenuEntry } from "./tab-menu";
import { PR_DISPLAY, pullRequestState, pullRequestTitle, type PullRequestSummary } from "./pull-request";

/** How long a workspace takes to slide open or shut. */
export const ACCORDION_MS = 150;

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

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
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
  private pullRequests = new Map<string, PullRequestSummary>();
  private tabs: TabState[] = [];
  private activeTabId: string | null = null;
  private groups: TabBarGroups = NO_GROUPS;
  private updateReady = false;
  // Which workspaces were closed at the last render, to tell what has just
  // opened or closed. A bar that had no tabs has nothing to slide from.
  private drawnCollapsed: Set<string> | null = null;
  private slide: { from: Set<string>; startedAt: number } | null = null;
  private slideElapsed = 0;
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
    const hadTabs = this.tabs.length > 0;
    this.tabs = tabs;
    this.activeTabId = activeTabId;
    this.groups = groups;
    for (const id of this.status.keys()) {
      if (!tabs.some((t) => t.id === id)) this.status.delete(id);
    }
    for (const id of this.pullRequests.keys()) {
      if (!tabs.some((t) => t.id === id)) this.pullRequests.delete(id);
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
    // A workspace that has just opened or closed slides, so the eye can
    // follow which tabs went where. Any other render is drawn as it stands.
    // One switch redraws the bar more than once, so a slide is tied to when
    // it began, not to the render that began it: a redraw while it runs
    // picks it up where it had got to.
    const now = Date.now();
    const last = this.drawnCollapsed;
    this.drawnCollapsed = new Set(groups.collapsed);
    if (hadTabs && last !== null && !sameSet(last, groups.collapsed)) {
      this.slide = { from: last, startedAt: now };
    } else if (this.slide && now - this.slide.startedAt >= ACCORDION_MS) {
      this.slide = null;
    }
    const before = this.slide?.from ?? null;
    this.slideElapsed = this.slide ? now - this.slide.startedAt : 0;
    let looseChipDrawn = false;
    for (const run of tabRuns(tabs)) {
      const key = run.group ?? UNGROUPED;
      const collapsed = groups.collapsed.has(key);
      const changed = before !== null && before.has(key) !== collapsed;
      const built = collapsed
        ? changed ? this.createClosingRun(run.tabs) : null
        : this.createRunElement(run.tabs, activeTabId);
      const runEl = built && changed && !collapsed ? this.slideOpen(built) : built;
      if (run.group === null) {
        // Ungrouped tabs can sit either side of a group; closed, they are
        // one chip however many stretches they are in.
        if (collapsed && !looseChipDrawn) tabList.appendChild(this.createUngroupedChip());
        if (runEl) tabList.appendChild(runEl);
        looseChipDrawn = true;
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
    // In the desktop window the marker goes beside the window buttons (below).
    if (this.updateReady && !isTauri) tabArea.appendChild(this.createUpdateMarker());
    this.container.appendChild(tabArea);

    if (isTauri) {
      const spacerRight = document.createElement("div");
      spacerRight.className = "tab-bar-spacer-right";
      spacerRight.setAttribute("data-tauri-drag-region", "");
      this.container.appendChild(spacerRight);

      const windowControls = this.createWindowControls();
      // The window buttons sit over the right end of the bar and cover
      // anything at the end of the tab area, which is where the marker went
      // unseen. Inside their box it is always on top and where the eye goes.
      if (this.updateReady) windowControls.prepend(this.createUpdateMarker());
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

  /** The agent state last reported for a tab, null when none was. */
  attentionOf(tabId: string): AttentionState {
    return this.status.get(tabId)?.state ?? null;
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

  /** Wrap a run that has just come on show so that it grows out of its chip. */
  private slideOpen(runEl: HTMLElement): HTMLElement {
    const slide = this.createSlide("opening");
    slide.appendChild(runEl);
    // Once open the wrapper would only clip things drawn past a tab's edge.
    setTimeout(() => slide.replaceWith(runEl), ACCORDION_MS - this.slideElapsed);
    return slide;
  }

  /**
   * The tabs of a workspace that has just closed, drawn once more so they can
   * shrink into its chip. They are a picture: no ids, no handlers, and gone
   * when the slide ends.
   */
  private createClosingRun(tabs: TabState[]): HTMLElement {
    const slide = this.createSlide("closing");
    slide.setAttribute("aria-hidden", "true");
    const runEl = document.createElement("div");
    runEl.className = "tab-run";
    for (const tab of tabs) {
      const ghost = this.createTabElement(tab, false).cloneNode(true) as HTMLElement;
      delete ghost.dataset["tabId"];
      runEl.appendChild(ghost);
    }
    slide.appendChild(runEl);
    setTimeout(() => slide.remove(), ACCORDION_MS - this.slideElapsed);
    return slide;
  }

  private createSlide(direction: "opening" | "closing"): HTMLElement {
    const slide = document.createElement("div");
    slide.className = `tab-slide tab-slide--${direction}`;
    slide.style.setProperty("--tab-slide-ms", `${ACCORDION_MS}ms`);
    slide.style.animationDelay = `-${this.slideElapsed}ms`;
    return slide;
  }

  /**
   * What a closed workspace's tabs need, in the slot and glyphs a tab uses
   * for its own status. One mark, the most pressing; when several tabs are
   * waiting it becomes their number.
   */
  private paintRollup(chip: HTMLElement, statusEl: HTMLElement | null, rollup: GroupRollup, closed: boolean): void {
    chip.dataset["status"] = rollup.state;
    if (!statusEl) return;
    const several = closed && rollup.waiting > 1;
    statusEl.classList.toggle("tab-group-status--count", several);
    statusEl.textContent = !closed
      ? ""
      : several
        ? String(rollup.waiting)
        : STATUS_DISPLAY[rollup.state].glyph;
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

  /**
   * Stands in for the ungrouped tabs while a workspace is open. It has no
   * name to show or menu to offer, only the way back to those tabs.
   */
  private createUngroupedChip(): HTMLElement {
    const members = this.tabs.filter((t) => !t.group);
    const rollup = groupRollup(members.map((t) => this.status.get(t.id)?.state ?? null));
    const chip = document.createElement("div");
    chip.className = "tab-group-chip tab-group-chip--ungrouped";
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    chip.dataset["collapsed"] = "true";
    chip.title = `Tabs in no workspace: ${members.map((t) => tabDisplayName(t)).join(", ")}`;
    chip.style.setProperty("--group-colour", groupColourVar(undefined));

    const statusEl = document.createElement("span");
    statusEl.className = "tab-group-status";
    chip.appendChild(statusEl);
    this.paintRollup(chip, statusEl, rollup, true);

    const countEl = document.createElement("span");
    countEl.className = "tab-group-count";
    countEl.textContent = String(members.length);
    chip.appendChild(countEl);

    const open = () => this.emit("group-toggle", UNGROUPED);
    chip.addEventListener("click", open);
    chip.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open();
    });
    return chip;
  }

  /** Show on a collapsed group's chip what the tabs inside it need. */
  private paintChip(chip: HTMLElement, group: string, collapsed: boolean): void {
    const members = this.tabs.filter((t) => t.group === group);
    const rollup = collapsed
      ? groupRollup(members.map((t) => this.status.get(t.id)?.state ?? null))
      : { state: "none" as const, waiting: 0 };
    chip.dataset["collapsed"] = String(collapsed);
    this.paintRollup(chip, chip.querySelector<HTMLElement>(".tab-group-status"), rollup, collapsed);
    const names = members.map((t) => tabDisplayName(t)).join(", ");
    const action = collapsed ? "Click to open, right-click" : "Right-click";
    const needs =
      rollup.state === "input"
        ? `${rollup.waiting} waiting on you. `
        : rollup.state === "none"
          ? ""
          : `${STATUS_DISPLAY[rollup.state].title}. `;
    chip.title = `${group}: ${names}\n${needs}${action} for more`;
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
      { kind: "action", label: "Open this workspace", action: () => this.emit("group-solo", group) },
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
    const badge = this.createPullRequestBadge(tab.id);
    if (badge) tabEl.appendChild(badge);
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
    if (!group) {
      // The ungrouped chip is small enough to rebuild, and holds no state.
      const loose = this.container.querySelector(".tab-group-chip--ungrouped");
      loose?.replaceWith(this.createUngroupedChip());
    }
  }

  /**
   * Show the pull request for a tab's branch, or take the badge away with
   * null. Updates the tab in place, as a status change does.
   */
  setPullRequest(tabId: string, pr: PullRequestSummary | null): void {
    if (pr) this.pullRequests.set(tabId, pr);
    else this.pullRequests.delete(tabId);
    const tabEl = this.findTab(tabId);
    if (!tabEl) return;
    const badge = this.createPullRequestBadge(tabId);
    const old = tabEl.querySelector(".tab-pr");
    if (old && badge) old.replaceWith(badge);
    else if (old) old.remove();
    else if (badge) tabEl.querySelector(".tab-close")?.before(badge);
  }

  private createPullRequestBadge(tabId: string): HTMLElement | null {
    const pr = this.pullRequests.get(tabId);
    if (!pr) return null;
    const state = pullRequestState(pr);
    // A link in meaning, a button in fact: the page must not navigate away,
    // and in the desktop window only the shell can open a browser.
    const badge = document.createElement("button");
    badge.className = "tab-pr";
    badge.dataset["state"] = state;
    if (pr.draft) badge.dataset["draft"] = "true";
    badge.textContent = `#${pr.number}${PR_DISPLAY[state].mark}`;
    badge.title = pullRequestTitle(pr);
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      this.emit("pr-open", pr.url);
    });
    // A press on the badge is not the start of dragging its tab.
    badge.addEventListener("pointerdown", (e) => e.stopPropagation());
    return badge;
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
