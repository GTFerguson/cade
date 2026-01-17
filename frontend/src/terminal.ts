/**
 * Terminal component wrapping xterm.js.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
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

export class Terminal implements Component {
  private terminal: XTerm | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient
  ) {}

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
      letterSpacing: 1,
      lineHeight: 1.3,
      theme: BADWOLF_THEME,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(this.container);

    // WebGL renderer for smoother scrolling and better performance
    try {
      const webgl = new WebglAddon();
      this.terminal.loadAddon(webgl);
    } catch {
      // WebGL not available, fall back to default canvas renderer
    }

    this.fit();

    this.terminal.onData((data) => {
      this.ws.sendInput(data);
    });

    this.terminal.onResize(({ cols, rows }) => {
      this.ws.sendResize(cols, rows);
    });

    this.ws.on("output", (message) => {
      this.terminal?.write(message.data);
    });

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
