/**
 * What the board lists and how it is filtered. No DOM here: the screen draws
 * whatever these functions return.
 *
 * The backend (backend/board.py) joins a project's ticket table to its
 * handoffs, worktrees and pull requests. This module arranges that so a
 * person can answer "what should I be doing now": tickets are gathered into
 * the streams that carry them, streams are grouped by what they need, and
 * what needs nothing is folded away behind a count.
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
  /**
   * The tracker's own kind of state (backlog, unstarted, started, completed,
   * canceled, triage), which holds whatever a team calls its states. Empty
   * when the status is only what the board file says.
   */
  statusType?: string;
  /** Whether title, status and parent were read from the tracker just now. */
  live?: boolean;
  /** The ticket this one sits under. */
  parent?: string | null;
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
  /** Tickets and handoffs only: the worktrees have not been read yet. */
  partial?: boolean;
  /** Whether tickets were read from the tracker, and how many it gave. */
  tracker?: { live: boolean; tickets: number };
  /** Tickets that others sit under and that are not rows themselves. */
  parents?: Record<string, { title: string; status: string; url: string | null; parent: string | null }>;
}

/**
 * A stream of work: one handoff and every ticket it carries, or a ticket
 * that has no handoff, on its own. A handoff is the unit a session is opened
 * on, and one often carries several tickets, which listed one per row read
 * as the same line several times over.
 */
export interface BoardGroup {
  /** The handoff's name, or the ticket's id when it has no handoff. */
  key: string;
  handoff: BoardHandoff | null;
  tickets: BoardStream[];
  /** The worktrees of all its tickets, each once. */
  worktrees: BoardWorktree[];
}

/**
 * What a stream needs, most pressing first. The board is grouped by this
 * and not by ticket status: "in progress" in the tracker covers a pull
 * request that is failing, one that merged days ago and one not yet opened,
 * which call for three different things.
 */
export type Stage = "needs-you" | "in-review" | "close-out" | "in-progress" | "queued" | "done";

export type BoardRow =
  | { kind: "group"; group: BoardGroup; stage: Stage }
  /** One ticket, in the view that follows tickets' parents. */
  | { kind: "ticket"; stream: BoardStream; depth: number }
  | { kind: "handoff"; handoff: BoardHandoff }
  | { kind: "worktree"; worktree: BoardWorktree }
  /** The heading of a folded section, which unfolds it. */
  | { kind: "fold"; id: string; title: string; count: number; hint: string };

export interface BoardSection {
  id: string;
  title: string;
  /** What the section is for, or holds, shown beside its title. */
  hint: string;
  rows: BoardRow[];
  folded: boolean;
}

/** By what each stream needs, or by which ticket each sits under. */
export type BoardView = "need" | "parent";

const DONE_NAMES = new Set(["Done", "Completed", "Canceled", "Cancelled"]);
const QUEUED_NAMES = new Set(["Todo", "Backlog", "Triage", ""]);
const DONE_TYPES = new Set(["completed", "canceled"]);
const QUEUED_TYPES = new Set(["backlog", "unstarted", "triage"]);

/** Finished in the tracker: by its kind of state when known, else by name. */
export function isDone(ticket: BoardStream): boolean {
  return ticket.statusType ? DONE_TYPES.has(ticket.statusType) : DONE_NAMES.has(ticket.status);
}

/** Not started: by the tracker's kind of state when known, else by name. */
export function isQueued(ticket: BoardStream): boolean {
  return ticket.statusType ? QUEUED_TYPES.has(ticket.statusType) : QUEUED_NAMES.has(ticket.status);
}
const VERDICT_ORDER: Verdict[] = ["finished", "merged-dirty", "in-review", "closed", "local"];

export const VERDICT_SAYS: Record<Verdict, string> = {
  finished: "finished",
  "merged-dirty": "merged, holds work",
  "in-review": "in review",
  closed: "closed",
  local: "no pull request",
};

