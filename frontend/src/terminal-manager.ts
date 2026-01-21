/**
 * Manages dual terminals (claude and manual) for a project tab.
 *
 * Provides lazy initialization of the manual terminal and handles
 * switching between terminals with visual status indicators.
 */

import { SessionKey, type SessionKeyValue } from "./protocol";
import { Terminal, type CustomKeyHandler } from "./terminal";
import type { Component, OutputMessage, SessionRestoredMessage } from "./types";
import type { WebSocketClient } from "./websocket";

export class TerminalManager implements Component {
  private claudeTerminal: Terminal | null = null;
  private manualTerminal: Terminal | null = null;
  private activeTerminal: SessionKeyValue = SessionKey.CLAUDE;
  private claudeContainer: HTMLElement;
  private manualContainer: HTMLElement;
  private statusIndicator: HTMLElement;
  private customKeyHandler: CustomKeyHandler | null = null;
  private outputBuffer: Map<SessionKeyValue, string> = new Map();
  private flushRafId: number | null = null;
  private lastFlushTime = 0;
  private boundHandlers = {
    output: (message: OutputMessage) => this.handleOutput(message),
    sessionRestored: (message: SessionRestoredMessage) => this.handleSessionRestored(message),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient
  ) {
    // Create sub-containers for each terminal
    this.claudeContainer = document.createElement("div");
    this.claudeContainer.className = "terminal-container terminal-claude";

    this.manualContainer = document.createElement("div");
    this.manualContainer.className = "terminal-container terminal-manual";
    this.manualContainer.style.display = "none";

    // Create status indicator
    this.statusIndicator = document.createElement("div");
    this.statusIndicator.className = "terminal-status-indicator";
    this.updateStatusIndicator();

    this.container.appendChild(this.claudeContainer);
    this.container.appendChild(this.manualContainer);
    this.container.appendChild(this.statusIndicator);
  }

  /**
   * Initialize the terminal manager.
   */
  initialize(): void {
    // Create and initialize claude terminal
    this.claudeTerminal = new Terminal(this.claudeContainer, this.ws, {
      sessionKey: SessionKey.CLAUDE,
      subscribeToOutput: false, // We handle output routing
      hideCursor: true, // Claude Code renders its own cursor
    });
    this.claudeTerminal.initialize();

    // Subscribe to output messages and route to correct terminal
    this.ws.on("output", this.boundHandlers.output);

    // Subscribe to session-restored messages
    this.ws.on("session-restored", this.boundHandlers.sessionRestored);
  }

  /**
   * Handle output message and route to correct terminal.
   */
  private handleOutput(message: OutputMessage): void {
    const sessionKey = message.sessionKey ?? SessionKey.CLAUDE;

    // Append to buffer
    const existing = this.outputBuffer.get(sessionKey) ?? "";
    this.outputBuffer.set(sessionKey, existing + message.data);

    // Adaptive flushing: immediate for small data, batched for high-frequency
    const now = performance.now();
    const timeSinceLastFlush = now - this.lastFlushTime;

    if (message.data.length < 100 && timeSinceLastFlush > 100) {
      // Small output and sufficient time passed: flush immediately for responsiveness
      this.flushOutputBuffer();
    } else {
      // Large output or high frequency: batch with RAF
      if (this.flushRafId == null) {
        this.flushRafId = requestAnimationFrame(() => {
          this.flushOutputBuffer();
        });
      }
    }
  }

  /**
   * Flush buffered output to terminals.
   */
  private flushOutputBuffer(): void {
    this.lastFlushTime = performance.now();
    this.flushRafId = null;

    for (const [sessionKey, data] of this.outputBuffer.entries()) {
      if (data.length === 0) continue;

      if (sessionKey === SessionKey.CLAUDE) {
        this.claudeTerminal?.write(data);
      } else if (sessionKey === SessionKey.MANUAL && this.manualTerminal) {
        this.manualTerminal.write(data);
      }
    }

    this.outputBuffer.clear();
  }

