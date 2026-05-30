/**
 * Plans & Handoffs pane.
 *
 * Lists the project's active plan docs (docs/plans/*.md) and handoff briefs
 * (docs/plans/handoff/*.md) so the user can see what's in flight, open one in
 * the viewer, inject its path into the active input, or spin up a new tab with
 * an agent already primed on it (CLI or enhanced chat).
 *
 * Rendered as the right pane's "plans" mode. Clicking a row asks the host
 * (ProjectContext) to swap the right pane to the markdown viewer.
 */

import type { Component, PlanEntry, PlansListMessage } from "../types";
import type { WebSocketClient } from "../platform/websocket";

type RelPathHandler = (relPath: string) => void;

export class PlansPane implements Component {
  private root: string | null = null;
  private plans: PlanEntry[] = [];
  private handoffs: PlanEntry[] = [];
  private loaded = false;

  private onOpenCb: RelPathHandler | null = null;
  private onInjectCb: RelPathHandler | null = null;
  private onLaunchCliCb: RelPathHandler | null = null;
  private onLaunchChatCb: RelPathHandler | null = null;

  private boundHandlers = {
    plansList: (msg: PlansListMessage) => {
      this.root = msg.root ?? null;
      this.plans = msg.plans ?? [];
      this.handoffs = msg.handoffs ?? [];
      this.loaded = true;
      this.render();
    },
    // Re-pull the list once the socket is up (init fires before connect).
    connected: () => this.refresh(),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
  ) {}

  initialize(): void {
    this.container.classList.add("plans-pane");
    this.ws.on("plans-list", this.boundHandlers.plansList as never);
    this.ws.on("connected", this.boundHandlers.connected as never);
    this.render();
    this.refresh();
  }

  /** Re-request the list from the backend. */
  refresh(): void {
    this.ws.requestPlansList(this.root ?? undefined);
  }

  onOpen(cb: RelPathHandler): void {
    this.onOpenCb = cb;
  }
  onInject(cb: RelPathHandler): void {
    this.onInjectCb = cb;
  }
  onLaunchCli(cb: RelPathHandler): void {
    this.onLaunchCliCb = cb;
  }
  onLaunchChat(cb: RelPathHandler): void {
    this.onLaunchChatCb = cb;
  }

  private render(): void {
    this.container.replaceChildren();

    const header = document.createElement("div");
    header.className = "plans-pane__header";
    const title = document.createElement("span");
    title.className = "plans-pane__title";
    title.textContent = "[ plans & handoffs ]";
    header.appendChild(title);

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "plans-pane__refresh";
    refreshBtn.title = "Refresh";
    refreshBtn.textContent = "↻";
    refreshBtn.addEventListener("click", () => this.refresh());
    header.appendChild(refreshBtn);
    this.container.appendChild(header);

    const body = document.createElement("div");
    body.className = "plans-pane__body";
    this.container.appendChild(body);

    if (!this.loaded) {
      const loading = document.createElement("div");
      loading.className = "plans-pane__empty";
      loading.textContent = "Loading…";
      body.appendChild(loading);
      return;
    }

    if (this.handoffs.length === 0 && this.plans.length === 0) {
      const empty = document.createElement("div");
      empty.className = "plans-pane__empty";
      empty.textContent = "No plans or handoffs yet. Run /compact to create one.";
      body.appendChild(empty);
      return;
    }

    body.appendChild(this.renderSection("Handoffs", this.handoffs));
    body.appendChild(this.renderSection("Plans", this.plans));
  }

  private renderSection(label: string, entries: PlanEntry[]): HTMLElement {
    const section = document.createElement("div");
    section.className = "plans-section";

    const heading = document.createElement("div");
    heading.className = "plans-section__heading";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = label;
    const cnt = document.createElement("span");
    cnt.className = "cnt";
    cnt.textContent = `(${entries.length})`;
    heading.append(lbl, cnt);
    section.appendChild(heading);

    if (entries.length === 0) {
      const none = document.createElement("div");
      none.className = "plans-section__none";
      none.textContent = "—";
      section.appendChild(none);
      return section;
    }

    for (const entry of entries) {
      section.appendChild(this.renderRow(entry));
    }
    return section;
  }

  private renderRow(entry: PlanEntry): HTMLElement {
    // Statusline layout (vim-airline / tmux powerline): a hard status block on
    // the left edge — ACTIVE filled red for the latest handoff, age in a grey
    // block otherwise — then the title, then inline launch actions.
    const row = document.createElement("div");
    row.className = "plans-row";
    row.title = entry.relPath;

    const seg = document.createElement("span");
    if (entry.isLatest) {
      seg.className = "plans-row__seg plans-row__seg--active";
      seg.textContent = "active";
    } else {
      seg.className = "plans-row__seg plans-row__seg--age";
      seg.textContent = relativeTime(entry.modified);
    }
    row.appendChild(seg);

    // Title region — clicking opens the doc in the viewer.
    const main = document.createElement("button");
    main.className = "plans-row__main";
    main.addEventListener("click", () => this.onOpenCb?.(entry.relPath));
    const name = document.createElement("span");
    name.className = "plans-row__name";
    name.textContent = entry.title || entry.name;
    main.appendChild(name);
    row.appendChild(main);

    // Inline actions — inject path, or launch a primed tab (CLI / Chat).
    const actions = document.createElement("div");
    actions.className = "plans-row__actions";
    actions.appendChild(
      this.actionButton("[path]", "Insert path into the active input", () =>
        this.onInjectCb?.(entry.relPath),
      ),
    );
    actions.appendChild(
      this.actionButton("[cli]", "New tab: Claude Code CLI primed on this file", () =>
        this.onLaunchCliCb?.(entry.relPath),
      ),
    );
    actions.appendChild(
      this.actionButton("[chat]", "New tab: enhanced chat seeded with this file", () =>
        this.onLaunchChatCb?.(entry.relPath),
      ),
    );
    row.appendChild(actions);

    return row;
  }

  private actionButton(label: string, tooltip: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "plans-row__action";
    btn.textContent = label;
    btn.title = tooltip;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  dispose(): void {
    this.ws.off("plans-list", this.boundHandlers.plansList as never);
    this.ws.off("connected", this.boundHandlers.connected as never);
  }
}

/** Compact age label ("now" / "5m" / "3h" / "2d") for the statusline segment. */
function relativeTime(epochSeconds: number): string {
  if (!epochSeconds) return "";
  const deltaSec = Date.now() / 1000 - epochSeconds;
  if (deltaSec < 60) return "now";
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
