// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TabBar, STATUS_DISPLAY } from "./tab-bar";
import type { TabState } from "./types";

function tab(id: string, name: string): TabState {
  return { id, name, projectPath: `/projects/${id}` } as TabState;
}

const TABS = [tab("a", "alpha"), tab("b", "beta")];

let container: HTMLElement;
let bar: TabBar;

const tabEl = (id: string) =>
  container.querySelector<HTMLElement>(`.tab[data-tab-id="${id}"]`)!;
const nameEl = (id: string) => tabEl(id).querySelector<HTMLElement>(".tab-name")!;
const inputEl = () => container.querySelector<HTMLInputElement>(".tab-name-input");

/** Two quick clicks on a name, with the re-render the first one causes. */
async function doubleClickName(id: string): Promise<void> {
  nameEl(id).click();
  bar.render(TABS, id);
  nameEl(id).click();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  bar = new TabBar(container);
  bar.render(TABS, "a");
});

describe("pull request badge", () => {
  const PR = { number: 12, title: "Add a thing", url: "https://example.test/pr/12", draft: false, checks: "failing" as const, review: null, conflicts: false };
  const badge = (id: string) => tabEl(id).querySelector<HTMLElement>(".tab-pr");

  it("is absent on a tab whose branch has no pull request", () => {
    expect(badge("a")).toBeNull();
  });

  it("shows the number and the state, without replacing the tab element", () => {
    const before = tabEl("b");
    bar.setPullRequest("b", PR);
    expect(tabEl("b")).toBe(before);
    expect(badge("b")!.textContent).toBe("#12\u2717");
    expect(badge("b")!.dataset["state"]).toBe("failing");
    expect(badge("a")).toBeNull();
  });

  it("follows a change of state and goes when the pull request does", () => {
    bar.setPullRequest("b", PR);
    bar.setPullRequest("b", { ...PR, checks: "passing", review: "approved" });
    expect(tabEl("b").querySelectorAll(".tab-pr")).toHaveLength(1);
    expect(badge("b")!.dataset["state"]).toBe("approved");
    bar.setPullRequest("b", null);
    expect(badge("b")).toBeNull();
  });

  it("survives a re-render", () => {
    bar.setPullRequest("b", PR);
    bar.render(TABS, "b");
    expect(badge("b")!.textContent).toBe("#12\u2717");
  });

  it("asks for the pull request to be opened, without selecting the tab", () => {
    const opened = vi.fn();
    const selected = vi.fn();
    bar.on("pr-open", opened);
    bar.on("tab-select", selected);
    bar.setPullRequest("b", PR);
    badge("b")!.click();
    expect(opened).toHaveBeenCalledWith(PR.url);
    expect(selected).not.toHaveBeenCalled();
  });
});

