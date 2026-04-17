/**
 * Chat pane component for LLM API conversations.
 *
 * REPL-style UI: user input shown with ❯ prompt, assistant output
 * flows below. Streaming responses use MertexMD's createStreamRenderer
 * for incremental markdown rendering.
 */

import {
  MarkdownRenderer,
  type StreamRenderer,
} from "@core/chat/markdown-renderer";
import type { PaneKeyHandler } from "../input/keybindings";
import { MessageType } from "@core/platform/protocol";
import type {
  ChatHistoryMessage,
  ChatModeChangeMessage,
  ChatStreamMessage,
  Component,
} from "../types";
import type { WebSocketClient } from "../platform/websocket";
import { ChatInput } from "@core/chat/chat-input";
import { DiagramViewer } from "@core/chat/diagram-viewer";

/** Descriptions for well-known Claude Code slash commands */
const SLASH_DESCRIPTIONS: Record<string, string> = {
  plan: "Switch to Architect mode (read-only)",
  code: "Switch to Code mode (full access)",
  review: "Switch to Review mode (read-only)",
  compact: "Compact conversation context",
  cost: "Show token usage and cost",
  context: "Show context window usage",
  init: "Initialize project CLAUDE.md",
  "pr-comments": "Address PR review comments",
  "release-notes": "Generate release notes",
  "security-review": "Security review of changes",
  simplify: "Simplify and improve code",
  debug: "Debug an issue",
  batch: "Run batch operations",
  insights: "Show session insights",
};

const CADE_MERMAID_CONFIG = {
  securityLevel: "loose" as const,
  theme: "base" as const,
  themeVariables: {
    darkMode: true,
    background: "#111110",
    primaryColor: "#1a1918",
    primaryTextColor: "#f8f6f2",
    primaryBorderColor: "#0a9dff",
    secondaryColor: "#1a1918",
    secondaryTextColor: "#c4b9ad",
    secondaryBorderColor: "#aeee00",
    tertiaryColor: "#1a1918",
    tertiaryBorderColor: "#ff9eb0",
    lineColor: "#0a9dff",
    textColor: "#c4b9ad",
    mainBkg: "#1a1918",
    nodeBorder: "#0a9dff",
    clusterBkg: "#111110",
    clusterBorder: "#0a9dff",
    titleColor: "#f8f6f2",
    edgeLabelBackground: "#111110",
    nodeTextColor: "#f8f6f2",
    git0: "#0a9dff",
    git1: "#aeee00",
    git2: "#ff9eb0",
    git3: "#ffa724",
    git4: "#cf73e6",
    git5: "#0a9dff",
    git6: "#aeee00",
    git7: "#ff9eb0",
    gitBranchLabel0: "#f8f6f2",
    gitBranchLabel1: "#f8f6f2",
    gitBranchLabel2: "#f8f6f2",
    gitBranchLabel3: "#f8f6f2",
    gitInv0: "#0a9dff",
  },
};

export interface ChatPaneOptions {
  autoSubscribe?: boolean;
  readOnly?: boolean;
}

export class ChatPane implements Component, PaneKeyHandler {
  private messagesEl: HTMLElement;
  private inputArea: HTMLElement;
  private statuslineEl: HTMLElement;
  private modeEl: HTMLElement;
  private providerEl: HTMLElement;
  private tokensEl: HTMLElement;
  private chatInput: ChatInput | null = null;
  private renderer: MarkdownRenderer;
  private streamRenderer: StreamRenderer | null = null;
  private currentAssistantEl: HTMLElement | null = null;
  private totalTokens = 0;
  private diagramViewer: DiagramViewer | null = null;
  private activeToolEls: Map<string, HTMLElement> = new Map();
  private thinkingEl: HTMLElement | null = null;
  private thinkingContentEl: HTMLElement | null = null;
  private costEl: HTMLElement;
  private totalCost = 0;
  private systemInfo: { model?: string; slashCommands?: string[] } = {
    slashCommands: Object.keys(SLASH_DESCRIPTIONS),
  };
  private slashHintEl: HTMLElement | null = null;
  private isStreaming = false;
  private readonly autoSubscribe: boolean;
  private readonly readOnly: boolean;

