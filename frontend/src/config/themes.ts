/**
 * Built-in color themes.
 *
 * Each theme provides a complete ColorsConfig and a terminal ANSI palette.
 * Dark themes share the badwolf accents and terminal colors and vary only
 * the neutral palette. Light themes need their own darker accents: the
 * badwolf neons are tuned for dark backgrounds and wash out on cream.
 */

import type { ColorsConfig } from "./user-config";
import { applyAppearanceConfig, getUserConfig } from "./user-config";

export type ThemeMode = "dark" | "light";

/** The 16 ANSI colors plus cursor/selection, as xterm.js consumes them. */
export interface TerminalPalette {
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: ThemeMode;
  colors: ColorsConfig;
  terminal: TerminalPalette;
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

/**
 * Badwolf ANSI colors for dark themes. Black/white follow the theme's own
 * background and foreground so full-screen TUIs blend into the pane.
 */
function darkTerminal(c: ColorsConfig): TerminalPalette {
  return {
    cursor: "#aeee00",
    selectionBackground: c.bgHover,
    black: c.bgPrimary,
    red: "#ff2c4b",
    green: "#aeee00",
    yellow: "#fade3e",
    blue: "#0a9dff",
    magenta: "#ff9eb8",
    cyan: "#8cffba",
    white: c.textPrimary,
    brightBlack: c.textMuted,
    brightRed: "#ff2c4b",
    brightGreen: "#aeee00",
    brightYellow: "#ffa724",
    brightBlue: "#0a9dff",
    brightMagenta: "#ff9eb8",
    brightCyan: "#8cffba",
    brightWhite: "#ffffff",
  };
}

function darkTheme(t: Omit<Theme, "mode" | "terminal">): Theme {
  return { ...t, mode: "dark", terminal: darkTerminal(t.colors) };
}

// ── Light palette ────────────────────────────────────────────────────
//
// Warm paper tones rather than white, so the screen doesn't glare in
// daylight. Accents are deepened versions of the badwolf hues (same
// roles, same colour families) so they hold contrast against cream as
// text, not just as fills.

const daylightColors: ColorsConfig = {
  bgPrimary: "#f5efe3",
  bgSecondary: "#ede6d7",
  bgTertiary: "#e5ddcb",
  bgHover: "#ddd4c0",
  bgSelected: "#d6ccb6",
  textPrimary: "#2a2520",
  textSecondary: "#4d453c",
  textMuted: "#6f665a",
  accentBlue: "#1b5f9c",
  accentGreen: "#436810",
  accentOrange: "#9c500a",
  accentYellow: "#7a5f00",
  accentPurple: "#a03a74",
  accentRed: "#bc2d3c",
  accentCyan: "#0f6a62",
  borderColor: "#d5cbb7",
  borderFocus: "#436810",
  scrollbarBg: "#f5efe3",
  scrollbarThumb: "#d0c5ae",
  scrollbarThumbHover: "#a2968a",
};

// Light-terminal convention: "black" is the dark ink colour and "white" a
// pale tone, so programs that print white-on-default stay faintly visible
// instead of vanishing, and black text reads as ordinary foreground.
const daylightTerminal: TerminalPalette = {
  cursor: "#436810",
  selectionBackground: "#d9cdb0",
  black: "#2a2520",
  red: "#bc2d3c",
  green: "#436810",
  yellow: "#7a5f00",
  blue: "#1b5f9c",
  magenta: "#a03a74",
  cyan: "#0f6a62",
  white: "#c9bfab",
  brightBlack: "#6f665a",
  brightRed: "#d23f4d",
  brightGreen: "#4f7d14",
  brightYellow: "#9c500a",
  brightBlue: "#2470b3",
  brightMagenta: "#b84d8a",
  brightCyan: "#137d72",
  brightWhite: "#e5ddcb",
};

// ── Theme definitions ────────────────────────────────────────────────

export const themes: Theme[] = [
  darkTheme({
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
  }),
  darkTheme({
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
  }),
  darkTheme({
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
  }),
  darkTheme({
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
  }),
  darkTheme({
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
  }),
  {
    id: "daylight",
    name: "Daylight",
    description: "Soft cream for bright rooms and outdoors",
    mode: "light",
    colors: daylightColors,
    terminal: daylightTerminal,
  },
];

// ── Theme lookup ─────────────────────────────────────────────────────

export function getThemeById(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}

/** The active theme, falling back to the default when the saved id is unknown. */
export function getActiveTheme(): Theme {
  return getThemeById(getSavedThemeId()) ?? getThemeById(DEFAULT_THEME_ID)!;
}

/**
 * Build an xterm.js theme from the active CADE theme, so terminals switch
 * palette (including ANSI colors) along with the rest of the UI.
 */
/**
 * The least contrast terminal text is drawn with, as a ratio against its
 * background. Programs choose their own colours, and most choose them for a
 * dark terminal: on a light theme those arrive as pale text on a pale page.
 * The terminal darkens any foreground that falls short, keeping its hue, so
 * such text stays the colour it was meant to be and becomes readable. The
 * figure is the one accessibility guidance gives for body text.
 */
export const LIGHT_MIN_CONTRAST = 4.5;

/** What the terminal should enforce under the active theme; 1 enforces nothing. */
export function terminalMinimumContrast(): number {
  // Dark themes are what programs' colours are chosen for; leave them be.
  return getActiveTheme().mode === "light" ? LIGHT_MIN_CONTRAST : 1;
}

export function buildXtermTheme(): Record<string, string> {
  const theme = getActiveTheme();
  return {
    ...theme.terminal,
    background: theme.colors.bgPrimary,
    foreground: theme.colors.textPrimary,
    cursorAccent: theme.colors.bgPrimary,
  };
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
export function onThemeChange(fn: ThemeChangeListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
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

  // Lets stylesheets swap things CSS variables can't express (the
  // highlight.js token palette) and tells the browser to draw native
  // controls and scrollbars for the right background.
  const root = document.documentElement;
  root.dataset.themeMode = theme.mode;
  root.style.colorScheme = theme.mode;

  for (const fn of listeners) {
    fn(themeId);
  }
}

/**
 * Apply the saved theme (or default) on startup.
 * Call this early, before the WebSocket config arrives.
 */
export function applySavedTheme(): void {
  // Resolve through getActiveTheme so a stale or removed saved id falls back
  // to the default here too; otherwise the CSS keeps its built-in palette
  // while terminals and diagrams follow the default theme.
  applyTheme(getActiveTheme().id);
}
