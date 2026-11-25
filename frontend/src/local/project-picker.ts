/**
 * Keyboard-driven picker for what a new tab opens on. The same screen on
 * desktop, in the browser and on the phone.
 *
 * The first screen lists the projects already open and recently opened, for
 * a quick second tab, then every project under the main working folder, most
 * recently worked on first. `h` and `l` walk up and down folders from there,
 * anywhere on disk. Enter chooses a folder as the project, which shows a new
 * session and the project's handoffs, newest first; choosing a handoff opens
 * a tab whose agent starts by reading it. The agent the tab will run and its
 * tab group are shown at the top and switched with `a` and `g`. The system
 * folder dialog is the last resort.
 *
 * In dev/demo mode, set window.__MOCK_BROWSE__ to stub the folder listing.
 */

import { apiBase } from "../config/config";
import type { FileNode, LiveSessionInfo } from "../types";
import {
  ago,
  browseSections,
  entryPath,
  filterSections,
  folderName,
  initialAgent,
  nextAgent,
  nextGroupChoice,
  parentPath,
  parseQuery,
  projectSections,
  sessionTask,
  type AgentInfo,
  type BrowseDir,
  type HandoffInfo,
  type OpenTab,
  type PickerEntry,
  type PickerSection,
  type ProjectInfo,
} from "./picker-model";

/** Listed when the backend cannot say where the projects are. */
const FALLBACK_BROWSE_PATH = "~/projects";
const AGENT_STORAGE_KEY = "cade-picker-agent";
/** Rows kept in view beyond the selected one while moving through the list. */
const SCROLL_LOOKAHEAD_ROWS = 2;

export type PickerResult =
  /**
   * Open a tab on a project. `group` null leaves the group to the folder
   * rule, `agent` null to the backend's default, and `handoff` is the brief
   * the agent starts from, if one was chosen.
   */
  | { kind: "project"; path: string; group: string | null; agent: string | null; handoff: string | null }
  /** Open a tab onto a session already running on the backend. */
  | { kind: "attach"; session: LiveSessionInfo }
  /** Ask the operating system's folder dialog for the project. */
  | { kind: "system"; group: string | null; agent: string | null };

export interface ProjectsListing {
  root: string;
  projects: ProjectInfo[];
  agents: AgentInfo[];
}

/** Where the picker gets its lists. Replaceable so it can be tested and demoed. */
export interface PickerApi {
  /** Null when the backend has no such listing (an older remote backend). */
  projects(): Promise<ProjectsListing | null>;
  handoffs(path: string): Promise<HandoffInfo[]>;
  browse(path: string): Promise<{ path: string; dirs: BrowseDir[] }>;
}

async function getJson<T>(url: string): Promise<T | null> {
  const resp = await fetch(url, { credentials: "include" });
  return resp.ok ? ((await resp.json()) as T) : null;
}

export const backendPickerApi: PickerApi = {
  projects: () => getJson<ProjectsListing>(`${apiBase()}/api/projects`),

  async handoffs(path) {
    const body = await getJson<{ handoffs?: HandoffInfo[] }>(
      `${apiBase()}/api/projects/handoffs?path=${encodeURIComponent(path)}`,
    );
    return body?.handoffs ?? [];
  },

  async browse(path) {
    const mock = (window as any).__MOCK_BROWSE__;
    const body: { path: string; children: FileNode[] } | null = mock
      ? await mock(path)
      : await getJson(`${apiBase()}/api/browse?path=${encodeURIComponent(path)}`);
    return {
      path: body?.path ?? path,
      dirs: (body?.children ?? [])
        .filter((child) => child.type === "directory")
        .map((child) => ({ name: child.name, path: child.path })),
    };
  },
};

