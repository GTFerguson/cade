/**
 * What the project picker lists and how it is filtered. No DOM here: the
 * picker draws whatever these functions return.
 */

import { fuzzyScore } from "../ui/mobile/fuzzy";
import type { LiveSessionInfo } from "../types";

export interface OpenTab {
  path: string;
  name: string;
  isActive: boolean;
}

export interface BrowseDir {
  name: string;
  path: string;
}

export type PickerEntry =
  /** A project some tab already has open: opens another tab on it. */
  | { kind: "open"; name: string; path: string; isActive: boolean }
  /** A session running on the backend with no tab here: attaches to it. */
  | { kind: "session"; session: LiveSessionInfo }
  | { kind: "recent"; name: string; path: string }
  | { kind: "dir"; name: string; path: string }
  /** The folder being browsed, as the project itself. */
  | { kind: "here"; path: string }
  /** The operating system's folder dialog, for anywhere the listing is awkward. */
  | { kind: "system" };

export interface PickerSection {
  title: string | null;
  entries: PickerEntry[];
}

export interface PickerInput {
  openTabs: OpenTab[];
  sessions: LiveSessionInfo[];
  recents: string[];
  dirs: BrowseDir[];
  browsePath: string;
  /** Whether the system folder dialog exists (the desktop app). */
  native: boolean;
}

export const RECENTS_LIMIT = 15;
/** Recent projects shown when nothing is typed; the rest are reachable by filtering. */
export const RECENTS_SHOWN = 6;

export function folderName(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || path;
}

/** The list with a project moved to the front, without repeats, capped. */
export function withRecent(recents: string[], path: string, limit = RECENTS_LIMIT): string[] {
  return [path, ...recents.filter((p) => p !== path)].slice(0, limit);
}

/**
 * Everything the picker offers, in the order it is shown. A project appears
 * once: open ones are not repeated under recent.
 */
export function buildSections(input: PickerInput, recentsShown = RECENTS_SHOWN): PickerSection[] {
  const sections: PickerSection[] = [];

  const open: PickerEntry[] = [];
  const openPaths = new Set<string>();
  // The active tab's project leads, so Enter opens a second tab on it.
  for (const tab of [...input.openTabs].sort((a, b) => Number(b.isActive) - Number(a.isActive))) {
    if (openPaths.has(tab.path)) continue;
    openPaths.add(tab.path);
    open.push({ kind: "open", name: folderName(tab.path), path: tab.path, isActive: tab.isActive });
  }
  if (open.length > 0) sections.push({ title: "open", entries: open });

  if (input.sessions.length > 0) {
    sections.push({
      title: "running, no tab here",
      entries: input.sessions.map((session) => ({ kind: "session", session })),
    });
  }

  const recent: PickerEntry[] = input.recents
    .filter((path) => !openPaths.has(path))
    .slice(0, recentsShown)
    .map((path) => ({ kind: "recent", name: folderName(path), path }));
  if (recent.length > 0) sections.push({ title: "recent", entries: recent });

  const browse: PickerEntry[] = input.dirs.map((d) => ({ kind: "dir", name: d.name, path: d.path }));
  browse.push({ kind: "here", path: input.browsePath });
  if (input.native) browse.push({ kind: "system" });
  sections.push({ title: input.browsePath, entries: browse });

  return sections;
}

/** The text an entry is matched against when filtering. */
export function entryText(entry: PickerEntry): string {
  switch (entry.kind) {
    case "open":
    case "recent":
      return entry.path;
    case "dir":
      return entry.name;
    case "session":
      return `${entry.session.label ?? ""} ${entry.session.projectPath}`;
    case "here":
    case "system":
      return "";
  }
}

/**
 * Entries matching what was typed, best first. Recent projects beyond the few
 * shown by default are searched too. "Use this folder" and the system dialog
 * are actions, not things to search for, so they drop out.
 */
export function filterEntries(input: PickerInput, query: string): PickerEntry[] {
  const all = buildSections(input, RECENTS_LIMIT).flatMap((s) => s.entries);
  const scored: { entry: PickerEntry; score: number; order: number }[] = [];
  all.forEach((entry, order) => {
    const text = entryText(entry);
    if (!text) return;
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
