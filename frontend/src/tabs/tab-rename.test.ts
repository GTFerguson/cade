// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TabManager } from "./tab-manager";

const savedTabs = () =>
  (JSON.parse(localStorage.getItem(Object.keys(localStorage)[0]!)!) as {
    tabs: { id: string; name: string; customName?: boolean }[];
  }).tabs;

describe("renaming a tab", () => {
  let manager: TabManager;

  beforeEach(() => {
    localStorage.clear();
    manager = new TabManager();
  });

  it("names a new tab after its project folder", () => {
    expect(manager.createTab("/home/me/projects/cade").name).toBe("cade");
  });

  it("applies and persists the chosen name", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    expect(manager.renameTab(tab.id, "  cade: theme work  ")?.name).toBe("cade: theme work");
    const saved = savedTabs().find((t) => t.id === tab.id)!;
    expect(saved.name).toBe("cade: theme work");
    expect(saved.customName).toBe(true);
  });

  it("announces the change so the tab bar redraws", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    const changed = vi.fn();
    manager.on("tabs-changed", changed);
    manager.renameTab(tab.id, "renamed");
    expect(changed).toHaveBeenCalled();
  });

  it.each(["", "   ", "cade"])("ignores a blank or unchanged name (%j)", (name) => {
    const tab = manager.createTab("/home/me/projects/cade");
    expect(manager.renameTab(tab.id, name)).toBeNull();
    expect(tab.name).toBe("cade");
    expect(tab.customName).toBeUndefined();
  });

  it("keeps a chosen name when the server confirms a different path", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    manager.renameTab(tab.id, "my name");
    manager.updateTabPath(tab.id, "/home/me/projects/other");
    expect(tab.name).toBe("my name");
    expect(tab.projectPath).toBe("/home/me/projects/other");
  });

  it("still follows the path for a tab that was never renamed", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    manager.updateTabPath(tab.id, "/home/me/projects/other");
    expect(tab.name).toBe("other");
  });

  it("treats an adopted session's own label as a chosen name", () => {
    const tab = manager.adoptSession("s1", "/home/me/projects/cade", "release prep");
    manager.updateTabPath(tab.id, "/home/me/projects/other");
    expect(tab.name).toBe("release prep");
  });
});
