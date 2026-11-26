/**
 * The line above a tab's terminal saying where its work stands: the ticket
 * it is on, the pull request, the branch and what is pending on it, and the
 * handoff it is working from.
 *
 * It is about the tab's own stream, not the folder the tab was opened on:
 * several tabs are often opened on one project folder, each on a different
 * handoff. The backend works out the handoff and reads the rest from the
 * board (backend/session_context.py). It shows only what is known, so it is
 * shorter on a tab with less going on and absent on one with nothing to
 * say. Each cell that names something opens it.
 */

import { ago } from "../local/picker-model";
import type { PullRequestSummary } from "./pull-request";
import { pullRequestWords, ticketTone, type AnyPullRequest, type Statused, type Tone } from "./work-words";

export interface ContextTicket extends Statused {
  ticket: string;
  title: string;
  url: string | null;
}

/** A stream's pull request, which unlike a tab's badge may be merged or closed. */
export type StreamPullRequest = AnyPullRequest & { state: "open" | "merged" | "closed" };

export interface SessionContext {
  /** The folder the tab was opened on: its branch and what is pending there. */
  branch: string | null;
  uncommitted: number;
  /** Commits not on the remote; null when the branch has no upstream. */
  unpushed: number | null;
  /** The handoff the tab is working from, and how that is known. */
  handoff: { name: string; relPath: string; title: string; modified: number; source?: string } | null;
  /** The tickets that handoff carries. */
  tickets?: ContextTicket[];
  /** The worktree that stands for the stream, in place of the tab's folder. */
  worktree?: { name: string; branch: string | null; uncommitted: number; unpushed: number | null } | null;
  /** The stream's pull request, in place of the folder's. */
  pr?: StreamPullRequest | null;
}

export type CellTone = Tone;

export interface StripCell {
  kind: "ticket" | "pr" | "branch" | "handoff";
  parts: { text: string; tone: CellTone }[];
  title?: string;
  open?: { url: string } | { file: string };
}

/**
 * The ticket to lead with: one being worked on, else one not yet started,
 * else whatever there is. A handoff often carries a ticket in progress
 * beside others still in the backlog, and the tab is on the first kind.
 */
function leadTicket(tickets: ContextTicket[]): ContextTicket | null {
  const under_way = (t: ContextTicket) => ticketTone(t) === "busy" || ticketTone(t) === "review";
  return (
    tickets.find(under_way) ?? tickets.find((t) => ticketTone(t) !== "good") ?? tickets[0] ?? null
  );
}

function ticketCell(tickets: ContextTicket[]): StripCell | null {
  const lead = leadTicket(tickets);
  if (!lead) return null;
  const others = tickets.length - 1;
  return {
    kind: "ticket",
    parts: [
      { text: lead.ticket, tone: "plain" },
      { text: ` ${lead.status}`, tone: ticketTone(lead) },
      ...(others > 0 ? [{ text: ` +${others}`, tone: "muted" as const }] : []),
      { text: `  ${lead.title}`, tone: "muted" },
    ],
    title:
      tickets.map((t) => `${t.ticket}  ${t.status}  ${t.title}`).join("\n") +
      (lead.url ? "\nClick to open in the tracker" : ""),
    ...(lead.url ? { open: { url: lead.url } } : {}),
  };
}

function prCell(pr: PullRequestSummary | StreamPullRequest): StripCell {
  const { text, tone, rest } = pullRequestWords(pr);
  return {
    kind: "pr",
    parts: [
      { text, tone },
      ...(rest.length > 0 ? [{ text: ` \u00b7 ${rest.join(" \u00b7 ")}`, tone: "muted" as const }] : []),
    ],
    title: `${pr.title}\nClick to open on GitHub`,
    open: { url: pr.url },
  };
}

