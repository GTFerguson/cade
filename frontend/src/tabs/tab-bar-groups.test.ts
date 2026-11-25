// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ACCORDION_MS, TabBar, STATUS_DISPLAY, type TabBarGroups } from "./tab-bar";
import type { TabState } from "./types";

function tab(id: string, group?: string): TabState {
  return { id, name: id, projectPath: `/projects/${group ?? "misc"}/${id}`, ...(group && { group }) } as TabState;
}

const TABS = [tab("a"), tab("w1", "Work"), tab("w2", "Work"), tab("h1", "Home"), tab("b")];
const DEFS = [{ name: "Work", colour: "purple", paths: [] }];

let container: HTMLElement;
let bar: TabBar;

const groups = (collapsed: string[] = []): TabBarGroups => ({ collapsed: new Set(collapsed), defs: DEFS });
const groupEl = (name: string) => container.querySelector<HTMLElement>(`.tab-group[data-group="${name}"]`)!;
const chip = (name: string) => groupEl(name).querySelector<HTMLElement>(".tab-group-chip")!;
const chipStatus = (name: string) => chip(name).querySelector<HTMLElement>(".tab-group-status")!;
const shownTabs = () =>
  [...container.querySelectorAll<HTMLElement>(".tab[data-tab-id]")].map((el) => el.dataset["tabId"]).join(" ");
const menuLabels = () =>
  [...document.querySelectorAll<HTMLElement>(".tab-menu-item, .tab-menu-heading")].map((el) => el.textContent);
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>(".tab-menu-item")].find((el) => el.textContent === label)!;
const rightClick = (el: HTMLElement) =>
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  bar = new TabBar(container);
  bar.render(TABS, "a", groups());
});

describe("layout", () => {
  it("heads each group with a chip and keeps ungrouped tabs outside", () => {
    expect([...container.querySelectorAll(".tab-group")].map((el) => (el as HTMLElement).dataset["group"])).toEqual([
      "Work",
      "Home",
    ]);
    expect(groupEl("Work").querySelectorAll(".tab").length).toBe(2);
    expect(shownTabs()).toBe("a w1 w2 h1 b");
  });

  it("colours a group from its definition, and one without a definition by default", () => {
    expect(groupEl("Work").style.getPropertyValue("--group-colour")).toBe("var(--accent-purple)");
    expect(groupEl("Home").style.getPropertyValue("--group-colour")).toBe("var(--text-muted)");
  });

  it("shows a collapsed group as its chip alone, with the number of tabs", () => {
    bar.render(TABS, "a", groups(["Work"]));
    expect(shownTabs()).toBe("a h1 b");
    expect(chip("Work").querySelector(".tab-group-count")!.textContent).toBe("2");
    expect(chip("Work").getAttribute("aria-expanded")).toBe("false");
  });

  it("asks to collapse or expand on a click of the chip", () => {
    const toggled = vi.fn();
    bar.on("group-toggle", toggled);
    chip("Home").click();
    expect(toggled).toHaveBeenCalledWith("Home");
  });
});

describe("ungrouped tabs while a workspace is open", () => {
  const looseChip = () => container.querySelector<HTMLElement>(".tab-group-chip--ungrouped");

  it("are tabs on the bar while they are the open workspace", () => {
    bar.render(TABS, "a", groups(["Work", "Home"]));
    expect(shownTabs()).toBe("a b");
    expect(looseChip()).toBeNull();
  });

  it("fold into one chip with their count, wherever they sit on the bar", () => {
    bar.render(TABS, "w1", groups(["", "Home"]));
    expect(shownTabs()).toBe("w1 w2");
    expect(container.querySelectorAll(".tab-group-chip--ungrouped")).toHaveLength(1);
    expect(looseChip()!.querySelector(".tab-group-count")!.textContent).toBe("2");
  });

  it("show on the chip that one of them is waiting", () => {
    bar.setAttention("b", "input");
    bar.render(TABS, "w1", groups(["", "Home"]));
    expect(looseChip()!.dataset["status"]).toBe("input");
  });

  it("update the chip when one starts waiting while they are hidden", () => {
    bar.render(TABS, "w1", groups(["", "Home"]));
    expect(looseChip()!.dataset["status"]).toBe("none");
    bar.setAttention("b", "input");
    expect(looseChip()!.dataset["status"]).toBe("input");
  });

  it("are opened by clicking the chip", () => {
    const toggled = vi.fn();
    bar.on("group-toggle", toggled);
    bar.render(TABS, "w1", groups(["", "Home"]));
    looseChip()!.click();
    expect(toggled).toHaveBeenCalledWith("");
  });
});

