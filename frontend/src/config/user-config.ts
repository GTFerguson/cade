/**
 * User configuration types and CSS variable injection.
 *
 * Mirrors backend/user_config.py structure for TypeScript.
 */

/**
 * Color theme configuration.
 */
export interface ColorsConfig {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  bgSelected: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  accentBlue: string;
  accentGreen: string;
  accentOrange: string;
  accentYellow: string;
  accentPurple: string;
  accentRed: string;
  accentCyan: string;

  borderColor: string;
  borderFocus: string;

  scrollbarBg: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
}

/**
 * Font configuration.
 */
export interface FontsConfig {
  mono: string;
  monoSize: string;
  sans: string;
}

/**
 * Terminal appearance configuration.
 */
export interface TerminalAppearanceConfig {
  fontSize: string;
  scrollback: number;
}

/**
 * Appearance configuration.
 */
export interface AppearanceConfig {
  colors: ColorsConfig;
  fonts: FontsConfig;
  terminal: TerminalAppearanceConfig;
}

/**
 * Global keybinding configuration.
 */
export interface GlobalKeybindingsConfig {
  prefix: string;
  prefixTimeout: number;
}

/**
 * Pane navigation keybindings.
 */
export interface PaneKeybindingsConfig {
  focusLeft: string;
  focusRight: string;
  resizeLeft: string;
  resizeRight: string;
}

/**
 * Tab keybindings.
 */
export interface TabKeybindingsConfig {
  next: string;
  previous: string;
  create: string;
  createRemote: string;
  close: string;
}

/**
 * Miscellaneous keybindings.
 */
export interface MiscKeybindingsConfig {
  help: string;
  toggleTerminal: string;
  toggleViewer: string;
  toggleEnhanced: string;

  cycleAgentNext: string;
  cycleAgentPrev: string;
}

/**
 * Navigation keybindings (shared across all panes).
 */
export interface NavigationKeybindingsConfig {
  scrollToTop: string;
  scrollToBottom: string;
}

/**
 * Keybindings configuration.
 */
export interface KeybindingsConfig {
  global: GlobalKeybindingsConfig;
  pane: PaneKeybindingsConfig;
  tab: TabKeybindingsConfig;
  misc: MiscKeybindingsConfig;
  navigation: NavigationKeybindingsConfig;
}

/**
 * Session behavior configuration.
 */
export interface SessionBehaviorConfig {
  autoStartClaude: boolean;
  autoSave: boolean;
  saveInterval: number;
}

/**
 * File tree behavior configuration.
 */
export interface FileTreeBehaviorConfig {
  showHidden: boolean;
  defaultExpandDepth: number;
}

/**
 * Layout behavior configuration.
 */
export interface LayoutBehaviorConfig {
  fileTree: number;
  terminal: number;
  viewer: number;
}

/**
 * Splash screen behavior configuration.
 */
export interface SplashBehaviorConfig {
  mode: "auto" | "always" | "never";
  idleThreshold: number;
  healthCheckTimeout: number;
}

/**
 * Behavior configuration.
 */
export interface BehaviorConfig {
  session: SessionBehaviorConfig;
  fileTree: FileTreeBehaviorConfig;
  layout: LayoutBehaviorConfig;
  splash: SplashBehaviorConfig;
}

/**
 * Complete user configuration.
 */
export interface UserConfig {
  appearance: AppearanceConfig;
  keybindings: KeybindingsConfig;
  behavior: BehaviorConfig;
}

/**
 * Default user configuration values.
 */
export const defaultUserConfig: UserConfig = {
  appearance: {
    colors: {
      bgPrimary: "#0a0a09",
      bgSecondary: "#111110",
      bgTertiary: "#1a1918",
      bgHover: "#222120",
      bgSelected: "#222120",
      textPrimary: "#f8f6f2",
      textSecondary: "#c4b9ad",
      textMuted: "#5e5955",
      accentBlue: "#0a9dff",
      accentGreen: "#aeee00",
      accentOrange: "#ffa724",
      accentYellow: "#fade3e",
      accentPurple: "#ff9eb8",
      accentRed: "#ff2c4b",
      accentCyan: "#8cffba",
      borderColor: "#2a2827",
      borderFocus: "#aeee00",
      scrollbarBg: "#0a0a09",
      scrollbarThumb: "#2a2827",
      scrollbarThumbHover: "#5e5955",
    },
    fonts: {
      mono: "JetBrains Mono",
      monoSize: "14px",
      sans: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
    },
    terminal: {
      fontSize: "14px",
      scrollback: 10000,
    },
  },
  keybindings: {
    global: {
      prefix: "C-a",
      prefixTimeout: 1500,
    },
    pane: {
      focusLeft: "h",
      focusRight: "l",
      resizeLeft: "A-h",
      resizeRight: "A-l",
    },
    tab: {
      next: "f",
      previous: "d",
      create: "c",
      createRemote: "C",
      close: "x",
    },
    misc: {
      help: "?",
      toggleTerminal: "s",
      toggleViewer: "v",
      toggleEnhanced: "e",

      cycleAgentNext: "]",
      cycleAgentPrev: "[",
    },
    navigation: {
      scrollToTop: "g",
      scrollToBottom: "G",
    },
  },
  behavior: {
    session: {
      autoStartClaude: true,
      autoSave: true,
      saveInterval: 300,
    },
    fileTree: {
      showHidden: false,
      defaultExpandDepth: 1,
    },
    layout: {
      fileTree: 0.2,
      terminal: 0.5,
      viewer: 0.3,
    },
    splash: {
      mode: "auto",
      idleThreshold: 1800,
      healthCheckTimeout: 3,
    },
  },
};

