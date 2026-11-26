/**
 * What the project picker lists and how it is filtered. No DOM here: the
 * picker draws whatever these functions return.
 *
 * The picker has two screens. The first lists projects (or, away from the
 * projects folder, plain folders). The second is one project: a new session,
 * then the handoffs a session can start from.
 */

import { fuzzyScore } from "../ui/mobile/fuzzy";
import type { LiveSessionInfo } from "../types";

/** A folder under the main working folder, as the backend lists it. */
export interface ProjectInfo {
  name: string;
  path: string;
  /** When it was last worked on, in seconds since the epoch. */
  modified: number;
  /** How many handoff briefs it has. */
  handoffs: number;
}

export interface HandoffInfo {
  name: string;
  relPath: string;
  title: string;
  modified: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  /** Whether the agent's program is installed on the backend's machine. */
  available: boolean;
  default: boolean;
}

export interface BrowseDir {
  name: string;
  path: string;
}

export interface OpenTab {
  path: string;
  isActive: boolean;
}

export const RECENTS_LIMIT = 15;
/**
 * How many recent projects, and how many sessions without a tab, are shown
 * before anything is typed. Both are shortcuts above the full project list,
 * so they stay short enough that the list is still on screen below them.
 */
export const RECENTS_SHOWN = 4;
export const SESSIONS_SHOWN = 4;

/** The list with a project moved to the front, without repeats, capped. */
export function withRecent(recents: string[], path: string, limit = RECENTS_LIMIT): string[] {
  return [path, ...recents.filter((p) => p !== path)].slice(0, limit);
}

export type PickerEntry =
  /** A project some tab already has open: the quick way to a second tab on it. */
  | { kind: "open"; name: string; path: string; isActive: boolean }
  /** A project opened lately on this device. */
  | { kind: "recent"; name: string; path: string }
  /** A session running on the backend with no tab here: attaches to it. */
  | { kind: "session"; session: LiveSessionInfo }
  /** The sessions left out of a shortened list; choosing it shows them all. */
  | { kind: "more"; count: number }
  /** A project under the main working folder. */
  | { kind: "project"; project: ProjectInfo; open: boolean }
  /** A plain folder, when browsing away from the projects folder. */
  | { kind: "dir"; name: string; path: string }
  /** The folder being browsed, as the project itself. */
  | { kind: "here"; path: string }
  /** The operating system's folder dialog: the last resort. */
  | { kind: "system" }
  /** A fresh session in the project, with nothing loaded. */
  | { kind: "new"; path: string }
  /** A session that starts by reading this handoff. */
  | { kind: "handoff"; path: string; handoff: HandoffInfo };

export interface PickerSection {
  title: string | null;
  entries: PickerEntry[];
  /**
   * Shown in the side column: the quick choices (open, running, recent)
   * that sit beside the main listing rather than in it.
   */
  side?: boolean;
}

export interface BrowseInput {
  openTabs: OpenTab[];
  recents: string[];
  sessions: LiveSessionInfo[];
  /** Show every session without a tab, not only the first few. */
  allSessions?: boolean;
  /** Projects, when the folder being browsed is the main working folder. */
  projects: ProjectInfo[] | null;
  dirs: BrowseDir[];
  browsePath: string;
  /** Whether the system folder dialog exists (the desktop app). */
  native: boolean;
}

export function folderName(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || path;
}

/**
 * The first screen: open projects, sessions to attach to, recent projects,
 * then the projects (or folders) of the folder being browsed. The quick
 * choices come first so the common case is at the top; a project also
 * appears in the listing below, where the whole folder is in one order.
 */
export function browseSections(
  input: BrowseInput,
  recentsShown = RECENTS_SHOWN,
): PickerSection[] {
  const sections: PickerSection[] = [];

  const open: PickerEntry[] = [];
  const openPaths = new Set<string>();
  // The active tab's project leads, so it is the first thing Enter reaches.
  for (const tab of [...input.openTabs].sort((a, b) => Number(b.isActive) - Number(a.isActive))) {
    if (openPaths.has(tab.path)) continue;
    openPaths.add(tab.path);
    open.push({ kind: "open", name: folderName(tab.path), path: tab.path, isActive: tab.isActive });
  }
  if (open.length > 0) sections.push({ title: "open", entries: open, side: true });

  if (input.sessions.length > 0) {
    const ordered = sessionsByNeed(input.sessions);
    const shown = input.allSessions ? ordered : ordered.slice(0, SESSIONS_SHOWN);
    const entries: PickerEntry[] = shown.map((session) => ({ kind: "session", session }));
    if (shown.length < ordered.length) {
      entries.push({ kind: "more", count: ordered.length - shown.length });
    }
    sections.push({ title: "running without a tab", entries, side: true });
  }

  const recent: PickerEntry[] = input.recents
    .filter((path) => !openPaths.has(path))
    .slice(0, recentsShown)
    .map((path) => ({ kind: "recent", name: folderName(path), path }));
  if (recent.length > 0) sections.push({ title: "recent", entries: recent, side: true });

  const listing: PickerEntry[] =
    input.projects !== null
      ? input.projects.map((project) => ({
          kind: "project",
          project,
          open: openPaths.has(project.path),
        }))
      : input.dirs.map((d) => ({ kind: "dir", name: d.name, path: d.path }));
  // The projects folder is a container, not a project, so it is not offered
  // as one; any other folder can be the project itself.
  if (input.projects === null) listing.push({ kind: "here", path: input.browsePath });
  if (input.native) listing.push({ kind: "system" });
  sections.push({ title: input.browsePath, entries: listing });

  return sections;
}

const ATTENTION_RANK: Record<string, number> = { input: 0, idle: 1, working: 2 };