  private boundHandlers = {
    chatStream: (msg: ChatStreamMessage) => {
      // When auto-subscribed, ignore events meant for agents
      if (msg.agentId) return;
      this.handleChatStream(msg);
    },
    chatHistory: (msg: ChatHistoryMessage) => this.handleChatHistory(msg),
    chatModeChange: (msg: ChatModeChangeMessage) => this.handleModeChange(msg),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    options?: ChatPaneOptions,
  ) {
    this.autoSubscribe = options?.autoSubscribe ?? true;
    this.readOnly = options?.readOnly ?? false;
    this.renderer = new MarkdownRenderer({
      mermaidConfig: CADE_MERMAID_CONFIG,
    });

    const pane = document.createElement("div");
    pane.className = "chat-pane";

    this.messagesEl = document.createElement("div");
    this.messagesEl.className = "chat-messages";

    this.inputArea = document.createElement("div");
    this.inputArea.className = "chat-input-area";

    // Statusline
    this.statuslineEl = document.createElement("div");
    this.statuslineEl.className = "chat-statusline";

    this.modeEl = document.createElement("span");
    this.modeEl.className = "status-mode";
    this.modeEl.textContent = "CHAT";

    this.providerEl = document.createElement("span");
    this.providerEl.className = "status-provider";
    this.providerEl.textContent = "";

    this.tokensEl = document.createElement("span");
    this.tokensEl.className = "status-tokens";
    this.tokensEl.textContent = "";

    this.costEl = document.createElement("span");
    this.costEl.className = "status-cost";
    this.costEl.textContent = "";

    this.statuslineEl.appendChild(this.modeEl);
    this.statuslineEl.appendChild(this.providerEl);
    this.statuslineEl.appendChild(this.tokensEl);
    this.statuslineEl.appendChild(this.costEl);

    if (!this.readOnly) {
      this.chatInput = new ChatInput(this.inputArea, (text) =>
        this.sendMessage(text),
      );
      this.chatInput.setOnCancel(() => this.cancelStream());
      this.chatInput.setOnSlashInput((text) => this.handleSlashInput(text));
    }

    // Open fullscreen viewer when clicking a mermaid diagram
    this.messagesEl.addEventListener("click", (e) => {
      const container = (e.target as HTMLElement).closest(".mermaid-container");
      if (!container) return;
      if (!this.diagramViewer) this.diagramViewer = new DiagramViewer();
      this.diagramViewer.show(container as HTMLElement);
    });

    pane.appendChild(this.messagesEl);
    if (!this.readOnly) {
      pane.appendChild(this.inputArea);
      pane.appendChild(this.statuslineEl);
    }
    this.container.appendChild(pane);
  }

  initialize(): void {
    if (this.autoSubscribe) {
      this.ws.on("chat-stream", this.boundHandlers.chatStream);
      this.ws.on("chat-history", this.boundHandlers.chatHistory);
      this.ws.on("chat-mode-change", this.boundHandlers.chatModeChange);
    }
  }

  /**
   * Feed a chat-stream message directly (used by AgentManager for per-agent routing).
   */
  feedChatStream(msg: ChatStreamMessage): void {
    this.handleChatStream(msg);
  }

  setProvider(name: string): void {
    this.providerEl.textContent = name;
  }

  setModeLabel(label: string): void {
    this.modeEl.textContent = label;
  }

  private currentMode = "code";

  getMode(): string {
    return this.currentMode;
  }

  setMode(mode: string): void {
    this.currentMode = mode;
    this.modeEl.textContent = mode.toUpperCase();
    this.modeEl.className = `status-mode ${mode}`;
  }

