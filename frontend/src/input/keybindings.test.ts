/**
 * @vitest-environment node
 *
 * Tests for keybinding pane delegation routing.
 *
 * Regression: the original guard used `!isXtermTextarea` which blocked ALL
 * xterm textareas (including the main terminal's) from pane delegation.
 * The fix narrows this to only skip delegation for Neovim's xterm textarea
 * (inside `.right-pane-neovim`), so the main terminal's textarea no longer
 * prevents file-tree/viewer keybindings from working.
 */

import { describe, it, expect } from "vitest";
import { shouldDelegateToPaneHandler } from "./keybindings";

// Minimal mock that satisfies the target parameter shape
function fakeTarget(opts: {
  isXtermTextarea?: boolean;
  insideNeovimPane?: boolean;
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

  // --- Main terminal's xterm textarea (the bug scenario) ---

  it("delegates when main terminal xterm textarea has focus but file-tree is focused", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideNeovimPane: false });
    expect(shouldDelegateToPaneHandler(target, "file-tree")).toBe(true);
  });

  it("delegates when main terminal xterm textarea has focus but viewer is focused", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideNeovimPane: false });
    expect(shouldDelegateToPaneHandler(target, "viewer")).toBe(true);
  });

  it("does NOT delegate main terminal xterm textarea when terminal is focused", () => {
    const target = fakeTarget({ isXtermTextarea: true, insideNeovimPane: false });
    expect(shouldDelegateToPaneHandler(target, "terminal")).toBe(false);
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

  // --- Regression: the exact bug scenario ---

  it("REGRESSION: after Neovim exit, switching to file-tree still allows delegation", () => {
    // User exits Neovim → focus returns to main terminal textarea →
    // user presses prefix+h to switch to file-tree → presses j/k.
    // The main terminal textarea still has browser focus, but the
    // logical focused pane is "file-tree". Delegation MUST happen.
    const mainTerminalTextarea = fakeTarget({ isXtermTextarea: true, insideNeovimPane: false });
    expect(shouldDelegateToPaneHandler(mainTerminalTextarea, "file-tree")).toBe(true);
  });

  it("REGRESSION: Neovim xterm textarea must NOT be intercepted during editing", () => {
    // User is actively editing in Neovim. The xterm textarea inside
    // .right-pane-neovim has focus. Delegation must be skipped so
    // xterm.js forwards keystrokes to Neovim via its onData handler.
    const neovimTextarea = fakeTarget({ isXtermTextarea: true, insideNeovimPane: true });
    expect(shouldDelegateToPaneHandler(neovimTextarea, "viewer")).toBe(false);
  });
});
