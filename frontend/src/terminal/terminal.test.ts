// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Terminal } from "./terminal";
import { resetDropTargets, resolveDropTarget } from "./file-drop";
import { SessionKey } from "@core/platform/protocol";
import { resetTerminalFontSizeCache, setTerminalFontSize } from "./font-size";
import type { WebSocketClient } from "../platform/websocket";

// Mock ResizeObserver (not available in jsdom)
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

global.ResizeObserver = ResizeObserverMock as any;

// Polyfill ClipboardEvent for jsdom
if (typeof ClipboardEvent === "undefined") {
  global.ClipboardEvent = class ClipboardEvent extends Event {
    clipboardData: DataTransfer | null;

    constructor(type: string, eventInitDict?: ClipboardEventInit) {
      super(type, eventInitDict);
      this.clipboardData = eventInitDict?.clipboardData ?? null;
    }
  } as any;
}

// Mock xterm.js
vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    private keyHandler: ((e: KeyboardEvent) => boolean) | null = null;

    loadAddon = vi.fn();
    open = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
    onScroll = vi.fn();
    write = vi.fn();
    paste = vi.fn();
    clear = vi.fn();
    dispose = vi.fn();
    getSelection = vi.fn(() => "");
    focus = vi.fn();
    scrollToTop = vi.fn();
    scrollToBottom = vi.fn();
    scrollToLine = vi.fn();
    buffer = { active: { viewportY: 0, baseY: 0 } };

    attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean) {
      this.keyHandler = handler;
    }

    // Helper to trigger the key handler for testing
    _triggerKeyHandler(e: KeyboardEvent): boolean {
      return this.keyHandler ? this.keyHandler(e) : true;
    }

    cols = 80;
    rows = 24;
    options: { fontSize: number } = { fontSize: 14 };
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
  }

  return {
    Terminal: MockTerminal,
  };
});

// Mock addons
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: class {},
}));

vi.mock("@xterm/addon-canvas", () => ({
  CanvasAddon: class {},
}));

// Mock WebSocket client
function createMockWebSocket(): WebSocketClient {
  return {
    sendInput: vi.fn(),
    sendResize: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as WebSocketClient;
}

// Mock clipboard API
function mockClipboard() {
  const clipboard = {
    writeText: vi.fn(() => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve("")),
  };

  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    writable: true,
    configurable: true,
  });

  return clipboard;
}

// Helper to create keyboard event
function createKeyboardEvent(
  key: string,
  options: {
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    code?: string;
  } = {}
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    code: options.code || `Key${key.toUpperCase()}`,
    ctrlKey: options.ctrlKey || false,
    shiftKey: options.shiftKey || false,
    altKey: options.altKey || false,
    bubbles: true,
    cancelable: true,
  });
}

// Helper to create paste event
function createPasteEvent(text: string): ClipboardEvent {
  const clipboardData = {
    getData: vi.fn((type: string) => (type === "text" ? text : "")),
  };

  return new ClipboardEvent("paste", {
    clipboardData: clipboardData as unknown as DataTransfer,
    bubbles: true,
    cancelable: true,
  });
}

// Helper to create context menu event
function createContextMenuEvent(): MouseEvent {
  return new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
}

