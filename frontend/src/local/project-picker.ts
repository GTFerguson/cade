/**
 * Keyboard-driven picker for what a new tab opens on. The same screen on
 * desktop, in the browser and on the phone.
 *
 * It opens on the projects under the main working folder, most recently
 * worked on first. Going into a project offers a new session and then the
 * project's handoffs, newest first; choosing a handoff opens a tab whose agent
 * starts by reading it. `a` switches the agent the tab will run. Folders
 * outside the projects folder are reached by going up or typing a path; the
 * system folder dialog is the last resort.
 *
 * In dev/demo mode, set window.__MOCK_BROWSE__ to stub the folder listing.
 */

import { basePath } from "../config/config";
import type { FileNode, LiveSessionInfo } from "../types";
import {
  ago,
  browseSections,
  filterSections,
  folderName,
  initialAgent,
  nextAgent,
  nextGroupChoice,
  parentPath,
  parseQuery,
  projectSections,
  type AgentInfo,
  type BrowseDir,
  type HandoffInfo,
  type PickerEntry,
  type PickerSection,
  type ProjectInfo,
} from "./picker-model";

/** Listed when the backend cannot say where the projects are. */
const FALLBACK_BROWSE_PATH = "~/projects";
const AGENT_STORAGE_KEY = "cade-picker-agent";

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
  projects: () => getJson<ProjectsListing>(`${basePath}/api/projects`),

  async handoffs(path) {
    const body = await getJson<{ handoffs?: HandoffInfo[] }>(
      `${basePath}/api/projects/handoffs?path=${encodeURIComponent(path)}`,
    );
    return body?.handoffs ?? [];
  },

  async browse(path) {
    const mock = (window as any).__MOCK_BROWSE__;
    const body: { path: string; children: FileNode[] } | null = mock
      ? await mock(path)
      : await getJson(`${basePath}/api/browse?path=${encodeURIComponent(path)}`);
    return {
      path: body?.path ?? path,
      dirs: (body?.children ?? [])
        .filter((child) => child.type === "directory")
        .map((child) => ({ name: child.name, path: child.path })),
    };
  },
};

export interface ProjectPickerOptions {
  /** Paths that already have a tab here; their projects are marked open. */
  openPaths: string[];
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
  private openPaths: ReadonlySet<string>;

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
  private group: string | null = null;
  private agent: string | null = null;

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(container: HTMLElement, private options: ProjectPickerOptions) {
    this.api = options.api ?? backendPickerApi;
    this.now = options.now ?? (() => Date.now() / 1000);
    this.openPaths = new Set(options.openPaths);

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

    this.listEl = el("div", "picker-list");
    body.appendChild(this.listEl);

    this.settingsEl = el("div", "picker-settings");
    body.appendChild(this.settingsEl);

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
    this.render();
  }

  /**
   * A folder was chosen as the project. With handoffs to pick from (or when
   * asked to), show the project; with none, a new session is the only thing
   * it could mean, so open it.
   */
  private async openProject(path: string, alwaysShow: boolean): Promise<void> {
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
    if (handoffs.length === 0 && !alwaysShow) {
      this.finishProject(path, null);
      return;
    }
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
            sessions: this.sessions,
            projects: this.browsePath === this.projectsRoot ? this.projects : null,
            dirs: this.dirs,
            browsePath: this.browsePath,
            openPaths: this.openPaths,
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
    this.selected = Math.max(0, Math.min(this.selected, this.entries.length - 1));

    this.headerEl.textContent =
      this.screen.kind === "project" ? `[ ${folderName(this.screen.path).toUpperCase()} ]` : "[ OPEN PROJECT ]";

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
    this.listEl.querySelector<HTMLElement>(".picker-option.selected")?.scrollIntoView?.({ block: "nearest" });

    this.renderSettings();
    this.renderHelp();
  }

  private canSwitchAgent(): boolean {
    return this.agents.filter((a) => a.available).length > 1;
  }

