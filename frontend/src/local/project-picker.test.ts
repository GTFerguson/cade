// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LiveSessionInfo } from "../types";
import {
  ProjectPicker,
  type PickerApi,
  type PickerResult,
  type ProjectPickerOptions,
} from "./project-picker";

const ROOT = "/home/me/projects";
const NOW = 1_000_000;

const TREE: Record<string, string[]> = {
  [ROOT]: ["cade", "nkrdn", "padarax"],
  [`${ROOT}/cade`]: ["backend", "frontend"],
  "/home/me": ["projects", "notes"],
  "/srv": ["site"],
};

const HANDOFFS: Record<string, { name: string; relPath: string; title: string; modified: number }[]> = {
  [`${ROOT}/cade`]: [
    { name: "roadmap.md", relPath: "docs/plans/handoff/roadmap.md", title: "Organisation roadmap", modified: NOW - 3600 },
    { name: "remote.md", relPath: "docs/plans/handoff/remote.md", title: "Remote access", modified: NOW - 86400 },
  ],
};

function makeApi(over: Partial<PickerApi> = {}): PickerApi {
  return {
    projects: vi.fn(async () => ({
      root: ROOT,
      projects: [
        { name: "cade", path: `${ROOT}/cade`, modified: NOW - 7200, handoffs: 2 },
        { name: "padarax", path: `${ROOT}/padarax`, modified: NOW - 86400 * 3, handoffs: 0 },
      ],
      agents: [
        { id: "claude-code", name: "Claude Code", available: true, default: true },
        { id: "codex", name: "Codex", available: true, default: false },
      ],
    })),
    handoffs: vi.fn(async (path: string) => HANDOFFS[path] ?? []),
    browse: vi.fn(async (path: string) => {
      const resolved = path === "~/projects" ? ROOT : path;
      return {
        path: resolved,
        dirs: (TREE[resolved] ?? []).map((name) => ({ name, path: `${resolved}/${name}` })),
      };
    }),
    ...over,
  };
}

const session = { id: "s1", projectPath: "/p/api", label: "release prep", agent: "claude", alive: true } as LiveSessionInfo;

let host: HTMLElement;
let result: Promise<PickerResult | null>;

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};
const labels = () => [...host.querySelectorAll(".picker-option-label")].map((n) => n.textContent);
const metas = () => [...host.querySelectorAll(".picker-option")].map((n) => n.querySelector(".picker-option-meta")?.textContent ?? "");
const selected = () => host.querySelector(".picker-option.selected .picker-option-label")?.textContent;
const setting = (name: string) =>
  host.querySelector(`.picker-setting[data-setting="${name}"] .picker-choice.selected`)?.textContent ?? null;
const choices = (name: string) =>
  [...host.querySelectorAll(`.picker-setting[data-setting="${name}"] .picker-choice`)].map((n) => n.textContent);
const type = async (text: string) => {
  const input = host.querySelector<HTMLInputElement>(".picker-filter-input")!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await settle();
};

