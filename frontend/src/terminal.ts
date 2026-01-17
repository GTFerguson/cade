/**
 * Terminal component wrapping xterm.js.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { SessionKey, type SessionKeyValue } from "./protocol";
import type { Component } from "./types";
import type { WebSocketClient } from "./websocket";

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
}

export class Terminal implements Component {
  private terminal: XTerm | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private customKeyHandler: CustomKeyHandler | null = null;
  private sessionKey: SessionKeyValue;
  private subscribeToOutput: boolean;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    options: TerminalOptions = {}
  ) {
    this.sessionKey = options.sessionKey ?? SessionKey.CLAUDE;
    this.subscribeToOutput = options.subscribeToOutput ?? true;
  }

  /**
   * Initialize the terminal.
   */
  initialize(): void {
    this.terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0.5,
      lineHeight: 1.3,
      scrollback: 10000,
      theme: BADWOLF_THEME,
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
      if (this.customKeyHandler) {
        // Return false to prevent xterm from handling the key
        return !this.customKeyHandler(e);
      }
      return true;
    });

    this.fit();

    this.terminal.onData((data) => {
      this.ws.sendInput(data, this.sessionKey);
    });

    this.terminal.onResize(({ cols, rows }) => {
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
      this.fit();
    });
    this.resizeObserver.observe(this.container);
  }

  /**
   * Fit terminal to container.
   */
  fit(): void {
    if (this.fitAddon === null || this.terminal === null) {
      return;
    }

    try {
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

    this.ws.sendResize(this.terminal.cols, this.terminal.rows);
  }

  /**
   * Focus the terminal.
   */
  focus(): void {
    this.terminal?.focus();
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
  }
}
