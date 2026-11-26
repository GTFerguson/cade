/**
 * What the board lists and how it is filtered. No DOM here: the screen draws
 * whatever these functions return.
 *
 * The backend (backend/board.py) joins a project's ticket table to its
 * handoffs, worktrees and pull requests. This module arranges that into
 * sections a person reads top to bottom: what is in review, what is in
 * progress, what is waiting, then the gaps (handoffs with no ticket,
 * worktrees nobody listed).
 */

export type Verdict = "finished" | "merged-dirty" | "in-review" | "closed" | "local";

export interface BoardPullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "merged" | "closed";
  draft?: boolean;
  checks?: "failing" | "running" | "passing" | null;
  review?: "approved" | "changes" | "required" | null;
  conflicts?: boolean;
}

export interface BoardWorktree {
  name: string;
  path: string;
  repo: string;
  branch: string | null;
  uncommitted: number;
  unpushed: number | null;
  pr: BoardPullRequest | null;
  verdict: Verdict;
}

export interface BoardHandoff {
  name: string;
  relPath: string;
  title: string;
  modified: number;
}

export interface BoardStream {
  ticket: string;
  url: string | null;
  title: string;
  status: string;
  statusDetail: string;
  /** The heading the row sits under in the board file. */
  section: string;
  next: string;
  handoff: BoardHandoff | null;
  /** A handoff the board file names that is not on disk. */
  missingHandoff: string | null;
  worktrees: BoardWorktree[];
  prs: number[];
}

export interface BoardData {
  project: string;
  hasBoardFile: boolean;
  streams: BoardStream[];
  /** Handoffs no ticket row names. */
  handoffs: BoardHandoff[];
  /** Worktrees no ticket row names. */
  worktrees: BoardWorktree[];
  gathered: number;
}

export type BoardRow =
  | { kind: "stream"; stream: BoardStream }
  | { kind: "handoff"; handoff: BoardHandoff }
  | { kind: "worktree"; worktree: BoardWorktree };

export interface BoardSection {
  title: string;
  rows: BoardRow[];
}

/**
 * The order tickets in play are read in: what someone else is waiting on
 * you for, then what you are doing, then what is queued. Done comes last,
 * and a status not named here goes between the queue and done.
 */
export const STATUS_ORDER = ["In Review", "In Progress", "Todo", "Backlog"];
const DONE = new Set(["Done", "Completed", "Canceled", "Cancelled"]);

const VERDICT_ORDER: Verdict[] = ["finished", "merged-dirty", "in-review", "closed", "local"];

export const VERDICT_SAYS: Record<Verdict, string> = {
  finished: "finished",
  "merged-dirty": "merged, holds work",
  "in-review": "in review",
  closed: "closed",
  local: "no pull request",
};

function statusRank(status: string): number {
  const at = STATUS_ORDER.indexOf(status);
  if (at !== -1) return at;
  return DONE.has(status) ? STATUS_ORDER.length + 1 : STATUS_ORDER.length;
}

/** Whether a board-file heading holds the tickets in play, as against deferred or coming ones. */
function isActive(section: string): boolean {
  return /active/i.test(section);
}

/**
 * The board as sections. Tickets under an "active" heading are regrouped by
 * their status; every other heading of the file is kept as its own section,
 * in the file's order, since that grouping is the author's.
 */
export function boardSections(data: BoardData): BoardSection[] {
  const sections: BoardSection[] = [];
  const active = data.streams.filter((s) => isActive(s.section));
  const statuses = [...new Set(active.map((s) => s.status || "No status"))].sort(
    (a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b),
  );
  for (const status of statuses) {
    sections.push({
      title: status,
      rows: active
        .filter((s) => (s.status || "No status") === status)
        .map((stream) => ({ kind: "stream", stream })),
    });
  }

  const others = [...new Set(data.streams.filter((s) => !isActive(s.section)).map((s) => s.section))];
  for (const title of others) {
    sections.push({
      title,
      rows: data.streams
        .filter((s) => s.section === title)
        .map((stream) => ({ kind: "stream", stream })),
    });
  }

  if (data.handoffs.length > 0) {
    sections.push({
      title: "Handoffs with no ticket",
      rows: data.handoffs.map((handoff) => ({ kind: "handoff", handoff })),
    });
  }
  if (data.worktrees.length > 0) {
    const sorted = [...data.worktrees].sort(
      (a, b) =>
        VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) ||
        a.name.localeCompare(b.name),
    );
    sections.push({
      title: "Worktrees not on the board",
      rows: sorted.map((worktree) => ({ kind: "worktree", worktree })),
    });
  }
  return sections.filter((s) => s.rows.length > 0);
}

/** Everything a row can be found by, lowercased. */
function haystack(row: BoardRow): string {
  const parts: (string | null | undefined)[] =
    row.kind === "stream"
      ? [
          row.stream.ticket,
          row.stream.title,
          row.stream.status,
          row.stream.handoff?.name,
          row.stream.missingHandoff,
          ...row.stream.worktrees.flatMap((w) => [w.name, w.branch]),
          ...row.stream.prs.map((n) => `#${n}`),
        ]
      : row.kind === "handoff"
        ? [row.handoff.name, row.handoff.title]
        : [row.worktree.name, row.worktree.branch, row.worktree.repo, VERDICT_SAYS[row.worktree.verdict]];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/** Sections with only the rows that contain every word of the query. */
export function filterSections(sections: BoardSection[], query: string): BoardSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections
    .map((s) => ({
      title: s.title,
      rows: s.rows.filter((row) => {
        const text = haystack(row);
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((s) => s.rows.length > 0);
}

/** How many worktrees, on the board or off it, could be removed today. */
export function finishedCount(data: BoardData): number {
  const all = new Map<string, BoardWorktree>();
  for (const w of [...data.streams.flatMap((s) => s.worktrees), ...data.worktrees]) all.set(w.path, w);
  return [...all.values()].filter((w) => w.verdict === "finished").length;
}

/** The pull request a stream is best summed up by: an open one before a merged one. */
export function leadPullRequest(stream: BoardStream): BoardPullRequest | null {
  const prs = stream.worktrees.map((w) => w.pr).filter((p): p is BoardPullRequest => p !== null);
  return prs.find((p) => p.state === "open") ?? prs.find((p) => p.state === "merged") ?? prs[0] ?? null;
}

/** What opening a row means: which folder the tab opens on and which brief it is handed. */
export function openTarget(
  row: BoardRow,
  project: string,
): { path: string; handoff: string | null } | null {
  if (row.kind === "worktree") return { path: row.worktree.path, handoff: null };
  if (row.kind === "handoff") return { path: project, handoff: row.handoff.relPath };
  // A ticket with no handoff has nothing to start a session from.
  return row.stream.handoff ? { path: project, handoff: row.stream.handoff.relPath } : null;
}
