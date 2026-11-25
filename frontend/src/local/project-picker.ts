/**
 * Keyboard-driven picker for the project a new tab opens on. The same screen
 * on desktop, in the browser and on the phone.
 *
 * It lists projects already open, sessions running without a tab here, recent
 * projects, then a folder listing. `/` filters all of them by typing; text
 * that starts like a path browses to that folder instead.
 *
 * In dev/demo mode, set window.__MOCK_BROWSE__ to stub the folder listing.
 */

import { basePath } from "../config/config";
import { fuzzyScore } from "../ui/mobile/fuzzy";
import type { FileNode, LiveSessionInfo } from "../types";
import {
  buildSections,
  filterEntries,
  folderName,
  nextGroupChoice,
  parentPath,
  parseQuery,
  type BrowseDir,
  type OpenTab,
  type PickerEntry,
  type PickerInput,
  type PickerSection,
} from "./picker-model";

const DEFAULT_BROWSE_PATH = "~/projects";

export type PickerResult =
  /** Open a tab on a project. `group` null leaves the group to the folder rule. */
  | { kind: "project"; path: string; group: string | null }
  /** Open a tab onto a session already running on the backend. */
  | { kind: "attach"; session: LiveSessionInfo }
  /** Ask the operating system's folder dialog for the project. */
  | { kind: "system"; group: string | null };

export interface ProjectPickerOptions {
  openTabs: OpenTab[];
  recents: string[];
  /** Names of the tab groups a new tab can be put in. */
  groups: string[];
  /** Whether the system folder dialog is available (the desktop app). */
  native: boolean;
  /** Live sessions with no tab on this device. Loaded after the picker opens. */
  loadSessions?: () => Promise<LiveSessionInfo[]>;
}