  /**
   * Handle session restored message.
   */
  private handleSessionRestored(message: SessionRestoredMessage): void {
    const sessionKey = message.sessionKey ?? SessionKey.CLAUDE;

    if (sessionKey === SessionKey.CLAUDE) {
      this.claudeTerminal?.reset();
      this.claudeTerminal?.write(message.scrollback);
    } else if (sessionKey === SessionKey.MANUAL) {
      // Lazily create manual terminal if needed for restore
      this.ensureManualTerminal();
      this.manualTerminal?.reset();
      this.manualTerminal?.write(message.scrollback);
    }
  }

  /**
   * Create manual terminal if it doesn't exist.
   */
  private ensureManualTerminal(): void {
    if (this.manualTerminal) {
      return;
    }

    this.manualTerminal = new Terminal(this.manualContainer, this.ws, {
      sessionKey: SessionKey.MANUAL,
      subscribeToOutput: false,
    });
    this.manualTerminal.initialize();

    // Apply custom key handler if one was set
    if (this.customKeyHandler) {
      this.manualTerminal.setCustomKeyHandler(this.customKeyHandler);
    }
  }

  /**
   * Toggle between claude and manual terminals.
   */
  toggle(): void {
    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.switchTo(SessionKey.MANUAL);
    } else {
      this.switchTo(SessionKey.CLAUDE);
    }
  }

  /**
   * Switch to a specific terminal.
   */
  switchTo(sessionKey: SessionKeyValue): void {
    if (sessionKey === SessionKey.MANUAL) {
      this.ensureManualTerminal();
    }

    this.activeTerminal = sessionKey;

    if (sessionKey === SessionKey.CLAUDE) {
      this.claudeContainer.style.display = "block";
      this.manualContainer.style.display = "none";
      this.claudeTerminal?.fit();
      this.claudeTerminal?.focus();
    } else {
      this.claudeContainer.style.display = "none";
      this.manualContainer.style.display = "block";
      this.manualTerminal?.fit();
      this.manualTerminal?.focus();
    }

    this.updateStatusIndicator();
  }

  /**
   * Update the status indicator text.
   */
  private updateStatusIndicator(): void {
    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.statusIndicator.textContent = "[claude]";
      this.statusIndicator.classList.remove("shell");
      this.statusIndicator.classList.add("claude");
    } else {
      this.statusIndicator.textContent = "[shell]";
      this.statusIndicator.classList.remove("claude");
      this.statusIndicator.classList.add("shell");
    }
  }

  /**
   * Get the currently active terminal type.
   */
  getActiveTerminal(): SessionKeyValue {
    return this.activeTerminal;
  }

  /**
   * Focus the active terminal.
   */
  focus(): void {
    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.focus();
    } else {
      this.manualTerminal?.focus();
    }
  }

  /**
   * Fit terminals to container.
   */
  fit(): void {
    this.claudeTerminal?.fit();
    this.manualTerminal?.fit();
  }

  /**
   * Send size for both terminals.
   */
  sendSize(): void {
    this.claudeTerminal?.sendSize();
    this.manualTerminal?.sendSize();
  }

  /**
   * Set custom key handler for terminals.
   */
  setCustomKeyHandler(handler: CustomKeyHandler | null): void {
    this.customKeyHandler = handler;
    this.claudeTerminal?.setCustomKeyHandler(handler);
    this.manualTerminal?.setCustomKeyHandler(handler);
  }

  /**
   * Reset the active terminal.
   */
  reset(): void {
    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.reset();
    } else {
      this.manualTerminal?.reset();
    }
  }

  /**
   * Write to the active terminal.
   */
  write(data: string): void {
    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.write(data);
    } else {
      this.manualTerminal?.write(data);
    }
  }

  /**
   * Dispose of all terminal resources.
   */
  dispose(): void {
    // Cancel pending flush
    if (this.flushRafId != null) {
      cancelAnimationFrame(this.flushRafId);
      this.flushRafId = null;
    }

    // Flush any remaining buffered output before disposal
    if (this.outputBuffer.size > 0) {
      this.flushOutputBuffer();
    }

    // Unregister WebSocket handlers
    this.ws.off("output", this.boundHandlers.output);
    this.ws.off("session-restored", this.boundHandlers.sessionRestored);

    this.claudeTerminal?.dispose();
    this.manualTerminal?.dispose();
    this.statusIndicator.remove();
  }
}
