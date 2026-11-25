// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { LiveSessionInfo } from "../types";
import { ProjectPicker, type PickerResult, type ProjectPickerOptions } from "./project-picker";

const TREE: Record<string, string[]> = {
  "~/projects": ["cade", "nkrdn", "padarax"],
  "/home/me/projects": ["cade", "nkrdn", "padarax"],
  "/home/me/projects/cade": ["backend", "frontend"],
  "/home/me": ["projects", "notes"],
};

function mockBrowse(path: string) {
  const resolved = path === "~/projects" ? "/home/me/projects" : path;
  const names = TREE[path] ?? [];
  return Promise.resolve({
    path: resolved,
    children: names.map((name) => ({ name, path: `${resolved}/${name}`, type: "directory" })),
  });
}

const session = { id: "s1", projectPath: "/p/api", label: "release prep", agent: "claude", alive: true } as LiveSessionInfo;

let host: HTMLElement;
let result: Promise<PickerResult | null>;

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};
const labels = () => [...host.querySelectorAll(".picker-option-label")].map((n) => n.textContent);
const selected = () => host.querySelector(".picker-option.selected .picker-option-label")?.textContent;
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
    ...options,
  });
  result = picker.show();
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  (window as any).__MOCK_BROWSE__ = vi.fn(mockBrowse);
});

afterEach(() => {
  delete (window as any).__MOCK_BROWSE__;
});

describe("what it lists", () => {
  it("starts on the active tab's project, so Enter opens a second tab on it", async () => {
    await open({
      openTabs: [
        { path: "/p/a", name: "a", isActive: false },
        { path: "/p/b", name: "b", isActive: true },
      ],
    });
    expect(selected()).toBe("[b]");
    key("Enter");
    expect(await result).toEqual({ kind: "project", path: "/p/b", group: null });
  });

  it("lists open projects, sessions without a tab, recents, then folders", async () => {
    await open({
      openTabs: [{ path: "/p/b", name: "b", isActive: true }],
      recents: ["/p/old"],
      loadSessions: async () => [session],
      native: true,
    });
    expect(labels()).toEqual([
      "[b]", "[release prep]", "[old]", "[cade/]", "[nkrdn/]", "[padarax/]",
      "[use this folder]", "[system folder dialog…]",
    ]);
  });

  it("offers no system dialog outside the desktop app", async () => {
    await open();
    expect(labels()).not.toContain("[system folder dialog…]");
  });

  it("removes itself and resolves to nothing on Escape", async () => {
    await open();
    key("Escape");
    expect(await result).toBeNull();
    expect(host.querySelector(".project-picker")).toBeNull();
  });
});

describe("choosing", () => {
  it("attaches to a running session", async () => {
    await open({ loadSessions: async () => [session] });
    key("Enter");
    expect(await result).toEqual({ kind: "attach", session });
  });

  it("hands over to the system dialog", async () => {
    await open({ native: true });
    key("k");
    expect(selected()).toBe("[system folder dialog…]");
    key("Enter");
    expect(await result).toEqual({ kind: "system", group: null });
  });

  it("opens a folder as the project on Enter and goes into it on l", async () => {
    await open();
    key("l");
    await settle();
    expect(labels()).toEqual(["[backend/]", "[frontend/]", "[use this folder]"]);
    key("j");
    key("j");
    key("Enter");
    expect(await result).toEqual({ kind: "project", path: "/home/me/projects/cade", group: null });
  });

  it("goes up a folder on h", async () => {
    await open();
    key("h");
    await settle();
    expect(labels()).toEqual(["[projects/]", "[notes/]", "[use this folder]"]);
  });

  it("cycles the tab group the new tab goes in", async () => {
    await open({ groups: ["Work", "Home"] });
    expect(host.querySelector(".picker-group-value")!.textContent).toBe("by folder");
    key("g");
    expect(host.querySelector(".picker-group-value")!.textContent).toBe("Work");
    key("Enter");
    expect(await result).toMatchObject({ group: "Work" });
  });

  it("hides the tab group line when there are no groups", async () => {
    await open();
    expect(host.querySelector<HTMLElement>(".picker-group")!.hidden).toBe(true);
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
  it("narrows every section by what is typed and opens the match", async () => {
    await open({ openTabs: [{ path: "/p/b", name: "b", isActive: true }], recents: ["/p/old"] });
    key("/");
    await type("pada");
    expect(labels()).toEqual(["[padarax/]"]);
    key("Enter");
    expect(await result).toEqual({ kind: "project", path: "/home/me/projects/padarax", group: null });
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
    expect(labels()).toContain("[cade/]");
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
    await type("/home/me/pro");
    key("Tab");
    await settle();
    expect(host.querySelector<HTMLInputElement>(".picker-filter-input")!.value).toBe("/home/me/projects/");
    expect(labels()).toEqual(["[cade/]", "[nkrdn/]", "[padarax/]", "[use this folder]"]);
  });
});
