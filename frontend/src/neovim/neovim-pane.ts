/**
 * Neovim pane component.
 *
 * Renders Neovim's TUI in an xterm.js terminal within the right pane.
 * All keyboard input is forwarded to Neovim via WebSocket.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglRenderer } from "../terminal/webgl-renderer";
import { kickFontLoad } from "../terminal/font-loader";
import type { PaneKeyHandler } from "../input/keybindings";
import type { Component, ErrorMessage, NeovimDiffAvailableMessage, NeovimExitedMessage, NeovimOutputMessage, NeovimReadyMessage } from "../types";
import { ErrorCode } from "@core/platform/protocol";
import type { WebSocketClient } from "../platform/websocket";

type NeovimPaneState = "idle" | "starting" | "ready" | "exited" | "error";

export class NeovimPane implements Component, PaneKeyHandler {
  private terminal: XTerm | null = null;
  private fitAddon: FitAddon | null = null;
  private webglRenderer: WebglRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: number | null = null;
  private state: NeovimPaneState = "idle";
  private statusEl: HTMLElement;
  private terminalContainer: HTMLElement;
  private headerEl: HTMLElement;
  private diffBtnEl: HTMLButtonElement;
  private lastSentSize: { cols: number; rows: number } | null = null;
  private exitCallback: (() => void) | null = null;
  private latestDiff: { filePath: string; added: number; removed: number } | null = null;
  private boundHandlers = {
    output: (msg: NeovimOutputMessage) => this.handleOutput(msg),
    ready: (msg: NeovimReadyMessage) => this.handleReady(msg),
    exited: (msg: NeovimExitedMessage) => this.handleExited(msg),
    error: (msg: ErrorMessage) => this.handleError(msg),
    diffAvailable: (msg: NeovimDiffAvailableMessage) => this.handleDiffAvailable(msg),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
  ) {
    this.headerEl = document.createElement("div");
    this.headerEl.className = "neovim-header";

    const title = document.createElement("span");
    title.className = "neovim-header-title";
    title.textContent = "NEOVIM";
    this.headerEl.appendChild(title);

    this.diffBtnEl = document.createElement("button");
    this.diffBtnEl.className = "neovim-diff-btn";
    this.diffBtnEl.style.display = "none";
    this.diffBtnEl.addEventListener("click", () => this.openDiff());
    this.headerEl.appendChild(this.diffBtnEl);

    this.terminalContainer = document.createElement("div");
    this.terminalContainer.className = "neovim-terminal-container";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "neovim-status-overlay";

    this.container.appendChild(this.headerEl);
    this.container.appendChild(this.terminalContainer);
    this.container.appendChild(this.statusEl);
  }

  initialize(): void {
    kickFontLoad();

    this.terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "block",
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0.5,
      lineHeight: 1.3,
      scrollback: 1000,
      theme: {
        background: "#1c1b1a",
        foreground: "#f8f6f2",
        cursor: "#aeee00",
        cursorAccent: "#1c1b1a",
        selectionBackground: "#45413b",
        black: "#141413",
        red: "#ff2c4b",
        green: "#aeee00",
        yellow: "#fade3e",
        blue: "#0a9dff",
        magenta: "#ff9eb8",
        cyan: "#8cffba",
        white: "#f8f6f2",
        brightBlack: "#857f78",
        brightRed: "#ff2c4b",
        brightGreen: "#aeee00",
        brightYellow: "#ffa724",
        brightBlue: "#0a9dff",
        brightMagenta: "#ff9eb8",
        brightCyan: "#8cffba",
        brightWhite: "#ffffff",
      },
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    this.terminal.open(this.terminalContainer);

    this.webglRenderer = new WebglRenderer(this.terminal);

    // Forward terminal data to backend Neovim process
    this.terminal.onData((data) => {
      if (this.state === "ready") {
        this.ws.neovimSendInput(data);
      }
    });

    this.terminal.onResize(({ cols, rows }) => {
      this.lastSentSize = { cols, rows };
      if (this.state === "ready" || this.state === "starting") {
        this.ws.neovimSendResize(cols, rows);
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeDebounceTimer !== null) {
        window.clearTimeout(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = window.setTimeout(() => {
        this.resizeDebounceTimer = null;
        this.fit();
      }, 150);
    });
    this.resizeObserver.observe(this.container);

    // Subscribe to neovim WebSocket events
    this.ws.on("neovim-output", this.boundHandlers.output);
    this.ws.on("neovim-ready", this.boundHandlers.ready);
    this.ws.on("neovim-exited", this.boundHandlers.exited);
    this.ws.on("error", this.boundHandlers.error);
    this.ws.on("neovim-diff-available", this.boundHandlers.diffAvailable);

    this.showStatus("idle");
  }

  /**
   * Spawn the Neovim backend process.
   * Called when the user switches to neovim mode.
   */
  spawn(): void {
    if (this.state === "ready" || this.state === "starting") {
      return;
    }

    this.state = "starting";
    this.showStatus("starting");
    this.ws.neovimSpawn(undefined, this.terminal?.cols, this.terminal?.rows);
  }

  /**
   * Kill the Neovim backend process.
   */
  kill(): void {
    this.ws.neovimKill();
    this.state = "idle";
    this.showStatus("idle");
  }

  /**
   * Spawn Neovim to edit a specific file (triggered from viewer).
   * Kills any existing instance, clears the terminal, and opens the file.
   */
  spawnForFile(filePath: string): void {
    this.lastSentSize = null;
    this.state = "starting";
    this.showStatus("starting");
    this.terminal?.clear();
    this.ws.neovimSpawn(filePath, this.terminal?.cols, this.terminal?.rows);
  }

  /**
   * Register a callback invoked when Neovim exits after editing a file.
   */
  onExit(callback: () => void): void {
    this.exitCallback = callback;
  }

  /**
   * PaneKeyHandler implementation.
   * When the xterm textarea has DOM focus, keystrokes flow through xterm.js
   * natively and this method is never called (shouldDelegateToPaneHandler
   * returns false for neovim xterm targets). When the textarea does NOT
   * have focus (common in WebView2), the keybinding manager delegates here
   * and we forward keystrokes directly to Neovim via WebSocket.
   */
  handleKeydown(e: KeyboardEvent): boolean {
    console.log(`[neovim] handleKeydown: key=${e.key}, state=${this.state}`);
    if (this.state !== "ready") return true;

    // Do NOT call textarea.focus() — it causes WebView2 to lose all
    // keyboard input.  Forward every keystroke to Neovim via WebSocket.
    const data = keyEventToTermData(e);
    if (data) {
      this.ws.neovimSendInput(data);
      console.log(`[neovim] Forwarded key: ${JSON.stringify(data)}`);
    }
    return true;
  }

  /**
   * Check if Neovim is currently running.
   */
  isReady(): boolean {
    return this.state === "ready";
  }

  /**
   * Focus the terminal.
   * Bypasses xterm.js's focus({ preventScroll: true }) which can fail
   * silently in WebView2. Directly focuses the hidden textarea.
   */
  focus(): void {
    this.terminal?.focus();
    // Direct textarea focus without preventScroll as WebView2 fallback
    const textarea = this.terminalContainer.querySelector(
      ".xterm-helper-textarea",
    ) as HTMLElement | null;
    textarea?.focus();
  }

  /**
   * Fit terminal to container.
   */
  fit(): void {
    if (this.fitAddon == null || this.terminal == null) {
      return;
    }

    if (this.container.offsetWidth === 0 || this.container.offsetHeight === 0) {
      return;
    }

    try {
      const dims = this.fitAddon.proposeDimensions();
      if (!dims) return;

      if (
        this.lastSentSize != null &&
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
   * Force fit + send resize to backend regardless of cached state.
   * Used after display changes where terminal dimensions may be stale.
   */
  private forceFitAndResize(): void {
    if (this.fitAddon == null || this.terminal == null) return;
    if (this.container.offsetWidth === 0 || this.container.offsetHeight === 0) return;

    try {
      this.fitAddon.fit();
    } catch {
      // Renderer may not be ready yet
    }

    const { cols, rows } = this.terminal;
    // Always send resize to backend (don't check lastSentSize)
    if (this.state === "ready") {
      this.ws.neovimSendResize(cols, rows);
    }
    this.lastSentSize = { cols, rows };
  }

  /**
   * Reclaim OS-level window focus via Tauri's native API.
   * PTY spawn on Windows can steal focus from the WebView2 control.
   * This is NOT a DOM focus() call — it operates at the OS window level.
   */
  private async reclaimWindowFocus(): Promise<void> {
    if ((window as any).__TAURI__ !== true) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFocus();
      console.log("[neovim] Reclaimed window focus via Tauri API");
    } catch {
      // Not in Tauri or permission not granted
    }
  }

  private handleDiffAvailable(msg: NeovimDiffAvailableMessage): void {
    this.latestDiff = { filePath: msg.filePath, added: msg.added, removed: msg.removed };
    const parts: string[] = [];
    if (msg.added > 0) parts.push(`+${msg.added}`);
    if (msg.removed > 0) parts.push(`-${msg.removed}`);
    this.diffBtnEl.textContent = `± ${parts.join(" ") || msg.hunkCount}`;
    this.diffBtnEl.style.display = "block";
  }

  private openDiff(): void {
    if (this.latestDiff) {
      this.ws.neovimOpenDiff(this.latestDiff.filePath);
    }
  }

  private handleOutput(msg: NeovimOutputMessage): void {
    this.terminal?.write(msg.data);
  }

  private handleReady(msg: NeovimReadyMessage): void {
    this.state = "ready";
    this.hideStatus();
    console.log(`[neovim] Ready, pid: ${msg.pid}, cols: ${this.terminal?.cols}, rows: ${this.terminal?.rows}`);

    this.forceFitAndResize();
    requestAnimationFrame(() => {
      this.forceFitAndResize();
    });

    // PTY spawn on Windows (pywinpty) can steal OS-level focus from
    // the WebView2 control, making the app stop receiving keyboard
    // events until the user clicks. Reclaim focus via Tauri's native
    // window API (operates at OS level, not DOM — safe for WebView2).
    this.reclaimWindowFocus();
  }

  private handleExited(msg: NeovimExitedMessage): void {
    this.state = "exited";
    console.log(`[neovim] Exited with code: ${msg.exitCode}`);
    this.terminal?.blur();

    if (this.exitCallback) {
      this.exitCallback();
    } else {
      this.showStatus("exited", msg.exitCode);
    }
  }

  private handleError(msg: ErrorMessage): void {
    if (this.state !== "starting") return;

    if (
      msg.code === ErrorCode.NEOVIM_NOT_FOUND ||
      msg.code === ErrorCode.NEOVIM_SPAWN_FAILED
    ) {
      this.state = "error";
      this.showStatus("error", undefined, msg.message);
    }
  }

  private showStatus(state: NeovimPaneState, exitCode?: number, errorMessage?: string): void {
    this.statusEl.style.display = "flex";
    this.terminalContainer.style.opacity = state === "ready" ? "1" : "0.3";

    switch (state) {
      case "idle":
        this.statusEl.innerHTML = `
          <div class="neovim-status-content">
            <span class="neovim-status-icon">⌨</span>
            <span>Neovim</span>
          </div>
        `;
        break;
      case "starting":
        this.statusEl.innerHTML = `
          <div class="neovim-status-content">
            <span class="neovim-status-icon spinning">◌</span>
            <span>Starting Neovim...</span>
          </div>
        `;
        break;
      case "exited":
        this.statusEl.innerHTML = `
          <div class="neovim-status-content">
            <span class="neovim-status-icon">✕</span>
            <span>Neovim exited${exitCode != null ? ` (code ${exitCode})` : ""}</span>
            <button class="neovim-restart-btn" onclick="">Restart</button>
          </div>
        `;
        this.statusEl.querySelector(".neovim-restart-btn")
          ?.addEventListener("click", () => this.spawn());
        break;
      case "error":
        this.statusEl.innerHTML = `
          <div class="neovim-status-content">
            <span class="neovim-status-icon">✕</span>
            <span>${errorMessage ?? "Failed to start Neovim"}</span>
            <button class="neovim-restart-btn">Retry</button>
          </div>
        `;
        this.statusEl.querySelector(".neovim-restart-btn")
          ?.addEventListener("click", () => this.spawn());
        break;
      case "ready":
        this.hideStatus();
        break;
    }
  }

  private hideStatus(): void {
    this.statusEl.style.display = "none";
    this.terminalContainer.style.opacity = "1";
  }

  dispose(): void {
    if (this.resizeDebounceTimer != null) {
      window.clearTimeout(this.resizeDebounceTimer);
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.ws.off("neovim-output", this.boundHandlers.output);
    this.ws.off("neovim-ready", this.boundHandlers.ready);
    this.ws.off("neovim-exited", this.boundHandlers.exited);
    this.ws.off("error", this.boundHandlers.error);
    this.ws.off("neovim-diff-available", this.boundHandlers.diffAvailable);

    if (this.state === "ready" || this.state === "starting") {
      this.kill();
    }

    this.webglRenderer?.dispose();
    this.webglRenderer = null;

    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
  }
}

/**
 * Convert a KeyboardEvent to the byte sequence a terminal would send.
 * Used as fallback when xterm.js's textarea doesn't have DOM focus
 * (WebView2 rejects programmatic focus), so keystrokes must be
 * forwarded to Neovim manually via WebSocket.
 */
function keyEventToTermData(e: KeyboardEvent): string | null {
  // Modifier-only keys produce no terminal data
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
    return null;
  }

  // Ctrl+key → control character (Ctrl+A = 0x01 through Ctrl+Z = 0x1A)
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    const key = e.key.toLowerCase();
    if (key.length === 1 && key >= "a" && key <= "z") {
      return String.fromCharCode(key.charCodeAt(0) - 96);
    }
    if (key === "[") return "\x1b";
    if (key === "\\") return "\x1c";
    if (key === "]") return "\x1d";
  }

  // Special keys → terminal escape sequences
  switch (e.key) {
    case "Enter": return "\r";
    case "Escape": return "\x1b";
    case "Backspace": return "\x7f";
    case "Tab": return e.shiftKey ? "\x1b[Z" : "\t";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Home": return "\x1b[H";
    case "End": return "\x1b[F";
    case "PageUp": return "\x1b[5~";
    case "PageDown": return "\x1b[6~";
    case "Delete": return "\x1b[3~";
    case "Insert": return "\x1b[2~";
  }

  // Alt+key → ESC prefix (for Neovim alt-mappings)
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
    return "\x1b" + e.key;
  }

  // Regular printable character
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    return e.key;
  }

  return null;
}