export const STAGES: { stage: Stage; title: string; hint: string; folded: boolean }[] = [
  { stage: "needs-you", title: "Needs you", hint: "failing, conflicting, changes asked for, or ready to merge", folded: false },
  { stage: "in-review", title: "In review", hint: "pull request open, waiting on checks or a reviewer", folded: false },
  { stage: "close-out", title: "Close out", hint: "pull request merged, ticket still open", folded: false },
  { stage: "in-progress", title: "In progress", hint: "being worked on, no pull request yet", folded: false },
  { stage: "queued", title: "Queued", hint: "not started", folded: true },
  { stage: "done", title: "Done", hint: "", folded: true },
];

/** Whether a board-file heading holds the tickets in play, as against deferred or coming ones. */
function isActive(section: string): boolean {
  return /active/i.test(section);
}

function uniqueWorktrees(tickets: BoardStream[]): BoardWorktree[] {
  const seen = new Map<string, BoardWorktree>();
  for (const w of tickets.flatMap((t) => t.worktrees)) seen.set(w.path, w);
  return [...seen.values()];
}

/** Tickets gathered under the handoff that carries them, in the order first met. */
export function groupStreams(streams: BoardStream[]): BoardGroup[] {
  const groups = new Map<string, BoardGroup>();
  for (const ticket of streams) {
    const key = ticket.handoff?.name ?? ticket.ticket;
    const group = groups.get(key);
    if (group) group.tickets.push(ticket);
    else groups.set(key, { key, handoff: ticket.handoff, tickets: [ticket], worktrees: [] });
  }
  for (const group of groups.values()) group.worktrees = uniqueWorktrees(group.tickets);
  return [...groups.values()];
}

/** Whether an open pull request is waiting on its author. */
export function wantsAuthor(pr: BoardPullRequest): boolean {
  if (pr.state !== "open") return false;
  if (pr.conflicts || pr.checks === "failing" || pr.review === "changes") return true;
  // Approved with nothing running or failing is waiting only to be merged.
  return pr.review === "approved" && pr.checks !== "running";
}

export function stageOf(group: BoardGroup): Stage {
  const prs = group.worktrees.map((w) => w.pr).filter((p): p is BoardPullRequest => p !== null);
  const open = prs.filter((p) => p.state === "open");
  if (open.some(wantsAuthor)) return "needs-you";
  if (open.length > 0) return "in-review";
  const unfinished = openTickets(group);
  if (unfinished.length === 0) return "done";
  if (prs.some((p) => p.state === "merged")) return "close-out";
  return unfinished.every(isQueued) ? "queued" : "in-progress";
}

/** The tickets of a group that are not finished in the tracker. */
export function openTickets(group: BoardGroup): BoardStream[] {
  return group.tickets.filter((t) => !isDone(t));
}

/** The pull request a stream is best summed up by: one that wants its author, then any open one, then a merged one. */
export function leadPullRequest(group: BoardGroup): BoardPullRequest | null {
  const prs = group.worktrees.map((w) => w.pr).filter((p): p is BoardPullRequest => p !== null);
  return (
    prs.find(wantsAuthor) ??
    prs.find((p) => p.state === "open") ??
    prs.find((p) => p.state === "merged") ??
    prs[0] ??
    null
  );
}

/** How many streams are at each stage, among the tickets in play. */
export function stageCounts(data: BoardData): Record<Stage, number> {
  const counts: Record<Stage, number> = {
    "needs-you": 0, "in-review": 0, "close-out": 0, "in-progress": 0, queued: 0, done: 0,
  };
  for (const group of groupStreams(data.streams.filter((s) => isActive(s.section)))) {
    counts[stageOf(group)]++;
  }
  return counts;
}

function gapSections(data: BoardData): Omit<BoardSection, "folded">[] {
  const sorted = [...data.worktrees].sort(
    (a, b) =>
      VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.name.localeCompare(b.name),
  );
  const finished = sorted.filter((w) => w.verdict === "finished").length;
  return [
    {
      id: "handoffs",
      title: "Handoffs with no ticket",
      hint: "",
      rows: data.handoffs.map((handoff) => ({ kind: "handoff", handoff })),
    },
    {
      id: "worktrees",
      title: "Worktrees not on the board",
      hint: finished > 0 ? `${finished} finished` : "",
      rows: sorted.map((worktree) => ({ kind: "worktree", worktree })),
    },
  ];
}