export interface ProjectPickerOptions {
  /** Projects that already have a tab here, offered first for a second tab. */
  openTabs: OpenTab[];
  /** Projects opened lately on this device, most recent first. */
  recents: string[];
  /** Names of the tab groups a new tab can be put in. */
  groups: string[];
  /** Whether the system folder dialog is available (the desktop app). */
  native: boolean;
  /** Live sessions with no tab on this device. Loaded after the picker opens. */
  loadSessions?: () => Promise<LiveSessionInfo[]>;
  api?: PickerApi;
  /** Seconds since the epoch; replaceable so "2h ago" can be tested. */
  now?: () => number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rememberedAgent(): string | null {
  try {
    return localStorage.getItem(AGENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

type Screen = { kind: "browse" } | { kind: "project"; path: string; handoffs: HandoffInfo[] };

export class ProjectPicker {
  private root: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private listEl: HTMLDivElement;
  private filterRow: HTMLDivElement;
  private filterInput: HTMLInputElement;
  private settingsEl: HTMLDivElement;
  private helpEl: HTMLDivElement;

  private api: PickerApi;
  private now: () => number;

  private resolve: ((result: PickerResult | null) => void) | null = null;
  private focusBefore: HTMLElement | null = null;

  private sessions: LiveSessionInfo[] = [];
  private projectsRoot: string | null = null;
  private projects: ProjectInfo[] = [];
  private agents: AgentInfo[] = [];
  private dirs: BrowseDir[] = [];
  private browsePath = FALLBACK_BROWSE_PATH;
  private screen: Screen = { kind: "browse" };
  private loading = true;
  // Guards against a slow listing landing after a newer request.
  private request = 0;

  private filtering = false;
  private entries: PickerEntry[] = [];
  private selected = 0;
  // Where the list was left when a project was opened, to come back to.
  private browseSelection = 0;
  private selectListing = false;
  private allSessions = false;
  private group: string | null = null;
  private agent: string | null = null;

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(container: HTMLElement, private options: ProjectPickerOptions) {
    this.api = options.api ?? backendPickerApi;
    this.now = options.now ?? (() => Date.now() / 1000);

    this.root = el("div", "project-picker");
    this.root.tabIndex = -1;

    const body = el("div", "picker-body");
    this.headerEl = el("div", "picker-header");
    body.appendChild(this.headerEl);

    this.filterRow = el("div", "picker-filter");
    this.filterRow.hidden = true;
    this.filterRow.appendChild(el("span", "picker-filter-prompt", "/"));
    this.filterInput = el("input", "picker-filter-input");
    this.filterInput.type = "text";
    this.filterInput.spellcheck = false;
    this.filterInput.setAttribute("aria-label", "Filter, or type a path");
    this.filterInput.addEventListener("input", () => this.onQueryChanged());
    this.filterRow.appendChild(this.filterInput);
    body.appendChild(this.filterRow);

    // Above the list, where they are seen before a project is chosen.
    this.settingsEl = el("div", "picker-settings");
    body.appendChild(this.settingsEl);

    this.listEl = el("div", "picker-list");
    body.appendChild(this.listEl);

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
    void this.loadProjects();

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  // -- data ---------------------------------------------------------------

  private async loadProjects(): Promise<void> {
    const request = ++this.request;
    let listing: ProjectsListing | null = null;
    try {
      listing = await this.api.projects();
    } catch {
      listing = null;
    }
    if (request !== this.request) return;
    if (!listing) {
      // No projects listing: fall back to a plain folder listing.
      await this.browse(FALLBACK_BROWSE_PATH);
      return;
    }
    this.projectsRoot = listing.root;
    this.projects = listing.projects;
    this.agents = listing.agents;
    this.agent = initialAgent(this.agents, rememberedAgent());
    this.browsePath = listing.root;
    this.loading = false;
    this.render();
  }

  private async browse(path: string): Promise<void> {
    const request = ++this.request;
    this.screen = { kind: "browse" };
    this.selected = 0;
    this.loading = true;
    this.render();
    let listed: { path: string; dirs: BrowseDir[] };
    try {
      listed = await this.api.browse(path);
    } catch {
      listed = { path, dirs: [] };
    }
    if (request !== this.request) return;
    this.browsePath = listed.path;
    this.dirs = listed.dirs;
    this.loading = false;
    // Having walked to a folder, start in its listing, below the quick choices.
    this.selectListing = true;
    this.render();
  }

  /**
   * A folder was chosen as the project: show what can be started in it, a
   * new session first and then its handoffs.
   */
  private async openProject(path: string): Promise<void> {
    const request = ++this.request;
    this.loading = true;
    this.render();
    let handoffs: HandoffInfo[] = [];
    try {
      handoffs = await this.api.handoffs(path);
    } catch {
      handoffs = [];
    }
    if (request !== this.request) return;
    this.loading = false;
    this.browseSelection = this.selected;
    this.screen = { kind: "project", path, handoffs };
    this.selected = 0;
    if (this.filtering) this.filterInput.value = "";
    this.render();
  }

  /** The sections on show: everything, or what the typed text narrows it to. */
  private currentSections(): PickerSection[] {
    const all =
      this.screen.kind === "project"
        ? projectSections(this.screen.path, this.screen.handoffs)
        : browseSections({
            openTabs: this.options.openTabs,
            recents: this.options.recents,
            sessions: this.sessions,
            // Typing searches every session, not only the few on show.
            allSessions: this.allSessions || this.filtering,
            projects: this.browsePath === this.projectsRoot ? this.projects : null,
            dirs: this.dirs,
            browsePath: this.browsePath,
            native: this.options.native,
          });
    if (!this.filtering) return all;
    const { browse, filter } = parseQuery(this.filterInput.value);
    if (filter === "") return all;
    // While a path is being typed only the folder listing is in play.
    const scope = browse !== null ? all.slice(-1) : all;
    return [{ title: browse !== null ? this.browsePath : null, entries: filterSections(scope, filter) }];
  }

  private onQueryChanged(): void {
    const { browse } = parseQuery(this.filterInput.value);
    this.selected = 0;
    if (browse !== null && (this.screen.kind !== "browse" || browse !== this.browsePath)) {
      void this.browse(browse);
    } else {
      this.render();
    }
  }

  // -- drawing ------------------------------------------------------------

  private render(): void {
    const sections = this.currentSections();
    this.entries = sections.flatMap((s) => s.entries);
    if (this.selectListing && !this.loading) {
      this.selectListing = false;
      if (this.screen.kind === "browse" && sections.length > 1) {
        this.selected = this.entries.length - sections[sections.length - 1]!.entries.length;
      }
    }
    this.selected = Math.max(0, Math.min(this.selected, this.entries.length - 1));

    this.headerEl.textContent =
      this.screen.kind === "project" ? `[ ${folderName(this.screen.path).toUpperCase()} ]` : "[ OPEN PROJECT ]";

    // Rebuilding the list resets its scroll position; keep it.
    const scrollTop = this.listEl.scrollTop;
    this.listEl.replaceChildren();
    let index = 0;
    for (const section of sections) {
      if (section.title !== null) this.listEl.appendChild(el("div", "picker-section", section.title));
      for (const entry of section.entries) {
        this.listEl.appendChild(this.entryElement(entry, index));
        index++;
      }
    }
    if (this.loading) this.listEl.appendChild(el("div", "picker-empty", "loading…"));
    else if (this.entries.length === 0) this.listEl.appendChild(el("div", "picker-empty", "nothing matches"));
    this.listEl.scrollTop = scrollTop;
    this.keepSelectedInView();

    this.renderSettings();
    this.renderHelp();
  }

  /**
   * Scroll so the selected row has rows visible on both sides of it. Without
   * the margin the list only moves when the selection hits its edge, and the
   * next row is never in sight.
   */
  private keepSelectedInView(): void {
    const list = this.listEl;
    const selected = list.querySelector<HTMLElement>(".picker-option.selected");
    if (!selected) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = selected.getBoundingClientRect();
    const margin = rowRect.height * SCROLL_LOOKAHEAD_ROWS;
    const top = rowRect.top - listRect.top + list.scrollTop;
    const bottom = top + rowRect.height;
    if (top - margin < list.scrollTop) list.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom + margin - list.clientHeight;
    }
  }

  private canSwitchAgent(): boolean {
    return this.agents.filter((a) => a.available).length > 1;
  }

  private renderSettings(): void {
    const rows: HTMLElement[] = [];
    const usable = this.agents.filter((a) => a.available);
    if (usable.length > 0) {
      rows.push(
        this.settingRow(
          "agent",
          "a",
          usable.map((a) => ({
            // Lowercase like every other option; a tab group keeps the name it was given.
            label: a.name.toLowerCase(),
            selected: a.id === this.agent,
            pick: () => this.setAgent(a.id),
          })),
        ),
      );
    }
    if (this.options.groups.length > 0) {
      const choices: (string | null)[] = [null, ...this.options.groups];
      rows.push(
        this.settingRow(
          "group",
          "g",
          choices.map((g) => ({
            label: g ?? "by folder",
            selected: g === this.group,
            pick: () => {
              this.group = g;
              this.render();
            },
          })),
        ),
      );
    }
    this.settingsEl.replaceChildren(...rows);
    this.settingsEl.hidden = rows.length === 0;
  }

  /**
   * One choice the new tab is opened with, as the segmented toggle used for
   * mode choices elsewhere: every option on show, the current one filled.
   */
  private settingRow(
    name: string,
    key: string,
    choices: { label: string; selected: boolean; pick: () => void }[],
  ): HTMLElement {
    const row = el("div", "picker-setting");
    row.dataset["setting"] = name;
    const toggle = el("div", "big-toggle picker-toggle");
    choices.forEach((choice, i) => {
      if (i > 0) toggle.appendChild(el("div", "big-toggle-divider"));
      const half = el("div", "big-toggle-half picker-choice", choice.label);
      half.classList.toggle("active", choice.selected);
      half.classList.toggle("selected", choice.selected);
      half.addEventListener("click", choice.pick);
      toggle.appendChild(half);
    });
    row.appendChild(toggle);
    const caption = el("div", "picker-setting-caption", name === "group" ? "tab group" : name);
    if (choices.length > 1) {
      caption.append(" ");
      caption.appendChild(el("span", "picker-help-key", key));
    }
    row.appendChild(caption);
    return row;
  }

  private entryElement(entry: PickerEntry, index: number): HTMLElement {
    const option = el("div", "picker-option");
    option.classList.toggle("selected", index === this.selected);
    option.dataset["kind"] = entry.kind;

    // Three columns: what it is, what is known about it, and (right-aligned)
    // when it was last touched or what state it is in.
    let label = "";
    let detail = "";
    let aside = "";
    switch (entry.kind) {
      case "open":
        label = `[${entry.name}]`;
        detail = entry.path;
        aside = entry.isActive ? "this tab" : "";
        break;
      case "recent":
        label = `[${entry.name}]`;
        detail = entry.path;
        break;
      case "project": {
        const p = entry.project;
        label = `[${p.name}]`;
        const handoffs = p.handoffs === 0 ? "" : p.handoffs === 1 ? "1 handoff" : `${p.handoffs} handoffs`;
        detail = [handoffs, entry.open ? "open" : ""].filter(Boolean).join(" · ");
        aside = ago(p.modified, this.now());
        break;
      }
      case "session": {
        const s = entry.session;
        label = `[${folderName(s.projectPath)}]`;
        detail = sessionTask(s) || "unnamed session";
        aside = s.attention === "input" ? "needs you" : s.attention === "idle" ? "done" : s.attention === "working" ? "working" : "";
        if (s.attention) option.dataset["state"] = s.attention;
        break;
      }
      case "more":
        label = `[+ ${entry.count} more]`;
        break;
      case "dir":
        label = `[${entry.name}/]`;
        break;
      case "here":
        label = "[use this folder]";
        detail = entry.path;
        break;
      case "system":
        label = "[open system explorer…]";
        break;
      case "new":
        label = "[+ new session]";
        break;
      case "handoff":
        label = `[${entry.handoff.title}]`;
        detail = entry.handoff.name.replace(/\.md$/, "");
        aside = ago(entry.handoff.modified, this.now());
        break;
    }

    option.appendChild(el("span", "picker-option-label", label));
    option.appendChild(el("span", "picker-option-meta", detail));
    option.appendChild(el("span", "picker-option-aside", aside));
    option.addEventListener("click", () => {
      this.selected = index;
      // A click on a plain folder goes into it, as in any file browser;
      // "use this folder" then makes it the project. Everything else is chosen.
      if (entry.kind === "dir") void this.browse(entry.path);
      else this.confirm();
    });
    return option;
  }

  private renderHelp(): void {
    const keys: [string, string][] = this.filtering
      ? [
          ["↑/↓", "move"],
          ["tab", "into folder"],
          ["enter", "choose"],
          ["esc", "stop filtering"],
        ]
      : [
          ["j/k", "move"],
          ["l", "into folder"],
          ["h", this.screen.kind === "project" ? "back" : "up a folder"],
          ["/", "filter or type a path"],
          ...(this.canSwitchAgent() ? ([["a", "agent"]] as [string, string][]) : []),
          ...(this.options.groups.length > 0 ? ([["g", "tab group"]] as [string, string][]) : []),
          ["enter", this.screen.kind === "project" ? "open" : "choose"],
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
    const chord = e.ctrlKey || e.altKey || e.metaKey;
    if (this.filtering) {
      // Nothing typed here may reach the terminal or an app shortcut.
      e.stopPropagation();
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey ? e.key.toLowerCase() : null;
      if (e.key === "ArrowDown" || ctrl === "n" || ctrl === "j") this.act(e, () => this.move(1));
      else if (e.key === "ArrowUp" || ctrl === "p" || ctrl === "k") this.act(e, () => this.move(-1));
      else if (e.key === "Enter") this.act(e, () => this.confirm());
      else if (e.key === "Tab") this.act(e, () => this.goInto());
      else if (e.key === "Escape") this.act(e, () => this.stopFiltering());
      return;
    }
    // Chords are left for the app.
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
        return this.goInto();
      case "h":
      case "ArrowLeft":
      case "Backspace":
        return this.back();
      case "Enter":
      case " ":
        return this.confirm();
      case "/":
        return this.startFiltering();
      case "g":
        this.group = nextGroupChoice(this.group, this.options.groups);
        return this.render();
      case "a":
        return this.switchAgent();
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

  private switchAgent(): void {
    if (this.canSwitchAgent()) this.setAgent(nextAgent(this.agents, this.agent));
  }

  private setAgent(agent: string | null): void {
    this.agent = agent;
    try {
      if (agent) localStorage.setItem(AGENT_STORAGE_KEY, agent);
    } catch {
      // Not remembered for next time; the choice still applies to this tab.
    }
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

  /**
   * Go down into the selected folder and list what is in it. This is plain
   * folder navigation and never opens anything: choosing is Enter's job.
   */
  private goInto(): void {
    const entry = this.entries[this.selected];
    const path = entry ? entryPath(entry) : null;
    if (path === null) return;
    // While typing a path, the text follows into the folder so typing can go on.
    if (this.filtering) {
      this.filterInput.value = parseQuery(this.filterInput.value).browse !== null ? `${path}/` : "";
    }
    void this.browse(path);
  }

  /** Leave a project for the list it was chosen from, or go up a folder. */
  private back(): void {
    if (this.screen.kind === "project") {
      this.screen = { kind: "browse" };
      this.selected = this.browseSelection;
      this.render();
      return;
    }
    const parent = parentPath(this.browsePath);
    if (parent !== this.browsePath) void this.browse(parent);
  }

  private confirm(): void {
    const entry = this.entries[this.selected];
    if (!entry) return;
    switch (entry.kind) {
      case "session":
        return this.finish({ kind: "attach", session: entry.session });
      case "more":
        this.allSessions = true;
        return this.render();
      case "system":
        return this.finish({ kind: "system", group: this.group, agent: this.agent });
      case "project":
        return void this.openProject(entry.project.path);
      case "open":
      case "recent":
      case "dir":
      case "here":
        return void this.openProject(entry.path);
      case "new":
        return this.finishProject(entry.path, null);
      case "handoff":
        return this.finishProject(entry.path, entry.handoff.relPath);
    }
  }

  private finishProject(path: string, handoff: string | null): void {
    this.finish({ kind: "project", path, group: this.group, agent: this.agent, handoff });
  }

  private finish(result: PickerResult | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.request++;
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.root.remove();
    if (this.focusBefore?.isConnected) this.focusBefore.focus();
    resolve?.(result);
  }
}
