// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SessionStrip, neighbourTab, waitingElsewhere, workspaceTabs } from "./session-strip";

const tabs = (active: string, ids = ["a", "b", "c"]) =>
  ids.map((id) => ({ id, name: id, isActive: id === active, unread: false }));

describe("neighbourTab", () => {
  it("steps forward and back with wrap-around", () => {
    expect(neighbourTab(tabs("a"), 1)?.id).toBe("b");
    expect(neighbourTab(tabs("c"), 1)?.id).toBe("a");
    expect(neighbourTab(tabs("a"), -1)?.id).toBe("c");
  });

  it("has nowhere to go with a single tab", () => {
    expect(neighbourTab(tabs("a", ["a"]), 1)).toBeNull();
  });
});

describe("the open workspace on the phone", () => {
  const mixed = (active: string) => [
    { id: "l", name: "l", isActive: active === "l", unread: false },
    { id: "w1", name: "w1", isActive: active === "w1", unread: false, group: "Work" },
    { id: "w2", name: "w2", isActive: active === "w2", unread: false, group: "Work", attention: "input" as const },
    { id: "h1", name: "h1", isActive: active === "h1", unread: false, group: "Home", attention: "input" as const },
  ];

  it("is the active tab's group, or the ungrouped tabs", () => {
    expect(workspaceTabs(mixed("w1")).map((t) => t.id)).toEqual(["w1", "w2"]);
    expect(workspaceTabs(mixed("l")).map((t) => t.id)).toEqual(["l"]);
  });

  it("keeps the arrows inside it", () => {
    expect(neighbourTab(workspaceTabs(mixed("w2")), 1)?.id).toBe("w1");
  });

  it("counts sessions waiting in the other workspaces only", () => {
    expect(waitingElsewhere(mixed("w1"))).toBe(1);
    expect(waitingElsewhere(mixed("l"))).toBe(2);
  });

  it("draws a dot per session of the workspace and flags waiting elsewhere", () => {
    const strip = new SessionStrip({ onSwitchRelative: vi.fn(), onOpenMenu: vi.fn() });
    strip.render(mixed("w1"), null);
    expect(strip.element.querySelectorAll(".session-strip-dot")).toHaveLength(2);
    expect(strip.element.querySelector(".session-strip-elsewhere")!.textContent).toBe("!1");

    strip.render(mixed("h1"), null);
    expect(strip.element.querySelector(".session-strip-elsewhere")!.textContent).toBe("!1");
    expect(strip.element.querySelectorAll(".session-strip-dot")).toHaveLength(1);
  });

  it("shows no flag when nothing is waiting elsewhere", () => {
    const strip = new SessionStrip({ onSwitchRelative: vi.fn(), onOpenMenu: vi.fn() });
    strip.render(mixed("h1").filter((t) => t.group !== "Work"), null);
    expect(strip.element.querySelector(".session-strip-elsewhere")).toBeNull();
  });
});

describe("SessionStrip", () => {
  it("names the active session and marks unread siblings", () => {
    const strip = new SessionStrip({ onSwitchRelative: vi.fn(), onOpenMenu: vi.fn() });
    const list = tabs("b");
    list[2]!.unread = true;
    strip.render(list, "claude-code");

    expect(strip.element.querySelector(".session-strip-name")!.textContent).toContain("b");
    expect(strip.element.querySelector(".session-strip-agent")!.textContent).toContain("claude-code");
    const dots = strip.element.querySelectorAll(".session-strip-dot");
    expect(dots).toHaveLength(3);
    expect(dots[1]!.classList.contains("active")).toBe(true);
    expect(dots[2]!.classList.contains("unread")).toBe(true);
  });

  it("shows the active session's tab group in the group's colour", () => {
    const strip = new SessionStrip({ onSwitchRelative: vi.fn(), onOpenMenu: vi.fn() });
    const list = tabs("b").map((t) =>
      t.id === "b" ? { ...t, group: "Work", groupColour: "var(--accent-purple)" } : t,
    );
    strip.render(list);
    const group = strip.element.querySelector<HTMLElement>(".session-strip-group")!;
    expect(group.textContent).toBe("Work");
    expect(group.style.color).toBe("var(--accent-purple)");
    expect(strip.element.querySelector(".session-strip-name")!.textContent).toBe("Work b");
  });

  it("shows no group for an ungrouped session", () => {
    const strip = new SessionStrip({ onSwitchRelative: vi.fn(), onOpenMenu: vi.fn() });
    strip.render(tabs("a"));
    expect(strip.element.querySelector(".session-strip-group")).toBeNull();
  });

  it("switches on arrow taps and opens the menu from the name", () => {
    const onSwitchRelative = vi.fn();
    const onOpenMenu = vi.fn();
    const strip = new SessionStrip({ onSwitchRelative, onOpenMenu });
    strip.render(tabs("a"));
    (strip.element.querySelector('[aria-label="next session"]') as HTMLButtonElement).click();
    (strip.element.querySelector(".session-strip-centre") as HTMLButtonElement).click();
    expect(onSwitchRelative).toHaveBeenCalledWith(1);
    expect(onOpenMenu).toHaveBeenCalled();
  });

  it("disables the arrows with a single session", () => {
    const strip = new SessionStrip({ onSwitchRelative: vi.fn(), onOpenMenu: vi.fn() });
    strip.render(tabs("a", ["a"]));
    expect((strip.element.querySelector('[aria-label="next session"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
