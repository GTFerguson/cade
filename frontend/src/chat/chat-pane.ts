/**
 * Chat pane component for LLM API conversations.
 *
 * REPL-style UI: user input shown with ❯ prompt, assistant output
 * flows below. Streaming responses use MertexMD's createStreamRenderer
 * for incremental markdown rendering.
 */

import { MertexMD, type StreamRenderer } from "mertex.md";
import { marked } from "marked";
import hljs from "highlight.js";
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";
import type { PaneKeyHandler } from "../input/keybindings";
import type {
  ChatHistoryMessage,
  ChatStreamMessage,
  Component,
} from "../types";
import type { WebSocketClient } from "../platform/websocket";
import { ChatInput } from "./chat-input";
import { DiagramViewer } from "./diagram-viewer";

/** Descriptions for well-known Claude Code slash commands */
const SLASH_DESCRIPTIONS: Record<string, string> = {
  compact: "Compact conversation context",
  cost: "Show token usage and cost",
  context: "Show context window usage",
  init: "Initialize project CLAUDE.md",
  review: "Review code changes",
  "pr-comments": "Address PR review comments",
  "release-notes": "Generate release notes",
  "security-review": "Security review of changes",
  simplify: "Simplify and improve code",
  debug: "Debug an issue",
  batch: "Run batch operations",
  insights: "Show session insights",
};

/** Same hash function mertex.md uses to generate mermaid placeholder IDs */
function hashCode(str: string): string {
  if (!str) return "0";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16);
}

// Ensure globals are set for mertex.md (marked, hljs, katex, mermaid)
if (typeof window !== "undefined") {
  (window as any).marked = marked;
  (window as any).hljs = hljs;
  (window as any).katex = katex;
  (window as any).renderMathInElement = renderMathInElement;
  (window as any).mermaid = mermaid;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
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
  });
}

export class ChatPane implements Component, PaneKeyHandler {
  private messagesEl: HTMLElement;
  private inputArea: HTMLElement;
  private statuslineEl: HTMLElement;
  private modeEl: HTMLElement;
  private providerEl: HTMLElement;
  private tokensEl: HTMLElement;
  private chatInput: ChatInput;
  private mertex: MertexMD;
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

  private boundHandlers = {
    chatStream: (msg: ChatStreamMessage) => this.handleChatStream(msg),
    chatHistory: (msg: ChatHistoryMessage) => this.handleChatHistory(msg),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
  ) {
    this.mertex = new MertexMD({
      breaks: true,
      gfm: true,
      highlight: true,
      katex: true,
      sanitize: false,
    });

    const pane = document.createElement("div");
    pane.className = "chat-pane";

    this.messagesEl = document.createElement("div");
    this.messagesEl.className = "chat-messages";

    this.inputArea = document.createElement("div");
    this.inputArea.className = "chat-input-area";

    this.chatInput = new ChatInput(this.inputArea, (text) =>
      this.sendMessage(text),
    );
    this.chatInput.setOnCancel(() => this.cancelStream());
    this.chatInput.setOnSlashInput((text) => this.handleSlashInput(text));

    // Statusline
    this.statuslineEl = document.createElement("div");
    this.statuslineEl.className = "chat-statusline";

    this.modeEl = document.createElement("span");
    this.modeEl.className = "status-mode";
    this.modeEl.textContent = "CHAT";

    const modeSpan = this.modeEl;

    this.providerEl = document.createElement("span");
    this.providerEl.className = "status-provider";
    this.providerEl.textContent = "";

    this.tokensEl = document.createElement("span");
    this.tokensEl.className = "status-tokens";
    this.tokensEl.textContent = "";

    this.costEl = document.createElement("span");
    this.costEl.className = "status-cost";
    this.costEl.textContent = "";

    this.statuslineEl.appendChild(modeSpan);
    this.statuslineEl.appendChild(this.providerEl);
    this.statuslineEl.appendChild(this.tokensEl);
    this.statuslineEl.appendChild(this.costEl);

    // Open fullscreen viewer when clicking a mermaid diagram
    this.messagesEl.addEventListener("click", (e) => {
      const container = (e.target as HTMLElement).closest(".mermaid-container");
      if (!container) return;
      if (!this.diagramViewer) this.diagramViewer = new DiagramViewer();
      this.diagramViewer.show(container as HTMLElement);
    });

    pane.appendChild(this.messagesEl);
    pane.appendChild(this.inputArea);
    pane.appendChild(this.statuslineEl);
    this.container.appendChild(pane);
  }

  initialize(): void {
    this.ws.on("chat-stream", this.boundHandlers.chatStream);
    this.ws.on("chat-history", this.boundHandlers.chatHistory);
  }

  setProvider(name: string): void {
    this.providerEl.textContent = name;
  }

  setModeLabel(label: string): void {
    this.modeEl.textContent = label;
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
        this.chatInput.setValue(`/${cmd}`);
        this.hideSlashHints();
        this.chatInput.focus();
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
    this.chatInput.setDisabled(true);
    this.isStreaming = true;
  }

