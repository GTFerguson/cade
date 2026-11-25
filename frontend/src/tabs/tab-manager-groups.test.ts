// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TabManager, migrateAppState } from "./tab-manager";
import type { AppState, TabState } from "./types";
import { UNGROUPED } from "./tab-groups";

const STORAGE_KEY = "cade-app-state";
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!) as AppState;
const order = (m: TabManager) => m.getTabs().map((t) => t.name).join(" ");

let manager: TabManager;
let a: TabState, b: TabState, c: TabState, d: TabState;

beforeEach(() => {
  localStorage.clear();
  manager = new TabManager();
  a = manager.createTab("/p/a");
  b = manager.createTab("/p/b");
  c = manager.createTab("/p/c");
  d = manager.createTab("/p/d");
  manager.switchTab(a.id);
});

describe("putting tabs in groups", () => {
  it("keeps a group's tabs together, the newcomer last", () => {
    manager.setTabGroup(b.id, "Work");
    manager.setTabGroup(d.id, "Work");
    expect(order(manager)).toBe("a b d c");
    manager.setTabGroup(a.id, "Work");
    expect(order(manager)).toBe("b d a c");
  });

  it("leaves the first tab of a new group where it was", () => {
    manager.setTabGroup(c.id, "Work");
    expect(order(manager)).toBe("a b c d");
  });

  it("puts a tab that leaves a group just past it", () => {
    for (const t of [a, b, c]) manager.setTabGroup(t.id, "Work");
    manager.setTabGroup(a.id, null);
    expect(order(manager)).toBe("b c a d");
  });

  it("reports a change only when the group really changed", () => {
    expect(manager.setTabGroup(b.id, "Work")).toBe(b);
    expect(manager.setTabGroup(b.id, " Work ")).toBeNull();
    expect(manager.setTabGroup(a.id, null)).toBeNull();
    expect(manager.setTabGroup("missing", "Work")).toBeNull();
  });

  it("saves the group with the tab", () => {
    manager.setTabGroup(b.id, "Work");
    expect(saved().tabs.find((t) => t.id === b.id)!.group).toBe("Work");
    expect(saved().tabs.find((t) => t.id === a.id)!.group).toBeUndefined();
  });

  it("places an adopted session in its group", () => {
    manager.setTabGroup(b.id, "Work");
    manager.adoptSession("s9", "/p/z", null, "Work");
    expect(order(manager)).toBe("a b z c d");
  });

  it("drags a tab within its group only", () => {
    for (const t of [b, c]) manager.setTabGroup(t.id, "Work");
    manager.moveTab(b.id, 5);
    expect(order(manager)).toBe("a c b d");
  });
});

describe("collapsing", () => {
  beforeEach(() => {
    manager.setTabGroup(b.id, "Work");
    manager.setTabGroup(c.id, "Work");
  });

  it("keeps only the active tab's workspace open", () => {
    manager.setTabGroup(d.id, "Home");
    expect([...manager.getCollapsedGroups()]).toEqual(["Work", "Home"]);
    manager.switchTab(b.id);
    expect(manager.getOpenWorkspace()).toBe("Work");
    expect([...manager.getCollapsedGroups()]).toEqual([UNGROUPED, "Home"]);
  });

  it("numbers only the open workspace's tabs, leaving ungrouped ones out", () => {
    manager.switchTab(c.id);
    expect(manager.getVisibleTabs()).toEqual([b, c]);
    manager.goToTab(0);
    expect(manager.getActiveTabId()).toBe(b.id);
  });

  it("keeps next and previous inside what is on show", () => {
    manager.nextTab();
    expect(manager.getActiveTabId()).toBe(d.id);
    manager.nextTab();
    expect(manager.getActiveTabId()).toBe(a.id);
  });

  it("numbers tabs by what is on show", () => {
    manager.goToTab(1);
    expect(manager.getActiveTabId()).toBe(d.id);
  });

  it("redraws the bar when a switch crosses into another workspace, and not otherwise", () => {
    const changed = vi.fn();
    manager.on("tabs-changed", changed);
    manager.switchTab(d.id);
    expect(changed).not.toHaveBeenCalled();
    manager.switchTab(c.id);
    expect(changed).toHaveBeenCalled();
  });

  it("stays in the workspace when its active tab closes", async () => {
    manager.switchTab(b.id);
    await manager.closeTab(b.id);
    expect(manager.getActiveTabId()).toBe(c.id);
  });

  it("saves which groups are closed", () => {
    expect(saved().collapsedGroups).toEqual(["Work"]);
    manager.ungroup("Work");
    expect(saved().collapsedGroups).toEqual([]);
  });
});

