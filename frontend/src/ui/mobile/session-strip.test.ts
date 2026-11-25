// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SessionStrip, neighbourTab } from "./session-strip";

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