  private handleChatStream(msg: ChatStreamMessage): void {
    switch (msg.event) {
      case "system-info":
        this.handleSystemInfo(msg);
        break;
      case "text-delta":
        this.handleTextDelta(msg.content ?? "");
        break;
      case "thinking-delta":
        this.handleThinkingDelta(msg.content ?? "");
        break;
      case "tool-use-start":
        this.handleToolUseStart(msg.toolId ?? "", msg.toolName ?? "");
        break;
      case "tool-result":
        this.handleToolResult(msg.toolId ?? "", msg.toolName ?? "", msg.status ?? "success");
        break;
      case "done":
        this.handleDone(msg);
        break;
      case "error":
        this.handleError(msg.message ?? "Unknown error");
        break;
    }
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
      this.streamRenderer = this.mertex.createStreamRenderer(segment);
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

  private handleToolUseStart(toolId: string, toolName: string): void {
    this.ensureAssistantEl();

    // Finalize any in-progress text stream before inserting tool block
    if (this.streamRenderer) {
      this.streamRenderer.finalize();
      this.streamRenderer = null;
    }
    this.finalizeThinking();

    const toolEl = document.createElement("div");
    toolEl.className = "chat-tool-use";

    const header = document.createElement("div");
    header.className = "chat-tool-header";

    const icon = document.createElement("span");
    icon.className = "chat-tool-icon running";
    icon.textContent = "\u25B8"; // ▸

    const name = document.createElement("span");
    name.className = "chat-tool-name";
    name.textContent = toolName;

    const status = document.createElement("span");
    status.className = "chat-tool-status";
    status.textContent = "running\u2026";

    header.appendChild(icon);
    header.appendChild(name);
    header.appendChild(status);
    toolEl.appendChild(header);

    const contentEl = this.currentAssistantEl!.querySelector(".chat-message-content");
    if (contentEl) {
      contentEl.appendChild(toolEl);
    }

    this.activeToolEls.set(toolId, toolEl);
    this.scrollToBottom();
  }

  private handleToolResult(toolId: string, _toolName: string, status: string): void {
    const toolEl = this.activeToolEls.get(toolId);
    if (!toolEl) return;

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

    this.activeToolEls.delete(toolId);
    this.scrollToBottom();
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
    if (targetEl && content) await this.renderRemainingDiagrams(targetEl, content);

    if (!msg.cancelled) {
      this.updateTokenCount(msg.usage);
      this.updateCost(msg.cost);
    }

    this.chatInput.setDisabled(false);
    this.chatInput.focus();
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

    this.chatInput.setDisabled(false);
    this.chatInput.focus();
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
        await this.mertex.renderInElement(contentEl, message.content);
        await this.renderRemainingDiagrams(contentEl, message.content);
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

  /**
   * Fallback for diagrams that mertex's MermaidHandler.renderInElement failed to render.
   * Finds remaining .mermaid-placeholder elements, extracts the code from the
   * original markdown, and renders them via mermaid.run() which handles diagram
   * types (like gitGraph) that mermaid.render() can choke on.
   */
  /**
   * Fallback for diagrams that mertex's MermaidHandler failed to render
   * via mermaid.render(). Uses mermaid.run() instead, which handles
   * diagram types like gitGraph that need DOM-attached elements.
   */
  private async renderRemainingDiagrams(container: HTMLElement, markdownContent: string): Promise<void> {
    const placeholders = container.querySelectorAll(".mermaid-placeholder");
    if (placeholders.length === 0) return;

    // Build the same mermaid map that mertex uses
    const codeMap = new Map<string, string>();
    const re = /```mermaid\s*\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(markdownContent)) !== null) {
      const code = match[1]!.split("\n").map((l: string) => l.trimEnd()).join("\n").trim();
      const id = "MERMAID_" + hashCode(code);
      codeMap.set(id, code);
    }

    for (const placeholder of placeholders) {
      const id = placeholder.getAttribute("data-mermaid-id");
      const code = id ? codeMap.get(id) : null;
      if (!code) continue;

      try {
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-container";
        const pre = document.createElement("pre");
        pre.className = "mermaid";
        pre.textContent = code;
        wrapper.appendChild(pre);
        placeholder.replaceWith(wrapper);
        await mermaid.run({ nodes: [pre] });
      } catch (err) {
        console.error("[ChatPane] Fallback mermaid render failed:", err);
        placeholder.textContent = `Diagram error: ${err}`;
        placeholder.className = "chat-message error";
      }
    }
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  // --- PaneKeyHandler interface ---

  handleKeydown(_e: KeyboardEvent): boolean {
    return false;
  }

  focus(): void {
    this.chatInput.focus();
  }

  blur(): void {
    this.chatInput.blur();
  }

  dispose(): void {
    this.ws.off("chat-stream", this.boundHandlers.chatStream);
    this.ws.off("chat-history", this.boundHandlers.chatHistory);
    this.chatInput.dispose();
    this.diagramViewer?.dispose();
  }
}
