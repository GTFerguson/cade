/**
 * @vitest-environment node
 *
 * Tests for keybinding pane delegation routing.
 *
 * The guard skips delegation when:
 * - focusedPane is "terminal" or undefined
 * - the target is an xterm textarea inside .terminal-pane (prevents focus desync
 *   from routing terminal keystrokes to file-tree/viewer handlers)
 * - the target is an xterm textarea inside .right-pane-neovim (Neovim handles
 *   its own input via key forwarding)
 */

import { describe, it, expect } from "vitest";
import { shouldDelegateToPaneHandler } from "./keybindings";

// Minimal mock that satisfies the target parameter shape
function fakeTarget(opts: {
  isXtermTextarea?: boolean;
  insideNeovimPane?: boolean;
  insideTerminalPane?: boolean;
} = {}): { classList: DOMTokenList; closest(selector: string): Element | null } {
  const classSet = new Set(opts.isXtermTextarea ? ["xterm-helper-textarea"] : []);
  return {
    classList: {
      contains: (name: string) => classSet.has(name),
    } as DOMTokenList,
    closest: (selector: string) => {
      if (selector === ".right-pane-neovim" && opts.insideNeovimPane) {
        return {} as Element;
      }
      if (selector === ".terminal-pane" && opts.insideTerminalPane) {
        return {} as Element;
      }
      return null;
    },
  };
}

// ============================================================================
// shouldDelegateToPaneHandler
// ============================================================================

describe("shouldDelegateToPaneHandler", () => {
  // --- Normal elements (document.body, div, etc.) ---

  it("delegates when a normal element has focus and file-tree is focused", () => {
    expect(shouldDelegateToPaneHandler(fakeTarget(), "file-tree")).toBe(true);
  });

  it("delegates when a normal element has focus and viewer is focused", () => {
    expect(shouldDelegateToPaneHandler(fakeTarget(), "viewer")).toBe(true);
  });

  it("does NOT delegate when terminal pane is focused", () => {
    expect(shouldDelegateToPaneHandler(fakeTarget(), "terminal")).toBe(false);
  });

  it("does NOT delegate when focusedPane is undefined", () => {
    expect(shouldDelegateToPaneHandler(fakeTarget(), undefined)).toBe(false);
  });

  // --- Terminal-pane xterm textarea (focus desync fix) ---

  it("does NOT delegate terminal-pane xterm textarea even when file-tree is focused", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideTerminalPane: true });
    expect(shouldDelegateToPaneHandler(target, "file-tree")).toBe(false);
  });

  it("does NOT delegate terminal-pane xterm textarea even when viewer is focused", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideTerminalPane: true });
    expect(shouldDelegateToPaneHandler(target, "viewer")).toBe(false);
  });

  it("does NOT delegate terminal-pane xterm textarea when terminal is focused", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideTerminalPane: true });
    expect(shouldDelegateToPaneHandler(target, "terminal")).toBe(false);
  });

  // --- Non-terminal xterm textarea (e.g. agent pane outside terminal-pane) ---

  it("delegates non-terminal xterm textarea when file-tree is focused", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideTerminalPane: false });
    expect(shouldDelegateToPaneHandler(target, "file-tree")).toBe(true);
  });

  // --- Neovim's xterm textarea ---

  it("does NOT delegate when Neovim xterm textarea has focus (viewer focused)", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideNeovimPane: true });
    expect(shouldDelegateToPaneHandler(target, "viewer")).toBe(false);
  });

  it("does NOT delegate when Neovim xterm textarea has focus (file-tree focused)", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideNeovimPane: true });
    expect(shouldDelegateToPaneHandler(target, "file-tree")).toBe(false);
  });

  // --- Regression: focus desync scenario ---

  it("REGRESSION: terminal-pane xterm with desynced focusedPane must NOT delegate", () => {
    // User presses prefix+h to focus file-tree, then clicks on the terminal.
    // focusedPane is still "file-tree" but the xterm textarea in .terminal-pane
    // has DOM focus. Keys like j/k must NOT be routed to the file-tree handler.
    const terminalTextarea = fakeTarget({ isXtermTextarea: true, insideTerminalPane: true });
    expect(shouldDelegateToPaneHandler(terminalTextarea, "file-tree")).toBe(false);
  });

  it("REGRESSION: Neovim xterm textarea must NOT be intercepted during editing", () => {
    // User is actively editing in Neovim. The xterm textarea inside
    // .right-pane-neovim has focus. Delegation must be skipped so
    // xterm.js forwards keystrokes to Neovim via its onData handler.
    const neovimTextarea = fakeTarget({ isXtermTextarea: true, insideNeovimPane: true });
    expect(shouldDelegateToPaneHandler(neovimTextarea, "viewer")).toBe(false);
  });
});
