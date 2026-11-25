/**
 * Tab groups: named, coloured, collapsible groups of tabs.
 *
 * A tab's group is the name held by its session on the backend. The functions
 * here are the rules for laying grouped tabs out and summarising them; they
 * hold no state.
 */

import type { AttentionState } from "../types";

/** What a group looks like and which folders join it, as the backend stores it. */
export interface TabGroupDef {
  name: string;
  colour: string;
  paths: string[];
}

/**
 * Colours a group may take, in the order new groups are given them. Purple,
 * green and yellow lead because blue, cyan and orange already mean working,
 * finished and waiting on a tab.
 */
export const GROUP_COLOURS = [
  "purple",
  "green",
  "yellow",
  "red",
  "blue",
  "cyan",
  "orange",
  "grey",
] as const;

export type GroupColour = (typeof GROUP_COLOURS)[number];

export const DEFAULT_GROUP_COLOUR: GroupColour = "grey";

const COLOUR_VARS: Record<GroupColour, string> = {
  purple: "var(--accent-purple)",
  green: "var(--accent-green)",
  yellow: "var(--accent-yellow)",
  red: "var(--accent-red)",
  blue: "var(--accent-blue)",
  cyan: "var(--accent-cyan)",
  orange: "var(--accent-orange)",
  grey: "var(--text-muted)",
};

export function groupColourVar(colour: string | undefined): string {
  return COLOUR_VARS[(colour ?? DEFAULT_GROUP_COLOUR) as GroupColour] ?? COLOUR_VARS[DEFAULT_GROUP_COLOUR];
}

/** The first colour no existing group uses, or the first colour when all are taken. */
export function nextGroupColour(defs: TabGroupDef[]): GroupColour {
  const used = new Set(defs.map((d) => d.colour));
  return GROUP_COLOURS.find((c) => !used.has(c)) ?? GROUP_COLOURS[0];
}

/** A name not yet taken: "Group", then "Group 2", "Group 3"… */
export function newGroupName(taken: Iterable<string>, base = "Group"): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

interface Grouped {
  group?: string;
}

/**
 * Order tabs so that each group's tabs sit together, the group standing where
 * its first tab was. Order within a group, and of everything else, is kept.
 */
export function arrangeByGroup<T extends Grouped>(tabs: T[]): T[] {
  const members = new Map<string, T[]>();
  for (const tab of tabs) {
    if (!tab.group) continue;
    const list = members.get(tab.group);
    if (list) list.push(tab);
    else members.set(tab.group, [tab]);
  }
  const out: T[] = [];
  const placed = new Set<string>();
  for (const tab of tabs) {
    if (!tab.group) {
      out.push(tab);
    } else if (!placed.has(tab.group)) {
      placed.add(tab.group);
      out.push(...members.get(tab.group)!);
    }
  }
  return out;
}

/** A stretch of the tab bar: one group's tabs, or adjacent ungrouped tabs. */
export interface TabRun<T> {
  group: string | null;
  tabs: T[];
}

/** Split arranged tabs into runs. Expects the order `arrangeByGroup` gives. */
export function tabRuns<T extends Grouped>(tabs: T[]): TabRun<T>[] {
  const runs: TabRun<T>[] = [];
  for (const tab of tabs) {
    const group = tab.group ?? null;
    const last = runs[runs.length - 1];
    if (last && last.group === group) last.tabs.push(tab);
    else runs.push({ group, tabs: [tab] });
  }
  return runs;
}

/**
 * How the ungrouped tabs are named in a set of collapsed groups. No group
 * can have this name: a group's name is never empty.
 */
export const UNGROUPED = "";

/** Tabs that are on show: those not inside a collapsed group. */
export function visibleTabs<T extends Grouped>(tabs: T[], collapsed: ReadonlySet<string>): T[] {
  return tabs.filter((t) => !collapsed.has(t.group ?? UNGROUPED));
}

/**
 * Where a tab dragged to `toIndex` within its own run lands in the full list.
 * A drag never carries a tab out of its run, so its group cannot change.
 */
