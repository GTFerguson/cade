/**
 * Manages worker agent ChatPane instances and switching.
 *
 * Owns all agent ChatPane instances, routes chat-stream events by agentId,
 * handles agent switching in the center pane.
 */

import { ChatPane } from "../chat/chat-pane";
import { wrapIndex } from "../nav";
import type { Component, ChatStreamMessage } from "../types";
import type { WebSocketClient } from "../platform/websocket";

export type AgentRole = "worker" | "primary";
export type AgentState = "pending" | "starting" | "idle" | "busy" | "done" | "error" | "review" | "closed";

export interface AgentInfo {
  agentId: string;
  label: string;
  role: AgentRole;
  state: AgentState;
  task: string;
}

interface AgentEntry {
  agentId: string;
  label: string;
  role: AgentRole;
  state: AgentState;
  task: string;
  chatPane: ChatPane;
  chatContainer: HTMLElement;
}

export class AgentManager implements Component {
  private agents: Map<string, AgentEntry> = new Map();
  private activeAgentId: string | null = null;
  private pendingChatEvents: Map<string, ChatStreamMessage[]> = new Map();

  // Callbacks
  private onSwitchCallback: ((agentId: string | null) => void) | null = null;
  private onPreviewUpdateCallback: ((agentId: string, text: string, toolCount: number) => void) | null = null;

  // Track last text snippet and tool count per agent for overview preview
  private previewState: Map<string, { lastText: string; toolCount: number }> = new Map();

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    _customKeyHandler: unknown,
  ) {}

  initialize(): void {
    // AgentManager starts empty — agents are created dynamically
  }

  /**
   * Create a new worker agent with its own ChatPane.
   * Flushes any chat events that arrived before the agent-spawned event.
   */
  createAgent(agentId: string, label: string, role: AgentRole, task: string = ""): void {
    if (this.agents.has(agentId)) {
      return;
    }

    const chatContainer = document.createElement("div");
    chatContainer.className = "terminal-container agent-chat";
    chatContainer.dataset["agent"] = agentId;
    chatContainer.style.display = "none";

    this.container.appendChild(chatContainer);

    const chatPane = new ChatPane(chatContainer, this.ws, {
      autoSubscribe: false,
      readOnly: true,
    });
    chatPane.initialize();

    const entry: AgentEntry = {
      agentId,
      label,
      role,
      state: "starting",
      task,
      chatPane,
      chatContainer,
    };

    this.agents.set(agentId, entry);
    this.previewState.set(agentId, { lastText: "", toolCount: 0 });

    // Flush any chat events that arrived before the agent was created
    const pending = this.pendingChatEvents.get(agentId);
    if (pending && pending.length > 0) {
      for (const msg of pending) {
        chatPane.feedChatStream(msg);
        this.trackPreview(agentId, msg);
      }
      this.pendingChatEvents.delete(agentId);
    }
  }

  /**
   * Destroy a worker agent and its ChatPane.
   * If this was the active agent, switches back to primary.
   */
  destroyAgent(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) {
      return;
    }

    if (this.activeAgentId === agentId) {
      this.switchToAgent(null);
    }

    entry.chatPane.dispose();
    entry.chatContainer.remove();

    this.agents.delete(agentId);
    this.pendingChatEvents.delete(agentId);
    this.previewState.delete(agentId);
  }

  /**
   * Route a chat-stream message to the correct agent's ChatPane.
   * Returns true if the message was handled (had a matching agentId).
   */
  routeChatStream(msg: ChatStreamMessage): boolean {
    const agentId = msg.agentId;
    if (!agentId) return false;

    const entry = this.agents.get(agentId);
    if (!entry) {
      // Buffer events for agents that haven't been created yet
      const pending = this.pendingChatEvents.get(agentId) ?? [];
      pending.push(msg);
      this.pendingChatEvents.set(agentId, pending);
      return true;
    }

    entry.chatPane.feedChatStream(msg);
    this.trackPreview(agentId, msg);
    return true;
  }

  /**
   * Switch the center pane to show an agent's ChatPane.
   * Pass null to switch back to the primary terminal.
   */
  switchToAgent(agentId: string | null): void {
    if (this.activeAgentId != null) {
      const current = this.agents.get(this.activeAgentId);
      if (current) {
        current.chatContainer.style.display = "none";
      }
    }

    this.activeAgentId = agentId;

    if (agentId != null) {
      const entry = this.agents.get(agentId);
      if (entry) {
        entry.chatContainer.style.display = "block";
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
    const newIndex = wrapIndex(currentIndex, delta, ids.length);
    this.switchToAgent(ids[newIndex]!);
  }

  /**
   * Toggle side is a no-op for ChatPane agents (no manual shell).
   */
  toggleSide(): void {
    // Agents use read-only ChatPanes, no manual terminal side
  }

  getActiveSide(): "claude" | "manual" {
    return "claude";
  }

  getActiveAgentId(): string | null {
    return this.activeAgentId;
  }

  updateAllThemes(): void {
    // ChatPane handles its own theming via CSS
  }

  fit(): void {
    // ChatPane auto-fits via CSS flex
  }

  sendSize(): void {
    // No PTY to resize
  }

  focus(): void {
    // ChatPane is read-only, nothing to focus
  }

  sendInput(_data: string): void {
    // Agents are read-only
  }

  setCustomKeyHandler(_handler: unknown): void {
    // No terminal key handler needed
  }

  updateAgentState(agentId: string, state: AgentState): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.state = state;
    }
  }

  hasAgents(): boolean {
    return this.agents.size > 0;
  }

  getAgentList(): AgentInfo[] {
    return Array.from(this.agents.values()).map((e) => ({
      agentId: e.agentId,
      label: e.label,
      role: e.role,
      state: e.state,
      task: e.task,
    }));
  }

  onAgentSwitch(callback: (agentId: string | null) => void): void {
    this.onSwitchCallback = callback;
  }

  /**
   * Register a callback for preview updates (used by overview pane).
   */
  onPreviewUpdate(callback: (agentId: string, text: string, toolCount: number) => void): void {
    this.onPreviewUpdateCallback = callback;
  }

  /**
   * Get the current preview state for an agent.
   */
  getPreviewState(agentId: string): { lastText: string; toolCount: number } | undefined {
    return this.previewState.get(agentId);
  }

  scrollToTop(): void {
    // ChatPane handles its own scrolling
  }

  scrollToBottom(): void {
    // ChatPane handles its own scrolling
  }

  dispose(): void {
    for (const entry of this.agents.values()) {
      entry.chatPane.dispose();
      entry.chatContainer.remove();
    }

    this.agents.clear();
    this.pendingChatEvents.clear();
    this.previewState.clear();
  }

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  /**
   * Track text snippets and tool counts for overview preview.
   */
  private trackPreview(agentId: string, msg: ChatStreamMessage): void {
    const state = this.previewState.get(agentId);
    if (!state) return;

    if (msg.event === "text-delta" && msg.content) {
      state.lastText = (state.lastText + msg.content).slice(-200);
    } else if (msg.event === "tool-use-start") {
      state.toolCount++;
    }

    this.onPreviewUpdateCallback?.(agentId, state.lastText, state.toolCount);
  }
}
