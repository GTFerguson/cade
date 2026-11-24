// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  themes,
  applyTheme,
  applySavedTheme,
  getActiveTheme,
  buildXtermTheme,
  DEFAULT_THEME_ID,
  type Theme,
} from "./themes";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// WCAG AA for normal-size text.
const AA = 4.5;

const lightThemes = themes.filter((t) => t.mode === "light");

describe("themes", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.themeMode;
  });

  it("has unique ids", () => {
    expect(new Set(themes.map((t) => t.id)).size).toBe(themes.length);
  });

  it("ships at least one light theme", () => {
    expect(lightThemes.length).toBeGreaterThan(0);
  });

  describe.each(lightThemes.map((t) => [t.id, t] as [string, Theme]))(
    "light theme %s",
    (_id, theme) => {
      const c = theme.colors;
      const textRoles = {
        textPrimary: c.textPrimary,
        textSecondary: c.textSecondary,
        textMuted: c.textMuted,
        accentBlue: c.accentBlue,
        accentGreen: c.accentGreen,
        accentOrange: c.accentOrange,
        accentYellow: c.accentYellow,
        accentPurple: c.accentPurple,
        accentRed: c.accentRed,
        accentCyan: c.accentCyan,
      };

      it.each(Object.entries(textRoles))("%s is readable on the main background", (_role, color) => {
        expect(contrast(color, c.bgPrimary)).toBeGreaterThanOrEqual(AA);
      });

      it("avoids pure white backgrounds", () => {
        for (const bg of [c.bgPrimary, c.bgSecondary, c.bgTertiary]) {
          expect(bg.toLowerCase()).not.toBe("#ffffff");
          expect(luminance(bg)).toBeLessThan(0.9);
        }
      });

      it.each(["red", "green", "yellow", "blue", "magenta", "cyan"] as const)(
        "terminal ANSI %s is readable on the terminal background",
        (name) => {
          expect(contrast(theme.terminal[name], c.bgPrimary)).toBeGreaterThanOrEqual(AA);
        },
      );
    },
  );

  it("applyTheme marks the document with the theme's mode", () => {
    const light = lightThemes[0]!;
    applyTheme(light.id);
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    const dark = themes.find((t) => t.mode === "dark")!;
    applyTheme(dark.id);
    expect(document.documentElement.dataset.themeMode).toBe("dark");
  });

  it("terminal theme follows the active theme, ANSI colors included", () => {
    const light = lightThemes[0]!;
    applyTheme(light.id);
    expect(getActiveTheme().id).toBe(light.id);

    const xterm = buildXtermTheme();
    expect(xterm.background).toBe(light.colors.bgPrimary);
    expect(xterm.foreground).toBe(light.colors.textPrimary);
    expect(xterm.green).toBe(light.terminal.green);

    const dark = themes.find((t) => t.mode === "dark")!;
    applyTheme(dark.id);
    expect(buildXtermTheme().green).toBe(dark.terminal.green);
  });

  it("an unknown saved theme falls back to the default for CSS and terminals alike", () => {
    localStorage.setItem("cade-theme", "no-such-theme");
    applySavedTheme();
    const fallback = themes.find((t) => t.id === DEFAULT_THEME_ID)!;
    expect(getActiveTheme().id).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.style.getPropertyValue("--bg-primary")).toBe(fallback.colors.bgPrimary);
    expect(buildXtermTheme().background).toBe(fallback.colors.bgPrimary);
  });
});
