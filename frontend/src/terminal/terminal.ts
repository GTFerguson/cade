/**
 * Terminal component wrapping xterm.js.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { SessionKey, type AnySessionKey } from "@core/platform/protocol";
import type { Component } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import { getSavedThemeId, getThemeById } from "../config/themes";

/**
 * Build an xterm.js theme from the current CADE theme.
 * Reads the active theme's neutral colors and maps them to xterm properties.
 * ANSI accent colors are shared across all themes.
 */
function buildXtermTheme(): Record<string, string> {
  const theme = getThemeById(getSavedThemeId());
  const c = theme?.colors;

  const bg = c?.bgPrimary ?? "#0a0a09";
  const fg = c?.textPrimary ?? "#f8f6f2";
  const muted = c?.textMuted ?? "#5e5955";
  const selection = c?.bgHover ?? "#222120";

  return {
    background: bg,
    foreground: fg,
    cursor: "#aeee00",
    cursorAccent: bg,
    selectionBackground: selection,

    // ANSI colors (shared across all themes)
    black: bg,
    red: "#ff2c4b",
    green: "#aeee00",
    yellow: "#fade3e",
    blue: "#0a9dff",
    magenta: "#ff9eb8",
    cyan: "#8cffba",
    white: fg,

    // Bright variants
    brightBlack: muted,
    brightRed: "#ff2c4b",
    brightGreen: "#aeee00",
    brightYellow: "#ffa724",
    brightBlue: "#0a9dff",
    brightMagenta: "#ff9eb8",
    brightCyan: "#8cffba",
    brightWhite: "#ffffff",
  };
}

export type CustomKeyHandler = (e: KeyboardEvent) => boolean;

export interface TerminalOptions {
  sessionKey?: AnySessionKey;
  subscribeToOutput?: boolean;
  hideCursor?: boolean;
  readOnly?: boolean;
  fontSize?: number;
  rows?: number;
  scrollback?: number;
}

export class Terminal implements Component {
  private terminal: XTerm | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: number | null = null;
  private customKeyHandler: CustomKeyHandler | null = null;
  private sessionKey: AnySessionKey;
  private subscribeToOutput: boolean;
  private hideCursor: boolean;
  private readOnly: boolean;
  private fontSizeOverride: number | null;
  private rowsOverride: number | null;
  private scrollbackOverride: number | null;
  private lastSentSize: { cols: number; rows: number } | null = null;

