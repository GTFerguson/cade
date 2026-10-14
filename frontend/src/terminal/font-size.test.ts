// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  fontSizeForCols,
  getTerminalFontSize,
  onTerminalFontSizeChange,
  resetTerminalFontSizeCache,
  setTerminalFontSize,
  stepTerminalFontSize,
} from "./font-size";

beforeEach(() => {
  localStorage.clear();
  resetTerminalFontSizeCache();
});

describe("terminal font size setting", () => {
  it("defaults when nothing is stored", () => {
    expect(getTerminalFontSize()).toBe(DEFAULT_FONT_SIZE);
  });

  it("persists and clamps", () => {
    expect(setTerminalFontSize(100)).toBe(MAX_FONT_SIZE);
    resetTerminalFontSizeCache();
    expect(getTerminalFontSize()).toBe(MAX_FONT_SIZE);
    expect(setTerminalFontSize(1)).toBe(MIN_FONT_SIZE);
    expect(setTerminalFontSize(NaN)).toBe(DEFAULT_FONT_SIZE);
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem("cade.terminal.fontSize", "huge");
    expect(getTerminalFontSize()).toBe(DEFAULT_FONT_SIZE);
  });

  it("notifies listeners only on change", () => {
    const cb = vi.fn();
    const off = onTerminalFontSizeChange(cb);
    setTerminalFontSize(16);
    setTerminalFontSize(16);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(16);
    off();
    setTerminalFontSize(17);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("steps by one in either direction", () => {
    setTerminalFontSize(14);
    expect(stepTerminalFontSize(1)).toBe(15);
    expect(stepTerminalFontSize(-1)).toBe(14);
  });
});

describe("fontSizeForCols", () => {
  it("shrinks until the columns fit", () => {
    // 200 cols at 0.6em per glyph in 390px: 390 / 120 = 3.25 → clamped to the minimum.
    expect(fontSizeForCols(200, 390, 14)).toBe(MIN_FONT_SIZE);
    // 80 cols in 390px: 390 / 48 = 8.1 → 8.
    expect(fontSizeForCols(80, 390, 14)).toBe(8);
  });

  it("never exceeds the user's size", () => {
    expect(fontSizeForCols(20, 1000, 14)).toBe(14);
  });

  it("falls back to the cap for nonsense input", () => {
    expect(fontSizeForCols(0, 390, 14)).toBe(14);
  });
});
