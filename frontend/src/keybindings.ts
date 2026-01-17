/**
 * Central keyboard shortcut manager.
 *
 * Implements a tmux-like prefix key system (Ctrl-a) for global shortcuts
 * while delegating pane-specific keys to focused components.
 */

import type { Component } from "./types";

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
  getFocusedPane: () => PaneType;
  getPaneHandler: (pane: PaneType) => PaneKeyHandler | null;
}

export interface PaneKeyHandler {
  handleKeydown(e: KeyboardEvent): boolean;
}

const PREFIX_TIMEOUT = 1500;

export class KeybindingManager implements Component {
  private prefixActive = false;
  private prefixTimeout: number | null = null;
  private callbacks: KeybindingCallbacks | null = null;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor() {
    this.boundHandleKeydown = this.handleKeydown.bind(this);
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

    // Prefix key: Ctrl-a (always intercept, even in terminal)
    if (e.ctrlKey && e.key === "a" && !e.shiftKey && !e.altKey && !e.metaKey) {
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
    }, PREFIX_TIMEOUT);
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
   * Handle shortcuts after prefix key.
   */
  private handlePrefixShortcut(e: KeyboardEvent): void {
    // Ignore modifier-only keypresses (Shift, Ctrl, etc.) - user may need them for the actual shortcut
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
      return;
    }

    console.log("[keybindings] Prefix shortcut:", e.key, "ctrl:", e.ctrlKey);
    // Always deactivate prefix after handling
    this.deactivatePrefix();

    // Pane resize: prefix + Ctrl-h/l
    if (e.ctrlKey && (e.key === "h" || e.key === "l")) {
      e.preventDefault();
      this.callbacks?.resizePane(e.key === "h" ? "left" : "right");
      return;
    }

    // Don't process if Ctrl is still held (except for resize above)
    if (e.ctrlKey) {
      return;
    }

    e.preventDefault();

    switch (e.key) {
      // Pane focus: prefix + f/g/h/l/arrows
      case "f":
      case "h":
      case "ArrowLeft":
        this.callbacks?.focusPane("left");
        break;
      case "g":
      case "l":
      case "ArrowRight":
        this.callbacks?.focusPane("right");
        break;

      // Tab navigation: prefix + r/t
      case "r":
        this.callbacks?.previousTab();
        break;
      case "t":
        this.callbacks?.nextTab();
        break;

      // Tab direct access: prefix + 0-9
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        this.callbacks?.goToTab(parseInt(e.key, 10));
        break;

      // Tab create/close: prefix + c/x
      case "c":
        this.callbacks?.createTab();
        break;
      case "x":
        this.callbacks?.closeTab();
        break;

      // Help: prefix + ?
      case "?":
        this.callbacks?.showHelp();
        break;

      // Terminal toggle: prefix + s
      case "s":
        this.callbacks?.toggleTerminal();
        break;
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
