/**
 * The board: a project's streams of work on one screen.
 *
 * It opens on what is to be acted on. Tickets are gathered into the streams
 * that carry them (one per handoff), streams are grouped by what they need
 * (needs you, in review, close out, in progress), and everything else is
 * folded to a heading with a count. A second view arranges tickets under
 * their parents. The right column is everything known about the selected
 * row. Enter opens a tab on it; `t` and `p` open its ticket and pull request.
 *
 * It only reads. Nothing here changes a ticket, a pull request or a worktree.
 */

import { apiBase } from "../config/config";
import { ago } from "../local/picker-model";
import { pullRequestWords, ticketTone, type Tone } from "../tabs/work-words";
import {
  VERDICT_SAYS,
  boardSections,
  filterSections,
  finishedCount,
  leadPullRequest,
  openTarget,
  openTickets,
  rowKey,
  sectionAt,
  sectionJump,
  stageCounts,
  visibleRows,
  type BoardData,
  type BoardGroup,
  type BoardPullRequest,
  type BoardRow,
  type BoardSection,
  type BoardStream,
  type BoardView,
  type BoardWorktree,
  type Stage,
} from "./board-model";

export type BoardResult = { path: string; handoff: string | null };
export type BoardRead = "quick" | "full" | "fresh";

export interface BoardScreenOptions {
  /** The project whose board this is. */
  project: string;
  /**
   * Reads the board, null when it cannot be read. "quick" is whatever the
   * backend has to hand, at once; "full" the whole board; "fresh" the whole
   * board read again past the backend's cache.
   */
  load?: (how: BoardRead) => Promise<BoardData | null>;
  openUrl: (url: string) => void;
  now?: () => number;
}

type Part = { text: string; tone?: Tone };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function folderName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

/** A pull request in a few words, and how it should be coloured. */
export function pullRequestText(pr: BoardPullRequest): { text: string; tone: Tone } {
  const { text, tone } = pullRequestWords(pr);
  return { text, tone };
}

/** Ticket ids in little room: the shared prefix once, then the numbers. */
export function compactTickets(ids: string[]): string {
  if (ids.length <= 1) return ids[0] ?? "";
  const prefix = ids[0]!.split("-")[0]!;
  if (!ids.every((id) => id.startsWith(`${prefix}-`))) return ids.join(" ");
  return `${prefix}-${ids.map((id) => id.slice(prefix.length + 1)).join(" ")}`;
}

/** What a stream's row says on its right, for the stage it is at. */
export function groupAside(group: BoardGroup, stage: Stage): { text: string; tone: Tone } {
  const pr = leadPullRequest(group);
  if (stage === "needs-you" && pr) {
    const waiting = pr.review === "approved" && !pr.conflicts && pr.checks !== "failing";
    return waiting ? { text: `#${pr.number} ✓ ready to merge`, tone: "good" } : pullRequestText(pr);
  }
  if (stage === "in-review" && pr) return pullRequestText(pr);
  if (stage === "close-out" && pr) {
    const left = openTickets(group).length;
    return { text: `#${pr.number} merged · ${left} to close`, tone: "warn" };
  }
  if (stage === "done") return { text: "done", tone: "muted" };
  if (stage === "queued") return { text: openTickets(group)[0]?.status || "not started", tone: "muted" };
  return { text: group.handoff ? "" : "no handoff", tone: "muted" };
}

const VERDICT_TONE: Record<BoardWorktree["verdict"], Tone> = {
  finished: "good",
  "merged-dirty": "warn",
  "in-review": "busy",
  closed: "muted",
  local: "muted",
};

const VIEW_SAYS: Record<BoardView, string> = { need: "by what it needs", parent: "by parent ticket" };

export class BoardScreen {
  private root: HTMLDivElement;
  private summaryEl: HTMLDivElement;
  private filterRow: HTMLDivElement;
  private filterInput: HTMLInputElement;
  private mainEl: HTMLDivElement;
  private detailEl: HTMLDivElement;

