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
  ChatCompactMessage,
  CompactPreviewMessage,
  ChatHistoryMessage,
  ChatModeChangeMessage,
  ChatStreamMessage,
  Component,
} from "../types";
import type { WebSocketClient } from "../platform/websocket";
import { ChatInput } from "@core/chat/chat-input";
import { DiagramViewer } from "@core/chat/diagram-viewer";
import { ContextBudgetIndicator } from "../components/context-budget-indicator";
import { PermissionsButton } from "./permissions-button";
import { MCPStatusIcon, type MCPEntry } from "./mcp-status-icon";
import { linkifyElement, patchLinks } from "@core/chat/linkify";

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
  onOpenFile?: (path: string) => void;
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
  private contextBudget: ContextBudgetIndicator | null = null;
  private permissionsButton: PermissionsButton | null = null;
  private mcpStatusIcon: MCPStatusIcon | null = null;
  private systemInfo: { model?: string; slashCommands: Array<{ name: string; description: string }> } = {
    slashCommands: [],
  };
  private onModelNameChange: (() => void) | null = null;
  private slashHintEl: HTMLElement | null = null;
  private slashMenu: {
    items: Array<{ name: string; description: string }>;
    selectedName: string | null;
  } = { items: [], selectedName: null };
  private isStreaming = false;
  private queuedMessage: string | null = null;
  private readonly autoSubscribe: boolean;
  private readonly readOnly: boolean;
  private readonly onOpenFile: ((path: string) => void) | null;

  // Scroll-lock: track whether new content should auto-scroll to bottom.
  // Disabled when the user manually scrolls up; re-enabled when they scroll
  // back near the bottom, or when new content arrives after 60s of no scrolling.
  private autoScroll = true;
  private lastUserScrollAt = 0;
  private static readonly NEAR_BOTTOM_PX = 100;
  private static readonly REATTACH_AFTER_MS = 60_000;

  private boundHandlers = {
    chatStream: (msg: ChatStreamMessage) => {
      // When auto-subscribed, ignore events meant for agents
      if (msg.agentId) return;
      this.handleChatStream(msg);
    },
    chatHistory: (msg: ChatHistoryMessage) => this.handleChatHistory(msg),
    chatModeChange: (msg: ChatModeChangeMessage) => this.handleModeChange(msg),
    chatCompact: (msg: ChatCompactMessage) => this.handleCompact(msg),
    compactPreview: (msg: CompactPreviewMessage) => this.handleCompactPreview(msg),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
    options?: ChatPaneOptions,
  ) {
    this.autoSubscribe = options?.autoSubscribe ?? true;
    this.readOnly = options?.readOnly ?? false;
    this.onOpenFile = options?.onOpenFile ?? null;
    this.renderer = new MarkdownRenderer({
      mermaidConfig: CADE_MERMAID_CONFIG,
      selfCorrect: {
        fix: async (code: string, format: string, error: string): Promise<string> => {
          const res = await fetch("/api/fix-diagram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, format, error }),
          });
          if (!res.ok) throw new Error(`fix-diagram ${res.status}`);
          const data = await res.json() as { code?: string; error?: string };
          if (!data.code) throw new Error(data.error ?? "no code returned");
          return data.code;
        },
        maxRetries: 2,
      },
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

    this.contextBudget = new ContextBudgetIndicator();
    this.permissionsButton = new PermissionsButton();
    this.mcpStatusIcon = new MCPStatusIcon();

    // Right-side group pushed to the end of the statusline
    const statusRight = document.createElement("div");
    statusRight.className = "statusline-right";
    statusRight.appendChild(this.mcpStatusIcon.getElement());
    statusRight.appendChild(this.permissionsButton.getElement());

    this.statuslineEl.appendChild(this.modeEl);
    this.statuslineEl.appendChild(this.providerEl);
    this.statuslineEl.appendChild(this.tokensEl);
    this.statuslineEl.appendChild(this.costEl);
    this.statuslineEl.appendChild(statusRight);

    if (!this.readOnly) {
      this.chatInput = new ChatInput(this.inputArea, (text) =>
        this.sendMessage(text),
      );
      this.chatInput.setOnCancel(() => this.cancelStream());
      this.chatInput.setOnSlashInput((text) => this.handleSlashInput(text));
      this.chatInput.setOnArrowUp(() => this._slashMenuNavigate("up"));
      this.chatInput.setOnArrowDown(() => this._slashMenuNavigate("down"));
      this.chatInput.setOnTabComplete(() => this._slashMenuComplete(false));
      // Enter with selection: fill the command then let send() fire (return false)
      this.chatInput.setOnEnterIntercept(() => {
        if (this.slashMenu.selectedName) {
          this._slashMenuComplete(false);
          return false;
        }
        return false;
      });

      // Context budget indicator sits at the right end of the input row
      const inputRow = this.inputArea.querySelector(".chat-input-row");
      inputRow?.appendChild(this.contextBudget.getElement());
    }

    // Track user scroll position to manage auto-scroll lock
    this.messagesEl.addEventListener("scroll", () => this.onMessagesScroll(), { passive: true });

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
      this.ws.on("chat-compact", this.boundHandlers.chatCompact);
      this.ws.on("compact-preview", this.boundHandlers.compactPreview);
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

  getModelName(): string | undefined {
    return this.systemInfo.model;
  }

  onModelChange(cb: () => void): void {
    this.onModelNameChange = cb;
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
      this._slashMenuClose();
      return;
    }

    if (text.startsWith("/") && !text.includes(" ")) {
      const query = text.slice(1).toLowerCase();
      const matches = commands.filter((c) => c.name.toLowerCase().startsWith(query));
      if (matches.length > 0) {
        // Take up to 8 matches in original order (native first), then reverse so
        // closest/first match sits at the bottom nearest the input.
        const displayed = [...matches.slice(0, 8)].reverse();

        // Maintain current selection if it's still visible.
        const stillSelected =
          this.slashMenu.selectedName !== null &&
          displayed.some((i) => i.name === this.slashMenu.selectedName);
        if (!stillSelected) this.slashMenu.selectedName = null;

        this._slashMenuShow(displayed, text);
        return;
      }
    }

    this._slashMenuClose();
  }

  private _slashMenuShow(items: Array<{ name: string; description: string }>, typedText?: string): void {
    this.slashMenu.items = items;
    // The typed text is the whole token to highlight (e.g. "/proven-r")
    if (typedText) this.chatInput?.setSkillHighlight(typedText, typedText);

    if (!this.slashHintEl) {
      this.slashHintEl = document.createElement("div");
      this.slashHintEl.className = "chat-slash-hints";
      this.inputArea.insertBefore(this.slashHintEl, this.inputArea.firstChild);
    }

    this.slashHintEl.innerHTML = "";
    for (const cmd of items) {
      const row = document.createElement("div");
      row.className = "chat-slash-row";
      if (cmd.name === this.slashMenu.selectedName) {
        row.classList.add("chat-slash-row--selected");
      }

      const name = document.createElement("span");
      name.className = "chat-slash-name";
      name.textContent = `/${cmd.name}`;

      const desc = document.createElement("span");
      desc.className = "chat-slash-desc";
      desc.textContent = cmd.description ?? "";

      row.appendChild(name);
      if (desc.textContent) row.appendChild(desc);

      row.addEventListener("click", () => {
        this.slashMenu.selectedName = cmd.name;
        this._slashMenuComplete(false);
        this.chatInput?.focus();
      });

      this.slashHintEl.appendChild(row);
    }
    this.slashHintEl.style.display = "block";
  }

  /** Navigate the menu. Up → toward bottom (most relevant). Down → toward top. */
  private _slashMenuNavigate(dir: "up" | "down"): boolean {
    const { items, selectedName } = this.slashMenu;
    if (!items.length || this.slashHintEl?.style.display === "none") return false;

    const last = items.length - 1;
    let idx = selectedName !== null ? items.findIndex((i) => i.name === selectedName) : -1;

    if (dir === "up") {
      // Up: no selection → last; at top (0) → deselect and return input focus
      if (idx === -1) {
        idx = last;
      } else if (idx === 0) {
        this.slashMenu.selectedName = null;
        this._slashMenuShow(items);
        this.chatInput?.focus();
        return true;
      } else {
        idx = idx - 1;
      }
    } else {
      // Down: no selection → first; at bottom → deselect and return input focus
      if (idx === -1) {
        idx = 0;
      } else if (idx === last) {
        this.slashMenu.selectedName = null;
        this._slashMenuShow(items);
        this.chatInput?.focus();
        return true;
      } else {
        idx = idx + 1;
      }
    }

    this.slashMenu.selectedName = items[idx]!.name;
    this._slashMenuShow(items); // re-render to update highlight
    return true;
  }

  /**
   * Complete input with selected (or bottom/closest) item.
   * suppressSend=true means Tab-only (don't want send after completion).
   */
  private _slashMenuComplete(suppressSend: boolean): void {
    const { items, selectedName } = this.slashMenu;
    if (!items.length) return;

    const target = selectedName
      ? items.find((i) => i.name === selectedName)
      : items[items.length - 1]; // default: bottom = closest match

    this._slashMenuClose();
    if (target) {
      const completed = `/${target.name}`;
      this.chatInput?.setValue(completed);
      // Highlight the completed skill name in the input
      this.chatInput?.setSkillHighlight(completed, completed);
    }

    if (suppressSend) {
      // Fire slash input so the menu re-evaluates the exact match (may re-open with single item)
      this.handleSlashInput(`/${target?.name ?? ""}`);
    }
  }

  private _slashMenuClose(): void {
    this.slashMenu.items = [];
    this.slashMenu.selectedName = null;
    if (this.slashHintEl) {
      this.slashHintEl.style.display = "none";
    }
    this.chatInput?.clearSkillHighlight();
  }


  setSlashCommands(
    commands: Array<{ name: string; description: string }>,
  ): void {
    this.systemInfo.slashCommands = commands;
  }

  setConnectionId(id: string): void {
    this.permissionsButton?.setConnectionId(id);
  }

  setMcpStatus(entries: MCPEntry[]): void {
    this.mcpStatusIcon?.setStatus(entries);
  }

  private cancelStream(): void {
    if (this.isStreaming) {
      this.queuedMessage = null;
      this.ws.sendChatCancel();
    }
  }

  private flushQueuedMessage(): void {
    const queued = this.queuedMessage;
    this.queuedMessage = null;
    this.chatInput?.setDisabled(false);
    if (queued) {
      this.sendMessage(queued);
    } else {
      this.chatInput?.focus();
    }
  }

  private sendMessage(text: string): void {
    if (this.isStreaming) {
      this.queuedMessage = text;
      this.chatInput?.showQueued(text);
      return;
    }

    this._slashMenuClose();

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
    if (this.onOpenFile) linkifyElement(textEl, this.onOpenFile);
    patchLinks(textEl, this.onOpenFile ?? undefined);

    userEl.appendChild(textEl);
    this.messagesEl.appendChild(userEl);
    this.scrollToBottom();
  }

  private handleSystemInfo(msg: ChatStreamMessage): void {
    const modelChanged = !!msg.model && msg.model !== this.systemInfo.model;
    if (msg.model) this.systemInfo.model = msg.model;
    if (msg.slashCommands) this.systemInfo.slashCommands = msg.slashCommands;
    if (msg.model) {
      this.providerEl.textContent = msg.model;
      this.contextBudget?.setModel(msg.model);
      this.contextBudget?.reset();
      if (modelChanged && this.onModelNameChange) {
        this.onModelNameChange();
      }
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
    this.collapseOldToolCalls();
  }

  private collapseOldToolCalls(): void {
    const contentEl = this.currentAssistantEl?.querySelector(".chat-message-content");
    if (!contentEl) return;

    const completed = Array.from(
      contentEl.querySelectorAll(
        ":scope > .chat-tool-use--success, :scope > .chat-tool-use--error",
      ),
    ) as HTMLElement[];

    const maxVisible = 3;
    let group = contentEl.querySelector(":scope > .chat-tool-group") as HTMLElement | null;
    const currentGrouped = group
      ? (group.querySelector(".chat-tool-group-body")?.children.length ?? 0)
      : 0;
    const totalCompleted = completed.length + currentGrouped;

    if (totalCompleted <= maxVisible) return;

    if (!group) {
      group = document.createElement("div");
      group.className = "chat-tool-group";

      const header = document.createElement("div");
      header.className = "chat-tool-group-header";
      header.addEventListener("click", () => {
        group!.classList.toggle("chat-tool-group--expanded");
        this.updateToolGroupHeader(group!);
      });
      group.appendChild(header);

      const body = document.createElement("div");
      body.className = "chat-tool-group-body";
      group.appendChild(body);

      contentEl.insertBefore(group, completed[0] ?? null);
    }

    const body = group.querySelector(".chat-tool-group-body")!;
    const targetGrouped = totalCompleted - maxVisible;
    const toMove = targetGrouped - currentGrouped;

    for (let i = 0; i < toMove; i++) {
      const el = completed[i];
      if (el) body.appendChild(el);
    }

    this.updateToolGroupHeader(group);
  }

  private updateToolGroupHeader(group: HTMLElement): void {
    const header = group.querySelector(".chat-tool-group-header")!;
    const body = group.querySelector(".chat-tool-group-body")!;
    const count = body.children.length;
    const chevron = group.classList.contains("chat-tool-group--expanded") ? "▾" : "›";
    header.innerHTML = `<span class="chat-tool-group-chevron">${chevron}</span> ${count} tool call${count !== 1 ? "s" : ""}`;
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
    if (targetEl && this.onOpenFile) linkifyElement(targetEl, this.onOpenFile);
    if (targetEl) patchLinks(targetEl, this.onOpenFile ?? undefined);

    if (!msg.cancelled) {
      this.updateTokenCount(msg.usage);
      this.updateCost(msg.cost);
      const promptTokens = msg.usage?.["prompt_tokens"] ?? 0;
      if (promptTokens > 0) this.contextBudget?.update(promptTokens);
    }

    this.flushQueuedMessage();
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

    this.flushQueuedMessage();
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
        if (this.onOpenFile) linkifyElement(contentEl, this.onOpenFile);
        patchLinks(contentEl, this.onOpenFile ?? undefined);
      } else if (message.role === "user") {
        const textEl = document.createElement("div");
        textEl.className = "chat-message-text";
        textEl.textContent = message.content;
        if (this.onOpenFile) linkifyElement(textEl, this.onOpenFile);
        patchLinks(textEl, this.onOpenFile ?? undefined);
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

    // "Allow for session" — only shown for bash, caches the command token
    if (msg.toolName === "bash") {
      const firstToken = (msg.description ?? "").split(/\s+/)[0] ?? "";
      const sessionBtn = document.createElement("button");
      sessionBtn.className = "chat-tool-approval-btn chat-tool-approval-btn--session";
      sessionBtn.textContent = firstToken ? `Allow '${firstToken}' for session` : "Allow for session";
      sessionBtn.title = "Run now and skip approval for this command in future turns";
      sessionBtn.addEventListener("click", () => {
        if (requestId) {
          this.ws.send({
            type: MessageType.PERMISSION_APPROVE,
            requestId,
            approveForSession: true,
          } as any);
        }
        block.classList.remove("chat-tool-use--approval");
        block.classList.add("chat-tool-use--running");
        icon.className = "chat-tool-icon running";
        icon.textContent = "▸"; // ▸
        approval.remove();
        const status = document.createElement("span");
        status.className = "chat-tool-status";
        status.textContent = "running…";
        header.appendChild(status);
      });
      actions.appendChild(sessionBtn);
    }

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

  private onMessagesScroll(): void {
    const el = this.messagesEl;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < ChatPane.NEAR_BOTTOM_PX) {
      this.autoScroll = true;
    } else {
      this.autoScroll = false;
      this.lastUserScrollAt = Date.now();
    }
  }

  // Called by all streaming/content events. Only scrolls if the user hasn't
  // manually scrolled away, or if they've been idle for long enough that we
  // assume they're done reading. Does nothing if there's no new content (so
  // a static chat stays wherever the user left it).
  private scrollToBottom(): void {
    if (!this.autoScroll) {
      if (Date.now() - this.lastUserScrollAt < ChatPane.REATTACH_AFTER_MS) return;
      this.autoScroll = true;
    }
    requestAnimationFrame(() => {
      if (!this.autoScroll) return; // user may have scrolled up during rAF
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  // Used by explicit "go to bottom" key bindings — always scrolls and re-pins.
  private jumpToBottom(): void {
    this.autoScroll = true;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  // --- PaneKeyHandler interface ---

  private lastKeyTime = 0;
  private lastKey = "";

  handleKeydown(e: KeyboardEvent): boolean {
    if (this.chatInput?.isFocused()) {
      // Alt+navigation while focused — scroll without leaving insert mode
      if (e.altKey) {
        switch (e.key) {
          case "j": this.messagesEl.scrollBy({ top: 60 }); return true;
          case "k": this.messagesEl.scrollBy({ top: -60 }); return true;
          case "g": this.messagesEl.scrollTop = 0; return true;
          case "G": this.jumpToBottom(); return true;
          case "PageUp": this.messagesEl.scrollBy({ top: -this.messagesEl.clientHeight * 0.8 }); return true;
          case "PageDown": this.messagesEl.scrollBy({ top: this.messagesEl.clientHeight * 0.8 }); return true;
        }
      }
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
        this.jumpToBottom();
        return true;
      case "PageUp":
        this.messagesEl.scrollBy({ top: -this.messagesEl.clientHeight * 0.8 });
        return true;
      case "PageDown":
        this.messagesEl.scrollBy({ top: this.messagesEl.clientHeight * 0.8 });
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

  prefillInput(text: string): void {
    this.chatInput?.setValue(text);
    this.chatInput?.focus();
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
    this.flushQueuedMessage();
  }

  private handleCompactPreview(msg: CompactPreviewMessage): void {
    const block = document.createElement("div");
    block.className = "chat-compact-preview";

    const header = document.createElement("div");
    header.className = "chat-compact-preview-header";
    header.textContent = "Session Handoff";

    if (msg.filePath) {
      const pathEl = document.createElement("div");
      pathEl.className = "chat-compact-preview-path";
      pathEl.textContent = msg.filePath;
      block.appendChild(header);
      block.appendChild(pathEl);
    } else {
      block.appendChild(header);
    }

    const preview = document.createElement("div");
    preview.className = "chat-compact-preview-content";
    preview.textContent = msg.content || "(no content)";
    block.appendChild(preview);

    const actions = document.createElement("div");
    actions.className = "chat-agent-approval-actions";

    const approveBtn = document.createElement("button");
    approveBtn.className = "agent-approval-btn approve";
    approveBtn.textContent = "Start New Session";
    approveBtn.addEventListener("click", () => {
      this.ws.sendCompactApprove();
      actions.replaceWith(this.makeStatusEl("Starting new session…", "approved"));
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "agent-approval-btn reject";
    rejectBtn.textContent = "Cancel";
    rejectBtn.addEventListener("click", () => {
      this.ws.sendCompactReject();
      actions.replaceWith(this.makeStatusEl("Cancelled", "rejected"));
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    block.appendChild(actions);

    this.messagesEl.appendChild(block);
    this.scrollToBottom();
  }

  private handleCompact(msg: ChatCompactMessage): void {
    this.messagesEl.innerHTML = "";
    this.streamRenderer = null;
    this.currentAssistantEl = null;
    this.totalTokens = 0;
    this.totalCost = 0;
    this.tokensEl.textContent = "";
    this.costEl.textContent = "";
    this.contextBudget?.reset();

    // Show the opening message from the new session if provided
    if (msg.context) {
      const assistantEl = document.createElement("div");
      assistantEl.className = "chat-message assistant";
      const contentEl = document.createElement("div");
      contentEl.className = "chat-message-content";
      contentEl.textContent = msg.context;
      assistantEl.appendChild(contentEl);
      this.messagesEl.appendChild(assistantEl);
    } else {
      const marker = document.createElement("div");
      marker.className = "chat-compact-marker";
      marker.textContent = "Session cleared";
      this.messagesEl.appendChild(marker);
    }

    this.isStreaming = false;
    this.flushQueuedMessage();
  }

  dispose(): void {
    if (this.autoSubscribe) {
      this.ws.off("chat-stream", this.boundHandlers.chatStream);
      this.ws.off("chat-history", this.boundHandlers.chatHistory);
      this.ws.off("chat-mode-change", this.boundHandlers.chatModeChange);
      this.ws.off("chat-compact", this.boundHandlers.chatCompact);
      this.ws.off("compact-preview", this.boundHandlers.compactPreview);
    }
    this.chatInput?.dispose();
    this.diagramViewer?.dispose();
    this.mcpStatusIcon?.dispose();
  }
}