describe("moving between workspaces", () => {
  beforeEach(() => {
    manager.setTabGroup(b.id, "Work");
    manager.setTabGroup(c.id, "Work");
    manager.setTabGroup(d.id, "Home");
  });

  it("lists each group and the ungrouped tabs as stops, in tab bar order", () => {
    expect(manager.getWorkspaces()).toEqual([null, "Work", "Home"]);
    manager.setTabGroup(a.id, "Home");
    expect(manager.getWorkspaces()).toEqual(["Work", "Home"]);
  });

  it("steps to the next and previous workspace, wrapping", () => {
    expect(manager.workspaceAt(1)).toBe("Work");
    expect(manager.workspaceAt(-1)).toBe("Home");
    manager.switchWorkspace("Home");
    expect(manager.workspaceAt(1)).toBeNull();
  });

  it("opens a workspace on its first tab the first time", () => {
    manager.switchWorkspace("Work");
    expect(manager.getActiveTabId()).toBe(b.id);
  });

  it("comes back to the tab that was last active there", () => {
    manager.switchTab(c.id);
    manager.switchWorkspace("Home");
    expect(manager.getActiveTabId()).toBe(d.id);
    manager.switchWorkspace("Work");
    expect(manager.getActiveTabId()).toBe(c.id);
    manager.switchWorkspace(null);
    expect(manager.getActiveTabId()).toBe(a.id);
  });

  it("forgets a remembered tab that has left the workspace", () => {
    manager.switchTab(c.id);
    manager.switchWorkspace("Home");
    manager.setTabGroup(c.id, "Home");
    manager.switchWorkspace("Work");
    expect(manager.getActiveTabId()).toBe(b.id);
  });

  it("does nothing when asked for the workspace already open", () => {
    manager.switchTab(c.id);
    manager.switchWorkspace("Work");
    expect(manager.getActiveTabId()).toBe(c.id);
  });
});

describe("renaming and ungrouping", () => {
  beforeEach(() => {
    manager.setTabGroup(b.id, "Work");
    manager.setTabGroup(c.id, "Work");
  });

  it("renames a group and returns the tabs to tell the backend about", () => {
    expect(manager.renameGroup("Work", " AirPLAi ")).toEqual([b, c]);
    expect(manager.getGroupNames()).toEqual(["AirPLAi"]);
    expect(manager.getCollapsedGroups().has("AirPLAi")).toBe(true);
  });

  it("ignores a blank or unchanged name", () => {
    expect(manager.renameGroup("Work", "  ")).toEqual([]);
    expect(manager.renameGroup("Work", "Work")).toEqual([]);
  });

  it("merges into a group that already has the new name", () => {
    manager.setTabGroup(a.id, "Home");
    manager.renameGroup("Work", "Home");
    expect(order(manager)).toBe("a b c d");
    expect(manager.getGroupNames()).toEqual(["Home"]);
  });

  it("ungroups in place", () => {
    expect(manager.ungroup("Work")).toEqual([b, c]);
    expect(order(manager)).toBe("a b c d");
    expect(manager.getGroupNames()).toEqual([]);
  });
});

describe("saved state", () => {
  it("carries state saved before groups existed", () => {
    const old = { version: 1, tabs: [{ id: "x", projectPath: "/p/x", name: "x" }], activeTabId: "x" };
    expect(migrateAppState(old)).toEqual({ ...old, version: 2, collapsedGroups: [] });
  });

  it.each([null, "text", { version: 3, tabs: [] }, { version: 2 }])("refuses unusable state (%j)", (raw) => {
    expect(migrateAppState(raw)).toBeNull();
  });

  it("restores groups, pulling a group's tabs together and showing the active tab", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      activeTabId: "w2",
      collapsedGroups: ["Work", "Home"],
      tabs: [
        { id: "w1", projectPath: "/p/w1", name: "w1", group: "Work" },
        { id: "h1", projectPath: "/p/h1", name: "h1", group: "Home" },
        { id: "w2", projectPath: "/p/w2", name: "w2", group: "Work" },
      ],
    }));
    const restored = new TabManager();
    await restored.restoreSession();
    expect(order(restored)).toBe("w1 w2 h1");
    expect([...restored.getCollapsedGroups()]).toEqual(["Home"]);
  });
});
