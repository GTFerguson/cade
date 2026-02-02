/**
 * Manages dual terminals (claude and manual) for a project tab.
 *
 * Provides lazy initialization of the manual terminal and handles
 * switching between terminals with visual status indicators.
 */

import { SessionKey, type SessionKeyValue, type AnySessionKey } from "../platform/protocol";
import { Terminal, type CustomKeyHandler } from "./terminal";
import type { Component, OutputMessage, SessionRestoredMessage } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import type { AgentManager } from "../agents";

export class TerminalManager implements Component {
  private claudeTerminal: Terminal | null = null;
  private manualTerminal: Terminal | null = null;
  private activeTerminal: SessionKeyValue = SessionKey.CLAUDE;
  private claudeContainer: HTMLElement;
  private manualContainer: HTMLElement;
  private statusIndicator: HTMLElement;
  private customKeyHandler: CustomKeyHandler | null = null;
  private agentManager: AgentManager | null = null;
  private agentDropdown: HTMLElement | null = null;
  private outputBuffer: Map<AnySessionKey, string[]> = new Map();
  private flushRafId: number | null = null;
  private flushTimeoutId: number | null = null;
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
   * Set the agent manager for delegating agent output routing.
   */
  setAgentManager(manager: AgentManager): void {
    this.agentManager = manager;
  }

  /**
   * Handle output message and route to correct terminal.
   */
  private handleOutput(message: OutputMessage): void {
    // Delegate agent output to AgentManager first
    if (this.agentManager?.routeOutput(message)) {
      return;
    }

    const sessionKey = message.sessionKey ?? SessionKey.CLAUDE;

    // Append to buffer
    const chunks = this.outputBuffer.get(sessionKey) ?? [];
    chunks.push(message.data);
    this.outputBuffer.set(sessionKey, chunks);

    // Adaptive flushing: immediate for interactive input, batched for bulk output
    const now = performance.now();
    const timeSinceLastFlush = now - this.lastFlushTime;

    // Flush immediately for small, rapid updates (likely interactive typing)
    const isSmallUpdate = message.data.length < 50;
    const isRapidUpdate = timeSinceLastFlush < 33; // Within 2 frames at 60fps

    if (isSmallUpdate && isRapidUpdate) {
      // Interactive typing: flush immediately for responsiveness
      this.flushOutputBuffer();
    } else {
      // Large updates or infrequent updates: batch for efficiency
      if (this.flushRafId == null) {
        this.flushRafId = requestAnimationFrame(() => {
          this.flushOutputBuffer();
        });

        // Fallback: force flush if RAF doesn't fire within 16ms
        this.flushTimeoutId = window.setTimeout(() => {
          this.flushOutputBuffer();
        }, 16);
      }
    }
  }

