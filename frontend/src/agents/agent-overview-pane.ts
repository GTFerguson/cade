/**
 * Agent overview pane for the right sidebar.
 *
 * Displays cards for each worker agent with state indicators,
 * task description, text preview, and click-to-focus behavior.
 */

import type { AgentManager, AgentInfo } from "./agent-manager";
import type { Component } from "../types";
import type { WebSocketClient } from "../platform/websocket";

export class AgentOverviewPane implements Component {
  private cards: Map<string, HTMLElement> = new Map();
  private previews: Map<string, HTMLElement> = new Map();
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

    // Subscribe to preview updates from AgentManager
    this.agentManager.onPreviewUpdate((agentId, text, toolCount) => {
      this.updatePreview(agentId, text, toolCount);
    });
  }

  onAgentSelect(callback: (agentId: string) => void): void {
    this.onAgentSelectCallback = callback;
  }

  setActiveAgent(agentId: string | null): void {
    this.activeAgentId = agentId;
    for (const [id, card] of this.cards.entries()) {
      card.classList.toggle("agent-card-active", id === agentId);
    }
  }

  render(): void {
    this.cards.clear();
    this.previews.clear();
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
    stateEl.className = "agent-card-state-led";

    const led = document.createElement("span");
    led.className = `agent-led agent-led-${agent.state}`;

    const stateText = document.createElement("span");
    stateText.textContent = agent.state;

    stateEl.appendChild(led);
    stateEl.appendChild(stateText);

    header.appendChild(labelEl);
    header.appendChild(stateEl);
    card.appendChild(header);

    // Task description
    if (agent.task) {
      const taskEl = document.createElement("div");
      taskEl.className = "agent-card-task";
      taskEl.textContent = agent.task.length > 80
        ? agent.task.slice(0, 80) + "..."
        : agent.task;
      card.appendChild(taskEl);
    }

    // Review-state report approval actions
    if (agent.state === "review") {
      const actions = document.createElement("div");
      actions.className = "agent-card-actions";

      const approveBtn = document.createElement("button");
      approveBtn.className = "agent-approval-btn approve";
      approveBtn.textContent = "Approve Report";
      approveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.ws.sendAgentApproveReport(agent.agentId);
      });

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "agent-approval-btn reject";
      rejectBtn.textContent = "Reject Report";
      rejectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.ws.sendAgentRejectReport(agent.agentId);
      });

      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
      card.appendChild(actions);
    }

    // Text preview
    {
      const previewEl = document.createElement("div");
      previewEl.className = "agent-card-preview";
      card.appendChild(previewEl);
      this.previews.set(agent.agentId, previewEl);

      const state = this.agentManager.getPreviewState(agent.agentId);
      if (state) {
        this.updatePreviewEl(previewEl, state.lastText, state.toolCount);
      }
    }

    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".agent-card-kill") ||
          (e.target as HTMLElement).closest(".agent-approval-btn")) {
        return;
      }
      this.onAgentSelectCallback?.(agent.agentId);
    });

    return card;
  }

  private updatePreview(agentId: string, text: string, toolCount: number): void {
    const previewEl = this.previews.get(agentId);
    if (previewEl) {
      this.updatePreviewEl(previewEl, text, toolCount);
    }
  }

  private updatePreviewEl(el: HTMLElement, text: string, toolCount: number): void {
    // Show last ~100 chars of text + tool count
    const lines: string[] = [];
    if (toolCount > 0) {
      lines.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""} used`);
    }
    const snippet = text.slice(-100).trim();
    if (snippet) {
      lines.push(snippet);
    }
    el.textContent = lines.join("\n") || "waiting...";
  }

  dispose(): void {
    this.cards.clear();
    this.previews.clear();
    this.container.innerHTML = "";
  }
}
