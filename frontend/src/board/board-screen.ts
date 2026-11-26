/**
 * The board: a project's streams of work on one screen.
 *
 * A full-pane screen in the picker's language (filled section rows, option
 * rows with a red selection, key help in the corner). The left column lists
 * tickets by status, then the gaps: handoffs with no ticket and worktrees
 * nobody listed. The right column is everything known about the selected
 * row. Enter opens a tab on it; `t` and `p` open its ticket and pull request.
 *
 * It only reads. Nothing here changes a ticket, a pull request or a worktree.
 */

import { apiBase } from "../config/config";
import { ago } from "../local/picker-model";
import { PR_DISPLAY, pullRequestState, type PullRequestSummary } from "../tabs/pull-request";
import {
  VERDICT_SAYS,
  boardSections,
  filterSections,
  finishedCount,
  leadPullRequest,
  openTarget,
  type BoardData,
  type BoardPullRequest,
  type BoardRow,
  type BoardSection,
  type BoardWorktree,
} from "./board-model";

export type BoardResult = { path: string; handoff: string | null };

export interface BoardScreenOptions {
  /** The project whose board this is. */
  project: string;
  /** Reads the board; `fresh` skips the backend's cache. Null when it cannot be read. */
  load?: (fresh: boolean) => Promise<BoardData | null>;
  openUrl: (url: string) => void;
  now?: () => number;
}

type Tone = "plain" | "muted" | "good" | "bad" | "warn" | "review" | "busy";

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
  if (pr.state === "merged") return { text: `#${pr.number} merged`, tone: "good" };
  if (pr.state === "closed") return { text: `#${pr.number} closed`, tone: "muted" };
  const state = pullRequestState(pr as unknown as PullRequestSummary);
  const tone: Tone =
    state === "conflicts" || state === "failing"
      ? "bad"
      : state === "changes"
        ? "review"
        : state === "running"
          ? "busy"
          : state === "open"
            ? "plain"
            : "good";
  const mark = PR_DISPLAY[state].mark;
  return { text: `#${pr.number}${mark ? ` ${mark}` : ""} ${PR_DISPLAY[state].says}`, tone };
}

const VERDICT_TONE: Record<BoardWorktree["verdict"], Tone> = {
  finished: "good",
  "merged-dirty": "warn",
  "in-review": "busy",
  closed: "muted",
  local: "muted",
};

export class BoardScreen {
  private root: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private summaryEl: HTMLDivElement;
  private filterRow: HTMLDivElement;
  private filterInput: HTMLInputElement;
  private mainEl: HTMLDivElement;
  private detailEl: HTMLDivElement;