describe("update marker", () => {
  const marker = () => container.querySelector<HTMLElement>(".tab-update-marker");

  it("is absent until a newer interface is waiting", () => {
    expect(marker()).toBeNull();
    bar.setUpdateReady(true);
    expect(marker()).not.toBeNull();
  });

  it("survives a re-render and keeps the active tab", () => {
    bar.setUpdateReady(true);
    expect(tabEl("a").classList.contains("active")).toBe(true);
    bar.render(TABS, "b");
    expect(marker()).not.toBeNull();
  });

  it("sits beside the window buttons in the desktop window, which would cover it anywhere else", () => {
    (window as any).__TAURI__ = true;
    try {
      bar.setUpdateReady(true);
      const controls = container.querySelector(".tab-bar-window-controls")!;
      expect(controls.querySelector(".tab-update-marker")).not.toBeNull();
      expect(controls.firstElementChild!.classList.contains("tab-update-marker")).toBe(true);
      expect(container.querySelector(".tab-area .tab-update-marker")).toBeNull();
    } finally {
      delete (window as any).__TAURI__;
    }
  });

  it("sits at the end of the tab area in a browser", () => {
    bar.setUpdateReady(true);
    expect(container.querySelector(".tab-area .tab-update-marker")).not.toBeNull();
  });

  it("asks for the reload only when clicked", () => {
    const reload = vi.fn();
    bar.on("update-reload", reload);
    bar.setUpdateReady(true);
    expect(reload).not.toHaveBeenCalled();
    marker()!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("agent status", () => {
  it("shows no activity until a state is reported", () => {
    expect(tabEl("a").dataset["status"]).toBe("none");
  });

  it.each(["working", "input", "idle"] as const)("marks a tab %s", (state) => {
    bar.setAttention("b", state);
    expect(tabEl("b").dataset["status"]).toBe(state);
    expect(tabEl("b").querySelector(".tab-status")!.textContent).toBe(STATUS_DISPLAY[state].glyph);
    expect(tabEl("a").dataset["status"]).toBe("none");
  });

  it("gives every state its own glyph, so colour is not the only cue", () => {
    const glyphs = Object.values(STATUS_DISPLAY).map((d) => d.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("puts the agent's message in the tooltip", () => {
    bar.setAttention("b", "input", "Allow Bash?");
    expect(tabEl("b").querySelector<HTMLElement>(".tab-status")!.title).toContain("Allow Bash?");
  });

  it("updates in place, without replacing the tab element", () => {
    const before = tabEl("b");
    bar.setAttention("b", "working");
    expect(tabEl("b")).toBe(before);
  });

  it("keeps the state across a re-render and clears it", () => {
    bar.setAttention("b", "input");
    bar.render(TABS, "b");
    expect(tabEl("b").dataset["status"]).toBe("input");
    bar.setAttention("b", null);
    expect(tabEl("b").dataset["status"]).toBe("none");
  });
});

describe("rename", () => {
  it("opens a text field on a double-click of the name", async () => {
    await doubleClickName("b");
    expect(inputEl()?.value).toBe("beta");
  });

  it("does not open on a single click or two slow clicks", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    nameEl("b").click();
    now.mockReturnValue(5_000);
    nameEl("b").click();
    await Promise.resolve();
    expect(inputEl()).toBeNull();
    now.mockRestore();
  });

  it("emits the new name on Enter", async () => {
    const renamed = vi.fn();
    bar.on("tab-rename", renamed);
    await doubleClickName("b");
    inputEl()!.value = "api server";
    inputEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(renamed).toHaveBeenCalledWith({ tabId: "b", name: "api server" });
    expect(inputEl()).toBeNull();
  });

  it("emits the new name when the field loses focus", async () => {
    const renamed = vi.fn();
    bar.on("tab-rename", renamed);
    await doubleClickName("b");
    inputEl()!.value = "docs";
    inputEl()!.dispatchEvent(new Event("blur"));
    expect(renamed).toHaveBeenCalledWith({ tabId: "b", name: "docs" });
  });

  it("keeps the old name on Escape", async () => {
    const renamed = vi.fn();
    bar.on("tab-rename", renamed);
    await doubleClickName("b");
    inputEl()!.value = "discarded";
    inputEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(renamed).not.toHaveBeenCalled();
    expect(nameEl("b").textContent).toBe("beta");
  });

  it("does not select or drag the tab while typing in the field", async () => {
    const selected = vi.fn();
    await doubleClickName("b");
    bar.on("tab-select", selected);
    inputEl()!.click();
    expect(selected).not.toHaveBeenCalled();
  });

  it("holds back re-renders until the rename ends, then applies them", async () => {
    await doubleClickName("b");
    bar.render([...TABS, tab("c", "gamma")], "b");
    expect(inputEl()).not.toBeNull();
    expect(container.querySelector('.tab[data-tab-id="c"]')).toBeNull();
    inputEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.querySelector('.tab[data-tab-id="c"]')).not.toBeNull();
  });

  it("a status change mid-rename leaves the field alone", async () => {
    await doubleClickName("b");
    bar.setAttention("b", "input");
    expect(inputEl()).not.toBeNull();
    expect(tabEl("b").dataset["status"]).toBe("input");
  });
});