  private data: BoardData | null = null;
  private failed = false;
  private loading = true;
  private view: BoardView = "need";
  /** Sections whose fold has been flipped from its default, per view. */
  private toggled: Record<BoardView, Set<string>> = { need: new Set(), parent: new Set() };
  private sections: BoardSection[] = [];
  private rows: BoardRow[] = [];
  private selected = 0;
  private filtering = false;
  private resolve: ((result: BoardResult | null) => void) | null = null;
  private focusBefore: HTMLElement | null = null;
  private load: (how: BoardRead) => Promise<BoardData | null>;
  private now: () => number;
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(container: HTMLElement, private options: BoardScreenOptions) {
    this.now = options.now ?? (() => Date.now() / 1000);
    this.load =
      options.load ??
      (async (how) => {
        const flag = how === "quick" ? "&quick=true" : how === "fresh" ? "&fresh=true" : "";
        const url = `${apiBase()}/api/board?path=${encodeURIComponent(options.project)}${flag}`;
        const resp = await fetch(url, { credentials: "include" });
        return resp.ok ? ((await resp.json()) as BoardData) : null;
      });

    this.root = el("div", "project-picker board-screen");
    this.root.tabIndex = -1;

    this.summaryEl = el("div", "picker-settings board-summary");
    const body = el("div", "picker-body");
    body.appendChild(el("div", "picker-header", `[ ${folderName(options.project).toUpperCase()} ]`));

    // Always on show, so that searching is something the screen offers and
    // not something to be known about.
    this.filterRow = el("div", "picker-filter board-filter");
    this.filterRow.appendChild(el("span", "picker-filter-prompt", "/"));
    this.filterInput = el("input", "picker-filter-input");
    this.filterInput.type = "text";
    this.filterInput.spellcheck = false;
    this.filterInput.placeholder = "search tickets, titles, handoffs, branches, #pull requests";
    this.filterInput.setAttribute("aria-label", "Search the board");
    this.filterInput.addEventListener("input", () => {
      this.selected = 0;
      this.render();
    });
    this.filterInput.addEventListener("focus", () => (this.filtering = true));
    this.filterInput.addEventListener("blur", () => (this.filtering = false));
    this.filterRow.appendChild(this.filterInput);
    body.appendChild(this.filterRow);

    const list = el("div", "picker-list");
    this.mainEl = el("div", "picker-column picker-column-main");
    this.detailEl = el("div", "picker-column picker-column-side board-detail");
    list.append(this.mainEl, this.detailEl);
    body.appendChild(list);

    const help = el("div", "picker-help");
    for (const [key, what] of [
      ["j/k", "move"],
      ["[ ]", "previous / next section"],
      ["enter", "open a tab, or unfold"],
      ["h", "fold this section"],
      ["v", "by need / by parent"],
      ["/", "search"],
      ["t  p", "ticket, pull request"],
      ["r", "read again"],
      ["esc", "close"],
    ]) {
      const row = el("div", "picker-help-row");
      row.appendChild(el("span", "picker-help-key", key));
      row.append(` ${what}`);
      help.appendChild(row);
    }

    this.root.append(this.summaryEl, body, help);
    container.appendChild(this.root);
  }

