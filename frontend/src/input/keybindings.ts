/**
 * Central keyboard shortcut manager.
 *
 * Implements a tmux-like prefix key system (Ctrl-a) for global shortcuts
 * while delegating pane-specific keys to focused components.
 */

import type { Component } from "../types";
import {
  getUserConfig,
  matchesKeybinding,
  parseKeybinding,
  type KeybindingsConfig,
} from "../config/user-config";

export type PaneType = "file-tree" | "terminal" | "viewer" | "chat";

/**
 * Determine whether a keydown event should be delegated to the focused pane's
 * key handler. Returns false when xterm.js should handle the event natively
 * (terminal pane or active Neovim in the viewer pane).
 */
export function shouldDelegateToPaneHandler(
  target: { classList: DOMTokenList; closest(selector: string): Element | null },
  focusedPane: PaneType | undefined,
): boolean {
  if (focusedPane == null || focusedPane === "terminal") return false;
  if (focusedPane === "chat") return true;

  const isXtermTextarea = target.classList.contains("xterm-helper-textarea");

  // If the target is a terminal-pane xterm, let it handle input natively even
  // when focusedPane is desynced (e.g. user clicked terminal without prefix key)
  if (isXtermTextarea && target.closest(".terminal-pane") != null) return false;

  const isNeovimXterm = isXtermTextarea && target.closest(".right-pane-neovim") != null;
  return !isNeovimXterm;
}

export interface KeybindingCallbacks {
  focusPane: (direction: "left" | "right") => void;
  resizePane: (direction: "left" | "right") => void;
  nextTab: () => void;
  previousTab: () => void;
  goToTab: (index: number) => void;
  createTab: () => void;
  createRemoteTab: () => void;
  closeTab: () => void;
  showHelp: () => void;
  toggleTerminal: () => void;
  toggleViewerCycle: () => void;

  viewLatestPlan: () => void;
  scrollTerminalToTop: () => void;
  scrollTerminalToBottom: () => void;
  cycleAgentNext: () => void;
  cycleAgentPrev: () => void;
  toggleEnhanced: () => void;
  cycleModeNext: () => void;
  cycleModePrev: () => void;
  approveAgent: () => void;
  rejectAgent: () => void;
  showThemeSelector: () => void;
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
  private boundHandleKeyup: (e: KeyboardEvent) => void;
  private prefixKeyHeld = false;
  private prefixUsedWhileHeld = false;