  private updateTokenCount(usage?: { prompt_tokens?: number; completion_tokens?: number }): void {
    if (!usage) return;
    const total = (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
    if (total > 0) {
      this.totalTokens += total;
      this.tokensEl.textContent = `${this.totalTokens.toLocaleString()} tokens`;
    }
  }

  private updateCost(cost?: number): void {
    if (cost == null || cost <= 0) return;
    this.totalCost += cost;
    this.costEl.textContent = `$${this.totalCost.toFixed(2)}`;
  }

  private handleSlashInput(text: string): void {
    if (this.readOnly) return;

    const commands = this.systemInfo.slashCommands;
    if (!commands || commands.length === 0) {
      this.hideSlashHints();
      return;
    }

    if (text.startsWith("/") && !text.includes(" ")) {
      const query = text.slice(1).toLowerCase();
      const matches = commands.filter((c) => c.toLowerCase().startsWith(query));
      if (matches.length > 0) {
        this.showSlashHints(matches);
        return;
      }
    }

    this.hideSlashHints();
  }

  private showSlashHints(commands: string[]): void {
    if (!this.slashHintEl) {
      this.slashHintEl = document.createElement("div");
      this.slashHintEl.className = "chat-slash-hints";
      this.inputArea.insertBefore(this.slashHintEl, this.inputArea.firstChild);
    }

    this.slashHintEl.innerHTML = "";
    for (const cmd of commands.slice(0, 8)) {
      const row = document.createElement("div");
      row.className = "chat-slash-row";

      const name = document.createElement("span");
      name.className = "chat-slash-name";
      name.textContent = `/${cmd}`;

      const desc = document.createElement("span");
      desc.className = "chat-slash-desc";
      desc.textContent = SLASH_DESCRIPTIONS[cmd] ?? "";

      row.appendChild(name);
      if (desc.textContent) row.appendChild(desc);

      row.addEventListener("click", () => {
        this.chatInput?.setValue(`/${cmd}`);
        this.hideSlashHints();
        this.chatInput?.focus();
      });

      this.slashHintEl.appendChild(row);
    }
    this.slashHintEl.style.display = "block";
  }

  private hideSlashHints(): void {
    if (this.slashHintEl) {
      this.slashHintEl.style.display = "none";
    }
  }

  private cancelStream(): void {
    if (this.isStreaming) {
      this.ws.sendChatCancel();
    }
  }

  private sendMessage(text: string): void {
    this.hideSlashHints();

    const userEl = document.createElement("div");
    userEl.className = "chat-message user";

    const textEl = document.createElement("div");
    textEl.className = "chat-message-text";
    textEl.textContent = text;

    userEl.appendChild(textEl);
    this.messagesEl.appendChild(userEl);
    this.scrollToBottom();

    this.ws.sendChatMessage(text);
    this.chatInput?.setDisabled(true);
    this.isStreaming = true;
  }

  private handleChatStream(msg: ChatStreamMessage): void {
    switch (msg.event) {
      case "system-info":
        this.handleSystemInfo(msg);
        break;
      case "user-message":
        this.handleUserMessage(msg.content ?? "");
        break;
      case "text-delta":
        this.handleTextDelta(msg.content ?? "");
        break;
      case "thinking-delta":
        this.handleThinkingDelta(msg.content ?? "");
        break;
      case "tool-use-start":
        this.handleToolUseStart(msg.toolId ?? "", msg.toolName ?? "", msg.toolInput);
        break;
      case "tool-result":
        this.handleToolResult(msg.toolId ?? "", msg.toolName ?? "", msg.status ?? "success", msg.content);
        break;
      case "done":
        this.handleDone(msg);
        break;
      case "error":
        this.handleError(msg.message ?? "Unknown error");
        break;
      case "agent-approval-request":
        this.handleAgentApprovalRequest(msg);
        break;
      case "agent-approval-resolved":
        this.handleAgentApprovalResolved(msg);
        break;
      case "report-review-request":
        this.handleReportReviewRequest(msg);
        break;
      case "permission-request":
        this.handlePermissionRequest(msg);
        break;
      case "permission-resolved":
        this.handlePermissionResolved(msg);
        break;
    }
  }

  private handleUserMessage(content: string): void {
    const userEl = document.createElement("div");
    userEl.className = "chat-message user";

    const textEl = document.createElement("div");
    textEl.className = "chat-message-text";
    textEl.textContent = content;

    userEl.appendChild(textEl);
    this.messagesEl.appendChild(userEl);
    this.scrollToBottom();
  }

  private handleSystemInfo(msg: ChatStreamMessage): void {
    if (msg.model) this.systemInfo.model = msg.model;
    if (msg.slashCommands) this.systemInfo.slashCommands = msg.slashCommands;
    if (msg.model) {
      this.providerEl.textContent = msg.model;
    }
  }

  private handleTextDelta(content: string): void {
    this.ensureAssistantEl();
    this.finalizeThinking();

    if (!this.streamRenderer) {
      const contentEl = this.currentAssistantEl!.querySelector(".chat-message-content")!;
      // Create a sub-container for this text segment so stream renderer
      // doesn't interfere with already-inserted tool/thinking blocks
      const segment = document.createElement("div");
      segment.className = "chat-text-segment";
      contentEl.appendChild(segment);
      this.streamRenderer = this.renderer.createStream(segment);
    }

    this.streamRenderer.appendContent(content);
    this.scrollToBottom();
  }

  private handleThinkingDelta(content: string): void {
    this.ensureAssistantEl();

    if (!this.thinkingEl) {
      // Finalize any in-progress text stream before inserting thinking block
      if (this.streamRenderer) {
        this.streamRenderer.finalize();
        this.streamRenderer = null;
      }

      this.thinkingEl = document.createElement("div");
      this.thinkingEl.className = "chat-thinking";

      const toggle = document.createElement("div");
      toggle.className = "chat-thinking-toggle";

      const chevron = document.createElement("span");
      chevron.className = "chevron open";
      chevron.textContent = "\u25B8"; // ▸

      const label = document.createElement("span");
      label.textContent = "thinking\u2026";

      toggle.appendChild(chevron);
      toggle.appendChild(label);

      this.thinkingContentEl = document.createElement("div");
      this.thinkingContentEl.className = "chat-thinking-content";

      toggle.addEventListener("click", () => {
        chevron.classList.toggle("open");
        const isOpen = chevron.classList.contains("open");
        this.thinkingContentEl!.style.display = isOpen ? "block" : "none";
      });

      this.thinkingEl.appendChild(toggle);
      this.thinkingEl.appendChild(this.thinkingContentEl);

      const contentEl = this.currentAssistantEl!.querySelector(".chat-message-content");
      if (contentEl) {
        contentEl.appendChild(this.thinkingEl);
      }
    }

    if (this.thinkingContentEl) {
      this.thinkingContentEl.textContent += content;
    }
    this.scrollToBottom();
  }

  private finalizeThinking(): void {
    if (this.thinkingEl) {
      // Collapse thinking block when done
      const chevron = this.thinkingEl.querySelector(".chevron");
      if (chevron) {
        chevron.classList.remove("open");
      }
      if (this.thinkingContentEl) {
        this.thinkingContentEl.style.display = "none";
      }
      // Update label to show "thought"
      const label = this.thinkingEl.querySelector(".chat-thinking-toggle span:last-child");
      if (label) {
        label.textContent = "thought";
      }
      this.thinkingEl = null;
      this.thinkingContentEl = null;
    }
  }

  private handleToolUseStart(
    toolId: string,
    toolName: string,
    toolInput?: Record<string, unknown>,
  ): void {
    this.ensureAssistantEl();

    // Finalize any in-progress text stream before inserting tool block
    if (this.streamRenderer) {
      this.streamRenderer.finalize();
      this.streamRenderer = null;
    }
    this.finalizeThinking();

    const toolEl = document.createElement("div");
    toolEl.className = "chat-tool-use chat-tool-use--running";

    const header = document.createElement("div");
    header.className = "chat-tool-header";

    const icon = document.createElement("span");
    icon.className = "chat-tool-icon running";
    icon.textContent = "\u25B8"; // ▸

    const name = document.createElement("span");
    name.className = "chat-tool-name";
    name.textContent = toolName;

    // Show key input context (file path, pattern, command)
    const inputSummary = this.summarizeToolInput(toolName, toolInput);
    if (inputSummary) {
      const inputEl = document.createElement("span");
      inputEl.className = "chat-tool-input";
      inputEl.textContent = inputSummary;
      header.appendChild(icon);
      header.appendChild(name);
      header.appendChild(inputEl);
    } else {
      header.appendChild(icon);
      header.appendChild(name);
    }

    const status = document.createElement("span");
    status.className = "chat-tool-status";
    status.textContent = "running\u2026";
    header.appendChild(status);

    toolEl.appendChild(header);

    const contentEl = this.currentAssistantEl!.querySelector(".chat-message-content");
    if (contentEl) {
      contentEl.appendChild(toolEl);
    }

    this.activeToolEls.set(toolId, toolEl);
    this.scrollToBottom();
  }

  private handleToolResult(
    toolId: string,
    _toolName: string,
    status: string,
    content?: string,
  ): void {
    const toolEl = this.activeToolEls.get(toolId);
    if (!toolEl) return;

    toolEl.classList.remove("chat-tool-use--running");
    toolEl.classList.add(
      status === "error" ? "chat-tool-use--error" : "chat-tool-use--success",
    );

    const icon = toolEl.querySelector(".chat-tool-icon");
    const statusEl = toolEl.querySelector(".chat-tool-status");

    if (icon) {
      icon.classList.remove("running");
      if (status === "error") {
        icon.classList.add("error");
        icon.textContent = "\u2717"; // ✗
      } else {
        icon.classList.add("success");
        icon.textContent = "\u2713"; // ✓
      }
    }

    if (statusEl) {
      statusEl.textContent = status === "error" ? "failed" : "done";
    }

    // Add collapsible result content body
    if (content && content.trim()) {
      const lines = content.split("\n");
      const lineCount = lines.length;

      // Update status with line/match count
      if (statusEl && status !== "error") {
        if (lineCount > 1) {
          statusEl.textContent = `${lineCount} lines`;
        }
      }

      // Create collapsible body
      const body = document.createElement("div");
      body.className = "chat-tool-body";

      const pre = document.createElement("div");
      pre.className = status === "error"
        ? "chat-tool-content chat-tool-content--error"
        : "chat-tool-content";

      // Show truncated preview (first 20 lines)
      const maxPreview = 20;
      const previewLines = lines.slice(0, maxPreview);
      pre.textContent = previewLines.join("\n");
      body.appendChild(pre);

      if (lineCount > maxPreview) {
        const more = document.createElement("div");
        more.className = "chat-tool-more";
        more.textContent = `\u2193 ${lineCount - maxPreview} more lines`;
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          pre.textContent = content;
          more.remove();
        });
        body.appendChild(more);
      }

      toolEl.appendChild(body);

      // Add chevron for collapse toggle
      const header = toolEl.querySelector(".chat-tool-header");
      const chevron = document.createElement("span");
      chevron.className = "chat-tool-chevron";
      chevron.textContent = "\u203A"; // ›
      header?.appendChild(chevron);

      // Toggle body on header click
      header?.addEventListener("click", () => {
        toolEl.classList.toggle("chat-tool-use--expanded");
      });
    }