  private renderSettings(): void {
    const rows: HTMLElement[] = [];
    const agent = this.agents.find((a) => a.id === this.agent);
    if (agent) {
      const row = el("div", "picker-setting");
      row.dataset["setting"] = "agent";
      row.append(el("span", "picker-setting-label", "agent "), el("span", "picker-setting-value", agent.name));
      rows.push(row);
    }
    if (this.options.groups.length > 0) {
      const row = el("div", "picker-setting");
      row.dataset["setting"] = "group";
      row.append(
        el("span", "picker-setting-label", "tab group "),
        el("span", "picker-setting-value", this.group ?? "by folder"),
      );
      rows.push(row);
    }
    this.settingsEl.replaceChildren(...rows);
    this.settingsEl.hidden = rows.length === 0;
  }

  private entryElement(entry: PickerEntry, index: number): HTMLElement {
    const option = el("div", "picker-option");
    option.classList.toggle("selected", index === this.selected);
    option.dataset["kind"] = entry.kind;

    let label: string;
    let meta = "";
    switch (entry.kind) {
      case "project": {
        const p = entry.project;
        label = `[${p.name}]`;
        const handoffs = p.handoffs === 0 ? "" : p.handoffs === 1 ? "1 handoff" : `${p.handoffs} handoffs`;
        meta = [ago(p.modified, this.now()), handoffs, entry.open ? "open" : ""].filter(Boolean).join(" · ");
        break;
      }
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
      case "new":
        label = "[new session]";
        break;
      case "handoff":
        label = `[${entry.handoff.title}]`;
        meta = [entry.handoff.name.replace(/\.md$/, ""), ago(entry.handoff.modified, this.now())]
          .filter(Boolean)
          .join(" · ");
        break;
      case "folders":
        label = "[browse folders/]";
        break;
    }

    option.appendChild(el("span", "picker-option-label", label));
    if (meta) option.appendChild(el("span", "picker-option-meta", meta));
    option.addEventListener("click", () => {
      this.selected = index;
      // A click on a plain folder goes into it; "use this folder" then makes
      // it the project. Everything else is chosen outright.
      if (entry.kind === "dir") void this.browse(entry.path);
      else this.confirm();
    });
    return option;
  }

  private renderHelp(): void {
    const keys: [string, string][] = this.filtering
      ? [
          ["↑/↓", "move"],
          ["tab", "go into"],
          ["enter", "open"],
          ["esc", "stop filtering"],
        ]
      : [
          ["j/k", "move"],
          ["l", "go into"],
          ["h", this.screen.kind === "project" ? "back" : "up"],
          ["/", "filter or type a path"],
          ...(this.canSwitchAgent() ? ([["a", "agent"]] as [string, string][]) : []),
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
    if (!this.canSwitchAgent()) return;
    this.agent = nextAgent(this.agents, this.agent);
    try {
      if (this.agent) localStorage.setItem(AGENT_STORAGE_KEY, this.agent);
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
   * Go into the selected entry: a project shows its sessions and handoffs, a
   * folder its subfolders. Anything else has no inside, so it is chosen.
   */
  private goInto(): void {
    const entry = this.entries[this.selected];
    if (!entry) return;
    if (entry.kind === "project") void this.openProject(entry.project.path, true);
    else if (entry.kind === "dir") {
      // While typing a path, the text follows into the folder so typing can go on.
      if (this.filtering) {
        this.filterInput.value = parseQuery(this.filterInput.value).browse !== null ? `${entry.path}/` : "";
      }
      void this.browse(entry.path);
    } else this.confirm();
  }

  private back(): void {
    if (this.screen.kind === "project") {
      void this.browse(parentPath(this.screen.path));
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
      case "system":
        return this.finish({ kind: "system", group: this.group, agent: this.agent });
      case "project":
        return void this.openProject(entry.project.path, false);
      case "dir":
      case "here":
        return void this.openProject(entry.path, false);
      case "new":
        return this.finishProject(entry.path, null);
      case "handoff":
        return this.finishProject(entry.path, entry.handoff.relPath);
      case "folders":
        return void this.browse(entry.path);
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
