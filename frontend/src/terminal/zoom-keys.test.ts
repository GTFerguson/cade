import { describe, expect, it } from "vitest";
import { isZoomHotkey } from "./zoom-keys";

function key(
  key: string,
  mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">> = {},
): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, ...mods } as KeyboardEvent;
}

describe("isZoomHotkey", () => {
  it.each(["-", "=", "+", "0"])("passes Ctrl+%s through to the app zoom", (k) => {
    expect(isZoomHotkey(key(k, { ctrlKey: true }))).toBe(true);
  });

  it("accepts Cmd on macOS", () => {
    expect(isZoomHotkey(key("=", { metaKey: true }))).toBe(true);
  });

  it("ignores the keys without a modifier so typing is unaffected", () => {
    expect(isZoomHotkey(key("-"))).toBe(false);
    expect(isZoomHotkey(key("0"))).toBe(false);
  });

  it("ignores Ctrl+Alt combinations and other Ctrl keys", () => {
    expect(isZoomHotkey(key("-", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZoomHotkey(key("c", { ctrlKey: true }))).toBe(false);
  });
});
