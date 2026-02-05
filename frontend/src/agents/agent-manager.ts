/**
 * Manages worker agent xterm.js terminals and switching.
 *
 * Owns all agent terminal instances, routes output by session key prefix,
 * handles agent switching in the center pane, and provides mini-terminal
 * registration for the overview pane.
 */

import { SessionKey, type AnySessionKey } from "../platform/protocol";
import { Terminal, type CustomKeyHandler } from "../terminal/terminal";
import type { Component, OutputMessage, SessionRestoredMessage } from "../types";
import type { WebSocketClient } from "../platform/websocket";

export type AgentRole = "worker" | "primary";
export type AgentState = "starting" | "idle" | "busy" | "done" | "error";

export interface AgentInfo {
  agentId: string;
  label: string;
  role: AgentRole;
  state: AgentState;
}

interface AgentTerminalEntry {
  agentId: string;
  label: string;
  role: AgentRole;
  state: AgentState;
  claudeTerminal: Terminal;
  claudeContainer: HTMLElement;
  manualTerminal: Terminal | null;
  manualContainer: HTMLElement;
}

export class AgentManager implements Component {
  private agents: Map<string, AgentTerminalEntry> = new Map();
  private activeAgentId: string | null = null;
  private activeSide: "claude" | "manual" = "claude";
  private pendingOutput: Map<string, string[]> = new Map();

  // Output buffering (same adaptive pattern as TerminalManager)
  private outputBuffer: Map<string, string[]> = new Map();
  private flushRafId: number | null = null;
  private flushTimeoutId: number | null = null;
  private lastFlushTime = 0;

  // Callbacks
  private onSwitchCallback: ((agentId: string | null) => void) | null = null;
  private miniTerminals: Map<string, Terminal> = new Map();

