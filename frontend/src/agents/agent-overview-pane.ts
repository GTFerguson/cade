/**
 * Agent overview pane for the right sidebar.
 *
 * Displays cards for each worker agent with state indicators,
 * mini-terminals showing recent output, and click-to-focus behavior.
 */

import { Terminal } from "../terminal/terminal";
import type { AgentManager, AgentInfo } from "./agent-manager";
import type { Component } from "../types";
import type { WebSocketClient } from "../platform/websocket";

export class AgentOverviewPane implements Component {
  private cards: Map<string, HTMLElement> = new Map();
  private miniTerminals: Map<string, Terminal> = new Map();
  private activeAgentId: string | null = null;
  private onAgentSelectCallback: ((agentId: string) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    private agentManager: AgentManager
  ) {}

  initialize(): void {
    this.container.className = "agent-overview-pane";
    this.render();
  }

  /**
   * Set callback for when an agent card is clicked.
   */
  onAgentSelect(callback: (agentId: string) => void): void {
    this.onAgentSelectCallback = callback;
  }

  /**
   * Highlight the active agent card.
   */
  setActiveAgent(agentId: string | null): void {
    this.activeAgentId = agentId;
    for (const [id, card] of this.cards.entries()) {
      card.classList.toggle("agent-card-active", id === agentId);
    }
  }

  /**
   * Re-render all agent cards from current state.
   */
  render(): void {
    this.disposeCards();
    this.container.innerHTML = "";

    const agents = this.agentManager.getAgentList();

    if (agents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "agent-overview-empty";
      empty.textContent = "No worker agents";
      this.container.appendChild(empty);
      return;
    }

    for (const agent of agents) {
      const card = this.buildCard(agent);
      this.container.appendChild(card);
      this.cards.set(agent.agentId, card);
    }
  }

  /**
   * Build a single agent card element.
   */
  private buildCard(agent: AgentInfo): HTMLElement {
    const card = document.createElement("div");
    card.className = "agent-card";
    if (agent.agentId === this.activeAgentId) {
      card.classList.add("agent-card-active");
    }

    // Header row: label + state badge
    const header = document.createElement("div");
    header.className = "agent-card-header";

    const labelEl = document.createElement("span");
    labelEl.className = "agent-card-label";
    labelEl.textContent = agent.label;

    const stateEl = document.createElement("span");
    stateEl.className = `agent-card-state agent-state-${agent.state}`;
    stateEl.textContent = agent.state;

    header.appendChild(labelEl);
    header.appendChild(stateEl);
    card.appendChild(header);

    // Mini-terminal container
    const miniContainer = document.createElement("div");
    miniContainer.className = "agent-card-mini-terminal";
    card.appendChild(miniContainer);

    const miniTerm = new Terminal(miniContainer, this.ws, {
      sessionKey: agent.agentId,
      subscribeToOutput: false,
      hideCursor: true,
      readOnly: true,
      fontSize: 10,
      rows: 6,
      scrollback: 100,
    });
    miniTerm.initialize();

    this.miniTerminals.set(agent.agentId, miniTerm);
    this.agentManager.registerMiniTerminal(agent.agentId, miniTerm);

    // Click-to-focus (guard against kill button clicks if added later)
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".agent-card-kill")) {
        return;
      }
      this.onAgentSelectCallback?.(agent.agentId);
    });

    return card;
  }

  /**
   * Dispose all mini-terminals and cards.
   */
  private disposeCards(): void {
    for (const [agentId, miniTerm] of this.miniTerminals.entries()) {
      this.agentManager.unregisterMiniTerminal(agentId);
      miniTerm.dispose();
    }
    this.miniTerminals.clear();
    this.cards.clear();
  }

  dispose(): void {
    this.disposeCards();
    this.container.innerHTML = "";
  }
}
