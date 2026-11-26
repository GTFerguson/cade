// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { LIGHT_MIN_CONTRAST, saveThemeId, terminalMinimumContrast, themes } from "./themes";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

beforeEach(() => localStorage.clear());

describe("the least contrast the terminal draws text with", () => {
  it("is enforced on a light theme, where programs' colours arrive pale", () => {
    saveThemeId("daylight");
    expect(terminalMinimumContrast()).toBe(LIGHT_MIN_CONTRAST);
  });

  it("is left alone on the dark themes those colours were chosen for", () => {
    for (const theme of themes.filter((t) => t.mode === "dark")) {
      saveThemeId(theme.id);
      expect(terminalMinimumContrast(), theme.id).toBe(1);
    }
  });
});

describe("the daylight theme's own colours", () => {
  const daylight = themes.find((t) => t.id === "daylight")!;
  const page = daylight.colors.bgPrimary;

  it("draws every accent readably on the page", () => {
    const accents = ["accentBlue", "accentGreen", "accentOrange", "accentYellow", "accentPurple", "accentRed", "accentCyan"] as const;
    for (const name of accents) {
      expect(contrast(daylight.colors[name], page), name).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRAST);
    }
  });

  it("draws muted text readably on the page and on the bar", () => {
    expect(contrast(daylight.colors.textMuted, page)).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRAST);
    expect(contrast(daylight.colors.textMuted, daylight.colors.bgSecondary)).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRAST);
  });

  it("has a terminal cursor that stands out from the page", () => {
    expect(contrast(daylight.terminal.cursor, page)).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRAST);
  });
});