/** Sections by what each stream needs. */
function byNeed(data: BoardData): (Omit<BoardSection, "folded"> & { foldedByDefault: boolean })[] {
  const out: (Omit<BoardSection, "folded"> & { foldedByDefault: boolean })[] = [];
  const staged = groupStreams(data.streams.filter((s) => isActive(s.section))).map((group) => ({
    group,
    stage: stageOf(group),
  }));
  for (const { stage, title, hint, folded } of STAGES) {
    out.push({
      id: stage,
      title,
      hint,
      rows: staged.filter((g) => g.stage === stage).map((g) => ({ kind: "group", group: g.group, stage })),
      foldedByDefault: folded,
    });
  }
  // The board file's other headings (deferred, coming, and so on) are the
  // author's own grouping and are kept as they are.
  const others = [...new Set(data.streams.filter((s) => !isActive(s.section)).map((s) => s.section))];
  for (const title of others) {
    out.push({
      id: `file:${title}`,
      title,
      hint: "",
      rows: groupStreams(data.streams.filter((s) => s.section === title)).map((group) => ({
        kind: "group",
        group,
        stage: stageOf(group),
      })),
      foldedByDefault: true,
    });
  }
  for (const gap of gapSections(data)) out.push({ ...gap, foldedByDefault: true });
  return out;
}

/**
 * Sections by parent: each ticket that others sit under heads a section,
 * with those tickets beneath it and theirs beneath them. A parent that is
 * not itself on the board still heads its section, by id alone. Tickets
 * with no parent and no children come last, together.
 */
function byParent(data: BoardData): (Omit<BoardSection, "folded"> & { foldedByDefault: boolean })[] {
  const byId = new Map(data.streams.map((s) => [s.ticket, s]));
  const children = new Map<string, BoardStream[]>();
  for (const s of data.streams) {
    if (!s.parent || s.parent === s.ticket) continue;
    const list = children.get(s.parent);
    if (list) list.push(s);
    else children.set(s.parent, [s]);
  }

  const descend = (id: string, depth: number, seen: Set<string>): BoardRow[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return (children.get(id) ?? []).flatMap((child) => [
      { kind: "ticket" as const, stream: child, depth },
      ...descend(child.ticket, depth + 1, seen),
    ]);
  };

  const out: (Omit<BoardSection, "folded"> & { foldedByDefault: boolean })[] = [];
  // A section per top of a tree: a parent that has no parent on the board.
  const tops = [...children.keys()].filter((id) => {
    const parent = byId.get(id)?.parent;
    return !parent || !children.has(parent) || parent === id;
  });
  for (const top of tops) {
    const self = byId.get(top);
    const rows: BoardRow[] = [
      ...(self ? [{ kind: "ticket" as const, stream: self, depth: 0 }] : []),
      ...descend(top, self ? 1 : 0, new Set()),
    ];
    const named = data.parents?.[top];
    out.push({
      id: `parent:${top}`,
      // The ticket's own row, first in the section, carries its title; a
      // parent that is not a row is named here, when the tracker gave it.
      title: top,
      hint: self ? "" : named ? named.title : "not on the board",
      rows,
      foldedByDefault: false,
    });
  }

  const placed = new Set(out.flatMap((s) => s.rows.map((r) => (r.kind === "ticket" ? r.stream.ticket : ""))));
  const alone = data.streams.filter((s) => !placed.has(s.ticket));
  out.push({
    id: "parent:none",
    title: "No parent recorded",
    hint: "",
    rows: alone.map((stream) => ({ kind: "ticket", stream, depth: 0 })),
    foldedByDefault: out.length > 0,
  });
  for (const gap of gapSections(data)) out.push({ ...gap, foldedByDefault: true });
  return out;
}

/**
 * The board as sections. Some open folded to a heading with a count, so the
 * screen opens on what is to be acted on and not on everything there is;
 * `toggled` holds the ids whose fold has been flipped from its default.
 */