  show(): Promise<BoardResult | null> {
    this.focusBefore = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", this.onKeyDown, true);
    this.root.focus();
    this.render();
    void this.read("full");
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /**
   * Read the board. The first read shows what the backend has to hand
   * before the whole board arrives: the tickets take two reads from disk,
   * the worktrees take git and GitHub.
   */
  private async read(how: "full" | "fresh"): Promise<void> {
    this.loading = true;
    this.failed = false;
    this.render();
    const attempt = async (h: BoardRead): Promise<BoardData | null> => {
      try {
        return await this.load(h);
      } catch {
        return null;
      }
    };
    if (how === "full" && !this.data) {
      const first = await attempt("quick");
      if (!this.resolve) return;
      if (first) this.adopt(first);
    }
    const data = await attempt(how);
    if (!this.resolve) return;
    this.loading = false;
    if (data) this.adopt(data);
    else this.failed = true;
    this.render();
  }

  private compute(): void {
    this.sections = this.data
      ? filterSections(boardSections(this.data, this.view, this.toggled[this.view]), this.filterInput.value)
      : [];
    this.rows = visibleRows(this.sections);
  }

  /** Redraw, keeping the selection on the row it was on where that row is still there. */
  private keepingSelection(change: () => void): void {
    const held = this.rows[this.selected];
    const key = held ? rowKey(held) : null;
    change();
    this.compute();
    if (key !== null) {
      const at = this.rows.findIndex((r) => rowKey(r) === key);
      if (at !== -1) this.selected = at;
    }
    this.render();
  }

  private adopt(data: BoardData): void {
    this.keepingSelection(() => (this.data = data));
  }

  private render(): void {
    this.compute();
    this.selected = Math.max(0, Math.min(this.selected, this.rows.length - 1));

    this.renderSummary();
    this.mainEl.replaceChildren();
    if (this.rows.length === 0) {
      this.mainEl.appendChild(el("div", "picker-empty", this.emptyText()));
    }
    let index = 0;
    for (const section of this.sections) {
      if (section.folded) {
        this.mainEl.appendChild(this.wire(this.foldElement(section), index++));
        continue;
      }
      const heading = el("div", "board-section");
      heading.appendChild(el("span", "board-section-title", section.title));
      heading.appendChild(el("span", "board-section-count", String(section.rows.length)));
      if (section.hint) heading.appendChild(el("span", "board-section-hint", section.hint));
      this.mainEl.appendChild(heading);
      for (const row of section.rows) this.mainEl.appendChild(this.wire(this.rowElement(row), index++));
    }
    this.renderDetail(this.rows[this.selected] ?? null);
    this.mainEl.querySelector(".board-row.selected")?.scrollIntoView?.({ block: "nearest" });
  }

  private wire(rowEl: HTMLElement, at: number): HTMLElement {
    rowEl.classList.toggle("selected", at === this.selected);
    rowEl.addEventListener("click", () => {
      this.selected = at;
      this.render();
    });
    rowEl.addEventListener("dblclick", () => this.open());
    return rowEl;
  }

  private emptyText(): string {
    if (this.loading && !this.data) return "reading the board, the worktrees and their pull requests…";
    if (this.failed && !this.data) return "the board could not be read";
    if (this.filterInput.value.trim()) return "nothing matches";
    return "nothing here: this project has no board file, handoffs or worktrees";
  }

  private renderSummary(): void {
    const parts: Part[] = [];
    if (this.data) {
      const counts = stageCounts(this.data);
      const say = (n: number, text: string, tone: Tone) => {
        if (n > 0) parts.push({ text: `${n} ${text}`, tone });
      };
      say(counts["needs-you"], counts["needs-you"] === 1 ? "needs you" : "need you", "warn");
      say(counts["in-review"], "in review", "busy");
      say(counts["close-out"], "to close out", "review");
      say(counts["in-progress"], "in progress", "plain");
      say(finishedCount(this.data), "worktrees finished", "good");
      if (!this.data.hasBoardFile) parts.push({ text: "no docs/plans/work-board.md here", tone: "muted" });
      if (!this.data.partial) {
        parts.push({
          text: this.data.tracker?.live ? "tickets live from Linear" : "tickets from the board file",
          tone: "muted",
        });
      }
      parts.push({ text: VIEW_SAYS[this.view], tone: "muted" });
      parts.push({
        text: this.data.partial
          ? "reading worktrees and pull requests…"
          : this.loading
            ? "reading again…"
            : `read ${ago(this.data.gathered, this.now()) || "just now"}`,
        tone: "muted",
      });
    }
    this.summaryEl.replaceChildren(
      ...parts.flatMap((part, i) => {
        const span = el("span", "", part.text);
        span.dataset["tone"] = part.tone ?? "plain";
        return i === 0 ? [span] : [el("span", "board-summary-gap", "·"), span];
      }),
    );
  }

  private foldElement(section: BoardSection): HTMLElement {
    const rowEl = el("div", "picker-option board-row board-fold");
    rowEl.dataset["kind"] = "fold";
    rowEl.appendChild(el("span", "picker-option-label", `+ ${section.title}`));
    rowEl.appendChild(el("span", "picker-option-meta", section.hint));
    rowEl.appendChild(el("span", "picker-option-aside", String(section.rows.length)));
    return rowEl;
  }

  private rowElement(row: BoardRow): HTMLElement {
    const rowEl = el("div", "picker-option board-row");
    rowEl.dataset["kind"] = row.kind;
    let label = "";
    let meta = "";
    let aside: { text: string; tone: Tone } = { text: "", tone: "muted" };
    if (row.kind === "group") {
      label = row.group.key;
      meta = compactTickets(row.group.tickets.map((t) => t.ticket));
      // A stream of one ticket has room to say what the ticket is.
      if (row.group.tickets.length === 1) meta += `  ${row.group.tickets[0]!.title}`;
      aside = groupAside(row.group, row.stage);
    } else if (row.kind === "ticket") {
      label = row.stream.ticket;
      meta = row.stream.title;
      aside = { text: row.stream.status || "no status", tone: ticketTone(row.stream) };
      rowEl.style.paddingLeft = `${16 + row.depth * 18}px`;
      if (row.depth > 0) rowEl.dataset["nested"] = "true";
    } else if (row.kind === "handoff") {
      label = row.handoff.name;
      meta = row.handoff.title;
      aside = { text: ago(row.handoff.modified, this.now()), tone: "muted" };
    } else if (row.kind === "worktree") {
      label = `[${row.worktree.name}/]`;
      meta = row.worktree.branch ?? "detached";
      aside = { text: VERDICT_SAYS[row.worktree.verdict], tone: VERDICT_TONE[row.worktree.verdict] };
    }
    rowEl.appendChild(el("span", "picker-option-label", label));
    rowEl.appendChild(el("span", "picker-option-meta", meta));
    const asideEl = el("span", "picker-option-aside", aside.text);
    asideEl.dataset["tone"] = aside.tone;
    rowEl.appendChild(asideEl);
    return rowEl;
  }

  private fact(key: string, parts: Part[]): HTMLElement {
    const row = el("div", "board-fact");
    row.appendChild(el("span", "board-fact-key", key));
    const value = el("span", "board-fact-value");
    for (const part of parts) {
      const span = el("span", "", part.text);
      span.dataset["tone"] = part.tone ?? "plain";
      value.appendChild(span);
    }
    row.appendChild(value);
    return row;
  }

  private handoffFact(handoff: BoardGroup["handoff"], missing: string | null): HTMLElement {
    return this.fact(
      "handoff",
      handoff
        ? [{ text: handoff.name }, { text: ` · ${ago(handoff.modified, this.now())}`, tone: "muted" }]
        : missing
          ? [{ text: `${missing} is named on the board but is not on disk`, tone: "warn" }]
          : [{ text: "none", tone: "muted" }],
    );
  }

  private worktreeFacts(worktrees: BoardWorktree[]): HTMLElement[] {
    if (worktrees.length === 0) {
      // Not yet read is not the same as none.
      const text = this.data?.partial ? "reading…" : "none found";
      return [this.fact("worktree", [{ text, tone: "muted" }])];
    }
    return worktrees.flatMap((worktree) => {
      const pending = [
        worktree.uncommitted > 0 ? `${worktree.uncommitted} uncommitted` : null,
        worktree.unpushed ? `${worktree.unpushed} unpushed` : null,
      ].filter(Boolean);
      const facts = [
        this.fact("worktree", [
          { text: worktree.name },
          { text: ` · ${worktree.branch ?? "detached"}`, tone: "muted" },
          ...(pending.length > 0 ? [{ text: ` · ${pending.join(" · ")}`, tone: "warn" as const }] : []),
          { text: ` · ${VERDICT_SAYS[worktree.verdict]}`, tone: VERDICT_TONE[worktree.verdict] },
        ]),
      ];
      if (worktree.pr) {
        facts.push(
          this.fact("pull request", [pullRequestText(worktree.pr), { text: ` · ${worktree.pr.title}`, tone: "muted" }]),
        );
      }
      return facts;
    });
  }

  private ticketLine(ticket: BoardStream): HTMLElement {
    const line = el("div", "board-ticket");
    line.appendChild(el("span", "board-ticket-id", ticket.ticket));
    const status = el("span", "board-ticket-status", ticket.status || "no status");
    status.dataset["tone"] = ticketTone(ticket);
    line.appendChild(status);
    const title = el("span", "board-ticket-title", ticket.title);
    line.appendChild(title);
    if (ticket.parent) {
      const parent = el("span", "board-ticket-parent", `under ${ticket.parent}`);
      parent.dataset["tone"] = "muted";
      line.appendChild(parent);
    }
    return line;
  }

  private nextBlock(tickets: BoardStream[]): HTMLElement[] {
    const withNext = tickets.filter((t) => t.next);
    if (withNext.length === 0) return [];
    const out: HTMLElement[] = [el("div", "board-detail-heading", "next")];
    for (const ticket of withNext) {
      const block = el("div", "board-next");
      if (tickets.length > 1) block.appendChild(el("span", "board-next-ticket", `${ticket.ticket}  `));
      block.append(ticket.next);
      out.push(block);
    }
    return out;
  }

  private renderDetail(row: BoardRow | null): void {
    this.detailEl.replaceChildren();
    if (!row) return;
    const add = (...nodes: HTMLElement[]) => this.detailEl.append(...nodes);
    if (row.kind === "group") {
      const g = row.group;
      add(el("div", "picker-section", g.key));
      add(el("div", "board-title", g.handoff?.title ?? g.tickets[0]!.title));
      add(el("div", "board-detail-heading", g.tickets.length === 1 ? "ticket" : `${g.tickets.length} tickets`));
      add(...g.tickets.map((t) => this.ticketLine(t)));
      add(el("div", "board-detail-heading", "carried by"));
      add(this.handoffFact(g.handoff, g.tickets.find((t) => t.missingHandoff)?.missingHandoff ?? null));
      add(...this.worktreeFacts(g.worktrees));
      add(...this.nextBlock(openTickets(g).length > 0 ? openTickets(g) : g.tickets));
    } else if (row.kind === "ticket") {
      const s = row.stream;
      add(el("div", "picker-section", s.ticket));
      add(el("div", "board-title", s.title));
      add(
        this.fact("status", [
          { text: s.status || "none recorded", tone: ticketTone(s) },
          ...(s.statusDetail ? [{ text: ` · ${s.statusDetail}`, tone: "muted" as const }] : []),
        ]),
      );
      add(this.fact("parent", [s.parent ? { text: s.parent } : { text: "none recorded", tone: "muted" }]));
      add(this.handoffFact(s.handoff, s.missingHandoff));
      add(...this.worktreeFacts(s.worktrees));
      add(...this.nextBlock([s]));
    } else if (row.kind === "handoff") {
      add(el("div", "picker-section", "handoff"));
      add(el("div", "board-title", row.handoff.title));
      add(this.fact("file", [{ text: row.handoff.relPath, tone: "muted" }]));
      add(this.fact("written", [{ text: ago(row.handoff.modified, this.now()) }]));
      add(this.fact("ticket", [{ text: "none on the board", tone: "warn" }]));
    } else if (row.kind === "worktree") {
      add(el("div", "picker-section", "worktree"));
      add(el("div", "board-title", row.worktree.path));
      add(...this.worktreeFacts([row.worktree]));
      add(this.fact("ticket", [{ text: "none on the board", tone: "muted" }]));
    } else {
      add(el("div", "picker-section", row.title));
      add(el("div", "board-title", `${row.count} folded away`));
      if (row.hint) add(this.fact("holds", [{ text: row.hint, tone: "muted" }]));
      add(this.fact("", [{ text: "enter unfolds it", tone: "muted" }]));
    }
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.filtering) {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.stopFiltering(true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.stopFiltering(false);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.move(e.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }
    // Chords are left for the app.
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // Plain keys belong to the board while it is open, handled or not: an
    // unhandled one must not be typed into the shell behind it.
    e.preventDefault();
    e.stopPropagation();
    switch (e.key) {
      case "j":
      case "ArrowDown":
        return this.move(1);
      case "k":
      case "ArrowUp":
        return this.move(-1);
      case "g":
        return this.moveTo(0);
      case "G":
        return this.moveTo(this.rows.length - 1);
      case "]":
        return this.moveTo(sectionJump(this.sections, this.selected, 1));
      case "[":
        return this.moveTo(sectionJump(this.sections, this.selected, -1));
      case "Enter":
      case "l":
      case "ArrowRight":
      case " ":
        return this.open();
      case "h":
      case "ArrowLeft":
        return this.foldCurrent();
      case "v":
        return this.switchView();
      case "t":
        return this.openTicket();
      case "p":
        return this.openPullRequest();
      case "r":
        return void this.read("fresh");
      case "/":
        return this.startFiltering();
      case "Escape":
        // The first escape gives the whole board back; the second leaves.
        if (this.filterInput.value) return this.stopFiltering(true);
        return this.finish(null);
      case "q":
        return this.finish(null);
    }
  }

  private move(step: number): void {
    this.moveTo(this.selected + step);
  }

  private moveTo(index: number): void {
    if (this.rows.length === 0) return;
    this.selected = Math.max(0, Math.min(index, this.rows.length - 1));
    this.render();
  }

  private toggle(id: string): void {
    const set = this.toggled[this.view];
    if (!set.delete(id)) set.add(id);
  }

  private foldCurrent(): void {
    const section = sectionAt(this.sections, this.selected);
    // While searching, everything is unfolded to show what was found.
    if (!section || section.folded || this.filterInput.value.trim()) return;
    this.toggle(section.id);
    this.compute();
    const at = this.rows.findIndex((r) => r.kind === "fold" && r.id === section.id);
    if (at !== -1) this.selected = at;
    this.render();
  }

  private switchView(): void {
    this.view = this.view === "need" ? "parent" : "need";
    this.selected = 0;
    this.render();
  }

  private startFiltering(): void {
    this.filterInput.focus();
  }

  private stopFiltering(clear: boolean): void {
    this.filtering = false;
    if (clear) this.filterInput.value = "";
    this.selected = 0;
    this.root.focus();
    this.render();
  }

  private open(): void {
    const row = this.rows[this.selected];
    if (!row || !this.data) return;
    if (row.kind === "fold") {
      this.toggle(row.id);
      // Land on the first row of what was just unfolded.
      this.render();
      return;
    }
    const target = openTarget(row, this.data.project);
    if (target) this.finish(target);
  }

  private openTicket(): void {
    const row = this.rows[this.selected];
    const ticket =
      row?.kind === "ticket"
        ? row.stream
        : row?.kind === "group"
          ? (openTickets(row.group)[0] ?? row.group.tickets[0])
          : undefined;
    if (ticket?.url) this.options.openUrl(ticket.url);
  }

  private openPullRequest(): void {
    const row = this.rows[this.selected];
    const pr =
      row?.kind === "group"
        ? leadPullRequest(row.group)
        : row?.kind === "worktree"
          ? row.worktree.pr
          : row?.kind === "ticket"
            ? (row.stream.worktrees.map((w) => w.pr).find((p) => p !== null) ?? null)
            : null;
    if (pr?.url) this.options.openUrl(pr.url);
  }

  private finish(result: BoardResult | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.root.remove();
    if (this.focusBefore?.isConnected) this.focusBefore.focus();
    resolve?.(result);
  }
}