  /**
   * Flush buffered output to terminals.
   */
  private flushOutputBuffer(): void {
    this.lastFlushTime = performance.now();

    // Clear both scheduled flush mechanisms
    if (this.flushRafId != null) {
      cancelAnimationFrame(this.flushRafId);
      this.flushRafId = null;
    }
    if (this.flushTimeoutId != null) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    for (const [sessionKey, chunks] of this.outputBuffer.entries()) {
      if (chunks.length === 0) continue;

      const data = chunks.join(''); // Safe: preserves UTF-8 boundaries

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
    // Delegate agent scrollback to AgentManager first
    if (this.agentManager?.routeSessionRestored(message)) {
      return;
    }

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
    // If an agent is focused, toggle its side instead
    if (this.agentManager?.getActiveAgentId() != null) {
      this.agentManager.toggleSide();
      this.updateStatusIndicator();
      return;
    }

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
   * Show the primary terminal containers (called when switching away from an agent).
   */
  showPrimary(): void {
    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeContainer.style.display = "block";
      this.claudeTerminal?.fit();
      this.claudeTerminal?.focus();
    } else {
      this.manualContainer.style.display = "block";
      this.manualTerminal?.fit();
      this.manualTerminal?.focus();
    }
    this.updateStatusIndicator();
  }

  /**
   * Hide the primary terminal containers (called when switching to an agent).
   */
  hidePrimary(): void {
    this.claudeContainer.style.display = "none";
    this.manualContainer.style.display = "none";
  }

  /**
   * Update the status indicator text.
   */
  /**
   * Update status indicator text. Shows agent label when an agent is focused,
   * with a dropdown for switching between agents.
   */
  updateStatusIndicator(): void {
    const activeAgentId = this.agentManager?.getActiveAgentId();

    if (activeAgentId != null) {
      // Agent is active — show its label
      const agents = this.agentManager?.getAgentList() ?? [];
      const activeAgent = agents.find((a) => a.agentId === activeAgentId);
      const label = activeAgent?.label ?? activeAgentId.replace("agent-", "");
      const side = this.agentManager?.getActiveSide() ?? "claude";

      this.statusIndicator.innerHTML = "";
      this.statusIndicator.classList.remove("claude", "shell");

      const labelSpan = document.createElement("span");
      labelSpan.className = "terminal-status-label";
      labelSpan.textContent = `[${label} ▾]`;
      labelSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleAgentDropdown();
      });

      const sideSpan = document.createElement("span");
      sideSpan.className = side === "claude" ? "terminal-status-claude" : "terminal-status-shell";
      sideSpan.textContent = side === "claude" ? " / [claude]" : " / [shell]";

      this.statusIndicator.appendChild(labelSpan);
      this.statusIndicator.appendChild(sideSpan);
      this.statusIndicator.classList.add(side === "claude" ? "claude" : "shell");
    } else if (this.agentManager?.hasAgents()) {
      // Primary is active but agents exist — show "main ▾"
      this.statusIndicator.innerHTML = "";
      this.statusIndicator.classList.remove("shell");
      this.statusIndicator.classList.add("claude");

      const labelSpan = document.createElement("span");
      labelSpan.className = "terminal-status-label";
      labelSpan.textContent = "[main ▾]";
      labelSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleAgentDropdown();
      });

      const sideSpan = document.createElement("span");
      if (this.activeTerminal === SessionKey.CLAUDE) {
        sideSpan.className = "terminal-status-claude";
        sideSpan.textContent = " / [claude]";
      } else {
        sideSpan.className = "terminal-status-shell";
        sideSpan.textContent = " / [shell]";
      }

      this.statusIndicator.appendChild(labelSpan);
      this.statusIndicator.appendChild(sideSpan);
    } else {
      // No agents — original behavior
      this.statusIndicator.innerHTML = "";
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
  }

  /**
   * Toggle the agent dropdown in the status bar.
   */
  private toggleAgentDropdown(): void {
    if (this.agentDropdown) {
      this.agentDropdown.remove();
      this.agentDropdown = null;
      return;
    }

    const dropdown = document.createElement("div");
    dropdown.className = "terminal-agent-dropdown";

    // Primary option
    const primaryOption = document.createElement("div");
    primaryOption.className = "terminal-agent-option";
    if (this.agentManager?.getActiveAgentId() == null) {
      primaryOption.classList.add("active");
    }
    primaryOption.textContent = "● main (primary)";
    primaryOption.addEventListener("click", () => {
      this.agentManager?.switchToAgent(null);
      this.hideAgentDropdown();
    });
    dropdown.appendChild(primaryOption);

    // Agent options
    const agents = this.agentManager?.getAgentList() ?? [];
    for (const agent of agents) {
      const option = document.createElement("div");
      option.className = "terminal-agent-option";
      if (agent.agentId === this.agentManager?.getActiveAgentId()) {
        option.classList.add("active");
      }
      option.textContent = `◉ ${agent.label} (${agent.role})`;
      option.addEventListener("click", () => {
        this.agentManager?.switchToAgent(agent.agentId);
        this.hideAgentDropdown();
      });
      dropdown.appendChild(option);
    }

    this.statusIndicator.appendChild(dropdown);
    this.agentDropdown = dropdown;

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && !this.statusIndicator.contains(e.target as Node)) {
        this.hideAgentDropdown();
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler), 0);
  }

  private hideAgentDropdown(): void {
    if (this.agentDropdown) {
      this.agentDropdown.remove();
      this.agentDropdown = null;
    }
  }

  /**
   * Get the currently active terminal type.
   */
  getActiveTerminal(): SessionKeyValue {
    return this.activeTerminal;
  }

  /**
   * Send input to the active terminal's PTY.
   */
  sendInput(data: string): void {
    if (this.agentManager?.getActiveAgentId() != null) {
      this.agentManager.sendInput(data);
      return;
    }

    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.sendInput(data);
    } else {
      this.manualTerminal?.sendInput(data);
    }
  }

  /**
   * Focus the active terminal.
   */
  focus(): void {
    if (this.agentManager?.getActiveAgentId() != null) {
      this.agentManager.focus();
      return;
    }

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
    this.agentManager?.fit();
  }

  /**
   * Send size for both terminals.
   */
  sendSize(): void {
    this.claudeTerminal?.sendSize();
    this.manualTerminal?.sendSize();
    this.agentManager?.sendSize();
  }

  /**
   * Set custom key handler for terminals.
   */
  setCustomKeyHandler(handler: CustomKeyHandler | null): void {
    this.customKeyHandler = handler;
    this.claudeTerminal?.setCustomKeyHandler(handler);
    this.manualTerminal?.setCustomKeyHandler(handler);
    this.agentManager?.setCustomKeyHandler(handler);
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
   * Scroll the active terminal to top.
   */
  scrollToTop(): void {
    if (this.agentManager?.getActiveAgentId() != null) {
      this.agentManager.scrollToTop();
      return;
    }

    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.scrollToTop();
    } else {
      this.manualTerminal?.scrollToTop();
    }
  }

  /**
   * Scroll the active terminal to bottom.
   */
  scrollToBottom(): void {
    if (this.agentManager?.getActiveAgentId() != null) {
      this.agentManager.scrollToBottom();
      return;
    }

    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.scrollToBottom();
    } else {
      this.manualTerminal?.scrollToBottom();
    }
  }

  /**
   * Dispose of all terminal resources.
   */
  dispose(): void {
    // Cancel pending flush (both RAF and timeout)
    if (this.flushRafId != null) {
      cancelAnimationFrame(this.flushRafId);
      this.flushRafId = null;
    }
    if (this.flushTimeoutId != null) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
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
