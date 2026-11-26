/**
 * How a ticket's status and a pull request's state are worded and coloured.
 *
 * The strip above a terminal and the board both say these things. They are
 * decided here once, so that a pull request that reads "checks failing" in
 * red on one does not read differently on the other.
 */

import { PR_DISPLAY, pullRequestState, type PullRequestSummary } from "./pull-request";

export type Tone = "plain" | "muted" | "good" | "bad" | "warn" | "review" | "busy";

/** A ticket's status as the tracker names it and, when known, its kind. */
export interface Statused {
  status: string;
  /**
   * The tracker's own kind of state (backlog, unstarted, started,
   * completed, canceled, triage), which holds whatever a team calls its
   * states. Empty when the status is only what a board file says.
   */
  statusType?: string;
}

const DONE_NAMES = new Set(["Done", "Completed", "Canceled", "Cancelled"]);
const QUEUED_NAMES = new Set(["Todo", "Backlog", "Triage", ""]);
const DONE_TYPES = new Set(["completed", "canceled"]);
const QUEUED_TYPES = new Set(["backlog", "unstarted", "triage"]);

/** Finished in the tracker: by its kind of state when known, else by name. */
export function isDone(ticket: Statused): boolean {
  return ticket.statusType ? DONE_TYPES.has(ticket.statusType) : DONE_NAMES.has(ticket.status);
}

/** Not started: by the tracker's kind of state when known, else by name. */
export function isQueued(ticket: Statused): boolean {
  return ticket.statusType ? QUEUED_TYPES.has(ticket.statusType) : QUEUED_NAMES.has(ticket.status);
}

export function ticketTone(ticket: Statused): Tone {
  if (isDone(ticket)) return "good";
  if (isQueued(ticket)) return "muted";
  return ticket.status === "In Review" ? "review" : "busy";
}

/** A pull request that may be open, merged or closed. */
export interface AnyPullRequest extends Partial<Omit<PullRequestSummary, "number" | "title" | "url">> {
  number: number;
  title: string;
  url: string;
  /** Absent means open: a tab's own badge only ever holds an open one. */
  state?: "open" | "merged" | "closed";
}

const OPEN_TONE: Record<ReturnType<typeof pullRequestState>, Tone> = {
  conflicts: "bad",
  failing: "bad",
  changes: "review",
  running: "busy",
  approved: "good",
  passing: "good",
  open: "plain",
};

/**
 * A pull request in a few words: what matters most about it, how that
 * should be coloured, and whatever else is true of it that the first part
 * does not already say.
 */
export function pullRequestWords(pr: AnyPullRequest): { text: string; tone: Tone; rest: string[] } {
  if (pr.state === "merged") return { text: `#${pr.number} merged`, tone: "good", rest: [] };
  if (pr.state === "closed") return { text: `#${pr.number} closed`, tone: "muted", rest: [] };
  const state = pullRequestState(pr as PullRequestSummary);
  const mark = PR_DISPLAY[state].mark;
  const rest = [
    pr.draft ? "draft" : null,
    state !== "failing" && pr.checks === "failing" ? "checks failing" : null,
    state !== "running" && pr.checks === "running" ? "checks running" : null,
    state !== "changes" && pr.review === "changes" ? "changes requested" : null,
    pr.review === "required" ? "review required" : null,
    state !== "approved" && pr.review === "approved" ? "approved" : null,
  ].filter((x): x is string => x !== null);
  return {
    text: `#${pr.number}${mark ? ` ${mark}` : ""} ${PR_DISPLAY[state].says}`,
    tone: OPEN_TONE[state],
    rest,
  };
}