/**
 * Sessions with the ones waiting on the user first, then finished, then
 * working, then the rest. Order within each is kept (most recent first).
 */
export function sessionsByNeed(sessions: LiveSessionInfo[]): LiveSessionInfo[] {
  const rank = (s: LiveSessionInfo) => ATTENTION_RANK[s.attention ?? ""] ?? 3;
  return sessions
    .map((session, order) => ({ session, order }))
    .sort((a, b) => rank(a.session) - rank(b.session) || a.order - b.order)
    .map((x) => x.session);
}

/**
 * What a session is about, without the parts shown elsewhere on its row. An
 * agent titles its terminal "Action Required | <task> | <project>"; the
 * project has its own column and the state its own mark, so only the task is
 * left. Empty for a session nobody has named.
 */
export function sessionTask(session: Pick<LiveSessionInfo, "label" | "projectPath">): string {
  const project = folderName(session.projectPath).toLowerCase();
  return (session.label ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== project && part.toLowerCase() !== "action required")
    .join(" | ");
}

/** The second screen: one project. */
export function projectSections(path: string, handoffs: HandoffInfo[]): PickerSection[] {
  const sections: PickerSection[] = [{ title: path, entries: [{ kind: "new", path }] }];
  if (handoffs.length > 0) {
    sections.push({
      title: "handoffs",
      entries: handoffs.map((handoff) => ({ kind: "handoff", path, handoff })),
    });
  }
  return sections;
}

/** The folder an entry stands for, or null for one that is not a folder. */
export function entryPath(entry: PickerEntry): string | null {
  switch (entry.kind) {
    case "project":
      return entry.project.path;
    case "open":
    case "recent":
    case "dir":
    case "here":
    case "new":
    case "handoff":
      return entry.path;
    case "session":
    case "system":
    case "more":
      return null;
  }
}

/** The text an entry is matched against when filtering; empty for actions. */
export function entryText(entry: PickerEntry): string {
  switch (entry.kind) {
    case "project":
      return entry.project.name;
    case "open":
    case "recent":
      return entry.name;
    case "dir":
      return entry.name;
    case "session":
      return `${folderName(entry.session.projectPath)} ${sessionTask(entry.session)}`;
    case "handoff":
      return `${entry.handoff.title} ${entry.handoff.name}`;
    case "here":
    case "system":
    case "new":
    case "more":
      return "";
  }
}

/**
 * The entries matching what was typed, best first. Actions have nothing to
 * match and drop out, and a project listed twice (open, and in the folder)
 * is matched once.
 */
export function filterSections(sections: PickerSection[], query: string): PickerEntry[] {
  const seen = new Set<string>();
  const scored: { entry: PickerEntry; score: number; order: number }[] = [];
  sections
    .flatMap((s) => s.entries)
    .forEach((entry, order) => {
      const text = entryText(entry);
      if (!text) return;
      const path = entryPath(entry);
      if (path !== null && entry.kind !== "handoff") {
        if (seen.has(path)) return;
        seen.add(path);
      }
      const match = fuzzyScore(query, text);
      if (match) scored.push({ entry, score: match.score, order });
    });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.entry);
}

/**
 * What typed text means. Text that starts like a path browses: everything up
 * to the last slash is the folder to list, the rest filters that listing.
 */
export function parseQuery(query: string): { browse: string | null; filter: string } {
  if (!query.startsWith("/") && !query.startsWith("~")) return { browse: null, filter: query };
  const cut = query.lastIndexOf("/");
  if (cut === -1) return { browse: null, filter: "" };
  return { browse: query.slice(0, cut) || "/", filter: query.slice(cut + 1) };
}

/** The folder above, or the same path at the top. */
export function parentPath(path: string): string {
  const clean = path.replace(/\/+$/, "");
  if (clean === "" || clean === "~") return path;
  const cut = clean.lastIndexOf("/");
  if (cut === -1) return path;
  if (clean.startsWith("~") && cut === 1) return "~";
  return clean.slice(0, cut) || "/";
}

/**
 * The next choice of tab group for the new tab: null (let the folder rule
 * decide) and then each group in turn, wrapping.
 */
export function nextGroupChoice(current: string | null, groups: string[]): string | null {
  if (groups.length === 0) return null;
  if (current === null) return groups[0]!;
  const at = groups.indexOf(current);
  return at === -1 || at === groups.length - 1 ? null : groups[at + 1]!;
}

/**
 * The agent a new tab starts with: the one chosen last time if it is still
 * installed, else the backend's default, else whatever is installed.
 */
export function initialAgent(agents: AgentInfo[], remembered: string | null): string | null {
  const usable = agents.filter((a) => a.available);
  return (
    usable.find((a) => a.id === remembered)?.id ??
    usable.find((a) => a.default)?.id ??
    usable[0]?.id ??
    null
  );
}

/** The next installed agent after the current one, wrapping. */
export function nextAgent(agents: AgentInfo[], current: string | null): string | null {
  const usable = agents.filter((a) => a.available);
  if (usable.length === 0) return null;
  const at = usable.findIndex((a) => a.id === current);
  return usable[(at + 1) % usable.length]!.id;
}

/** How long ago something happened, in the largest unit that fits. */
export function ago(seconds: number, now: number): string {
  if (seconds <= 0) return "";
  const elapsed = Math.max(0, now - seconds);
  if (elapsed < 60) return "just now";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  if (elapsed < 86400 * 60) return `${Math.floor(elapsed / 86400)}d ago`;
  return `${Math.floor(elapsed / (86400 * 30))}mo ago`;
}

/**
 * What an agent opened on a handoff brief is given: the brief's path and
 * nothing else. The brief carries the context, and any instruction added
 * here (resume, report, wait) decides for the user what the session is for.
 */
export function handoffPrompt(relPath: string): string {
  return relPath;
}
