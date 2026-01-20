/**
 * Central keyboard shortcut manager.
 *
 * Implements a tmux-like prefix key system (Ctrl-a) for global shortcuts
 * while delegating pane-specific keys to focused components.
 */

import type { Component } from "./types";
import {
  getUserConfig,
  matchesKeybinding,
  parseKeybinding,
  type KeybindingsConfig,
} from "./user-config";

export type PaneType = "file-tree" | "terminal" | "viewer";

export interface KeybindingCallbacks {
  focusPane: (direction: "left" | "right") => void;
  resizePane: (direction: "left" | "right") => void;
  nextTab: () => void;
  previousTab: () => void;
  goToTab: (index: number) => void;
  createTab: () => void;
  closeTab: () => void;
  showHelp: () => void;
  toggleTerminal: () => void;
  viewLatestPlan: () => void;
  getFocusedPane: () => PaneType;
  getPaneHandler: (pane: PaneType) => PaneKeyHandler | null;
}

export interface PaneKeyHandler {
  handleKeydown(e: KeyboardEvent): boolean;
}

export class KeybindingManager implements Component {
  private prefixActive = false;
  private prefixTimeout: number | null = null;
  private callbacks: KeybindingCallbacks | null = null;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor() {
    this.boundHandleKeydown = this.handleKeydown.bind(this);
  }

  /**
   * Get the current keybindings configuration.
   */
  private getConfig(): KeybindingsConfig {
    return getUserConfig().keybindings;
  }

  /**
   * Get the prefix timeout from config.
   */
  private getPrefixTimeout(): number {
    return this.getConfig().global.prefixTimeout;
  }

  /**
   * Check if the given key event matches the configured prefix key.
   */
  private isPrefixKey(e: KeyboardEvent): boolean {
    const prefix = this.getConfig().global.prefix;
    return matchesKeybinding(e, prefix);
  }

  /**
   * Initialize the keybinding manager.
   */
  initialize(): void {
    console.log("[keybindings] Initializing...");
    // Use capture phase to intercept before xterm.js handles the event
    document.addEventListener("keydown", this.boundHandleKeydown, true);
    console.log("[keybindings] Event listener added");
  }

  /**
   * Set the callbacks for keybinding actions.
   */
  setCallbacks(callbacks: KeybindingCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Check if prefix mode is currently active.
   */
  isPrefixActive(): boolean {
    return this.prefixActive;
  }

  /**
   * Handle keydown events.
   */
  private handleKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;

    // xterm.js uses a hidden textarea for input - don't treat it as a regular input
    const isXtermTextarea = target.classList.contains("xterm-helper-textarea");
    const isInput =
      !isXtermTextarea &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);

    // Ctrl+g: View latest plan file (intercept before prefix check)
    if (e.ctrlKey && e.key === "g" && !isInput) {
      e.preventDefault();
      e.stopPropagation();
      this.callbacks?.viewLatestPlan();
      return;
    }