async function browseDirectory(path: string): Promise<{ path: string; children: FileNode[] }> {
  const mock = (window as any).__MOCK_BROWSE__;
  if (mock) return mock(path);

  const resp = await fetch(`${basePath}/api/browse?path=${encodeURIComponent(path)}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ProjectPicker {
  private root: HTMLDivElement;
  private listEl: HTMLDivElement;
  private filterRow: HTMLDivElement;
  private filterInput: HTMLInputElement;
  private groupEl: HTMLDivElement;
  private helpEl: HTMLDivElement;

  private resolve: ((result: PickerResult | null) => void) | null = null;
  private focusBefore: HTMLElement | null = null;

  private sessions: LiveSessionInfo[] = [];
  private dirs: BrowseDir[] = [];
  private browsePath = DEFAULT_BROWSE_PATH;
  private loading = true;
  // Guards against a slow folder listing landing after a newer one.
  private browseRequest = 0;

  private filtering = false;
  private entries: PickerEntry[] = [];
  private selected = 0;
  private group: string | null = null;

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(container: HTMLElement, private options: ProjectPickerOptions) {
    this.root = el("div", "project-picker");
    this.root.tabIndex = -1;

    const body = el("div", "picker-body");
    body.appendChild(el("div", "picker-header", "[ OPEN PROJECT ]"));

    this.filterRow = el("div", "picker-filter");
    this.filterRow.hidden = true;
    this.filterRow.appendChild(el("span", "picker-filter-prompt", "/"));
    this.filterInput = el("input", "picker-filter-input");
    this.filterInput.type = "text";
    this.filterInput.spellcheck = false;
    this.filterInput.setAttribute("aria-label", "Filter projects, or type a path");
    this.filterInput.addEventListener("input", () => this.onQueryChanged());
    this.filterRow.appendChild(this.filterInput);
    body.appendChild(this.filterRow);

    this.listEl = el("div", "picker-list");
    body.appendChild(this.listEl);

    this.groupEl = el("div", "picker-group");
    body.appendChild(this.groupEl);

    this.helpEl = el("div", "picker-help");
    this.root.appendChild(body);
    this.root.appendChild(this.helpEl);
    container.appendChild(this.root);
  }

  async show(): Promise<PickerResult | null> {
    this.focusBefore = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", this.onKeyDown, true);
    // Take focus off the terminal, or it would go on blinking as if typing went there.
    this.root.focus();
    this.render();

    void this.options.loadSessions?.().then(
      (sessions) => {
        if (!this.resolve) return;
        this.sessions = sessions;
        this.render();
      },
      () => {
        // The picker works without them; the start screen offers them too.
      },
    );
    void this.browse(DEFAULT_BROWSE_PATH);

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  // -- data ---------------------------------------------------------------

  private get input(): PickerInput {
    return {
      openTabs: this.options.openTabs,
      sessions: this.sessions,
      recents: this.options.recents,
      dirs: this.dirs,
      browsePath: this.browsePath,
      native: this.options.native,
    };
  }

  private async browse(path: string): Promise<void> {
    const request = ++this.browseRequest;
    this.loading = true;
    this.render();
    let listed: { path: string; children: FileNode[] } | null = null;
    try {
      listed = await browseDirectory(path);
    } catch {
      listed = null;
    }
    if (request !== this.browseRequest) return;
    this.browsePath = listed?.path ?? path;
    this.dirs = (listed?.children ?? [])
      .filter((child) => child.type === "directory")
      .map((child) => ({ name: child.name, path: child.path }));
    this.loading = false;
    this.render();
  }

  /** The sections on show: everything, or what the typed text narrows it to. */
  private currentSections(): PickerSection[] {
    const query = this.filtering ? this.filterInput.value : "";
    const { browse, filter } = parseQuery(query);
    if (browse !== null) {
      const dirs = this.dirs.filter((d) => fuzzyScore(filter, d.name) !== null);
      const entries: PickerEntry[] = dirs.map((d) => ({ kind: "dir", name: d.name, path: d.path }));
      if (filter === "") entries.push({ kind: "here", path: this.browsePath });
      return [{ title: this.browsePath, entries }];
    }
    if (filter !== "") return [{ title: null, entries: filterEntries(this.input, filter) }];
    return buildSections(this.input);
  }

  private onQueryChanged(): void {
    const { browse } = parseQuery(this.filterInput.value);
    this.selected = 0;
    if (browse !== null && browse !== this.browsePath) void this.browse(browse);
    else this.render();
  }

  // -- drawing ------------------------------------------------------------

  private render(): void {
    const sections = this.currentSections();
    this.entries = sections.flatMap((s) => s.entries);
    this.selected = Math.max(0, Math.min(this.selected, this.entries.length - 1));

    this.listEl.replaceChildren();
    let index = 0;
    for (const section of sections) {
      if (section.title !== null) this.listEl.appendChild(el("div", "picker-section", section.title));
      for (const entry of section.entries) {
        this.listEl.appendChild(this.entryElement(entry, index));
        index++;
      }
    }
    if (this.entries.length === 0) {
      this.listEl.appendChild(el("div", "picker-empty", this.loading ? "loading…" : "nothing matches"));
    } else if (this.loading) {
      this.listEl.appendChild(el("div", "picker-empty", "loading…"));
    }
    this.listEl.querySelector<HTMLElement>(".picker-option.selected")?.scrollIntoView?.({ block: "nearest" });

    this.groupEl.hidden = this.options.groups.length === 0;
    this.groupEl.replaceChildren(
      el("span", "picker-group-label", "tab group "),
      el("span", "picker-group-value", this.group ?? "by folder"),
    );

    this.renderHelp();
  }

  private entryElement(entry: PickerEntry, index: number): HTMLElement {
    const option = el("div", "picker-option");
    option.classList.toggle("selected", index === this.selected);
    option.dataset["kind"] = entry.kind;

    let label: string;
    let meta = "";
    switch (entry.kind) {
      case "open":
        label = `[${entry.name}]`;
        meta = entry.isActive ? `${entry.path} · this tab` : entry.path;
        break;
      case "recent":
        label = `[${entry.name}]`;
        meta = entry.path;
        break;
      case "session": {
        const s = entry.session;
        label = `[${s.label?.trim() || folderName(s.projectPath)}]`;
        const state = s.attention === "input" ? " · needs you" : s.attention === "idle" ? " · done" : "";
        meta = `attach · ${s.agent}${state}`;
        break;
      }
      case "dir":
        label = `[${entry.name}/]`;
        break;
      case "here":
        label = "[use this folder]";
        meta = entry.path;
        break;
      case "system":
        label = "[system folder dialog…]";
        break;
    }

    option.appendChild(el("span", "picker-option-label", label));
    if (meta) option.appendChild(el("span", "picker-option-meta", meta));
    option.addEventListener("click", () => {
      this.selected = index;
      // A click on a folder goes into it; its project is one more click on
      // "use this folder". Everything else is chosen outright.
      if (entry.kind === "dir") void this.enter(entry);
      else this.confirm();
    });
    return option;
  }

  private renderHelp(): void {
    const keys: [string, string][] = this.filtering
      ? [
          ["↑/↓", "move"],
          ["tab", "into folder"],
          ["enter", "open"],
          ["esc", "stop filtering"],
        ]
      : [
          ["j/k", "move"],
          ["l", "into folder"],
          ["h", "up"],
          ["/", "filter or type a path"],
          ...(this.options.groups.length > 0 ? ([["g", "tab group"]] as [string, string][]) : []),
          ["enter", "open"],
          ["esc", "cancel"],
        ];
    this.helpEl.replaceChildren(
      ...keys.map(([key, what]) => {
        const row = el("div", "picker-help-row");
        row.appendChild(el("span", "picker-help-key", key));
        row.append(` ${what}`);
        return row;
      }),
    );
  }

  // -- keys ---------------------------------------------------------------

  private handleKey(e: KeyboardEvent): void {
    // Leave chords alone, apart from the few used to move while filtering.
    const chord = e.ctrlKey || e.altKey || e.metaKey;
    if (this.filtering) {
      // Nothing typed here may reach the terminal or an app shortcut.
      e.stopPropagation();
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey ? e.key.toLowerCase() : null;
      if (e.key === "ArrowDown" || ctrl === "n" || ctrl === "j") this.act(e, () => this.move(1));
      else if (e.key === "ArrowUp" || ctrl === "p" || ctrl === "k") this.act(e, () => this.move(-1));
      else if (e.key === "Enter") this.act(e, () => this.confirm());
      else if (e.key === "Tab") this.act(e, () => this.enterSelected());
      else if (e.key === "Escape") this.act(e, () => this.stopFiltering());
      return;
    }
    if (chord) return;

    // Plain keys belong to the picker while it is open, handled or not:
    // an unhandled one must not be typed into the shell behind it.
    e.preventDefault();
    e.stopPropagation();
    switch (e.key) {
      case "j":
      case "ArrowDown":
        return this.move(1);
      case "k":
      case "ArrowUp":
        return this.move(-1);
      case "l":
      case "ArrowRight":
        return this.enterSelected();
      case "h":
      case "ArrowLeft":
      case "Backspace":
        return this.up();
      case "Enter":
      case " ":
        return this.confirm();
      case "/":
        return this.startFiltering();
      case "g":
        this.group = nextGroupChoice(this.group, this.options.groups);
        return this.render();
      case "Escape":
        return this.finish(null);
    }
  }

  private act(e: KeyboardEvent, action: () => void): void {
    e.preventDefault();
    action();
  }

  private move(step: 1 | -1): void {
    if (this.entries.length === 0) return;
    this.selected = (this.selected + step + this.entries.length) % this.entries.length;
    this.render();
  }

  private startFiltering(): void {
    this.filtering = true;
    this.filterRow.hidden = false;
    this.filterInput.value = "";
    this.selected = 0;
    this.filterInput.focus();
    this.render();
  }

  private stopFiltering(): void {
    this.filtering = false;
    this.filterRow.hidden = true;
    this.filterInput.value = "";
    this.selected = 0;
    this.root.focus();
    this.render();
  }

  /** Go into the selected folder; anything else has no inside, so it is chosen. */
  private enterSelected(): void {
    const entry = this.entries[this.selected];
    if (!entry) return;
    if (entry.kind === "dir") void this.enter(entry);
    else this.confirm();
  }

  private async enter(entry: { path: string }): Promise<void> {
    // While typing a path, the text follows into the folder so typing can go on.
    if (this.filtering) this.filterInput.value = parseQuery(this.filterInput.value).browse !== null ? `${entry.path}/` : "";
    this.selected = 0;
    await this.browse(entry.path);
  }

  private up(): void {
    const parent = parentPath(this.browsePath);
    if (parent === this.browsePath) return;
    this.selected = 0;
    void this.browse(parent);
  }

  private confirm(): void {
    const entry = this.entries[this.selected];
    if (!entry) return;
    switch (entry.kind) {
      case "session":
        return this.finish({ kind: "attach", session: entry.session });
      case "system":
        return this.finish({ kind: "system", group: this.group });
      default:
        return this.finish({ kind: "project", path: entry.path, group: this.group });
    }
  }

  private finish(result: PickerResult | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.root.remove();
    if (this.focusBefore?.isConnected) this.focusBefore.focus();
    resolve?.(result);
  }
}
