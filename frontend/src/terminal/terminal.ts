/**
 * Terminal component wrapping xterm.js.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { SessionKey, type SessionKeyValue } from "../platform/protocol";
import type { Component } from "../types";
import type { WebSocketClient } from "../platform/websocket";

/**
 * Badwolf-inspired color scheme.
 * @see https://github.com/sjl/badwolf
 */
const BADWOLF_THEME = {
  background: "#1c1b1a", // blackgravel
  foreground: "#f8f6f2", // plain
  cursor: "#aeee00", // lime
  cursorAccent: "#1c1b1a", // blackgravel
  selectionBackground: "#45413b", // deepgravel

  // ANSI colors
  black: "#141413", // blackestgravel
  red: "#ff2c4b", // taffy
  green: "#aeee00", // lime
  yellow: "#fade3e", // dalespale
  blue: "#0a9dff", // tardis
  magenta: "#ff9eb8", // dress
  cyan: "#8cffba", // saltwatertaffy
  white: "#f8f6f2", // plain

  // Bright variants
  brightBlack: "#857f78", // gravel
  brightRed: "#ff2c4b", // taffy
  brightGreen: "#aeee00", // lime
  brightYellow: "#ffa724", // orange
  brightBlue: "#0a9dff", // tardis
  brightMagenta: "#ff9eb8", // dress
  brightCyan: "#8cffba", // saltwatertaffy
  brightWhite: "#ffffff", // snow
};

export type CustomKeyHandler = (e: KeyboardEvent) => boolean;

export interface TerminalOptions {
  sessionKey?: SessionKeyValue;
  subscribeToOutput?: boolean;
  hideCursor?: boolean;
}

