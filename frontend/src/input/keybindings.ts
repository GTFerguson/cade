/**
 * Central keyboard shortcut manager.
 *
 * Implements a tmux-like prefix key system (Ctrl-a) for global shortcuts
 * while delegating pane-specific keys to focused components.
 */

import type { Component } from "../types";
import {
  getUserConfig,
  type KeybindingsConfig,
} from "../config/user-config";
import { matchesKeybinding, parseKeybinding } from "@core/input/bindings";
import { PrefixController } from "@core/input/prefix-controller";

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
  toggleDashboard: () => void;

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
  focusChatInput: () => void;
  getFocusedPane: () => PaneType;
  getPaneHandler: (pane: PaneType) => PaneKeyHandler | null;
}

export interface PaneKeyHandler {
  handleKeydown(e: KeyboardEvent): boolean;
}

export class KeybindingManager implements Component {
  private callbacks: KeybindingCallbacks | null = null;
  private boundHandleKeydown: (e: KeyboardEvent) => void;
  private boundHandleKeyup: (e: KeyboardEvent) => void;
  private readonly prefix: PrefixController;

  constructor() {
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.boundHandleKeyup = this.handleKeyup.bind(this);
    this.prefix = new PrefixController({
      getTimeout: () => this.getPrefixTimeout(),
      onChange: (active) => {
        if (active) {
          console.log("[keybindings] Prefix mode activated");
        }
      },
    });
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
    return this.prefix.isActive();
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
      this.prefix.keyHeld();
      this.prefix.activate();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // If prefix active, handle global shortcuts
    if (this.prefix.isActive()) {
      this.handlePrefixShortcut(e);
      e.stopPropagation();
      return;
    }

    // Alt shortcuts: tab management + dashboard (no prefix needed)
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const key = e.key.toLowerCase();

      // Alt+1-9: jump to tab by number
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        this.callbacks?.goToTab(parseInt(e.key, 10) - 1);
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        this.callbacks?.goToTab(9);
        return;
      }

      // Alt+d/f: previous/next tab
      if (key === "d") {
        e.preventDefault();
        this.callbacks?.previousTab();
        return;
      }
      if (key === "f") {
        e.preventDefault();
        this.callbacks?.nextTab();
        return;
      }

      // Alt+t: new tab
      if (key === "t") {
        e.preventDefault();
        this.callbacks?.createTab();
        return;
      }

      // Alt+w: close tab
      if (key === "w") {
        e.preventDefault();
        this.callbacks?.closeTab();
        return;
      }

      // Alt+q: toggle dashboard
      if (key === "q") {
        e.preventDefault();
        this.callbacks?.toggleDashboard();
        return;
      }

      // Alt+h/l: focus pane left/right
      // Note: Alt+H may conflict with Firefox Help menu on Linux
      if (e.key === "h") {
        e.preventDefault();
        this.callbacks?.focusPane("left");
        return;
      }
      if (e.key === "l") {
        e.preventDefault();
        this.callbacks?.focusPane("right");
        return;
      }

      // Alt+H/L: resize pane left/right
      if (e.key === "H") {
        e.preventDefault();
        this.callbacks?.resizePane("left");
        return;
      }
      if (e.key === "L") {
        e.preventDefault();
        this.callbacks?.resizePane("right");
        return;
      }

      // Alt+s: toggle terminal
      if (key === "s") {
        e.preventDefault();
        this.callbacks?.toggleTerminal();
        return;
      }

      // Alt+v: toggle viewer
      // Note: Alt+V may conflict with Firefox View menu on Linux
      if (key === "v") {
        e.preventDefault();
        this.callbacks?.toggleViewerCycle();
        return;
      }

      // Alt+e: toggle enhanced mode
      // Note: Alt+E may conflict with Firefox Edit menu on Linux
      if (key === "e") {
        e.preventDefault();
        this.callbacks?.toggleEnhanced();
        return;
      }

      // Alt+[/]: cycle agent prev/next
      if (e.key === "[") {
        e.preventDefault();
        this.callbacks?.cycleAgentPrev();
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        this.callbacks?.cycleAgentNext();
        return;
      }

      // Alt+m/M: cycle mode next/prev
      if (e.key === "m") {
        e.preventDefault();
        this.callbacks?.cycleModeNext();
        return;
      }
      if (e.key === "M") {
        e.preventDefault();
        this.callbacks?.cycleModePrev();
        return;
      }

      // Alt+y/n: approve/reject agent
      if (key === "y") {
        e.preventDefault();
        this.callbacks?.approveAgent();
        return;
      }
      if (key === "n") {
        e.preventDefault();
        this.callbacks?.rejectAgent();
        return;
      }

      // Alt+r: create remote tab
      if (key === "r") {
        e.preventDefault();
        this.callbacks?.createRemoteTab();
        return;
      }

      // Alt+p: theme selector (palette)
      if (key === "p") {
        e.preventDefault();
        this.callbacks?.showThemeSelector();
        return;
      }

      // Alt+i: focus chat input from any pane
      if (key === "i") {
        e.preventDefault();
        this.callbacks?.focusChatInput();
        return;
      }
    }

    // Alt+navigation keys delegate to chat pane even when textarea is focused
    if (e.altKey && !e.ctrlKey && !e.metaKey && isInput) {
      const altNavKeys = ["j", "k", "g", "G", "PageUp", "PageDown"];
      if (altNavKeys.includes(e.key)) {
        const focusedPane = this.callbacks?.getFocusedPane();
        if (focusedPane === "chat") {
          const handler = this.callbacks?.getPaneHandler("chat");
          if (handler?.handleKeydown(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
        return;
      }
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
   * Check if a key matches a configured binding (for use after prefix).
   * When prefix key is held, Ctrl modifier is ignored (it comes from the
   * held prefix) — delegated to core's matchesKeybinding via ignoreCtrl.
   */
  private matchesBinding(e: KeyboardEvent, binding: string): boolean {
    return matchesKeybinding(e, binding, {
      ignoreCtrl: this.prefix.isKeyHeld(),
    });
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
    if (e.ctrlKey && !this.prefix.isKeyHeld()) {
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
   */
  private onPrefixShortcutUsed(): void {
    this.prefix.notifyShortcutUsed();
  }

  /**
   * Handle keyup events (for prefix key release).
   */
  private handleKeyup(e: KeyboardEvent): void {
    if (this.isPrefixKeyRelease(e)) {
      this.prefix.keyReleased();
    }
  }

  /**
   * Check if a keyup event is for the prefix key. We match on the key
   * character alone (case-insensitive) because modifier release order is
   * not guaranteed and the user may have already lifted Ctrl before the
   * character key.
   */
  private isPrefixKeyRelease(e: KeyboardEvent): boolean {
    const prefix = this.getConfig().global.prefix;
    const parsed = parseKeybinding(prefix);
    return e.key.toLowerCase() === parsed.key.toLowerCase();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    document.removeEventListener("keydown", this.boundHandleKeydown, true);
    document.removeEventListener("keyup", this.boundHandleKeyup, true);
    this.prefix.dispose();
  }
}