  private data: BoardData | null = null;
  private failed = false;
  private loading = true;
  private rows: BoardRow[] = [];
  private selected = 0;
  private filtering = false;
  private resolve: ((result: BoardResult | null) => void) | null = null;
  private focusBefore: HTMLElement | null = null;
  private load: (fresh: boolean) => Promise<BoardData | null>;
  private now: () => number;
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(container: HTMLElement, private options: BoardScreenOptions) {
    this.now = options.now ?? (() => Date.now() / 1000);
    this.load =
      options.load ??
      (async (fresh) => {
        const url = `${apiBase()}/api/board?path=${encodeURIComponent(options.project)}${fresh ? "&fresh=true" : ""}`;
        const resp = await fetch(url, { credentials: "include" });
        return resp.ok ? ((await resp.json()) as BoardData) : null;
      });

    this.root = el("div", "project-picker board-screen");
    this.root.tabIndex = -1;

    this.summaryEl = el("div", "picker-settings board-summary");
    const body = el("div", "picker-body");
    this.headerEl = el("div", "picker-header", `[ ${folderName(options.project).toUpperCase()} ]`);
    body.appendChild(this.headerEl);

    this.filterRow = el("div", "picker-filter");
    this.filterRow.hidden = true;
    this.filterRow.appendChild(el("span", "picker-filter-prompt", "/"));
    this.filterInput = el("input", "picker-filter-input");
    this.filterInput.type = "text";
    this.filterInput.spellcheck = false;
    this.filterInput.setAttribute("aria-label", "Filter the board");
    this.filterInput.addEventListener("input", () => {
      this.selected = 0;
      this.render();
    });
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
      ["enter", "open a tab"],
      ["t", "ticket"],
      ["p", "pull request"],
      ["/", "filter"],
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
    void this.read(false);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private async read(fresh: boolean): Promise<void> {
    this.loading = true;
    this.failed = false;
    this.render();
    let data: BoardData | null = null;
    try {
      data = await this.load(fresh);
    } catch {
      data = null;
    }
    if (!this.resolve) return;
    this.loading = false;
    if (data) this.data = data;
    else this.failed = true;
    this.render();
  }

  private sections(): BoardSection[] {
    return this.data ? filterSections(boardSections(this.data), this.filterInput.value) : [];
  }

  private render(): void {
    const sections = this.sections();
    this.rows = sections.flatMap((s) => s.rows);
    this.selected = Math.max(0, Math.min(this.selected, this.rows.length - 1));

    this.renderSummary();
    this.mainEl.replaceChildren();
    if (this.rows.length === 0) {
      this.mainEl.appendChild(el("div", "picker-empty", this.emptyText()));
    }
    let index = 0;
    for (const section of sections) {
      this.mainEl.appendChild(el("div", "picker-section", `${section.title} · ${section.rows.length}`));
      for (const row of section.rows) {
        const rowEl = this.rowElement(row);
        const at = index++;
        rowEl.classList.toggle("selected", at === this.selected);
        rowEl.addEventListener("click", () => {
          this.selected = at;
          this.render();
        });
        rowEl.addEventListener("dblclick", () => this.open());
        this.mainEl.appendChild(rowEl);
      }
    }
    this.renderDetail(this.rows[this.selected] ?? null);
    this.mainEl.querySelector(".picker-option.selected")?.scrollIntoView?.({ block: "nearest" });
  }

  private emptyText(): string {
    if (this.loading && !this.data) return "reading the board, the worktrees and their pull requests…";
    if (this.failed && !this.data) return "the board could not be read";
    if (this.filterInput.value.trim()) return "nothing matches";
    return "nothing here: this project has no board file, handoffs or worktrees";
  }

  private renderSummary(): void {
    const parts: string[] = [];
    if (this.data) {
      parts.push(`${this.data.streams.length} tickets`);
      const finished = finishedCount(this.data);
      if (finished > 0) parts.push(`${finished} worktrees finished`);
      if (!this.data.hasBoardFile) parts.push("no docs/plans/work-board.md here");
      parts.push(this.loading ? "reading again…" : `read ${ago(this.data.gathered, this.now()) || "just now"}`);
    }
    this.summaryEl.textContent = parts.join("  ·  ");
  }

  private rowElement(row: BoardRow): HTMLElement {
    const rowEl = el("div", "picker-option board-row");
    rowEl.dataset["kind"] = row.kind;
    let label: string;
    let meta: string;
    let aside: { text: string; tone: Tone };
    if (row.kind === "stream") {
      const pr = leadPullRequest(row.stream);
      label = row.stream.ticket;
      meta = row.stream.title;
      aside = pr
        ? pullRequestText(pr)
        : row.stream.handoff
          ? { text: ago(row.stream.handoff.modified, this.now()), tone: "muted" }
          : { text: "no handoff", tone: "muted" };
    } else if (row.kind === "handoff") {
      label = row.handoff.title;
      meta = `${row.handoff.name}.md`;
      aside = { text: ago(row.handoff.modified, this.now()), tone: "muted" };
    } else {
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

  private fact(key: string, parts: { text: string; tone?: Tone }[]): HTMLElement {
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

  private worktreeFacts(worktree: BoardWorktree): HTMLElement[] {
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
      const pr = pullRequestText(worktree.pr);
      facts.push(this.fact("pull request", [pr, { text: ` · ${worktree.pr.title}`, tone: "muted" }]));
    }
    return facts;
  }

  private renderDetail(row: BoardRow | null): void {
    this.detailEl.replaceChildren();
    if (!row) return;
    if (row.kind === "stream") {
      const s = row.stream;
      this.detailEl.appendChild(el("div", "picker-section", s.ticket));
      this.detailEl.appendChild(el("div", "board-title", s.title));
      this.detailEl.appendChild(
        this.fact("status", [
          { text: s.status || "none recorded" },
          ...(s.statusDetail ? [{ text: ` · ${s.statusDetail}`, tone: "muted" as const }] : []),
        ]),
      );
      this.detailEl.appendChild(
        this.fact(
          "handoff",
          s.handoff
            ? [{ text: s.handoff.name }, { text: ` · ${ago(s.handoff.modified, this.now())}`, tone: "muted" }]
            : s.missingHandoff
              ? [{ text: `${s.missingHandoff} is named on the board but is not on disk`, tone: "warn" }]
              : [{ text: "none", tone: "muted" }],
        ),
      );
      if (s.worktrees.length === 0) {
        this.detailEl.appendChild(this.fact("worktree", [{ text: "none found", tone: "muted" }]));
      }
      for (const worktree of s.worktrees) this.detailEl.append(...this.worktreeFacts(worktree));
      if (s.next) {
        this.detailEl.appendChild(el("div", "picker-section board-next-title", "next"));
        this.detailEl.appendChild(el("div", "board-next", s.next));
      }
    } else if (row.kind === "handoff") {
      this.detailEl.appendChild(el("div", "picker-section", "handoff"));
      this.detailEl.appendChild(el("div", "board-title", row.handoff.title));
      this.detailEl.appendChild(this.fact("file", [{ text: row.handoff.relPath, tone: "muted" }]));
      this.detailEl.appendChild(this.fact("written", [{ text: ago(row.handoff.modified, this.now()) }]));
      this.detailEl.appendChild(this.fact("ticket", [{ text: "none on the board", tone: "warn" }]));
    } else {
      this.detailEl.appendChild(el("div", "picker-section", "worktree"));
      this.detailEl.appendChild(el("div", "board-title", row.worktree.path));
      this.detailEl.append(...this.worktreeFacts(row.worktree));
      this.detailEl.appendChild(this.fact("ticket", [{ text: "none on the board", tone: "muted" }]));
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
      case "Enter":
      case "l":
        return this.open();
      case "t":
        return this.openTicket();
      case "p":
        return this.openPullRequest();
      case "r":
        return void this.read(true);
      case "/":
        return this.startFiltering();
      case "Escape":
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

  private startFiltering(): void {
    this.filtering = true;
    this.filterRow.hidden = false;
    this.filterInput.focus();
  }

  private stopFiltering(clear: boolean): void {
    this.filtering = false;
    if (clear) this.filterInput.value = "";
    this.filterRow.hidden = this.filterInput.value === "";
    this.selected = 0;
    this.root.focus();
    this.render();
  }

  private open(): void {
    const row = this.rows[this.selected];
    const target = row && this.data ? openTarget(row, this.data.project) : null;
    if (target) this.finish(target);
  }

  private openTicket(): void {
    const row = this.rows[this.selected];
    if (row?.kind === "stream" && row.stream.url) this.options.openUrl(row.stream.url);
  }

  private openPullRequest(): void {
    const row = this.rows[this.selected];
    const pr =
      row?.kind === "stream" ? leadPullRequest(row.stream) : row?.kind === "worktree" ? row.worktree.pr : null;
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