export class Terminal implements Component {
  private terminal: XTerm | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: number | null = null;
  private customKeyHandler: CustomKeyHandler | null = null;
  private sessionKey: SessionKeyValue;
  private subscribeToOutput: boolean;
  private hideCursor: boolean;
  private lastSentSize: { cols: number; rows: number } | null = null;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    options: TerminalOptions = {}
  ) {
    this.sessionKey = options.sessionKey ?? SessionKey.CLAUDE;
    this.subscribeToOutput = options.subscribeToOutput ?? true;
    this.hideCursor = options.hideCursor ?? false;
  }

  /**
   * Initialize the terminal.
   */
  initialize(): void {
    const theme = this.hideCursor
      ? { ...BADWOLF_THEME, cursor: "transparent", cursorAccent: "transparent" }
      : BADWOLF_THEME;

    this.terminal = new XTerm({
      cursorBlink: !this.hideCursor,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0.5,
      lineHeight: 1.3,
      scrollback: 10000,
      theme,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(this.container);

    try {
      this.terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, fall back to canvas renderer
    }

    // Allow external key interception (e.g., for prefix key)
    this.terminal.attachCustomKeyEventHandler((e) => {
      // Check if keybinding manager wants to intercept FIRST (e.g., prefix key active)
      if (this.customKeyHandler) {
        const shouldIntercept = this.customKeyHandler(e);
        if (shouldIntercept) {
          return false; // Prevent xterm from handling
        }
      }

      // Now handle terminal-specific shortcuts (only if not intercepted above)

      // Handle Ctrl+C (copy) - intercept before terminal sends SIGINT
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyC') {
        const selection = this.terminal?.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(err => {
            console.error('Failed to copy to clipboard:', err);
          });
        }
        return false; // Prevent xterm from processing (no SIGINT)
      }

      // Handle Ctrl+X (SIGINT - replacement for Ctrl+C interrupt)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyX') {
        this.ws.sendInput('\x03', this.sessionKey); // Send ETX (Ctrl+C)
        return false;
      }

      // Handle Ctrl+V (paste) - let the browser paste event handle it
      // We intercept here only to prevent xterm from handling it
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyV') {
        // Don't preventDefault - allow browser paste event to fire
        // Our paste event handler will catch it
        return false; // Prevent xterm from handling
      }

      return true;
    });

    this.fit();

    this.terminal.onData((data) => {
      this.ws.sendInput(data, this.sessionKey);
    });

    this.terminal.onResize(({ cols, rows }) => {
      this.lastSentSize = { cols, rows };
      this.ws.sendResize(cols, rows, this.sessionKey);
    });

    if (this.subscribeToOutput) {
      this.ws.on("output", (message) => {
        // Only handle output for our sessionKey
        const msgSessionKey = message.sessionKey ?? SessionKey.CLAUDE;
        if (msgSessionKey === this.sessionKey) {
          this.terminal?.write(message.data);
        }
      });
    }

    this.ws.on("connected", () => {
      this.sendSize();
    });

    this.resizeObserver = new ResizeObserver(() => {
      // Debounce resize to avoid flooding backend during drag-resize
      if (this.resizeDebounceTimer !== null) {
        window.clearTimeout(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = window.setTimeout(() => {
        this.resizeDebounceTimer = null;
        this.fit();
      }, 150);
    });
    this.resizeObserver.observe(this.container);

    // Scroll to bottom on click if no text is selected
    this.container.addEventListener("click", () => {
      const selection = this.terminal?.getSelection();
      if (!selection) {
        this.scrollToBottom();
      }
    });

    // Prevent default browser paste events (xterm.js has its own paste handler that conflicts)
    this.container.addEventListener('paste', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Get clipboard data from event
      const text = e.clipboardData?.getData('text');
      if (text) {
        this.ws.sendInput(text, this.sessionKey);
      }
    });

    // Handle right-click context menu
    this.container.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      const selection = this.terminal?.getSelection();

      if (selection) {
        // Copy selected text to clipboard
        navigator.clipboard.writeText(selection).catch(err => {
          console.error('Failed to copy to clipboard:', err);
        });
      } else {
        // If no selection, paste from clipboard
        navigator.clipboard.readText()
          .then(text => {
            if (text) {
              this.ws.sendInput(text, this.sessionKey);
            }
          })
          .catch(err => {
            console.error('Failed to read from clipboard:', err);
          });
      }
    });
  }

  /**
   * Fit terminal to container.
   */
  fit(): void {
    if (this.fitAddon === null || this.terminal === null) {
      return;
    }

    // Don't fit when container is hidden - would send bad dimensions
    if (this.container.offsetWidth === 0 || this.container.offsetHeight === 0) {
      return;
    }

    try {
      // Check if dimensions would actually change
      const dims = this.fitAddon.proposeDimensions();
      if (!dims) {
        return;
      }

      // Skip if dimensions haven't changed
      if (
        this.lastSentSize !== null &&
        dims.cols === this.lastSentSize.cols &&
        dims.rows === this.lastSentSize.rows
      ) {
        return;
      }

      this.fitAddon.fit();
    } catch {
      // Ignore fit errors during initialization
    }
  }

  /**
   * Send current terminal size to server.
   */
  sendSize(): void {
    if (this.terminal === null) {
      return;
    }

    // Don't send size when container is hidden - would send stale/bad dimensions
    if (this.container.offsetWidth === 0 || this.container.offsetHeight === 0) {
      return;
    }

    this.ws.sendResize(this.terminal.cols, this.terminal.rows, this.sessionKey);
  }

  /**
   * Focus the terminal and scroll to bottom.
   */
  focus(): void {
    this.terminal?.focus();
    this.scrollToBottom();
  }

  /**
   * Scroll terminal to the top of the buffer.
   */
  scrollToTop(): void {
    this.terminal?.scrollToTop();
  }

  /**
   * Scroll terminal to the bottom of the buffer.
   */
  scrollToBottom(): void {
    this.terminal?.scrollToBottom();
  }

  /**
   * Set a custom key handler that can intercept keys before xterm.
   * Return true from the handler to prevent xterm from processing the key.
   */
  setCustomKeyHandler(handler: CustomKeyHandler | null): void {
    this.customKeyHandler = handler;
  }

  /**
   * Get the session key for this terminal.
   */
  getSessionKey(): SessionKeyValue {
    return this.sessionKey;
  }

  /**
   * Write data to terminal (for local echo or status messages).
   */
  write(data: string): void {
    this.terminal?.write(data);
  }

  /**
   * Clear the terminal.
   */
  clear(): void {
    this.terminal?.clear();
  }

  /**
   * Reset terminal state and clear screen.
   *
   * Clears screen and scrollback buffer for clean slate before replay.
   * Avoids DECSTR (\x1b[!p) which triggers DA1 responses in xterm.js.
   */
  reset(): void {
    if (this.terminal == null) {
      return;
    }

    // Reset to initial state without triggering device queries:
    // - SGR 0: Reset text attributes
    // - Cursor home + clear screen
    // - Exit alternate screen buffer if active (to normal buffer)
    // - Reset scroll margins
    this.terminal.write(
      "\x1b[0m" +       // SGR reset (text attributes)
      "\x1b[?1049l" +   // Exit alternate screen buffer (if in it)
      "\x1b[r" +        // Reset scroll margins (DECSTBM)
      "\x1b[H\x1b[2J"   // Cursor home + clear screen
    );
    this.terminal.clear();
  }

  /**
   * Dispose of terminal resources.
   */
  dispose(): void {
    if (this.resizeDebounceTimer !== null) {
      window.clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
  }
}