export function moveWithinRun<T extends Grouped & { id: string }>(
  tabs: T[],
  id: string,
  toIndex: number,
): T[] {
  const from = tabs.findIndex((t) => t.id === id);
  if (from === -1) return tabs;
  const group = tabs[from]!.group ?? null;
  let start = from;
  while (start > 0 && (tabs[start - 1]!.group ?? null) === group) start--;
  let end = from;
  while (end < tabs.length - 1 && (tabs[end + 1]!.group ?? null) === group) end++;
  const target = Math.max(start, Math.min(start + toIndex, end));
  if (target === from) return tabs;
  const out = tabs.slice();
  const [moved] = out.splice(from, 1);
  out.splice(target, 0, moved!);
  return out;
}

/**
 * The tab to show when `id` is about to go out of view: the nearest visible
 * tab after it, else the nearest before it. Null when nothing else is on show.
 */
export function nearestVisible<T extends Grouped & { id: string }>(
  tabs: T[],
  id: string,
  collapsed: ReadonlySet<string>,
): T | null {
  const index = tabs.findIndex((t) => t.id === id);
  const shown = (t: T) => t.id !== id && (!t.group || !collapsed.has(t.group));
  for (let i = index + 1; i < tabs.length; i++) if (shown(tabs[i]!)) return tabs[i]!;
  for (let i = index - 1; i >= 0; i--) if (shown(tabs[i]!)) return tabs[i]!;
  return null;
}

export interface GroupRollup {
  state: "input" | "working" | "idle" | "none";
  /** Tabs waiting on the user. Only "input" is counted. */
  waiting: number;
}

/**
 * What a collapsed group shows for the tabs inside it. Waiting outranks
 * working, which outranks finished, and only waiting tabs are counted: several
 * finished tabs must not read as something that needs the user.
 */
export function groupRollup(states: AttentionState[]): GroupRollup {
  const waiting = states.filter((s) => s === "input").length;
  if (waiting > 0) return { state: "input", waiting };
  if (states.includes("working")) return { state: "working", waiting: 0 };
  if (states.includes("idle")) return { state: "idle", waiting: 0 };
  return { state: "none", waiting: 0 };
}

function isWithin(path: string, folder: string): boolean {
  const clean = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = clean(path);
  const f = clean(folder);
  return p === f || p.startsWith(`${f}/`);
}

/** The folder above a project, the unit a group auto-adds by. Null at the root. */
export function parentFolder(path: string): string | null {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const cut = clean.lastIndexOf("/");
  return cut > 0 ? clean.slice(0, cut) : null;
}

export function groupAutoAdds(def: TabGroupDef | undefined, folder: string): boolean {
  return def?.paths.some((p) => isWithin(folder, p) && isWithin(p, folder)) ?? false;
}

/**
 * Definitions with one group's colour or folders changed. A group with no
 * definition yet gets one, in the first colour not in use.
 */
export function withGroupDef(
  defs: TabGroupDef[],
  name: string,
  change: Partial<Pick<TabGroupDef, "colour" | "paths">> = {},
): TabGroupDef[] {
  if (defs.some((d) => d.name === name)) {
    return defs.map((d) => (d.name === name ? { ...d, ...change } : d));
  }
  return [...defs, { name, colour: nextGroupColour(defs), paths: [], ...change }];
}

/**
 * Definitions after a group is renamed. Renaming onto an existing group
 * merges into it, keeping that group's colour and gaining the folders.
 */
export function withGroupRenamed(defs: TabGroupDef[], from: string, to: string): TabGroupDef[] {
  const old = defs.find((d) => d.name === from);
  if (!old) return defs;
  const target = defs.find((d) => d.name === to);
  const rest = defs.filter((d) => d.name !== from);
  if (!target) return defs.map((d) => (d.name === from ? { ...d, name: to } : d));
  const paths = [...new Set([...target.paths, ...old.paths])];
  return rest.map((d) => (d.name === to ? { ...d, paths } : d));
}

export function withoutGroupDef(defs: TabGroupDef[], name: string): TabGroupDef[] {
  return defs.filter((d) => d.name !== name);
}

/** A group's folder list with one folder added or taken out. */
export function withAutoAdd(def: TabGroupDef | undefined, folder: string, enabled: boolean): string[] {
  const kept = (def?.paths ?? []).filter((p) => !groupAutoAdds({ name: "", colour: "", paths: [p] }, folder));
  return enabled ? [...kept, folder] : kept;
}