  constructor() {
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.boundHandleKeyup = this.handleKeyup.bind(this);
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
    document.addEventListener("keyup", this.boundHandleKeyup, true);
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

    // Prefix key (always intercept, even in terminal and chat input)
    if (this.isPrefixKey(e)) {
      // Don't intercept in input elements, unless they opt in via data attribute
      if (isInput && !target.dataset.kbPrefix) {
        return;
      }
      this.prefixKeyHeld = true;
      this.prefixUsedWhileHeld = false;
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

    // Don't delegate to pane handlers when a full-screen overlay is open
    if (document.querySelector(".remote-project-selector, .theme-selector-overlay, .help-overlay, .diagram-viewer-overlay")) {
      return;
    }

    const focusedPane = this.callbacks?.getFocusedPane();
    const shouldDelegate = shouldDelegateToPaneHandler(target, focusedPane);
    console.log(`[keybindings] key=${e.key}, focusedPane=${focusedPane}, target=${target.className}, shouldDelegate=${shouldDelegate}`);
    if (shouldDelegate) {
      const handler = this.callbacks?.getPaneHandler(focusedPane!);
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
   * When prefix key is held, Ctrl modifier is ignored (it comes from the held prefix).
   */
  private matchesBinding(e: KeyboardEvent, binding: string): boolean {
    const parsed = parseKeybinding(binding);

    // When prefix key is held, ignore Ctrl (it's from the prefix, not the shortcut)
    const effectiveCtrl = this.prefixKeyHeld ? false : e.ctrlKey;

    // For shift: only enforce if binding explicitly uses S- prefix.
    // Characters like ?, G, ! inherently require shift to type, so we
    // shouldn't require shiftKey to match for single-character bindings.
    const shiftMatches = parsed.shift ? e.shiftKey : true;

    const matches = (
      effectiveCtrl === parsed.ctrl &&
      e.altKey === parsed.alt &&
      shiftMatches &&
      e.metaKey === parsed.meta &&
      e.key === parsed.key
    );

    if (binding === "C" || binding === "c") {
      console.log("[CADE] matchesBinding check:", {
        binding,
        eventKey: e.key,
        parsedKey: parsed.key,
        keyMatch: e.key === parsed.key,
        matches
      });
    }

    return matches;
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
    console.log("[keybindings] Prefix shortcut:", e.key, "ctrl:", e.ctrlKey, "alt:", e.altKey);

    // Pane resize: uses config pane.resizeLeft/resizeRight (default: A-h/A-l)
    if (this.matchesBinding(e, config.pane.resizeLeft)) {
      e.preventDefault();
      this.callbacks?.resizePane("left");
      this.onPrefixShortcutUsed();
      return;
    }
    if (this.matchesBinding(e, config.pane.resizeRight)) {
      e.preventDefault();
      this.callbacks?.resizePane("right");
      this.onPrefixShortcutUsed();
      return;
    }

    // Don't process simple keys if Ctrl is still held (except when prefix key is held)
    if (e.ctrlKey && !this.prefixKeyHeld) {
      this.onPrefixShortcutUsed();
      return;
    }

    e.preventDefault();

    // Navigation: scroll to top/bottom (works in terminal with prefix)
    const nav = config.navigation;
    if (this.matchesBinding(e, nav.scrollToTop)) {
      this.callbacks?.scrollTerminalToTop();
      this.onPrefixShortcutUsed();
      return;
    }
    if (this.matchesBinding(e, nav.scrollToBottom)) {
      this.callbacks?.scrollTerminalToBottom();
      this.onPrefixShortcutUsed();
      return;
    }

    // Pane focus: uses config pane.focusLeft/focusRight (default: h/l)
    // Also support arrow keys as aliases
    if (
      this.matchesBinding(e, config.pane.focusLeft) ||
      e.key === "ArrowLeft"
    ) {
      this.callbacks?.focusPane("left");
      this.onPrefixShortcutUsed();
      return;
    }
    if (
      this.matchesBinding(e, config.pane.focusRight) ||
      e.key === "ArrowRight"
    ) {
      this.callbacks?.focusPane("right");
      this.onPrefixShortcutUsed();
      return;
    }

    // Tab navigation: uses config tab.previous/next (default: r/t)
    if (this.matchesBinding(e, config.tab.previous)) {
      this.callbacks?.previousTab();
      this.onPrefixShortcutUsed();
      return;
    }
    if (this.matchesBinding(e, config.tab.next)) {
      this.callbacks?.nextTab();
      this.onPrefixShortcutUsed();
      return;
    }

    // Tab create/close: uses config tab.create/createRemote/close (default: c/C/x)
    if (this.matchesBinding(e, config.tab.create)) {
      this.callbacks?.createTab();
      this.onPrefixShortcutUsed();
      return;
    }
    if (this.matchesBinding(e, config.tab.createRemote)) {
      console.log("[CADE] createRemote binding matched! Calling callback");
      this.callbacks?.createRemoteTab();
      this.onPrefixShortcutUsed();
      return;
    }
    console.log("[CADE] createRemote binding check - key:", e.key, "expected:", config.tab.createRemote, "matched:", this.matchesBinding(e, config.tab.createRemote));
    if (this.matchesBinding(e, config.tab.close)) {
      this.callbacks?.closeTab();
      this.onPrefixShortcutUsed();
      return;
    }

    // Help: uses config misc.help (default: ?)
    if (this.matchesBinding(e, config.misc.help)) {
      this.callbacks?.showHelp();
      this.onPrefixShortcutUsed();
      return;
    }

    // Terminal toggle: uses config misc.toggleTerminal (default: s)
    if (this.matchesBinding(e, config.misc.toggleTerminal)) {
      this.callbacks?.toggleTerminal();
      this.onPrefixShortcutUsed();
      return;
    }

    // Viewer toggle: uses config misc.toggleViewer (default: v)
    if (this.matchesBinding(e, config.misc.toggleViewer)) {
      this.callbacks?.toggleViewerCycle();
      this.onPrefixShortcutUsed();
      return;
    }

    // Enhanced mode toggle: uses config misc.toggleEnhanced (default: e)
    if (this.matchesBinding(e, config.misc.toggleEnhanced)) {
      this.callbacks?.toggleEnhanced();
      this.onPrefixShortcutUsed();
      return;
    }

    // Agent cycling: ] for next, [ for previous
    if (this.matchesBinding(e, config.misc.cycleAgentNext)) {
      this.callbacks?.cycleAgentNext();
      this.onPrefixShortcutUsed();
      return;
    }
    if (this.matchesBinding(e, config.misc.cycleAgentPrev)) {
      this.callbacks?.cycleAgentPrev();
      this.onPrefixShortcutUsed();
      return;
    }

    // Mode cycling: prefix + m/M
    if (this.matchesBinding(e, config.misc.cycleModeNext)) {
      this.callbacks?.cycleModeNext();
      this.onPrefixShortcutUsed();
      return;
    }
    if (this.matchesBinding(e, config.misc.cycleModePrev)) {
      this.callbacks?.cycleModePrev();
      this.onPrefixShortcutUsed();
      return;
    }

    // Agent approval: prefix + y/n
    if (this.matchesBinding(e, config.misc.approveAgent)) {
      this.callbacks?.approveAgent();
      this.onPrefixShortcutUsed();
      return;
    }
    if (this.matchesBinding(e, config.misc.rejectAgent)) {
      this.callbacks?.rejectAgent();
      this.onPrefixShortcutUsed();
      return;
    }

    // Theme selector: prefix + t
    if (e.key === "t") {
      this.callbacks?.showThemeSelector();
      this.onPrefixShortcutUsed();
      return;
    }

    // Tab direct access: 1-9 for tabs 1-9, 0 for tab 10
    // (1-indexed for ergonomics: key "1" = first tab)
    if (/^[1-9]$/.test(e.key)) {
      this.callbacks?.goToTab(parseInt(e.key, 10) - 1);
      this.onPrefixShortcutUsed();
      return;
    }
    if (e.key === "0") {
      this.callbacks?.goToTab(9); // Tab 10
      this.onPrefixShortcutUsed();
      return;
    }

    // No match - still deactivate prefix for tap flow
    this.onPrefixShortcutUsed();
  }

  /**
   * Called after a prefix shortcut is used.
   * Tracks usage for hold mode and deactivates for tap mode.
   */
  private onPrefixShortcutUsed(): void {
    if (this.prefixKeyHeld) {
      // Hold mode: allow more shortcuts while held
      this.prefixUsedWhileHeld = true;
    } else {
      // Tap flow: one shortcut only
      this.deactivatePrefix();
    }
  }

  /**
   * Handle keyup events (for prefix key release).
   */
  private handleKeyup(e: KeyboardEvent): void {
    if (this.isPrefixKeyRelease(e)) {
      this.prefixKeyHeld = false;
      if (this.prefixUsedWhileHeld) {
        // User used shortcuts while holding - immediately deactivate
        this.deactivatePrefix();
      }
      // If not used while held, timeout handles deactivation (tap-then-shortcut flow)
    }
  }

  /**
   * Check if a keyup event is for the prefix key.
   */
  private isPrefixKeyRelease(e: KeyboardEvent): boolean {
    const prefix = this.getConfig().global.prefix;
    const parsed = parseKeybinding(prefix);
    // For keyup, we check if the released key matches the prefix key character
    // The modifiers may or may not be present depending on release order
    // Use case-insensitive comparison for the prefix key
    return e.key.toLowerCase() === parsed.key.toLowerCase();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    document.removeEventListener("keydown", this.boundHandleKeydown, true);
    document.removeEventListener("keyup", this.boundHandleKeyup, true);
    this.clearPrefixTimeout();
  }
}