export function boardSections(
  data: BoardData,
  view: BoardView = "need",
  toggled: ReadonlySet<string> = new Set(),
): BoardSection[] {
  return (view === "need" ? byNeed(data) : byParent(data))
    .filter((s) => s.rows.length > 0)
    .map(({ foldedByDefault, ...s }) => ({ ...s, folded: foldedByDefault !== toggled.has(s.id) }));
}

/**
 * The rows to draw and move through: each section's rows, or for a folded
 * section the one row that stands for it.
 */
export function visibleRows(sections: BoardSection[]): BoardRow[] {
  return sections.flatMap((s) =>
    s.folded
      ? [{ kind: "fold" as const, id: s.id, title: s.title, count: s.rows.length, hint: s.hint }]
      : s.rows,
  );
}

function ticketWords(t: BoardStream): (string | null | undefined)[] {
  return [t.ticket, t.title, t.status, t.parent, t.missingHandoff, ...t.prs.map((n) => `#${n}`)];
}

function worktreeWords(w: BoardWorktree): (string | null | undefined)[] {
  return [w.name, w.branch, w.repo, VERDICT_SAYS[w.verdict], w.pr ? `#${w.pr.number}` : null];
}

/** Everything a row can be found by, lowercased. */
function haystack(row: BoardRow): string {
  const parts: (string | null | undefined)[] =
    row.kind === "group"
      ? [
          row.group.key,
          row.group.handoff?.title,
          ...row.group.tickets.flatMap(ticketWords),
          ...row.group.worktrees.flatMap(worktreeWords),
        ]
      : row.kind === "ticket"
        ? [...ticketWords(row.stream), row.stream.handoff?.name, ...row.stream.worktrees.flatMap(worktreeWords)]
        : row.kind === "handoff"
          ? [row.handoff.name, row.handoff.title]
          : row.kind === "worktree"
            ? worktreeWords(row.worktree)
            : [];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Sections with only the rows that contain every word of the query, all of
 * them unfolded: a search looks inside what is folded away, and shows what
 * it found there.
 */
export function filterSections(sections: BoardSection[], query: string): BoardSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections
    .map((s) => ({
      ...s,
      folded: false,
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

/** What identifies a row, so that it can be found again in a newer board. */
export function rowKey(row: BoardRow): string {
  switch (row.kind) {
    case "group":
      return `group:${row.group.key}`;
    case "ticket":
      return `ticket:${row.stream.section}:${row.stream.ticket}`;
    case "handoff":
      return `handoff:${row.handoff.relPath}`;
    case "worktree":
      return `worktree:${row.worktree.path}`;
    case "fold":
      return `fold:${row.id}`;
  }
}

/** What opening a row means: which folder the tab opens on and which brief it is handed. */
export function openTarget(
  row: BoardRow,
  project: string,
): { path: string; handoff: string | null } | null {
  switch (row.kind) {
    case "worktree":
      return { path: row.worktree.path, handoff: null };
    case "handoff":
      return { path: project, handoff: row.handoff.relPath };
    case "group":
      // A ticket with no handoff has nothing to start a session from.
      return row.group.handoff ? { path: project, handoff: row.group.handoff.relPath } : null;
    case "ticket":
      return row.stream.handoff ? { path: project, handoff: row.stream.handoff.relPath } : null;
    case "fold":
      return null;
  }
}

/** The index of the first row of the section after, or before, the one a row is in. */
export function sectionJump(sections: BoardSection[], selected: number, step: 1 | -1): number {
  const starts: number[] = [];
  let at = 0;
  for (const s of sections) {
    starts.push(at);
    at += s.folded ? 1 : s.rows.length;
  }
  if (starts.length === 0) return 0;
  if (step === 1) return starts.find((i) => i > selected) ?? starts[starts.length - 1]!;
  // Going back lands on the start of this section first, then the one before.
  return [...starts].reverse().find((i) => i < selected) ?? 0;
}

/** The section a row index falls in, or null. */
export function sectionAt(sections: BoardSection[], index: number): BoardSection | null {
  let at = 0;
  for (const s of sections) {
    const size = s.folded ? 1 : s.rows.length;
    if (index < at + size) return s;
    at += size;
  }
  return null;
}