function branchCell(context: SessionContext): StripCell | null {
  // The stream's own worktree when it has one; the tab's folder otherwise.
  const tree = context.worktree ?? context;
  if (!tree.branch) return null;
  const parts: StripCell["parts"] = [
    { text: "branch ", tone: "muted" },
    { text: tree.branch, tone: "plain" },
  ];
  if (tree.uncommitted > 0) {
    parts.push({ text: ` \u00b7 ${tree.uncommitted} uncommitted`, tone: "warn" });
  }
  if (tree.unpushed) parts.push({ text: ` \u00b7 ${tree.unpushed} unpushed`, tone: "muted" });
  if (tree.uncommitted === 0 && !tree.unpushed) parts.push({ text: " \u00b7 clean", tone: "muted" });
  return {
    kind: "branch",
    parts,
    ...(context.worktree ? { title: `worktree ${context.worktree.name}` } : {}),
  };
}

const SOURCE_SAYS: Record<string, string> = {
  chosen: "the handoff this tab was opened on",
  written: "the handoff this tab's agent last wrote",
  titled: "the handoff this tab's title names",
};

function handoffCell(context: SessionContext, now: number): StripCell | null {
  const handoff = context.handoff;
  if (!handoff) return null;
  // "4m", not "4m ago": the strip has one line and the label says what it is.
  const when = ago(handoff.modified, now).replace(/ ago$/, "");
  const how = handoff.source ? SOURCE_SAYS[handoff.source] : undefined;
  return {
    kind: "handoff",
    parts: [
      { text: "handoff ", tone: "muted" },
      { text: handoff.name, tone: "plain" },
      ...(when ? [{ text: ` ${when}`, tone: "muted" as const }] : []),
    ],
    title: `${handoff.title}${how ? `\n${how}` : ""}\nClick to read it`,
    open: { file: handoff.relPath },
  };
}

/** The pull request to show: the stream's when it has one, else the folder's. */
export function effectivePullRequest(
  folder: PullRequestSummary | null,
  context: SessionContext | null,
): PullRequestSummary | StreamPullRequest | null {
  return context?.pr ?? folder;
}

/** The cells to show, most identifying first. Empty when nothing is known. */
export function stripCells(
  pr: PullRequestSummary | null,
  context: SessionContext | null,
  now: number,
): StripCell[] {
  const shown = effectivePullRequest(pr, context);
  return [
    context ? ticketCell(context.tickets ?? []) : null,
    shown ? prCell(shown) : null,
    context ? branchCell(context) : null,
    context ? handoffCell(context, now) : null,
  ].filter((c): c is StripCell => c !== null);
}

export interface ContextStripCallbacks {
  onOpenUrl: (url: string) => void;
  onOpenFile: (relPath: string) => void;
}

/** How often the handoff's age is redrawn while nothing else changes. */
const AGE_REFRESH_MS = 60_000;

export class ContextStrip {
  readonly element: HTMLElement;
  private pr: PullRequestSummary | null = null;
  private context: SessionContext | null = null;
  private timer: ReturnType<typeof setInterval>;

  constructor(private callbacks: ContextStripCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "context-strip";
    this.element.hidden = true;
    this.timer = setInterval(() => this.render(), AGE_REFRESH_MS);
  }

  setPullRequest(pr: PullRequestSummary | null): void {
    this.pr = pr;
    this.render();
  }

  setContext(context: SessionContext | null): void {
    this.context = context;
    this.render();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.element.remove();
  }

  private render(): void {
    const cells = stripCells(this.pr, this.context, Date.now() / 1000);
    this.element.hidden = cells.length === 0;
    this.element.replaceChildren(
      ...cells.map((cell) => {
        const open = cell.open;
        const el = document.createElement(open ? "button" : "span");
        el.className = "context-strip-cell";
        el.dataset["kind"] = cell.kind;
        if (cell.title) el.title = cell.title;
        for (const part of cell.parts) {
          const span = document.createElement("span");
          span.dataset["tone"] = part.tone;
          span.textContent = part.text;
          el.appendChild(span);
        }
        if (open) {
          el.addEventListener("click", () => {
            if ("url" in open) this.callbacks.onOpenUrl(open.url);
            else this.callbacks.onOpenFile(open.file);
          });
        }
        return el;
      }),
    );
  }
}