    // Prefix key (always intercept, even in terminal)
    if (this.isPrefixKey(e)) {
      // Don't intercept in actual input elements
      if (isInput) {
        return;
      }
      this.activatePrefix();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // If prefix active, handle global shortcuts
    if (this.prefixActive) {
      this.handlePrefixShortcut(e);
      e.stopPropagation();
      return;
    }

    // For non-prefix mode, don't intercept input elements
    if (isInput) {
      return;
    }

    // Delegate to focused pane handler (except terminal)
    const focusedPane = this.callbacks?.getFocusedPane();
    if (focusedPane && focusedPane !== "terminal") {
      const handler = this.callbacks?.getPaneHandler(focusedPane);
      if (handler?.handleKeydown(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  /**
   * Activate prefix mode with timeout.
   */
  private activatePrefix(): void {
    this.prefixActive = true;
    this.clearPrefixTimeout();
    console.log("[keybindings] Prefix mode activated");
    this.prefixTimeout = window.setTimeout(() => {
      this.deactivatePrefix();
    }, this.getPrefixTimeout());
  }

  /**
   * Deactivate prefix mode.
   */
  private deactivatePrefix(): void {
    this.prefixActive = false;
    this.clearPrefixTimeout();
  }

  /**
   * Clear the prefix timeout.
   */
  private clearPrefixTimeout(): void {
    if (this.prefixTimeout !== null) {
      window.clearTimeout(this.prefixTimeout);
      this.prefixTimeout = null;
    }
  }

  /**
   * Check if a key matches a configured binding (for use after prefix).
   * Binding format: "h" for simple key, "C-h" for Ctrl+h, etc.
   */
  private matchesBinding(e: KeyboardEvent, binding: string): boolean {
    const parsed = parseKeybinding(binding);

    // For post-prefix bindings, we match the key and modifiers
    return (
      e.ctrlKey === parsed.ctrl &&
      e.altKey === parsed.alt &&
      e.shiftKey === parsed.shift &&
      e.metaKey === parsed.meta &&
      e.key.toLowerCase() === parsed.key
    );
  }

  /**
   * Handle shortcuts after prefix key.
   */
  private handlePrefixShortcut(e: KeyboardEvent): void {
    // Ignore modifier-only keypresses (Shift, Ctrl, etc.) - user may need them for the actual shortcut
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
      return;
    }

    const config = this.getConfig();
    console.log("[keybindings] Prefix shortcut:", e.key, "ctrl:", e.ctrlKey);
    // Always deactivate prefix after handling
    this.deactivatePrefix();

    // Pane resize: uses config pane.resizeLeft/resizeRight (default: C-h/C-l)
    if (this.matchesBinding(e, config.pane.resizeLeft)) {
      e.preventDefault();
      this.callbacks?.resizePane("left");
      return;
    }
    if (this.matchesBinding(e, config.pane.resizeRight)) {
      e.preventDefault();
      this.callbacks?.resizePane("right");
      return;
    }

    // Don't process simple keys if Ctrl is still held (resize was already checked)
    if (e.ctrlKey) {
      return;
    }

    e.preventDefault();

    // Pane focus: uses config pane.focusLeft/focusRight (default: h/l)
    // Also support f/g and arrow keys as aliases
    if (
      this.matchesBinding(e, config.pane.focusLeft) ||
      e.key === "f" ||
      e.key === "ArrowLeft"
    ) {
      this.callbacks?.focusPane("left");
      return;
    }
    if (
      this.matchesBinding(e, config.pane.focusRight) ||
      e.key === "g" ||
      e.key === "ArrowRight"
    ) {
      this.callbacks?.focusPane("right");
      return;
    }

    // Tab navigation: uses config tab.previous/next (default: r/t)
    if (this.matchesBinding(e, config.tab.previous)) {
      this.callbacks?.previousTab();
      return;
    }
    if (this.matchesBinding(e, config.tab.next)) {
      this.callbacks?.nextTab();
      return;
    }

    // Tab create/close: uses config tab.create/close (default: c/x)
    if (this.matchesBinding(e, config.tab.create)) {
      this.callbacks?.createTab();
      return;
    }
    if (this.matchesBinding(e, config.tab.close)) {
      this.callbacks?.closeTab();
      return;
    }

    // Help: uses config misc.help (default: ?)
    if (this.matchesBinding(e, config.misc.help)) {
      this.callbacks?.showHelp();
      return;
    }

    // Terminal toggle: uses config misc.toggleTerminal (default: s)
    if (this.matchesBinding(e, config.misc.toggleTerminal)) {
      this.callbacks?.toggleTerminal();
      return;
    }

    // Tab direct access: 1-9 for tabs 1-9, 0 for tab 10
    // (1-indexed for ergonomics: key "1" = first tab)
    if (/^[1-9]$/.test(e.key)) {
      this.callbacks?.goToTab(parseInt(e.key, 10) - 1);
      return;
    }
    if (e.key === "0") {
      this.callbacks?.goToTab(9); // Tab 10
      return;
    }
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    document.removeEventListener("keydown", this.boundHandleKeydown, true);
    this.clearPrefixTimeout();
  }
}