  // Scroll lock: xterm.js has a bug where alternate buffer transitions
  // clear the internal isUserScrolling flag, causing the viewport to snap
  // to the bottom on the next output write. We track scroll state ourselves
  // and restore it when xterm loses it.
  private savedScrollPos: number | null = null;
  private isFitting = false;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    options: TerminalOptions = {}
  ) {
    this.sessionKey = options.sessionKey ?? SessionKey.CLAUDE;
    this.subscribeToOutput = options.subscribeToOutput ?? true;
    this.hideCursor = options.hideCursor ?? false;
    this.readOnly = options.readOnly ?? false;
    this.fontSizeOverride = options.fontSize ?? null;
    this.rowsOverride = options.rows ?? null;
    this.scrollbackOverride = options.scrollback ?? null;
  }

  /**
   * Initialize the terminal.
   */
  initialize(): void {
    const xtermTheme = buildXtermTheme();
    const theme = this.hideCursor
      ? { ...xtermTheme, cursor: "transparent", cursorAccent: "transparent" }
      : xtermTheme;

    this.terminal = new XTerm({
      cursorBlink: !this.hideCursor,
      cursorStyle: "block",
      fontSize: this.fontSizeOverride ?? 14,
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0,
      lineHeight: 1.0,
      scrollback: this.scrollbackOverride ?? 10000,
      ...(this.rowsOverride != null ? { rows: this.rowsOverride } : {}),
      theme,
      disableStdin: this.readOnly,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(this.container);

    try {
      const webgl = new WebglAddon({ preserveDrawingBuffer: true });
      // Fall back to canvas renderer on context loss rather than leaving artifacts
      webgl.onContextLoss(() => webgl.dispose());
      this.terminal.loadAddon(webgl);
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

    // Track user scroll position to work around xterm.js bug where
    // alternate buffer transitions clear the isUserScrolling flag.
    // Suppress during fit() reflows (transient positions) and when
    // container is hidden (viewport freezes while baseY keeps growing,
    // producing stale positions that lock the terminal away from bottom).
    this.terminal.onScroll(() => {
      if (this.isFitting) return;
      if (this.container.offsetWidth === 0 || this.container.offsetHeight === 0) return;
      const buf = this.terminal?.buffer.active;
      if (!buf) return;
      if (buf.viewportY < buf.baseY) {
        this.savedScrollPos = buf.viewportY;
      } else {
        this.savedScrollPos = null;
      }
    });

    if (!this.readOnly) {
      this.terminal.onData((data) => {
        this.ws.sendInput(data, this.sessionKey);
      });

      this.terminal.onResize(({ cols, rows }) => {
        this.lastSentSize = { cols, rows };
        this.ws.sendResize(cols, rows, this.sessionKey);
      });
    }

    if (this.subscribeToOutput) {
      this.ws.on("output", (message) => {
        // Only handle output for our sessionKey
        const msgSessionKey = message.sessionKey ?? SessionKey.CLAUDE;
        if (msgSessionKey === this.sessionKey) {
          this.write(message.data);
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
   * Update the terminal color theme (e.g. when user switches themes).
   */
  updateTheme(): void {
    if (!this.terminal) return;
    const xtermTheme = buildXtermTheme();
    this.terminal.options.theme = this.hideCursor
      ? { ...xtermTheme, cursor: "transparent", cursorAccent: "transparent" }
      : xtermTheme;
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
      const dims = this.fitAddon.proposeDimensions();
      if (!dims) {
        return;
      }

      const buf = this.terminal.buffer.active;

      // Use savedScrollPos as the authority on whether the user was scrolled
      // up — NOT raw viewportY. When a tab is hidden, the viewport freezes
      // while baseY keeps growing from output, making viewportY < baseY even
      // though the user was at the bottom. savedScrollPos is immune to this
      // because onScroll is suppressed while the container is hidden.
      const userWasScrolledUp = this.savedScrollPos != null;

      // Skip if dimensions haven't changed, but still fix stale viewport
      if (
        this.lastSentSize !== null &&
        dims.cols === this.lastSentSize.cols &&
        dims.rows === this.lastSentSize.rows
      ) {
        // Viewport may be stale after tab switch (frozen while hidden)
        if (!userWasScrolledUp && buf.viewportY < buf.baseY) {
          this.terminal.scrollToBottom();
        }
        return;
      }

      // Suppress onScroll during reflow — fitAddon.fit() causes transient
      // viewport positions that would corrupt savedScrollPos
      this.isFitting = true;
      this.fitAddon.fit();
      this.isFitting = false;

      if (userWasScrolledUp && this.savedScrollPos != null) {
        // User was scrolled up — restore their position after reflow
        const pos = this.savedScrollPos;
        if (buf.viewportY !== pos) {
          this.terminal.scrollToLine(pos);
        }
        this.savedScrollPos = pos;
      } else {
        // User was at bottom — ensure we're still there after reflow
        this.savedScrollPos = null;
        if (buf.viewportY < buf.baseY) {
          this.terminal.scrollToBottom();
        }
      }
    } catch {
      this.isFitting = false;
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
   * Focus the terminal without changing scroll position.
   */
  focus(): void {
    this.terminal?.focus();
  }

  /**
   * Focus the terminal and scroll to bottom.
   */
  focusAtBottom(): void {
    this.terminal?.focus();
    this.scrollToBottom();
  }

  /**
   * Scroll terminal to the top of the buffer.
   */
  scrollToTop(): void {
    this.savedScrollPos = 0;
    this.terminal?.scrollToTop();
  }

  /**
   * Scroll terminal to the bottom of the buffer.
   */
  scrollToBottom(): void {
    this.savedScrollPos = null;
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
  getSessionKey(): AnySessionKey {
    return this.sessionKey;
  }

  /**
   * Write data to terminal (for local echo or status messages).
   * Protects scroll position from xterm.js alt-buffer bug.
   */
  write(data: string): void {
    if (!this.terminal) return;
    const restoreTo = this.savedScrollPos;
    if (restoreTo != null) {
      this.terminal.write(data, () => {
        // If we were scrolled up but xterm snapped to bottom, restore
        if (this.savedScrollPos == null && restoreTo != null) {
          this.terminal?.scrollToLine(restoreTo);
          this.savedScrollPos = restoreTo;
        }
      });
    } else {
      this.terminal.write(data);
    }
  }

  /**
   * Send input data to the terminal's PTY (same path as keyboard input).
   */
  sendInput(data: string): void {
    this.ws.sendInput(data, this.sessionKey);
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
    this.savedScrollPos = null;

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
