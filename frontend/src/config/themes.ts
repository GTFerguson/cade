/**
 * Built-in color themes.
 *
 * Each theme provides a complete ColorsConfig. Accent colors are shared
 * across all themes (badwolf highlights); only the neutral palette
 * (backgrounds, text, borders, scrollbar) varies.
 */

import type { ColorsConfig } from "./user-config";
import { applyAppearanceConfig, getUserConfig } from "./user-config";

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ColorsConfig;
}

const STORAGE_KEY = "cade-theme";

/** Default theme when none is saved. */
export const DEFAULT_THEME_ID = "true-black";

// ── Shared accent palette (badwolf highlights) ───────────────────────

const sharedAccents = {
  accentBlue: "#0a9dff",
  accentGreen: "#aeee00",
  accentOrange: "#ffa724",
  accentYellow: "#fade3e",
  accentPurple: "#ff9eb8",
  accentRed: "#ff2c4b",
  accentCyan: "#8cffba",
  borderFocus: "#aeee00",
};

// ── Theme definitions ────────────────────────────────────────────────

export const themes: Theme[] = [
  {
    id: "true-black",
    name: "True Black",
    description: "OLED-dark, maximum depth",
    colors: {
      ...sharedAccents,
      bgPrimary: "#0a0a09",
      bgSecondary: "#111110",
      bgTertiary: "#1a1918",
      bgHover: "#222120",
      bgSelected: "#222120",
      textPrimary: "#f8f6f2",
      textSecondary: "#c4b9ad",
      textMuted: "#5e5955",
      borderColor: "#2a2827",
      scrollbarBg: "#0a0a09",
      scrollbarThumb: "#2a2827",
      scrollbarThumbHover: "#5e5955",
    },
  },
  {
    id: "deep-contrast",
    name: "Deep Contrast",
    description: "Tighter grey range, more pop",
    colors: {
      ...sharedAccents,
      bgPrimary: "#141312",
      bgSecondary: "#1a1918",
      bgTertiary: "#222120",
      bgHover: "#2a2827",
      bgSelected: "#2a2827",
      textPrimary: "#f8f6f2",
      textSecondary: "#d9cec3",
      textMuted: "#6b6560",
      borderColor: "#2e2c2a",
      scrollbarBg: "#141312",
      scrollbarThumb: "#2e2c2a",
      scrollbarThumbHover: "#6b6560",
    },
  },
  {
    id: "ember",
    name: "Ember",
    description: "Warm blacks, reddish undertone",
    colors: {
      ...sharedAccents,
      bgPrimary: "#110f0d",
      bgSecondary: "#181513",
      bgTertiary: "#201c19",
      bgHover: "#2a2521",
      bgSelected: "#2a2521",
      textPrimary: "#f8f6f2",
      textSecondary: "#d4c5b5",
      textMuted: "#6e6259",
      borderColor: "#302a25",
      scrollbarBg: "#110f0d",
      scrollbarThumb: "#302a25",
      scrollbarThumbHover: "#6e6259",
    },
  },
  {
    id: "ink",
    name: "Ink",
    description: "Cool neutral, blue-grey borders",
    colors: {
      ...sharedAccents,
      bgPrimary: "#0e0f10",
      bgSecondary: "#151617",
      bgTertiary: "#1c1d1f",
      bgHover: "#242628",
      bgSelected: "#242628",
      textPrimary: "#e8e6e3",
      textSecondary: "#b0aca6",
      textMuted: "#5c5a57",
      borderColor: "#2c2e31",
      scrollbarBg: "#0e0f10",
      scrollbarThumb: "#2c2e31",
      scrollbarThumbHover: "#5c5a57",
    },
  },
  {
    id: "badwolf",
    name: "Badwolf",
    description: "Original badwolf palette",
    colors: {
      ...sharedAccents,
      bgPrimary: "#1c1b1a",
      bgSecondary: "#242321",
      bgTertiary: "#35322d",
      bgHover: "#45413b",
      bgSelected: "#45413b",
      textPrimary: "#f8f6f2",
      textSecondary: "#d9cec3",
      textMuted: "#857f78",
      borderColor: "#45413b",
      scrollbarBg: "#1c1b1a",
      scrollbarThumb: "#45413b",
      scrollbarThumbHover: "#857f78",
    },
  },
];

// ── Theme lookup ─────────────────────────────────────────────────────

export function getThemeById(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}

// ── Persistence ──────────────────────────────────────────────────────

export function getSavedThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage may be unavailable in some environments
  }
}

// ── Change listeners ─────────────────────────────────────────────────

type ThemeChangeListener = (themeId: string) => void;
const listeners: ThemeChangeListener[] = [];

/**
 * Register a callback for theme changes (e.g. to update xterm.js terminals).
 */
export function onThemeChange(fn: ThemeChangeListener): void {
  listeners.push(fn);
}

// ── Application ──────────────────────────────────────────────────────

/**
 * Apply a theme by id. Saves the choice and updates CSS variables.
 * Notifies all registered listeners.
 */
export function applyTheme(themeId: string): void {
  const theme = getThemeById(themeId);
  if (!theme) return;

  saveThemeId(themeId);

  const config = getUserConfig();
  const appearance = {
    ...config.appearance,
    colors: { ...theme.colors },
  };
  applyAppearanceConfig(appearance);

  for (const fn of listeners) {
    fn(themeId);
  }
}

/**
 * Apply the saved theme (or default) on startup.
 * Call this early, before the WebSocket config arrives.
 */
export function applySavedTheme(): void {
  applyTheme(getSavedThemeId());
}
