import { describe, it, expect } from "vitest";
import { parseKeybinding, matchesKeybinding } from "./bindings";

describe("parseKeybinding", () => {
  it("parses a lone lowercase key", () => {
    expect(parseKeybinding("c")).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "c",
    });
  });

  it("keeps the key's original case", () => {
    expect(parseKeybinding("C").key).toBe("C");
    expect(parseKeybinding("?").key).toBe("?");
  });

  it("parses single modifier C-", () => {
    expect(parseKeybinding("C-a")).toMatchObject({ ctrl: true, key: "a" });
  });

  it("parses A-, S-, M- modifiers", () => {
    expect(parseKeybinding("A-h")).toMatchObject({ alt: true, key: "h" });
    expect(parseKeybinding("S-c")).toMatchObject({ shift: true, key: "c" });
    expect(parseKeybinding("M-k")).toMatchObject({ meta: true, key: "k" });
  });

  it("accepts lowercase modifier tokens", () => {
    expect(parseKeybinding("c-a")).toMatchObject({ ctrl: true, key: "a" });
  });

  it("parses multiple modifiers", () => {
    expect(parseKeybinding("C-S-a")).toMatchObject({
      ctrl: true,
      shift: true,
      key: "a",
    });
  });

  it("handles empty string as empty key with no modifiers", () => {
    expect(parseKeybinding("")).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "",
    });
  });
});

function fakeEvent(
  key: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): KeyboardEvent {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  } as KeyboardEvent;
}

describe("matchesKeybinding", () => {
  it("matches exact key with no modifiers", () => {
    expect(matchesKeybinding(fakeEvent("c"), "c")).toBe(true);
  });

  it("rejects key mismatch", () => {
    expect(matchesKeybinding(fakeEvent("c"), "d")).toBe(false);
  });

  it("is case-sensitive on key (C vs c)", () => {
    expect(matchesKeybinding(fakeEvent("C"), "c")).toBe(false);
    expect(matchesKeybinding(fakeEvent("c"), "C")).toBe(false);
  });

  it("requires matching Ctrl state", () => {
    expect(matchesKeybinding(fakeEvent("a", { ctrl: true }), "C-a")).toBe(true);
    expect(matchesKeybinding(fakeEvent("a"), "C-a")).toBe(false);
    expect(matchesKeybinding(fakeEvent("a", { ctrl: true }), "a")).toBe(false);
  });

  it("does NOT require shift for single-char binding without S-", () => {
    // `?` inherently requires shift to type, but the binding doesn't say S-.
    expect(matchesKeybinding(fakeEvent("?", { shift: true }), "?")).toBe(true);
  });

  it("DOES require shift when binding explicitly uses S-", () => {
    expect(matchesKeybinding(fakeEvent("a", { shift: true }), "S-a")).toBe(
      true
    );
    expect(matchesKeybinding(fakeEvent("a"), "S-a")).toBe(false);
  });

  it("ignoreCtrl: treats event's ctrl as false during compare", () => {
    // Event has ctrl held (e.g. from the prefix). Binding is plain "h".
    expect(
      matchesKeybinding(fakeEvent("h", { ctrl: true }), "h", {
        ignoreCtrl: true,
      })
    ).toBe(true);
    // Same event without ignoreCtrl: ctrl mismatch, no match.
    expect(matchesKeybinding(fakeEvent("h", { ctrl: true }), "h")).toBe(false);
  });

  it("ignoreCtrl does NOT bypass alt/shift/meta checks", () => {
    expect(
      matchesKeybinding(fakeEvent("h", { ctrl: true, alt: true }), "h", {
        ignoreCtrl: true,
      })
    ).toBe(false);
  });
});
