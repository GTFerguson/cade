/**
 * Turning a terminal title into a tab name.
 *
 * Claude Code and Codex set the terminal title (OSC 0/2) to a short name for
 * the session they are running, and keep it current as the work changes. A
 * tab the user has not named follows that title, so several tabs on the same
 * project can be told apart by what each agent is doing.
 */

import type { TabInfo } from "./types";

const MAX_TITLE_LENGTH = 60;

// A shell's own title: "user@host: ~/dir", or a bare path.
const SHELL_PROMPT_TITLE = /^[\w.-]+@[\w.-]+\s*:/;
const PATH_TITLE = /^(~|\/|[A-Za-z]:\\)/;

// Titles that only name the program say less than the project folder does.
const PROGRAM_NAMES = new Set([
  "claude", "claude code", "codex", "codex cli", "openai codex",
  "bash", "zsh", "fish", "sh", "tmux", "terminal",
]);

/**
 * The session name carried by a terminal title, or null when the title is
 * not one (a shell prompt, a path, a bare program name, or empty).
 */
export function sessionTitleFromTerminal(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || SHELL_PROMPT_TITLE.test(trimmed) || PATH_TITLE.test(trimmed)) return null;
  // Agents prefix the title with a status glyph or an animated spinner frame;
  // dropping it also keeps the tab from redrawing on every frame.
  const title = trimmed.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!title || PROGRAM_NAMES.has(title.toLowerCase())) return null;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

/**
 * What a tab is called on screen: the user's own name if they gave one,
 * else the agent's session title, else the project folder.
 */
export function tabDisplayName(tab: Pick<TabInfo, "name" | "customName" | "agentTitle">): string {
  if (tab.customName) return tab.name;
  return tab.agentTitle || tab.name;
}