    this.activeToolEls.delete(toolId);
    this.scrollToBottom();
  }

  /**
   * Extract the most useful context from tool input for display.
   */
  private summarizeToolInput(
    toolName: string,
    input?: Record<string, unknown>,
  ): string {
    if (!input) return "";

    switch (toolName) {
      case "Read":
        return String(input.file_path ?? "");
      case "Write":
        return String(input.file_path ?? "");
      case "Edit":
        return String(input.file_path ?? "");
      case "Glob":
        return String(input.pattern ?? "");
      case "Grep":
        return `${input.pattern ?? ""}${input.path ? " in " + input.path : ""}`;
      case "Bash":
        return String(input.command ?? input.description ?? "");
      case "Agent":
        return String(input.description ?? input.prompt ?? "").slice(0, 60);
      case "WebSearch":
      case "WebFetch":
        return String(input.query ?? input.url ?? "");
      default: {
        // Generic: show first string-valued field
        for (const val of Object.values(input)) {
          if (typeof val === "string" && val.length > 0 && val.length < 200) {
            return val;
          }
        }
        return "";
      }
    }
  }

  /**
   * Ensure the assistant message container exists for inserting content blocks.
   */
  private ensureAssistantEl(): void {
    if (!this.currentAssistantEl) {
      this.currentAssistantEl = document.createElement("div");
      this.currentAssistantEl.className = "chat-message assistant";

      const contentEl = document.createElement("div");
      contentEl.className = "chat-message-content";
      this.currentAssistantEl.appendChild(contentEl);

      this.messagesEl.appendChild(this.currentAssistantEl);
    }
  }

  private async handleDone(msg: ChatStreamMessage): Promise<void> {
    this.isStreaming = false;

    if (msg.cancelled) {
      // Show cancelled indicator
      this.ensureAssistantEl();
      const cancelEl = document.createElement("div");
      cancelEl.className = "chat-cancelled";
      cancelEl.textContent = "(cancelled)";
      const contentEl = this.currentAssistantEl!.querySelector(".chat-message-content");
      if (contentEl) contentEl.appendChild(cancelEl);
    }

    const targetEl = this.currentAssistantEl;
    const content = (this.streamRenderer as any)?.content as string | undefined;
    await this.streamRenderer?.finalize();
    this.streamRenderer = null;
    this.finalizeThinking();
    this.activeToolEls.clear();
    this.currentAssistantEl = null;
    if (targetEl && content) await this.renderer.renderRemainingDiagrams(targetEl, content);

    if (!msg.cancelled) {
      this.updateTokenCount(msg.usage);
      this.updateCost(msg.cost);
    }

    this.chatInput?.setDisabled(false);
    this.chatInput?.focus();
  }

  private handleError(message: string): void {
    this.isStreaming = false;

    const errorEl = document.createElement("div");
    errorEl.className = "chat-message error";
    errorEl.textContent = message;
    this.messagesEl.appendChild(errorEl);
    this.scrollToBottom();

    if (this.streamRenderer) {
      this.streamRenderer.finalize();
      this.streamRenderer = null;
    }
    this.finalizeThinking();
    this.activeToolEls.clear();
    this.currentAssistantEl = null;

    this.chatInput?.setDisabled(false);
    this.chatInput?.focus();
  }

  private async handleChatHistory(msg: ChatHistoryMessage): Promise<void> {
    this.messagesEl.innerHTML = "";

    for (const message of msg.messages) {
      const el = document.createElement("div");
      el.className = `chat-message ${message.role}`;

      if (message.role === "assistant") {
        const contentEl = document.createElement("div");
        contentEl.className = "chat-message-content";
        el.appendChild(contentEl);
        this.messagesEl.appendChild(el);
        await this.renderer.render(contentEl, message.content);
        await this.renderer.renderRemainingDiagrams(contentEl, message.content);
      } else if (message.role === "user") {
        const textEl = document.createElement("div");
        textEl.className = "chat-message-text";
        textEl.textContent = message.content;
        el.appendChild(textEl);
        this.messagesEl.appendChild(el);
      } else {
        el.textContent = message.content;
        this.messagesEl.appendChild(el);
      }
    }

    this.scrollToBottom();
  }

  // ── Inline approval / report review blocks ────────────────────

  private handleAgentApprovalRequest(msg: ChatStreamMessage): void {
    const targetId = msg.targetAgentId;
    if (!targetId) return;

    const block = document.createElement("div");
    block.className = "chat-agent-approval";
    block.dataset["targetAgentId"] = targetId;

    const header = document.createElement("div");
    header.className = "chat-agent-approval-header";
    header.textContent = `Agent: ${msg.name ?? "unknown"}`;

    const taskEl = document.createElement("div");
    taskEl.className = "chat-agent-approval-task";
    taskEl.textContent = msg.task ?? "";

    const modeEl = document.createElement("div");
    modeEl.className = "chat-agent-approval-mode";
    modeEl.textContent = `mode: ${msg.mode ?? "code"}`;

    const actions = document.createElement("div");
    actions.className = "chat-agent-approval-actions";

    const approveBtn = document.createElement("button");
    approveBtn.className = "agent-approval-btn approve";
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => {
      this.ws.sendAgentApprove(targetId);
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "agent-approval-btn reject";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => {
      this.ws.sendAgentReject(targetId);
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);

    block.appendChild(header);
    block.appendChild(taskEl);
    block.appendChild(modeEl);
    block.appendChild(actions);

    this.ensureAssistantEl();
    if (this.streamRenderer) {
      this.streamRenderer.finalize();
      this.streamRenderer = null;
    }

    const contentEl = this.currentAssistantEl!.querySelector(".chat-message-content");
    if (contentEl) {
      contentEl.appendChild(block);
    }
    this.scrollToBottom();
  }

  private handleAgentApprovalResolved(msg: ChatStreamMessage): void {
    const targetId = msg.targetAgentId;
    if (!targetId) return;

    const block = this.messagesEl.querySelector(
      `.chat-agent-approval[data-target-agent-id="${targetId}"]`
    );
    if (!block) return;

    const actions = block.querySelector(".chat-agent-approval-actions");
    if (actions) {
      const status = document.createElement("div");
      status.className = "chat-agent-approval-status";
      const approved = msg.resolution === "approved";
      status.textContent = approved ? "Approved" : "Rejected";
      status.classList.add(approved ? "approved" : "rejected");
      actions.replaceWith(status);
    }
  }

  private handleReportReviewRequest(msg: ChatStreamMessage): void {
    const block = document.createElement("div");
    block.className = "chat-report-review";
    if (msg.agentId) block.dataset["agentId"] = msg.agentId;

    const header = document.createElement("div");
    header.className = "chat-report-review-header";
    header.textContent = "Agent Report";

    const preview = document.createElement("div");
    preview.className = "chat-report-review-preview";
    preview.textContent = msg.report ?? "(no report)";

    if (msg.cost != null && msg.cost > 0) {
      const costEl = document.createElement("div");
      costEl.className = "chat-report-review-cost";
      costEl.textContent = `cost: $${msg.cost.toFixed(4)}`;
      block.appendChild(costEl);
    }

    const actions = document.createElement("div");
    actions.className = "chat-agent-approval-actions";

    const agentId = msg.agentId;

    const approveBtn = document.createElement("button");
    approveBtn.className = "agent-approval-btn approve";
    approveBtn.textContent = "Approve Report";
    approveBtn.addEventListener("click", () => {
      if (agentId) this.ws.sendAgentApproveReport(agentId);
      actions.replaceWith(this.makeStatusEl("Approved", "approved"));
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "agent-approval-btn reject";
    rejectBtn.textContent = "Reject Report";
    rejectBtn.addEventListener("click", () => {
      if (agentId) this.ws.sendAgentRejectReport(agentId);
      actions.replaceWith(this.makeStatusEl("Rejected", "rejected"));
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);

    block.appendChild(header);
    block.appendChild(preview);
    block.appendChild(actions);

    this.messagesEl.appendChild(block);
    this.scrollToBottom();
  }

  private handlePermissionRequest(msg: ChatStreamMessage): void {
    this.ensureAssistantEl();

    if (this.streamRenderer) {
      this.streamRenderer.finalize();
      this.streamRenderer = null;
    }
    this.finalizeThinking();

    const block = document.createElement("div");
    block.className = "chat-tool-use chat-tool-use--approval";
    if (msg.requestId) block.dataset["requestId"] = msg.requestId;

    // Header
    const header = document.createElement("div");
    header.className = "chat-tool-header";

    const icon = document.createElement("span");
    icon.className = "chat-tool-icon chat-tool-icon--approval";
    icon.textContent = "\u26A1"; // ⚡

    const name = document.createElement("span");
    name.className = "chat-tool-name";
    name.textContent = msg.toolName ?? "Tool";

    header.appendChild(icon);
    header.appendChild(name);

    const inputSummary = this.summarizeToolInput(
      msg.toolName ?? "",
      msg.toolInput,
    );
    if (inputSummary) {
      const inputEl = document.createElement("span");
      inputEl.className = "chat-tool-input";
      inputEl.textContent = inputSummary;
      header.appendChild(inputEl);
    }

    block.appendChild(header);

    // Approval body
    const approval = document.createElement("div");
    approval.className = "chat-tool-approval";

    if (msg.description) {
      const desc = document.createElement("div");
      desc.className = "chat-tool-approval-desc";
      desc.textContent = msg.description;
      approval.appendChild(desc);
    }

    const actions = document.createElement("div");
    actions.className = "chat-tool-approval-actions";

    const requestId = msg.requestId;

    const allowBtn = document.createElement("button");
    allowBtn.className = "chat-tool-approval-btn chat-tool-approval-btn--approve";
    allowBtn.textContent = "Allow";
    allowBtn.addEventListener("click", () => {
      if (requestId) {
        this.ws.send({
          type: MessageType.PERMISSION_APPROVE,
          requestId,
        } as any);
      }
      block.classList.remove("chat-tool-use--approval");
      block.classList.add("chat-tool-use--running");
      icon.className = "chat-tool-icon running";
      icon.textContent = "\u25B8"; // ▸
      approval.remove();
      const status = document.createElement("span");
      status.className = "chat-tool-status";
      status.textContent = "running\u2026";
      header.appendChild(status);
    });

    const denyBtn = document.createElement("button");
    denyBtn.className = "chat-tool-approval-btn chat-tool-approval-btn--deny";
    denyBtn.textContent = "Deny";
    denyBtn.addEventListener("click", () => {
      if (requestId) {
        this.ws.send({
          type: MessageType.PERMISSION_DENY,
          requestId,
        } as any);
      }
      block.classList.remove("chat-tool-use--approval");
      icon.textContent = "\u2013"; // –
      icon.className = "chat-tool-icon";
      icon.style.color = "var(--text-muted)";
      approval.innerHTML = "";
      const denied = document.createElement("div");
      denied.className = "chat-tool-approval-resolved";
      denied.textContent = "denied";
      denied.style.color = "var(--text-muted)";
      approval.appendChild(denied);
    });

    const hint = document.createElement("span");
    hint.className = "chat-tool-approval-hint";
    hint.textContent = "y / n";

    actions.appendChild(allowBtn);
    actions.appendChild(denyBtn);
    actions.appendChild(hint);
    approval.appendChild(actions);
    block.appendChild(approval);

    const contentEl = this.currentAssistantEl?.querySelector(".chat-message-content");
    if (contentEl) {
      contentEl.appendChild(block);
    } else {
      this.messagesEl.appendChild(block);
    }
    this.scrollToBottom();
  }

  private handlePermissionResolved(msg: ChatStreamMessage): void {
    if (!msg.requestId) return;
    const block = this.messagesEl.querySelector(
      `[data-request-id="${msg.requestId}"]`,
    ) as HTMLElement | null;
    if (!block) return;

    block.classList.remove("chat-tool-use--approval", "chat-tool-use--running");
    const icon = block.querySelector(".chat-tool-icon");

    if (msg.decision === "allow") {
      block.classList.add("chat-tool-use--success");
      if (icon) {
        icon.className = "chat-tool-icon success";
        icon.textContent = "\u2713"; // ✓
      }
    } else {
      if (icon) {
        icon.textContent = "\u2013"; // –
        icon.className = "chat-tool-icon";
        (icon as HTMLElement).style.color = "var(--text-muted)";
      }
    }
  }

  private makeStatusEl(text: string, cls: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `chat-agent-approval-status ${cls}`;
    el.textContent = text;
    return el;
  }

  /**
   * Find the first unresolved spawn approval block and return its target agent ID.
   */
  getPendingApprovalAgentId(): string | null {
    const blocks = this.messagesEl.querySelectorAll(".chat-agent-approval");
    for (const block of blocks) {
      if (block.querySelector(".chat-agent-approval-actions")) {
        return (block as HTMLElement).dataset["targetAgentId"] ?? null;
      }
    }
    return null;
  }

  /**
   * Find the first unresolved report review block and return its agent ID.
   */
  getPendingReportAgentId(): string | null {
    const blocks = this.messagesEl.querySelectorAll(".chat-report-review");
    for (const block of blocks) {
      if (block.querySelector(".chat-agent-approval-actions")) {
        return (block as HTMLElement).dataset["agentId"] ?? null;
      }
    }
    return null;
  }

  /**
   * Programmatically approve the first pending spawn approval block.
   */
  approveSpawn(agentId: string): void {
    const block = this.messagesEl.querySelector(
      `.chat-agent-approval[data-target-agent-id="${agentId}"]`
    );
    if (!block) return;
    const btn = block.querySelector(".agent-approval-btn.approve") as HTMLElement | null;
    btn?.click();
  }

  /**
   * Programmatically reject the first pending spawn approval block.
   */
  rejectSpawn(agentId: string): void {
    const block = this.messagesEl.querySelector(
      `.chat-agent-approval[data-target-agent-id="${agentId}"]`
    );
    if (!block) return;
    const btn = block.querySelector(".agent-approval-btn.reject") as HTMLElement | null;
    btn?.click();
  }

  /**
   * Programmatically approve a pending report review block.
   */
  approveReport(agentId: string): void {
    const block = this.messagesEl.querySelector(
      `.chat-report-review[data-agent-id="${agentId}"]`
    );
    if (!block) return;
    const btn = block.querySelector(".agent-approval-btn.approve") as HTMLElement | null;
    btn?.click();
  }

  /**
   * Programmatically reject a pending report review block.
   */
  rejectReport(agentId: string): void {
    const block = this.messagesEl.querySelector(
      `.chat-report-review[data-agent-id="${agentId}"]`
    );
    if (!block) return;
    const btn = block.querySelector(".agent-approval-btn.reject") as HTMLElement | null;
    btn?.click();
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  // --- PaneKeyHandler interface ---

  private lastKeyTime = 0;
  private lastKey = "";

  handleKeydown(e: KeyboardEvent): boolean {
    // Only handle keys when chat input is blurred (normal mode)
    if (this.chatInput?.isFocused()) {
      return false;
    }

    switch (e.key) {
      case "i":
        this.chatInput?.focus();
        return true;
      case "j":
        this.messagesEl.scrollBy({ top: 60 });
        return true;
      case "k":
        this.messagesEl.scrollBy({ top: -60 });
        return true;
      case "G":
        this.scrollToBottom();
        return true;
      case "g": {
        const now = Date.now();
        if (this.lastKey === "g" && now - this.lastKeyTime < 500) {
          this.messagesEl.scrollTop = 0;
          this.lastKey = "";
          return true;
        }
        this.lastKey = "g";
        this.lastKeyTime = now;
        return true;
      }
      default:
        return false;
    }
  }

  focus(): void {
    this.chatInput?.focus();
  }

  blur(): void {
    this.chatInput?.blur();
  }

  private handleModeChange(msg: ChatModeChangeMessage): void {
    this.setMode(msg.mode);
    // Mode commands (e.g. /orch) are intercepted server-side and never
    // reach the CC subprocess, so no "done" event fires. Re-enable input.
    this.isStreaming = false;
    this.chatInput?.setDisabled(false);
    this.chatInput?.focus();
  }

  dispose(): void {
    if (this.autoSubscribe) {
      this.ws.off("chat-stream", this.boundHandlers.chatStream);
      this.ws.off("chat-history", this.boundHandlers.chatHistory);
      this.ws.off("chat-mode-change", this.boundHandlers.chatModeChange);
    }
    this.chatInput?.dispose();
    this.diagramViewer?.dispose();
  }
}
