/**
 * The line above a tab's terminal saying where its work stands: the pull
 * request for its branch, the branch and what is pending on it, and the
 * handoff last written for the project.
 *
 * It shows only what is known, so it is shorter on a tab with less going on
 * and absent on one with nothing to say. Each cell that names something
 * opens it.
 */

import { ago } from "../local/picker-model";
import { PR_DISPLAY, pullRequestState, type PullRequestSummary } from "./pull-request";

export interface SessionContext {
  branch: string | null;
  uncommitted: number;
  /** Commits not on the remote; null when the branch has no upstream. */
  unpushed: number | null;
  handoff: { name: string; relPath: string; title: string; modified: number } | null;
}

export type CellTone = "plain" | "muted" | "good" | "bad" | "warn" | "review" | "busy";

export interface StripCell {
  kind: "pr" | "branch" | "handoff";
  parts: { text: string; tone: CellTone }[];
  title?: string;
  open?: { url: string } | { file: string };
}

const PR_TONE: Record<ReturnType<typeof pullRequestState>, CellTone> = {
  conflicts: "bad",
  failing: "bad",
  changes: "review",
  running: "busy",
  approved: "good",
  passing: "good",
  open: "plain",
};

function prCell(pr: PullRequestSummary): StripCell {
  const state = pullRequestState(pr);
  const mark = PR_DISPLAY[state].mark;
  const lead = `#${pr.number}${mark ? ` ${mark}` : ""} ${PR_DISPLAY[state].says}`;
  // What the leading state does not already say.
  const rest = [
    pr.draft ? "draft" : null,
    state !== "failing" && pr.checks === "failing" ? "checks failing" : null,
    state !== "running" && pr.checks === "running" ? "checks running" : null,
    state !== "changes" && pr.review === "changes" ? "changes requested" : null,
    pr.review === "required" ? "review required" : null,
    state !== "approved" && pr.review === "approved" ? "approved" : null,
  ].filter((x): x is string => x !== null);
  return {
    kind: "pr",
    parts: [
      { text: lead, tone: PR_TONE[state] },
      ...(rest.length > 0 ? [{ text: ` · ${rest.join(" · ")}`, tone: "muted" as const }] : []),
    ],
    title: `${pr.title}\nClick to open on GitHub`,
    open: { url: pr.url },
  };
}

function branchCell(context: SessionContext): StripCell | null {
  if (!context.branch) return null;
  const parts: StripCell["parts"] = [
    { text: "branch ", tone: "muted" },
    { text: context.branch, tone: "plain" },
  ];
  if (context.uncommitted > 0) {
    parts.push({ text: ` · ${context.uncommitted} uncommitted`, tone: "warn" });
  }
  if (context.unpushed) parts.push({ text: ` · ${context.unpushed} unpushed`, tone: "muted" });
  if (context.uncommitted === 0 && !context.unpushed) parts.push({ text: " · clean", tone: "muted" });
  return { kind: "branch", parts };
}

function handoffCell(context: SessionContext, now: number): StripCell | null {
  const handoff = context.handoff;
  if (!handoff) return null;
  // "4m", not "4m ago": the strip has one line and the label says what it is.
  const when = ago(handoff.modified, now).replace(/ ago$/, "");
  return {
    kind: "handoff",
    parts: [
      { text: "handoff ", tone: "muted" },
      { text: handoff.name, tone: "plain" },
      ...(when ? [{ text: ` ${when}`, tone: "muted" as const }] : []),
    ],
    title: `${handoff.title}\nClick to read it`,
    open: { file: handoff.relPath },
  };
}

/** The cells to show, most pressing first. Empty when nothing is known. */
export function stripCells(
  pr: PullRequestSummary | null,
  context: SessionContext | null,
  now: number,
): StripCell[] {
  return [
    pr ? prCell(pr) : null,
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