describe("a workspace sliding open or shut", () => {
  const slides = (direction: string) => container.querySelectorAll(`.tab-slide--${direction}`);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not slide on a render that opens or closes nothing", () => {
    bar.render(TABS, "b", groups());
    expect(container.querySelectorAll(".tab-slide")).toHaveLength(0);
  });

  it("does not slide when the bar is first filled", () => {
    const fresh = new TabBar(container);
    fresh.initialize();
    fresh.render(TABS, "w1", groups(["", "Home"]));
    expect(container.querySelectorAll(".tab-slide")).toHaveLength(0);
  });

  it("slides the closing workspace's tabs away as a picture, then drops them", () => {
    bar.render(TABS, "a", groups(["Work"]));
    expect(slides("closing")).toHaveLength(1);
    expect(shownTabs()).toBe("a h1 b");
    expect(slides("closing")[0]!.querySelectorAll(".tab")).toHaveLength(2);
    vi.advanceTimersByTime(ACCORDION_MS);
    expect(slides("closing")).toHaveLength(0);
  });

  it("keeps sliding through a redraw that lands part-way", () => {
    bar.render(TABS, "a", groups(["Work"]));
    vi.advanceTimersByTime(ACCORDION_MS / 3);
    bar.render(TABS, "a", groups(["Work"]));
    expect(slides("closing")).toHaveLength(1);
    expect((slides("closing")[0] as HTMLElement).style.animationDelay).toBe(`-${ACCORDION_MS / 3}ms`);
    vi.advanceTimersByTime((ACCORDION_MS * 2) / 3);
    expect(slides("closing")).toHaveLength(0);
    bar.render(TABS, "a", groups(["Work"]));
    expect(slides("closing")).toHaveLength(0);
  });

  it("slides the opening workspace's tabs in, and leaves them as ordinary tabs", () => {
    bar.render(TABS, "a", groups(["Work"]));
    vi.advanceTimersByTime(ACCORDION_MS);
    bar.render(TABS, "w1", groups());
    expect(slides("opening")).toHaveLength(1);
    expect(shownTabs()).toBe("a w1 w2 h1 b");
    vi.advanceTimersByTime(ACCORDION_MS);
    expect(container.querySelectorAll(".tab-slide")).toHaveLength(0);
    expect(groupEl("Work").querySelector(":scope > .tab-run")).not.toBeNull();
  });
});

describe("what a collapsed group needs", () => {
  beforeEach(() => bar.render(TABS, "a", groups(["Work"])));

  it("is quiet until a tab inside reports something", () => {
    expect(chip("Work").dataset["status"]).toBe("none");
    expect(chipStatus("Work").textContent).toBe(STATUS_DISPLAY.none.glyph);
  });

  it("shows a waiting tab, and the number when more than one waits", () => {
    bar.setAttention("w1", "input");
    expect(chip("Work").dataset["status"]).toBe("input");
    expect(chipStatus("Work").textContent).toBe(STATUS_DISPLAY.input.glyph);
    bar.setAttention("w2", "input");
    expect(chipStatus("Work").textContent).toBe("2");
    expect(chipStatus("Work").classList.contains("tab-group-status--count")).toBe(true);
    bar.setAttention("w2", "working");
    expect(chipStatus("Work").textContent).toBe(STATUS_DISPLAY.input.glyph);
    expect(chipStatus("Work").classList.contains("tab-group-status--count")).toBe(false);
  });

  it("lets waiting outrank working, and working outrank finished", () => {
    bar.setAttention("w1", "idle");
    expect(chip("Work").dataset["status"]).toBe("idle");
    bar.setAttention("w2", "working");
    expect(chip("Work").dataset["status"]).toBe("working");
    bar.setAttention("w1", "input");
    expect(chip("Work").dataset["status"]).toBe("input");
  });

  it("keeps the state of hidden tabs across a re-render", () => {
    bar.setAttention("w1", "input");
    bar.render(TABS, "a", groups(["Work"]));
    expect(chip("Work").dataset["status"]).toBe("input");
    bar.render(TABS, "a", groups());
    expect(container.querySelector<HTMLElement>('.tab[data-tab-id="w1"]')!.dataset["status"]).toBe("input");
  });

  it("an expanded group's chip shows no status of its own", () => {
    bar.render(TABS, "a", groups());
    bar.setAttention("w1", "input");
    expect(chip("Work").dataset["status"]).toBe("none");
  });
});