  // Key handler applied to all agent terminals
  private customKeyHandler: CustomKeyHandler | null = null;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    customKeyHandler: CustomKeyHandler | null
  ) {
    this.customKeyHandler = customKeyHandler;
  }

  initialize(): void {
    // AgentManager starts empty — agents are created dynamically
  }

  /**
   * Create a new worker agent with its own xterm.js terminal.
   * Flushes any output that arrived before the agent-spawned event.
   */
  createAgent(agentId: string, label: string, role: AgentRole): void {
    if (this.agents.has(agentId)) {
      return;
    }

    // Create containers (hidden by default)
    const claudeContainer = document.createElement("div");
    claudeContainer.className = "terminal-container agent-claude";
    claudeContainer.dataset["agent"] = agentId;
    claudeContainer.style.display = "none";

    const manualContainer = document.createElement("div");
    manualContainer.className = "terminal-container agent-manual";
    manualContainer.dataset["agent"] = agentId;
    manualContainer.style.display = "none";

    this.container.appendChild(claudeContainer);
    this.container.appendChild(manualContainer);

    // Create xterm.js terminal for the agent's claude side
    const claudeTerminal = new Terminal(claudeContainer, this.ws, {
      sessionKey: agentId,
      subscribeToOutput: false,
      hideCursor: true,
    });
    claudeTerminal.initialize();

    if (this.customKeyHandler) {
      claudeTerminal.setCustomKeyHandler(this.customKeyHandler);
    }

    const entry: AgentTerminalEntry = {
      agentId,
      label,
      role,
      state: "starting",
      claudeTerminal,
      claudeContainer,
      manualTerminal: null,
      manualContainer,
    };

    this.agents.set(agentId, entry);

    // Flush any output that arrived before the terminal was created
    const pending = this.pendingOutput.get(agentId);
    if (pending && pending.length > 0) {
      const data = pending.join("");
      claudeTerminal.write(data);

      const mini = this.miniTerminals.get(agentId);
      if (mini) {
        mini.write(data);
      }

      this.pendingOutput.delete(agentId);
    }
  }

  /**
   * Destroy a worker agent and its terminals.
   * If this was the active agent, switches back to primary.
   */
  destroyAgent(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) {
      return;
    }

    // Switch away if this agent was active
    if (this.activeAgentId === agentId) {
      this.switchToAgent(null);
    }

    entry.claudeTerminal.dispose();
    entry.manualTerminal?.dispose();
    entry.claudeContainer.remove();
    entry.manualContainer.remove();

    this.agents.delete(agentId);
    this.pendingOutput.delete(agentId);
    this.outputBuffer.delete(agentId);
  }

  /**
   * Route output to the correct agent terminal.
   * Returns true if the sessionKey belongs to an agent (starts with "agent-").
   * Buffers output if the agent terminal hasn't been created yet.
   */
  routeOutput(message: OutputMessage): boolean {
    const sessionKey = message.sessionKey ?? SessionKey.CLAUDE;

    if (!this.isAgentSessionKey(sessionKey)) {
      return false;
    }

    // Parse: "agent-tests" → agentId, "agent-tests-manual" → agentId + manual
    const { agentId, isManual } = this.parseAgentSessionKey(sessionKey);

    const entry = this.agents.get(agentId);
    if (!entry) {
      // Buffer output for agents that haven't been created yet
      const pending = this.pendingOutput.get(agentId) ?? [];
      if (!isManual) {
        pending.push(message.data);
        this.pendingOutput.set(agentId, pending);
      }
      return true;
    }

    // Buffer and flush using the same adaptive pattern as TerminalManager
    const bufferKey = isManual ? `${agentId}-manual` : agentId;
    const chunks = this.outputBuffer.get(bufferKey) ?? [];
    chunks.push(message.data);
    this.outputBuffer.set(bufferKey, chunks);

    this.scheduleFlush(message.data.length);

    return true;
  }

  /**
   * Route session-restored scrollback to the correct agent terminal.
   * Returns true if the sessionKey belongs to an agent.
   */
  routeSessionRestored(message: SessionRestoredMessage): boolean {
    const sessionKey = message.sessionKey ?? SessionKey.CLAUDE;

    if (!this.isAgentSessionKey(sessionKey)) {
      return false;
    }

    const { agentId, isManual } = this.parseAgentSessionKey(sessionKey);

    const entry = this.agents.get(agentId);
    if (!entry) {
      // Buffer scrollback for agents that haven't been created yet
      if (!isManual) {
        const pending = this.pendingOutput.get(agentId) ?? [];
        pending.push(message.scrollback);
        this.pendingOutput.set(agentId, pending);
      }
      return true;
    }

    if (isManual) {
      this.ensureManualTerminal(entry);
      entry.manualTerminal?.reset();
      entry.manualTerminal?.write(message.scrollback);
    } else {
      entry.claudeTerminal.reset();
      entry.claudeTerminal.write(message.scrollback);

      const mini = this.miniTerminals.get(agentId);
      if (mini) {
        mini.write(message.scrollback);
      }
    }

    return true;
  }

  /**
   * Switch the center pane to show an agent's terminal.
   * Pass null to switch back to the primary terminal.
   */
  switchToAgent(agentId: string | null): void {
    // Hide current agent containers
    if (this.activeAgentId != null) {
      const current = this.agents.get(this.activeAgentId);
      if (current) {
        current.claudeContainer.style.display = "none";
        current.manualContainer.style.display = "none";
      }
    }

    this.activeAgentId = agentId;
    this.activeSide = "claude";

    if (agentId != null) {
      const entry = this.agents.get(agentId);
      if (entry) {
        entry.claudeContainer.style.display = "block";
        entry.claudeTerminal.fit();
        entry.claudeTerminal.focus();
      }
    }

    this.onSwitchCallback?.(agentId);
  }

  /**
   * Cycle through agents: [null (primary), ...agentIds].
   */
  cycleAgent(direction: "next" | "prev"): void {
    const ids: (string | null)[] = [null, ...this.agents.keys()];
    if (ids.length <= 1) {
      return;
    }

    const currentIndex = ids.indexOf(this.activeAgentId);
    const delta = direction === "next" ? 1 : -1;
    const newIndex = (currentIndex + delta + ids.length) % ids.length;
    this.switchToAgent(ids[newIndex]!);
  }

  /**
   * Toggle between claude and manual for the active agent.
   * Lazy-creates the manual shell terminal on first use.
   */
  toggleSide(): void {
    if (this.activeAgentId == null) {
      return;
    }

    const entry = this.agents.get(this.activeAgentId);
    if (!entry) {
      return;
    }

    if (this.activeSide === "claude") {
      this.ensureManualTerminal(entry);
      entry.claudeContainer.style.display = "none";
      entry.manualContainer.style.display = "block";
      entry.manualTerminal?.fit();
      entry.manualTerminal?.focus();
      this.activeSide = "manual";
    } else {
      entry.manualContainer.style.display = "none";
      entry.claudeContainer.style.display = "block";
      entry.claudeTerminal.fit();
      entry.claudeTerminal.focus();
      this.activeSide = "claude";
    }
  }

  /**
   * Get which side (claude or manual) is active for the current agent.
   */
  getActiveSide(): "claude" | "manual" {
    return this.activeSide;
  }

  /**
   * Get the currently active agent ID, or null if on primary.
   */
  getActiveAgentId(): string | null {
    return this.activeAgentId;
  }

  /**
   * Update theme on all agent terminals.
   */
  updateAllThemes(): void {
    for (const entry of this.agents.values()) {
      entry.claudeTerminal.updateTheme();
      entry.manualTerminal?.updateTheme();
    }
  }

  /**
   * Fit the active agent's visible terminal to its container.
   */
  fit(): void {
    if (this.activeAgentId == null) {
      return;
    }

    const entry = this.agents.get(this.activeAgentId);
    if (!entry) {
      return;
    }

    if (this.activeSide === "claude") {
      entry.claudeTerminal.fit();
    } else {
      entry.manualTerminal?.fit();
    }
  }

  /**
   * Send the current size of the active agent's terminal to the backend.
   */
  sendSize(): void {
    if (this.activeAgentId == null) {
      return;
    }

    const entry = this.agents.get(this.activeAgentId);
    if (!entry) {
      return;
    }

    if (this.activeSide === "claude") {
      entry.claudeTerminal.sendSize();
    } else {
      entry.manualTerminal?.sendSize();
    }
  }

  /**
   * Focus the active agent's visible terminal.
   */
  focus(): void {
    if (this.activeAgentId == null) {
      return;
    }

    const entry = this.agents.get(this.activeAgentId);
    if (!entry) {
      return;
    }

    if (this.activeSide === "claude") {
      entry.claudeTerminal.focus();
    } else {
      entry.manualTerminal?.focus();
    }
  }

  /**
   * Send input to the active agent's visible terminal.
   */
  sendInput(data: string): void {
    if (this.activeAgentId == null) {
      return;
    }

    const entry = this.agents.get(this.activeAgentId);
    if (!entry) {
      return;
    }

    if (this.activeSide === "claude") {
      entry.claudeTerminal.sendInput(data);
    } else {
      entry.manualTerminal?.sendInput(data);
    }
  }

  /**
   * Apply a custom key handler to all agent terminals (existing and future).
   */
  setCustomKeyHandler(handler: CustomKeyHandler | null): void {
    this.customKeyHandler = handler;
    for (const entry of this.agents.values()) {
      entry.claudeTerminal.setCustomKeyHandler(handler);
      entry.manualTerminal?.setCustomKeyHandler(handler);
    }
  }

  /**
   * Update an agent's lifecycle state.
   */
  updateAgentState(agentId: string, state: AgentState): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.state = state;
    }
  }

  /**
   * Register a mini-terminal for output tee (used by overview pane).
   */
  registerMiniTerminal(agentId: string, terminal: Terminal): void {
    this.miniTerminals.set(agentId, terminal);
  }

  /**
   * Unregister a mini-terminal.
   */
  unregisterMiniTerminal(agentId: string): void {
    this.miniTerminals.delete(agentId);
  }

  /**
   * Check if any worker agents exist.
   */
  hasAgents(): boolean {
    return this.agents.size > 0;
  }

  /**
   * Get the list of agents for UI rendering.
   */
  getAgentList(): AgentInfo[] {
    return Array.from(this.agents.values()).map((e) => ({
      agentId: e.agentId,
      label: e.label,
      role: e.role,
      state: e.state,
    }));
  }

  /**
   * Register a callback for agent switch events.
   */
  onAgentSwitch(callback: (agentId: string | null) => void): void {
    this.onSwitchCallback = callback;
  }

  /**
   * Scroll the active agent's terminal to top.
   */
  scrollToTop(): void {
    if (this.activeAgentId == null) return;
    const entry = this.agents.get(this.activeAgentId);
    if (!entry) return;

    if (this.activeSide === "claude") {
      entry.claudeTerminal.scrollToTop();
    } else {
      entry.manualTerminal?.scrollToTop();
    }
  }

  /**
   * Scroll the active agent's terminal to bottom.
   */
  scrollToBottom(): void {
    if (this.activeAgentId == null) return;
    const entry = this.agents.get(this.activeAgentId);
    if (!entry) return;

    if (this.activeSide === "claude") {
      entry.claudeTerminal.scrollToBottom();
    } else {
      entry.manualTerminal?.scrollToBottom();
    }
  }

  /**
   * Dispose of all agent terminals and resources.
   */
  dispose(): void {
    // Cancel pending flush
    if (this.flushRafId != null) {
      cancelAnimationFrame(this.flushRafId);
      this.flushRafId = null;
    }
    if (this.flushTimeoutId != null) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    // Flush remaining output
    if (this.outputBuffer.size > 0) {
      this.flushOutputBuffer();
    }

    for (const entry of this.agents.values()) {
      entry.claudeTerminal.dispose();
      entry.manualTerminal?.dispose();
      entry.claudeContainer.remove();
      entry.manualContainer.remove();
    }

    this.agents.clear();
    this.miniTerminals.clear();
    this.pendingOutput.clear();
    this.outputBuffer.clear();
  }

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  private isAgentSessionKey(sessionKey: AnySessionKey): boolean {
    return typeof sessionKey === "string" && sessionKey.startsWith("agent-");
  }

  /**
   * Parse "agent-tests" → { agentId: "agent-tests", isManual: false }
   * Parse "agent-tests-manual" → { agentId: "agent-tests", isManual: true }
   */
  private parseAgentSessionKey(sessionKey: string): {
    agentId: string;
    isManual: boolean;
  } {
    if (sessionKey.endsWith("-manual")) {
      return {
        agentId: sessionKey.slice(0, -"-manual".length),
        isManual: true,
      };
    }
    return { agentId: sessionKey, isManual: false };
  }

  /**
   * Lazy-create the manual shell terminal for an agent.
   */
  private ensureManualTerminal(entry: AgentTerminalEntry): void {
    if (entry.manualTerminal) {
      return;
    }

    const manualKey = `${entry.agentId}-manual`;
    entry.manualTerminal = new Terminal(entry.manualContainer, this.ws, {
      sessionKey: manualKey,
      subscribeToOutput: false,
    });
    entry.manualTerminal.initialize();

    if (this.customKeyHandler) {
      entry.manualTerminal.setCustomKeyHandler(this.customKeyHandler);
    }
  }

  /**
   * Schedule an adaptive output flush (same pattern as TerminalManager).
   */
  private scheduleFlush(dataLength: number): void {
    const now = performance.now();
    const timeSinceLastFlush = now - this.lastFlushTime;

    const isSmallUpdate = dataLength < 50;
    const isRapidUpdate = timeSinceLastFlush < 33;

    if (isSmallUpdate && isRapidUpdate) {
      this.flushOutputBuffer();
    } else {
      if (this.flushRafId == null) {
        this.flushRafId = requestAnimationFrame(() => {
          this.flushOutputBuffer();
        });

        this.flushTimeoutId = window.setTimeout(() => {
          this.flushOutputBuffer();
        }, 16);
      }
    }
  }

  /**
   * Flush buffered output to agent terminals and mini-terminals.
   */
  private flushOutputBuffer(): void {
    this.lastFlushTime = performance.now();

    if (this.flushRafId != null) {
      cancelAnimationFrame(this.flushRafId);
      this.flushRafId = null;
    }
    if (this.flushTimeoutId != null) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    for (const [bufferKey, chunks] of this.outputBuffer.entries()) {
      if (chunks.length === 0) continue;

      const data = chunks.join("");
      const { agentId, isManual } = this.parseAgentSessionKey(bufferKey);

      const entry = this.agents.get(agentId);
      if (!entry) continue;

      if (isManual) {
        entry.manualTerminal?.write(data);
      } else {
        entry.claudeTerminal.write(data);

        // Tee to mini-terminal for overview pane
        const mini = this.miniTerminals.get(agentId);
        if (mini) {
          mini.write(data);
        }
      }
    }

    this.outputBuffer.clear();
  }
}