describe("Terminal paste handling", () => {
  let container: HTMLElement;
  let ws: WebSocketClient;
  let terminal: Terminal;
  let clipboard: ReturnType<typeof mockClipboard>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create container
    container = document.createElement("div");
    document.body.appendChild(container);

    // Mock clipboard
    clipboard = mockClipboard();

    // Create WebSocket mock
    ws = createMockWebSocket();

    // Create terminal
    terminal = new Terminal(container, ws);
    terminal.initialize();
  });

  describe("Browser paste event", () => {
    it("routes paste through xterm so bracketed paste mode is honored", async () => {
      const pasteText = "Hello from clipboard";
      const pasteEvent = createPasteEvent(pasteText);

      container.dispatchEvent(pasteEvent);

      // Should prevent default to stop double-handling
      expect(pasteEvent.defaultPrevented).toBe(true);

      // Must go through xterm's paste() (applies \x1b[200~ wrapping and
      // newline normalization), never raw over the WebSocket
      const xtermMock = (terminal as any).terminal;
      expect(xtermMock.paste).toHaveBeenCalledWith(pasteText);
      expect(ws.sendInput).not.toHaveBeenCalled();
    });

    it("prevents event propagation to stop xterm handler", () => {
      const pasteEvent = createPasteEvent("test");
      const stopPropagationSpy = vi.spyOn(pasteEvent, "stopPropagation");

      container.dispatchEvent(pasteEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it("handles empty paste gracefully", () => {
      const pasteEvent = createPasteEvent("");

      container.dispatchEvent(pasteEvent);

      // Should still prevent default
      expect(pasteEvent.defaultPrevented).toBe(true);

      // Should not paste empty text
      const xtermMock = (terminal as any).terminal;
      expect(xtermMock.paste).not.toHaveBeenCalled();
      expect(ws.sendInput).not.toHaveBeenCalled();
    });

    it("routes multiline paste through xterm unmodified", () => {
      const multilineText = "line 1\nline 2\nline 3";
      const pasteEvent = createPasteEvent(multilineText);

      container.dispatchEvent(pasteEvent);

      const xtermMock = (terminal as any).terminal;
      expect(xtermMock.paste).toHaveBeenCalledWith(multilineText);
      expect(ws.sendInput).not.toHaveBeenCalled();
    });

    it("routes paste with special characters through xterm", () => {
      const specialText = "echo 'Hello $USER'\t\n";
      const pasteEvent = createPasteEvent(specialText);

      container.dispatchEvent(pasteEvent);

      const xtermMock = (terminal as any).terminal;
      expect(xtermMock.paste).toHaveBeenCalledWith(specialText);
    });
  });

  describe("Ctrl+V keyboard shortcut", () => {
    it("intercepts Ctrl+V to prevent xterm handling", () => {
      const keyEvent = createKeyboardEvent("V", {
        ctrlKey: true,
        code: "KeyV",
      });

      // Get the mock xterm instance
      const xtermMock = (terminal as any).terminal;

      // Trigger the custom key handler
      const result = xtermMock._triggerKeyHandler(keyEvent);

      // Should return false to prevent xterm from handling
      expect(result).toBe(false);
    });

    it("allows browser paste event to fire for Ctrl+V", () => {
      const keyEvent = createKeyboardEvent("V", {
        ctrlKey: true,
        code: "KeyV",
      });

      const xtermMock = (terminal as any).terminal;
      xtermMock._triggerKeyHandler(keyEvent);

      // Should NOT call preventDefault, allowing paste event to fire
      expect(keyEvent.defaultPrevented).toBe(false);
    });

    it("does not intercept Ctrl+Shift+V", () => {
      const keyEvent = createKeyboardEvent("V", {
        ctrlKey: true,
        shiftKey: true,
        code: "KeyV",
      });

      const xtermMock = (terminal as any).terminal;
      const result = xtermMock._triggerKeyHandler(keyEvent);

      // Should allow xterm to handle (for browser default paste)
      expect(result).toBe(true);
    });

    it("does not intercept Alt+V", () => {
      const keyEvent = createKeyboardEvent("V", {
        altKey: true,
        code: "KeyV",
      });

      const xtermMock = (terminal as any).terminal;
      const result = xtermMock._triggerKeyHandler(keyEvent);

      expect(result).toBe(true);
    });
  });

  describe("Ctrl+C copy shortcut", () => {
    it("copies selection to clipboard when text is selected", async () => {
      const selectedText = "selected text";
      const xtermMock = (terminal as any).terminal;
      xtermMock.getSelection = vi.fn(() => selectedText);

      const keyEvent = createKeyboardEvent("C", {
        ctrlKey: true,
        code: "KeyC",
      });

      xtermMock._triggerKeyHandler(keyEvent);

      // Wait for async clipboard operation
      await vi.waitFor(() => {
        expect(clipboard.writeText).toHaveBeenCalledWith(selectedText);
      });
    });

    it("does nothing when no text is selected", async () => {
      const xtermMock = (terminal as any).terminal;
      xtermMock.getSelection = vi.fn(() => "");

      const keyEvent = createKeyboardEvent("C", {
        ctrlKey: true,
        code: "KeyC",
      });

      xtermMock._triggerKeyHandler(keyEvent);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not copy empty selection
      expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it("prevents default to avoid sending SIGINT", () => {
      const xtermMock = (terminal as any).terminal;
      xtermMock.getSelection = vi.fn(() => "text");

      const keyEvent = createKeyboardEvent("C", {
        ctrlKey: true,
        code: "KeyC",
      });

      const result = xtermMock._triggerKeyHandler(keyEvent);

      // Should prevent xterm from handling (no SIGINT)
      expect(result).toBe(false);
    });
  });

  describe("Ctrl+X SIGINT shortcut", () => {
    it("sends ETX character for interrupt", () => {
      const keyEvent = createKeyboardEvent("X", {
        ctrlKey: true,
        code: "KeyX",
      });

      const xtermMock = (terminal as any).terminal;
      xtermMock._triggerKeyHandler(keyEvent);

      // Should send Ctrl+C character (ETX)
      expect(ws.sendInput).toHaveBeenCalledWith("\x03", SessionKey.CLAUDE);
    });

    it("prevents xterm from handling Ctrl+X", () => {
      const keyEvent = createKeyboardEvent("X", {
        ctrlKey: true,
        code: "KeyX",
      });

      const xtermMock = (terminal as any).terminal;
      const result = xtermMock._triggerKeyHandler(keyEvent);

      expect(result).toBe(false);
    });
  });

  describe("Right-click context menu", () => {
    it("copies selected text on right-click when text is selected", async () => {
      const selectedText = "selected text";
      const xtermMock = (terminal as any).terminal;
      xtermMock.getSelection = vi.fn(() => selectedText);

      const contextMenuEvent = createContextMenuEvent();
      container.dispatchEvent(contextMenuEvent);

      // Should prevent default context menu
      expect(contextMenuEvent.defaultPrevented).toBe(true);

      // Wait for async clipboard operation
      await vi.waitFor(() => {
        expect(clipboard.writeText).toHaveBeenCalledWith(selectedText);
      });
    });

    it("pastes clipboard content through xterm on right-click when no selection", async () => {
      const clipboardText = "line 1\nline 2";
      clipboard.readText.mockResolvedValue(clipboardText);

      const xtermMock = (terminal as any).terminal;
      xtermMock.getSelection = vi.fn(() => "");

      const contextMenuEvent = createContextMenuEvent();
      container.dispatchEvent(contextMenuEvent);

      expect(contextMenuEvent.defaultPrevented).toBe(true);

      // Wait for async clipboard read; must route through xterm's paste()
      // so bracketed paste and disableStdin are honored
      await vi.waitFor(() => {
        expect(xtermMock.paste).toHaveBeenCalledWith(clipboardText);
      });
      expect(ws.sendInput).not.toHaveBeenCalled();
    });

    it("does not paste when clipboard is empty", async () => {
      clipboard.readText.mockResolvedValue("");

      const xtermMock = (terminal as any).terminal;
      xtermMock.getSelection = vi.fn(() => "");

      const contextMenuEvent = createContextMenuEvent();
      container.dispatchEvent(contextMenuEvent);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(ws.sendInput).not.toHaveBeenCalled();
    });

    it("handles clipboard read errors gracefully", async () => {
      clipboard.readText.mockRejectedValue(new Error("Permission denied"));

      const xtermMock = (terminal as any).terminal;
      xtermMock.getSelection = vi.fn(() => "");

      const contextMenuEvent = createContextMenuEvent();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      container.dispatchEvent(contextMenuEvent);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to read from clipboard:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Manual terminal session", () => {
    it("pastes into the terminal instance that owns the container", () => {
      const manualTerminal = new Terminal(container, ws, {
        sessionKey: SessionKey.MANUAL,
      });
      manualTerminal.initialize();

      const pasteEvent = createPasteEvent("test");
      container.dispatchEvent(pasteEvent);

      // Session-key routing happens via each terminal's own onData wiring;
      // the paste handler must hand the text to its own xterm instance
      expect((manualTerminal as any).terminal.paste).toHaveBeenCalledWith("test");
    });
  });

  describe("Edge cases and integration", () => {
    it("handles rapid paste events without duplication", () => {
      const event1 = createPasteEvent("paste 1");
      const event2 = createPasteEvent("paste 2");
      const event3 = createPasteEvent("paste 3");

      container.dispatchEvent(event1);
      container.dispatchEvent(event2);
      container.dispatchEvent(event3);

      // Should paste each exactly once
      const xtermMock = (terminal as any).terminal;
      expect(xtermMock.paste).toHaveBeenCalledTimes(3);
      expect(xtermMock.paste).toHaveBeenNthCalledWith(1, "paste 1");
      expect(xtermMock.paste).toHaveBeenNthCalledWith(2, "paste 2");
      expect(xtermMock.paste).toHaveBeenNthCalledWith(3, "paste 3");
    });

    it("prevents xterm from creating duplicate pastes", () => {
      // Simulate user pressing Ctrl+V
      const keyEvent = createKeyboardEvent("V", {
        ctrlKey: true,
        code: "KeyV",
      });

      const xtermMock = (terminal as any).terminal;
      xtermMock._triggerKeyHandler(keyEvent);

      // Then paste event fires
      const pasteEvent = createPasteEvent("test");
      container.dispatchEvent(pasteEvent);

      // Should only paste once (from paste event handler)
      expect(xtermMock.paste).toHaveBeenCalledTimes(1);
      expect(xtermMock.paste).toHaveBeenCalledWith("test");
    });

    it("handles Unicode and emoji correctly", () => {
      const unicodeText = "Hello 世界 🚀 Ñoño";
      const pasteEvent = createPasteEvent(unicodeText);

      container.dispatchEvent(pasteEvent);

      const xtermMock = (terminal as any).terminal;
      expect(xtermMock.paste).toHaveBeenCalledWith(unicodeText);
    });

    it("prevents default on all paste events to avoid xterm conflicts", () => {
      const events = [
        createPasteEvent("test 1"),
        createPasteEvent("test 2"),
        createPasteEvent("test 3"),
      ];

      events.forEach((event) => {
        container.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      });
    });
  });
});

describe("Terminal file-drop registration", () => {
  let container: HTMLElement;
  let ws: WebSocketClient;

  beforeEach(async () => {
    resetDropTargets();
    container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(container, "offsetWidth", { value: 400 });
    Object.defineProperty(container, "offsetHeight", { value: 300 });
    ws = createMockWebSocket();
  });

  it("registers itself so a drop over its container pastes the path", () => {
    const terminal = new Terminal(container, ws);
    terminal.initialize();
    (document as any).elementFromPoint = vi.fn(() => container);
    const target = resolveDropTarget(5, 5);
    expect(target).toBe(terminal);
    const xtermMock = (terminal as any).terminal;
    target!.pasteText("/tmp/a ");
    expect(xtermMock.paste).toHaveBeenCalledWith("/tmp/a ");
  });

  it("does not register a read-only viewer", () => {
    const terminal = new Terminal(container, ws, { readOnly: true });
    terminal.initialize();
    (document as any).elementFromPoint = vi.fn(() => container);
    expect(resolveDropTarget(5, 5)).toBeNull();
  });

  it("becomes the fallback target after receiving focus", () => {
    const terminal = new Terminal(container, ws);
    terminal.initialize();
    container.dispatchEvent(new Event("focusin", { bubbles: true }));
    (document as any).elementFromPoint = vi.fn(() => null);
    expect(resolveDropTarget(0, 0)).toBe(terminal);
  });

  it("unregisters on dispose", () => {
    const terminal = new Terminal(container, ws);
    terminal.initialize();
    container.dispatchEvent(new Event("focusin", { bubbles: true }));
    terminal.dispose();
    (document as any).elementFromPoint = vi.fn(() => container);
    expect(resolveDropTarget(5, 5)).toBeNull();
  });
});

describe("Terminal PTY size policy", () => {
  let container: HTMLElement;
  let ws: WebSocketClient;
  let terminal: Terminal;
  let xterm: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    Object.defineProperty(container, "offsetWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 600, configurable: true });
    document.body.appendChild(container);
    ws = createMockWebSocket();
    terminal = new Terminal(container, ws);
    terminal.initialize();
    xterm = (terminal as any).terminal;
    (terminal as any).connectionId = "me";
  });

  it("mirrors another controller's size without asking the server for it", () => {
    terminal.applyPtySize(40, 20, "phone");

    expect(xterm.resize).toHaveBeenCalledWith(40, 20);
    expect(terminal.isMirroring()).toBe(true);
    expect(container.classList.contains("terminal-fixed-size")).toBe(true);
    expect(ws.sendResize).not.toHaveBeenCalled();
  });

  it("does not refit the container while mirroring", () => {
    terminal.applyPtySize(40, 20, "phone");
    (terminal as any).fitAddon.fit.mockClear();
    terminal.fit();
    expect((terminal as any).fitAddon.fit).not.toHaveBeenCalled();
  });

  it("returns to fitting its own container when it becomes the controller", () => {
    terminal.applyPtySize(40, 20, "phone");
    terminal.applyPtySize(40, 20, "me");

    expect(terminal.isMirroring()).toBe(false);
    expect(container.classList.contains("terminal-fixed-size")).toBe(false);
    expect((terminal as any).fitAddon.fit).toHaveBeenCalled();
  });

  it("treats an unowned terminal as its own to size", () => {
    terminal.applyPtySize(40, 20, "phone");
    terminal.applyPtySize(40, 20, null);
    expect(terminal.isMirroring()).toBe(false);
  });

  it("asks for a repaint through its own session key", () => {
    (ws as any).sendRepaint = vi.fn();
    terminal.requestRepaint();
    expect((ws as any).sendRepaint).toHaveBeenCalledWith(SessionKey.CLAUDE);
  });
});

describe("Terminal row lock and font size", () => {
  let container: HTMLElement;
  let ws: WebSocketClient;
  let terminal: Terminal;
  let xterm: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetTerminalFontSizeCache();
    container = document.createElement("div");
    Object.defineProperty(container, "offsetWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 600, configurable: true });
    Object.defineProperty(container, "clientWidth", { value: 390, configurable: true });
    document.body.appendChild(container);
    ws = createMockWebSocket();
    terminal = new Terminal(container, ws);
    terminal.initialize();
    xterm = (terminal as any).terminal;
    (terminal as any).connectionId = "me";
  });

  it("keeps the row count while locked instead of refitting", () => {
    terminal.lockRows(10);
    expect(xterm.resize).toHaveBeenCalledWith(80, 10);
    expect(container.classList.contains("terminal-rows-locked")).toBe(true);

    (terminal as any).fitAddon.fit.mockClear();
    terminal.fit();
    expect((terminal as any).fitAddon.fit).not.toHaveBeenCalled();
    expect(xterm.rows).toBe(10);
  });

  it("refits when the lock is released", () => {
    terminal.lockRows(10);
    (terminal as any).fitAddon.fit.mockClear();
    terminal.lockRows(null);
    expect(container.classList.contains("terminal-rows-locked")).toBe(false);
    expect((terminal as any).fitAddon.fit).toHaveBeenCalled();
  });

  it("follows the shared font size setting", () => {
    (terminal as any).fitAddon.fit.mockClear();
    setTerminalFontSize(18);
    expect(xterm.options.fontSize).toBe(18);
    expect((terminal as any).fitAddon.fit).toHaveBeenCalled();
  });

  it("shrinks the font to fit a wider mirrored PTY, then restores it", () => {
    setTerminalFontSize(14);
    terminal.applyPtySize(200, 50, "desktop");
    // 390px / (200 cols * 0.6) = 3.25 → clamped to the minimum of 7.
    expect(xterm.options.fontSize).toBe(7);

    terminal.applyPtySize(200, 50, "me");
    expect(xterm.options.fontSize).toBe(14);
  });

  it("stops following the setting once disposed", () => {
    terminal.dispose();
    setTerminalFontSize(20);
    expect(xterm.options.fontSize).toBe(14);
  });
});