describe("tab menu", () => {
  const tabEl = (id: string) => container.querySelector<HTMLElement>(`.tab[data-tab-id="${id}"]`)!;

  it("offers the other groups, a new group, and removal for a grouped tab", () => {
    rightClick(tabEl("w1"));
    expect(menuLabels()).toEqual([
      "Move to group", "Home", "New group", "Remove from group", "Rename tab", "Close tab",
    ]);
  });

  it("does not offer removal to an ungrouped tab", () => {
    rightClick(tabEl("a"));
    expect(menuLabels()).not.toContain("Remove from group");
    expect(menuLabels()).toContain("Work");
  });

  it("moves the tab to the chosen group and closes the menu", () => {
    const moved = vi.fn();
    bar.on("tab-set-group", moved);
    rightClick(tabEl("a"));
    menuItem("Work").click();
    expect(moved).toHaveBeenCalledWith({ tabId: "a", group: "Work" });
    expect(document.querySelector(".tab-menu")).toBeNull();
  });

  it("removes the tab from its group", () => {
    const moved = vi.fn();
    bar.on("tab-set-group", moved);
    rightClick(tabEl("w1"));
    menuItem("Remove from group").click();
    expect(moved).toHaveBeenCalledWith({ tabId: "w1", group: null });
  });

  it("starts a new group from the tab", () => {
    const created = vi.fn();
    bar.on("tab-new-group", created);
    rightClick(tabEl("b"));
    menuItem("New group").click();
    expect(created).toHaveBeenCalledWith("b");
  });

  it("closes on Escape without acting", () => {
    rightClick(tabEl("a"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".tab-menu")).toBeNull();
  });
});

describe("group menu", () => {
  it("offers each project's parent folder for auto-adding, ticked when in effect", () => {
    const defs = [{ name: "Work", colour: "purple", paths: ["/projects/Work"] }];
    bar.render(TABS, "a", { collapsed: new Set(), defs });
    rightClick(chip("Work"));
    expect(menuItem("/projects/Work").dataset["checked"]).toBe("true");
    const changed = vi.fn();
    bar.on("group-auto-add", changed);
    menuItem("/projects/Work").click();
    expect(changed).toHaveBeenCalledWith({ group: "Work", folder: "/projects/Work", enabled: false });
  });

  it("picks a colour", () => {
    const coloured = vi.fn();
    bar.on("group-colour", coloured);
    rightClick(chip("Work"));
    document.querySelector<HTMLElement>('.tab-menu-swatch[aria-label="green"]')!.click();
    expect(coloured).toHaveBeenCalledWith({ group: "Work", colour: "green" });
  });

  it.each([
    ["Open this workspace", "group-solo"],
    ["Ungroup", "group-ungroup"],
  ] as const)("%s", (label, event) => {
    const handler = vi.fn();
    bar.on(event, handler);
    rightClick(chip("Work"));
    menuItem(label).click();
    expect(handler).toHaveBeenCalledWith("Work");
  });

  it("renames in place, without collapsing the group", () => {
    const renamed = vi.fn();
    const toggled = vi.fn();
    bar.on("group-rename", renamed);
    bar.on("group-toggle", toggled);
    rightClick(chip("Work"));
    menuItem("Rename group").click();
    const input = chip("Work").querySelector<HTMLInputElement>(".tab-name-input")!;
    input.click();
    input.value = "AirPLAi";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(renamed).toHaveBeenCalledWith({ group: "Work", name: "AirPLAi" });
    expect(toggled).not.toHaveBeenCalled();
  });
});

describe("dragging", () => {
  it("counts a drop position within the tab's own group", () => {
    const runs = [...container.querySelectorAll(".tab-run")].map((run) =>
      [...run.querySelectorAll<HTMLElement>(".tab")].map((el) => el.dataset["tabId"]).join(" "),
    );
    expect(runs).toEqual(["a", "w1 w2", "h1", "b"]);
  });
});