/**
 * Current active user configuration.
 */
let currentConfig: UserConfig = defaultUserConfig;

/**
 * Get the current user configuration.
 */
export function getUserConfig(): UserConfig {
  return currentConfig;
}

/**
 * Deep merge: overlay values from source onto target, preserving
 * any keys in target that source doesn't provide.
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = (target as Record<string, any>)[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      (result as Record<string, any>)[key] = deepMerge(tgtVal, srcVal);
    } else {
      (result as Record<string, any>)[key] = srcVal;
    }
  }
  return result;
}

/**
 * Set the user configuration.
 * Merges with defaults so missing fields from the server don't break things.
 */
export function setUserConfig(config: UserConfig): void {
  currentConfig = deepMerge(defaultUserConfig, config);
  applyAppearanceConfig(currentConfig.appearance);
}

/**
 * Apply appearance configuration by updating CSS variables.
 */
export function applyAppearanceConfig(appearance: AppearanceConfig): void {
  const root = document.documentElement;

  // Apply color variables
  const colors = appearance.colors;
  root.style.setProperty("--bg-primary", colors.bgPrimary);
  root.style.setProperty("--bg-secondary", colors.bgSecondary);
  root.style.setProperty("--bg-tertiary", colors.bgTertiary);
  root.style.setProperty("--bg-hover", colors.bgHover);
  root.style.setProperty("--bg-selected", colors.bgSelected);

  root.style.setProperty("--text-primary", colors.textPrimary);
  root.style.setProperty("--text-secondary", colors.textSecondary);
  root.style.setProperty("--text-muted", colors.textMuted);

  root.style.setProperty("--accent-blue", colors.accentBlue);
  root.style.setProperty("--accent-green", colors.accentGreen);
  root.style.setProperty("--accent-orange", colors.accentOrange);
  root.style.setProperty("--accent-yellow", colors.accentYellow);
  root.style.setProperty("--accent-purple", colors.accentPurple);
  root.style.setProperty("--accent-red", colors.accentRed);
  root.style.setProperty("--accent-cyan", colors.accentCyan);

  root.style.setProperty("--border-color", colors.borderColor);
  root.style.setProperty("--border-focus", colors.borderFocus);

  root.style.setProperty("--scrollbar-bg", colors.scrollbarBg);
  root.style.setProperty("--scrollbar-thumb", colors.scrollbarThumb);
  root.style.setProperty("--scrollbar-thumb-hover", colors.scrollbarThumbHover);

  // Apply font variables
  const fonts = appearance.fonts;
  const monoFontStack = `"${fonts.mono}", "Fira Code", Consolas, monospace`;
  root.style.setProperty("--font-mono", monoFontStack);
  root.style.setProperty("--font-sans", fonts.sans);

  console.log("[user-config] Applied appearance configuration");
}

/**
 * Parse a keybinding string like "C-a" or "C-h" into its components.
 */
export function parseKeybinding(binding: string): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
} {
  const result = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: "",
  };

  const parts = binding.split("-");

  for (let i = 0; i < parts.length - 1; i++) {
    const modifier = parts[i]?.toUpperCase();
    switch (modifier) {
      case "C":
        result.ctrl = true;
        break;
      case "A":
        result.alt = true;
        break;
      case "S":
        result.shift = true;
        break;
      case "M":
        result.meta = true;
        break;
    }
  }

  const lastPart = parts[parts.length - 1];
  // Keep original case - don't lowercase
  result.key = lastPart ?? "";

  return result;
}

/**
 * Check if a keyboard event matches a keybinding string.
 */
export function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  const parsed = parseKeybinding(binding);

  // For shift: only enforce if binding explicitly uses S- prefix
  const shiftMatches = parsed.shift ? e.shiftKey : true;

  return (
    e.ctrlKey === parsed.ctrl &&
    e.altKey === parsed.alt &&
    shiftMatches &&
    e.metaKey === parsed.meta &&
    e.key === parsed.key
  );
}
