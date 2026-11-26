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

import { describe, it, expect, vi } from "vitest";
import { altShortcut, carryTabStep, shouldDelegateToPaneHandler, type KeybindingCallbacks } from "./keybindings";

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

describe("Alt shortcuts for tabs and workspaces", () => {
  const callbacks = () =>
    new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get: (seen, name: string) => (seen[name] ??= vi.fn()),
    });
  const press = (key: string) => {
    const cb = callbacks();
    altShortcut(key, cb as unknown as KeybindingCallbacks)?.();
    return cb;
  };

  it("moves to the next workspace on w and the previous on Shift+w", () => {
    expect(press("w")["nextWorkspace"]).toHaveBeenCalled();
    expect(press("W")["previousWorkspace"]).toHaveBeenCalled();
    expect(press("W")["nextWorkspace"]).not.toHaveBeenCalled();
  });

  it("closes the tab on x, not on w", () => {
    expect(press("x")["closeTab"]).toHaveBeenCalled();
    expect(press("w")["closeTab"]).not.toHaveBeenCalled();
  });

  it("leaves j and k to whatever has focus", () => {
    const cb = callbacks() as unknown as KeybindingCallbacks;
    expect(altShortcut("j", cb)).toBeNull();
    expect(altShortcut("k", cb)).toBeNull();
  });
});

describe("carrying the tab to another workspace", () => {
  const chord = (over: Partial<Parameters<typeof carryTabStep>[0]> = {}) => ({
    key: "w", code: "KeyW", ctrlKey: true, altKey: true, metaKey: false, shiftKey: false, ...over,
  });

  it("is the workspace key with Ctrl added, forward", () => {
    expect(carryTabStep(chord())).toBe(1);
  });

  it("goes back with Shift", () => {
    expect(carryTabStep(chord({ key: "W", shiftKey: true }))).toBe(-1);
  });

  it("goes by the physical key when the layout reports another character", () => {
    expect(carryTabStep(chord({ key: "\u0142" }))).toBe(1);
  });

  it("is not the plain workspace key, nor Ctrl or Alt with another key", () => {
    expect(carryTabStep(chord({ ctrlKey: false }))).toBeNull();
    expect(carryTabStep(chord({ altKey: false }))).toBeNull();
    expect(carryTabStep(chord({ key: "x", code: "KeyX" }))).toBeNull();
    expect(carryTabStep(chord({ metaKey: true }))).toBeNull();
  });
});
