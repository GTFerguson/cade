// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { sessionTitleFromTerminal, tabDisplayName } from "./session-title";
import { TabManager } from "./tab-manager";

describe("sessionTitleFromTerminal", () => {
  it.each([
    ["\u2733 Light theme work", "Light theme work"],
    ["\u2802 Light theme work", "Light theme work"],
    ["\u2810 Light theme work", "Light theme work"],
    ["  Fix flaky upload test  ", "Fix flaky upload test"],
    ["* cade: review tabs", "cade: review tabs"],
  ])("reads %j as %j", (raw, expected) => {
    expect(sessionTitleFromTerminal(raw)).toBe(expected);
  });

  it("gives every spinner frame the same name, so the tab does not flicker", () => {
    const frames = ["\u2802", "\u2810", "\u2808", "\u2733"].map((g) => sessionTitleFromTerminal(`${g} Refactor auth`));
    expect(new Set(frames).size).toBe(1);
  });

  it.each([
    "",
    "   ",
    "gary@workstation: ~/projects/cade",
    "gary@workstation:~/projects/cade",
    "~/projects/cade",
    "/home/gary/projects/cade",
    "C:\\Users\\gary",
    "claude",
    "\u2733 Claude Code",
    "codex",
    "bash",
  ])("does not take %j for a session name", (raw) => {
    expect(sessionTitleFromTerminal(raw)).toBeNull();
  });

  it("shortens a very long title", () => {
    const title = sessionTitleFromTerminal("x".repeat(200))!;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("\u2026")).toBe(true);
  });
});

describe("tabDisplayName", () => {
  it("uses the folder name when nothing else is known", () => {
    expect(tabDisplayName({ name: "cade" })).toBe("cade");
  });

  it("uses the agent's session title on an unnamed tab", () => {
    expect(tabDisplayName({ name: "cade", agentTitle: "Light theme work" })).toBe("Light theme work");
  });

  it("keeps the user's own name over the agent's title", () => {
    expect(tabDisplayName({ name: "mine", customName: true, agentTitle: "Light theme work" })).toBe("mine");
  });
});

describe("TabManager.setAgentTitle", () => {
  let manager: TabManager;

  beforeEach(() => {
    localStorage.clear();
    manager = new TabManager();
  });

  it("renames an unnamed tab and announces it", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    const changed = vi.fn();
    manager.on("tabs-changed", changed);
    expect(manager.setAgentTitle(tab.id, "Light theme work")).toBe(tab);
    expect(tabDisplayName(tab)).toBe("Light theme work");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the title has not changed", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    manager.setAgentTitle(tab.id, "Light theme work");
    expect(manager.setAgentTitle(tab.id, "Light theme work")).toBeNull();
  });

  it("falls back to the folder name when the agent stops reporting one", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    manager.setAgentTitle(tab.id, "Light theme work");
    manager.setAgentTitle(tab.id, null);
    expect(tabDisplayName(tab)).toBe("cade");
  });

  it("does not rename a tab the user named, but remembers the title", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    manager.renameTab(tab.id, "mine");
    expect(manager.setAgentTitle(tab.id, "Light theme work")).toBeNull();
    expect(tabDisplayName(tab)).toBe("mine");
    expect(tab.agentTitle).toBe("Light theme work");
  });

  it("does not save the agent's title as the tab's own name", () => {
    const tab = manager.createTab("/home/me/projects/cade");
    manager.setAgentTitle(tab.id, "Light theme work");
    manager.moveTab(tab.id, 0);
    manager.renameTab(manager.createTab("/x/other").id, "force a save");
    const saved = JSON.parse(localStorage.getItem(Object.keys(localStorage)[0]!)!).tabs;
    expect(saved.find((t: { id: string }) => t.id === tab.id).name).toBe("cade");
  });
});
