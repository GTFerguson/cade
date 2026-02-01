/**
 * Neovim pane component.
 *
 * Renders Neovim's TUI in an xterm.js terminal within the right pane.
 * All keyboard input is forwarded to Neovim via WebSocket.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { PaneKeyHandler } from "../input/keybindings";
import type { Component, ErrorMessage, NeovimExitedMessage, NeovimOutputMessage, NeovimReadyMessage } from "../types";
import { ErrorCode } from "../platform/protocol";
import type { WebSocketClient } from "../platform/websocket";

type NeovimPaneState = "idle" | "starting" | "ready" | "exited" | "error";

export class NeovimPane implements Component, PaneKeyHandler {
  private terminal: XTerm | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: number | null = null;
  private state: NeovimPaneState = "idle";
  private statusEl: HTMLElement;
  private terminalContainer: HTMLElement;
  private lastSentSize: { cols: number; rows: number } | null = null;
  private boundHandlers = {
    output: (msg: NeovimOutputMessage) => this.handleOutput(msg),
    ready: (msg: NeovimReadyMessage) => this.handleReady(msg),
    exited: (msg: NeovimExitedMessage) => this.handleExited(msg),
    error: (msg: ErrorMessage) => this.handleError(msg),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
  ) {
    this.terminalContainer = document.createElement("div");
    this.terminalContainer.className = "neovim-terminal-container";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "neovim-status-overlay";

    this.container.appendChild(this.terminalContainer);
    this.container.appendChild(this.statusEl);
  }

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

    try {
      this.terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, canvas fallback
    }

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
    // Allow re-spawn from error state (Retry button)

    this.state = "starting";
    this.showStatus("starting");
    this.ws.neovimSpawn();
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
   * PaneKeyHandler implementation.
   * Consumes ALL keys when Neovim pane is focused (except prefix,
   * which is handled by KeybindingManager before this is called).
   */
  handleKeydown(_e: KeyboardEvent): boolean {
    // All keys are consumed via xterm.js onData handler
    // The KeybindingManager only calls us for non-terminal panes,
    // but since we use xterm.js, input flows through onData instead.
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
   */
  focus(): void {
    this.terminal?.focus();
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

  private handleOutput(msg: NeovimOutputMessage): void {
    this.terminal?.write(msg.data);
  }

  private handleReady(msg: NeovimReadyMessage): void {
    this.state = "ready";
    this.hideStatus();
    this.fit();
    this.terminal?.focus();
    console.log(`[neovim] Ready, pid: ${msg.pid}`);
  }

  private handleExited(msg: NeovimExitedMessage): void {
    this.state = "exited";
    this.showStatus("exited", msg.exitCode);
    console.log(`[neovim] Exited with code: ${msg.exitCode}`);
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

    if (this.state === "ready" || this.state === "starting") {
      this.kill();
    }

    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
  }
}