async function open(options: Partial<ProjectPickerOptions> = {}): Promise<void> {
  const picker = new ProjectPicker(host, {
    openTabs: [],
    recents: [],
    groups: [],
    native: false,
    api: makeApi(),
    now: () => NOW,
    ...options,
  });
  result = picker.show();
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("the first screen", () => {
  it("starts on the active tab's project, for a quick second tab on it", async () => {
    await open({
      openTabs: [
        { path: `${ROOT}/padarax`, isActive: false },
        { path: `${ROOT}/cade`, isActive: true },
      ],
      recents: ["/p/old"],
    });
    expect(labels()).toEqual(["[cade]", "[padarax]", "[old]", "[cade]", "[padarax]"]);
    expect(selected()).toBe("[cade]");
    expect(metas()[0]).toBe(`${ROOT}/cade · this tab`);
  });

  it("lists every project in the backend's order with when each was last worked on", async () => {
    await open({ openTabs: [{ path: `${ROOT}/padarax`, isActive: true }] });
    expect(labels().slice(1)).toEqual(["[cade]", "[padarax]"]);
    expect(metas().slice(1)).toEqual(["2h ago · 2 handoffs", "3d ago · open"]);
  });

  it("puts sessions to attach to above the projects and the system explorer last", async () => {
    await open({ loadSessions: async () => [session], native: true });
    expect(labels()).toEqual(["[release prep]", "[cade]", "[padarax]", "[open system explorer…]"]);
  });

  it("attaches to a running session", async () => {
    await open({ loadSessions: async () => [session] });
    key("Enter");
    expect(await result).toEqual({ kind: "attach", session });
  });

  it("removes itself and resolves to nothing on Escape", async () => {
    await open();
    key("Escape");
    expect(await result).toBeNull();
    expect(host.querySelector(".project-picker")).toBeNull();
  });

  it("falls back to a plain folder listing when the backend has no projects listing", async () => {
    await open({ api: makeApi({ projects: async () => null }) });
    expect(labels()).toEqual(["[cade/]", "[nkrdn/]", "[padarax/]", "[use this folder]"]);
    expect(setting("agent")).toBeNull();
  });
});

describe("walking folders", () => {
  it("goes down into a project's folders on l, without opening anything", async () => {
    await open();
    key("l");
    await settle();
    expect(labels()).toEqual(["[backend/]", "[frontend/]", "[use this folder]"]);
    expect(host.querySelector(".project-picker")).not.toBeNull();
  });

  it("goes down from an open or recent project too", async () => {
    await open({ openTabs: [{ path: `${ROOT}/cade`, isActive: true }] });
    key("l");
    await settle();
    expect(labels()).toEqual(["[cade]", "[backend/]", "[frontend/]", "[use this folder]"]);
  });

  it("starts in the folder's own listing after walking to it, below the quick choices", async () => {
    await open({ openTabs: [{ path: `${ROOT}/cade`, isActive: true }] });
    key("l");
    await settle();
    expect(selected()).toBe("[backend/]");
  });

  it("keeps going down, and comes back up with h", async () => {
    await open();
    key("l");
    await settle();
    key("l");
    await settle();
    expect(host.querySelector(".picker-section")!.textContent).toBe(`${ROOT}/cade/backend`);
    key("h");
    await settle();
    expect(labels()).toEqual(["[backend/]", "[frontend/]", "[use this folder]"]);
  });

  it("goes up out of the projects folder and lists plain folders", async () => {
    await open();
    key("h");
    await settle();
    expect(labels()).toEqual(["[projects/]", "[notes/]", "[use this folder]"]);
  });

  it("shows the ordered projects again when the projects folder is entered", async () => {
    await open();
    key("h");
    await settle();
    key("l");
    await settle();
    expect(labels()).toEqual(["[cade]", "[padarax]"]);
  });

  it("does nothing on l for an entry that is not a folder", async () => {
    await open({ native: true });
    key("k");
    key("l");
    await settle();
    expect(selected()).toBe("[open system explorer…]");
  });
});

describe("inside a project", () => {
  it("offers a new session first, then the handoffs with their age", async () => {
    await open();
    key("Enter");
    await settle();
    expect(labels()).toEqual(["[new session]", "[Organisation roadmap]", "[Remote access]"]);
    expect(metas()).toEqual(["", "roadmap · 1h ago", "remote · 1d ago"]);
    expect(selected()).toBe("[new session]");
  });

  it("shows a project without handoffs the same way, so Enter never opens a tab by surprise", async () => {
    await open();
    key("j");
    key("Enter");
    await settle();
    expect(labels()).toEqual(["[new session]"]);
    expect(host.querySelector(".project-picker")).not.toBeNull();
  });

  it("opens a new session on a second Enter", async () => {
    await open();
    key("Enter");
    await settle();
    key("Enter");
    expect(await result).toEqual({
      kind: "project", path: `${ROOT}/cade`, group: null, agent: "claude-code", handoff: null,
    });
  });

  it("opens on the chosen handoff", async () => {
    await open();
    key("Enter");
    await settle();
    key("j");
    key("Enter");
    expect(await result).toEqual({
      kind: "project", path: `${ROOT}/cade`, group: null, agent: "claude-code",
      handoff: "docs/plans/handoff/roadmap.md",
    });
  });

  it("goes back to the list where it was left on h", async () => {
    await open();
    key("j");
    key("Enter");
    await settle();
    key("h");
    expect(labels()).toEqual(["[cade]", "[padarax]"]);
    expect(selected()).toBe("[padarax]");
  });

  it("goes down into the project's folders on l", async () => {
    await open();
    key("Enter");
    await settle();
    key("l");
    await settle();
    expect(labels()).toEqual(["[backend/]", "[frontend/]", "[use this folder]"]);
  });

  it("filters the handoffs", async () => {
    await open();
    key("Enter");
    await settle();
    key("/");
    await type("remote");
    expect(labels()).toEqual(["[Remote access]"]);
  });
});

describe("agent and tab group", () => {
  it("starts on the backend's default agent and switches with a", async () => {
    await open();
    expect(setting("agent")).toBe("Claude Code");
    expect(choices("agent")).toEqual(["Claude Code", "Codex"]);
    key("a");
    expect(setting("agent")).toBe("Codex");
    key("Enter");
    await settle();
    key("Enter");
    expect(await result).toMatchObject({ agent: "codex" });
  });

  it("switches agent on a click of its name", async () => {
    await open();
    host.querySelectorAll<HTMLElement>('.picker-setting[data-setting="agent"] .picker-choice')[1]!.click();
    expect(setting("agent")).toBe("Codex");
  });

  it("offers only the agents that are installed", async () => {
    const api = makeApi({
      projects: async () => ({
        root: ROOT,
        projects: [],
        agents: [
          { id: "claude-code", name: "Claude Code", available: true, default: true },
          { id: "codex", name: "Codex", available: false, default: false },
        ],
      }),
    });
    await open({ api });
    expect(choices("agent")).toEqual(["Claude Code"]);
  });

  it("remembers the agent for the next time the picker opens", async () => {
    await open();
    key("a");
    key("Escape");
    await result;
    await open();
    expect(setting("agent")).toBe("Codex");
  });

  it("switches agent inside a project too, and carries it with a handoff", async () => {
    await open();
    key("Enter");
    await settle();
    key("a");
    key("j");
    key("Enter");
    expect(await result).toMatchObject({ agent: "codex", handoff: "docs/plans/handoff/roadmap.md" });
  });

  it("cycles the tab group the new tab goes in", async () => {
    await open({ groups: ["Work", "Home"] });
    expect(setting("group")).toBe("by folder");
    expect(choices("group")).toEqual(["by folder", "Work", "Home"]);
    key("g");
    expect(setting("group")).toBe("Work");
    key("Enter");
    await settle();
    key("Enter");
    expect(await result).toMatchObject({ group: "Work" });
  });

  it("shows no tab group when there are no groups", async () => {
    await open();
    expect(setting("group")).toBeNull();
  });
});

describe("outside the projects folder", () => {
  it("chooses any folder as a project", async () => {
    await open();
    key("/");
    await type("/srv/");
    key("Enter");
    await settle();
    expect(labels()).toEqual(["[new session]"]);
    key("Enter");
    expect(await result).toMatchObject({ kind: "project", path: "/srv/site", handoff: null });
  });

  it("hands over to the system explorer with the chosen agent", async () => {
    await open({ native: true });
    key("k");
    expect(selected()).toBe("[open system explorer…]");
    key("Enter");
    expect(await result).toEqual({ kind: "system", group: null, agent: "claude-code" });
  });
});

describe("keys", () => {
  it("keeps plain keys from the terminal behind it, handled or not", async () => {
    await open();
    expect(key("x").defaultPrevented).toBe(true);
  });

  it("leaves chords for the app", async () => {
    await open();
    expect(key("t", { ctrlKey: true }).defaultPrevented).toBe(false);
  });
});

describe("filtering", () => {
  it("narrows the projects by what is typed and opens the match", async () => {
    await open();
    key("/");
    await type("pada");
    expect(labels()).toEqual(["[padarax]"]);
    key("Enter");
    await settle();
    key("Enter");
    expect(await result).toMatchObject({ path: `${ROOT}/padarax` });
  });

  it("says so when nothing matches", async () => {
    await open();
    key("/");
    await type("zzzz");
    expect(host.querySelector(".picker-empty")!.textContent).toBe("nothing matches");
  });

  it("moves with the arrow keys while typing", async () => {
    await open();
    key("/");
    await type("a");
    const first = selected();
    key("ArrowDown");
    expect(selected()).not.toBe(first);
  });

  it("leaves filtering on Escape without closing the picker", async () => {
    await open();
    key("/");
    await type("pada");
    key("Escape");
    expect(host.querySelector(".project-picker")).not.toBeNull();
    expect(labels()).toEqual(["[cade]", "[padarax]"]);
    expect(host.querySelector<HTMLElement>(".picker-filter")!.hidden).toBe(true);
  });

  it("browses to a typed path and filters that folder", async () => {
    await open();
    key("/");
    await type("/home/me/no");
    expect(labels()).toEqual(["[notes/]"]);
    await type("/home/me/");
    expect(labels()).toEqual(["[projects/]", "[notes/]", "[use this folder]"]);
  });

  it("follows Tab into a folder so the path can go on being typed", async () => {
    await open();
    key("/");
    await type("/srv/si");
    key("Tab");
    await settle();
    expect(host.querySelector<HTMLInputElement>(".picker-filter-input")!.value).toBe("/srv/site/");
  });
});
