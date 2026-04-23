/**
 * Manages dual terminals (claude and manual) for a project tab.
 *
 * Provides lazy initialization of the manual terminal and handles
 * switching between terminals with visual status indicators.
 */

import { ChatPane } from "../chat/chat-pane";
import { SessionKey, type SessionKeyValue, type AnySessionKey } from "@core/platform/protocol";
import { Terminal, type CustomKeyHandler } from "./terminal";
import type { ChatStreamMessage, Component, OutputMessage, SessionRestoredMessage } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import type { AgentManager } from "../agents";

export type TerminalMode = "terminal" | "chat";

export class TerminalManager implements Component {
  private claudeTerminal: Terminal | null = null;
  private manualTerminal: Terminal | null = null;
  private activeTerminal: SessionKeyValue = SessionKey.CLAUDE;
  private claudeContainer: HTMLElement;
  private manualContainer: HTMLElement;
  private chatContainer: HTMLElement;
  private chatPane: ChatPane | null = null;
  private mode: TerminalMode = "terminal";
  private enhanced = false;
  private statusIndicator: HTMLElement;
  private customKeyHandler: CustomKeyHandler | null = null;
  private agentManager: AgentManager | null = null;
  private agentTabBar: HTMLElement;
  private terminalContent: HTMLElement;
  private outputBuffer: Map<AnySessionKey, string[]> = new Map();
  private flushRafId: number | null = null;
  private flushTimeoutId: number | null = null;
  private lastFlushTime = 0;
  private boundHandlers = {
    output: (message: OutputMessage) => this.handleOutput(message),
    sessionRestored: (message: SessionRestoredMessage) => this.handleSessionRestored(message),
    chatStream: (message: ChatStreamMessage) => this.handleAgentChatStream(message),
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient
  ) {
    // Agent tab bar (hidden until agents exist)
    this.agentTabBar = document.createElement("div");
    this.agentTabBar.className = "agent-tab-bar";
    this.agentTabBar.style.display = "none";

    // Wrapper for terminal content (flex-grow to fill remaining space)
    this.terminalContent = document.createElement("div");
    this.terminalContent.className = "terminal-content";

    // Create sub-containers for each terminal
    this.claudeContainer = document.createElement("div");
    this.claudeContainer.className = "terminal-container terminal-claude";

    this.manualContainer = document.createElement("div");
    this.manualContainer.className = "terminal-container terminal-manual";
    this.manualContainer.style.display = "none";

    this.chatContainer = document.createElement("div");
    this.chatContainer.className = "terminal-container terminal-chat";
    this.chatContainer.style.display = "none";

    // Create status indicator
    this.statusIndicator = document.createElement("div");
    this.statusIndicator.className = "terminal-status-indicator";
    this.updateStatusIndicator();

    this.terminalContent.appendChild(this.claudeContainer);
    this.terminalContent.appendChild(this.manualContainer);
    this.terminalContent.appendChild(this.chatContainer);
    this.terminalContent.appendChild(this.statusIndicator);

    this.container.appendChild(this.agentTabBar);
    this.container.appendChild(this.terminalContent);
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

    // Route agent chat-stream events to AgentManager
    this.ws.on("chat-stream", this.boundHandlers.chatStream);
  }

  /**
   * Set the agent manager for delegating agent output routing.
   */
  setAgentManager(manager: AgentManager): void {
    this.agentManager = manager;
  }

  /**
   * Switch between terminal and chat modes.
   */
  setMode(mode: TerminalMode): void {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === "chat") {
      this.claudeContainer.style.display = "none";
      this.manualContainer.style.display = "none";
      this.chatContainer.style.display = "block";

      // Lazy-create the chat pane
      if (!this.chatPane) {
        this.chatPane = new ChatPane(this.chatContainer, this.ws);
        this.chatPane.initialize();
        // Re-render status indicator when model name changes
        this.chatPane.onModelChange(() => this.updateStatusIndicator());
      }

      this.chatPane.focus();
    } else {
      this.chatContainer.style.display = "none";
      // Restore whichever terminal was active
      if (this.activeTerminal === SessionKey.CLAUDE) {
        this.claudeContainer.style.display = "block";
        this.claudeTerminal?.fit();
        this.claudeTerminal?.focus();
      } else {
        this.manualContainer.style.display = "block";
        this.manualTerminal?.fit();
        this.manualTerminal?.focus();
      }
    }

    this.updateStatusIndicator();
  }

  /**
   * Get the current mode.
   */
  getMode(): TerminalMode {
    return this.mode;
  }

  /**
   * Whether enhanced CC mode is active (Claude Code rendered in ChatPane).
   */
  isEnhanced(): boolean {
    return this.enhanced;
  }

  /**
   * Enable or disable enhanced CC mode. When enabled, switches to chat pane
   * for markdown-rendered Claude Code output. When disabled, returns to raw PTY.
   */
  setEnhanced(enabled: boolean): void {
    this.enhanced = enabled;
    if (enabled && this.mode === "terminal") {
      this.setMode("chat");
    } else if (!enabled && this.mode === "chat") {
      this.setMode("terminal");
    }
    this.updateStatusIndicator();
  }

  /**
   * Toggle enhanced CC mode on/off at runtime.
   */
  toggleEnhanced(): void {
    this.setEnhanced(!this.enhanced);
  }

  /**
   * Blur the chat input so keystrokes don't get captured by it.
   */
  blurChat(): void {
    this.chatPane?.blur();
  }

  /**
   * Get the chat pane instance (null if not yet created).
   */
  getChatPane(): ChatPane | null {
    return this.chatPane;
  }

  /**
   * Handle output message and route to correct terminal.
   */
  private handleOutput(message: OutputMessage): void {
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
   * Route agent chat-stream events to AgentManager.
   * Primary events (no agentId) are handled by ChatPane's own subscription.
   */
  private handleAgentChatStream(message: ChatStreamMessage): void {
    if (message.agentId && this.agentManager) {
      this.agentManager.routeChatStream(message);
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
   * Toggle between claude/chat and manual terminals.
   */
  toggle(): void {
    // If an agent is focused, toggle its side instead
    if (this.agentManager?.getActiveAgentId() != null) {
      this.agentManager.toggleSide();
      this.updateStatusIndicator();
      return;
    }

    if (this.mode === "chat") {
      // In chat mode: toggle between chat pane and manual shell
      if (this.chatContainer.style.display !== "none") {
        this.chatContainer.style.display = "none";
        this.ensureManualTerminal();
        this.manualContainer.style.display = "block";
        this.manualTerminal?.fit();
        this.manualTerminal?.focus();
      } else {
        this.manualContainer.style.display = "none";
        this.chatContainer.style.display = "block";
        this.chatPane?.focus();
      }
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
    if (this.mode === "chat") {
      this.chatContainer.style.display = "block";
      this.chatPane?.focus();
    } else if (this.activeTerminal === SessionKey.CLAUDE) {
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
    this.chatContainer.style.display = "none";
  }

  /**
   * Update status indicator and agent tab bar.
   */
  updateStatusIndicator(): void {
    // Rebuild the agent tab bar on every status update
    this.renderAgentTabBar();

    const hasAgents = this.agentManager?.hasAgents() ?? false;
    const activeAgentId = this.agentManager?.getActiveAgentId();

    if (hasAgents) {
      // Tab bar handles agent switching — status indicator shows side label only
      this.statusIndicator.innerHTML = "";
      this.statusIndicator.classList.remove("claude", "shell");

      if (activeAgentId != null) {
        const side = this.agentManager?.getActiveSide() ?? "claude";
        this.statusIndicator.textContent = side === "claude" ? "[claude]" : "[shell]";
        this.statusIndicator.classList.add(side === "claude" ? "claude" : "shell");
      } else {
        // On ORCH tab — show the standard mode label
        if (this.mode === "chat") {
          const isChatVisible = this.chatContainer.style.display !== "none";
          if (isChatVisible) {
            if (this.enhanced) {
              // Show model name from last system-info event (fallback aware)
              const modelName = this.chatPane?.getModelName();
              this.statusIndicator.textContent = modelName ? `[${modelName}]` : "[enhanced]";
              this.statusIndicator.classList.add("claude");
            } else {
              this.statusIndicator.textContent = "[chat]";
              this.statusIndicator.classList.add("claude");
            }
          } else {
            this.statusIndicator.textContent = "[shell]";
            this.statusIndicator.classList.add("shell");
          }
        } else if (this.activeTerminal === SessionKey.CLAUDE) {
          this.statusIndicator.textContent = "[claude]";
          this.statusIndicator.classList.add("claude");
        } else {
          this.statusIndicator.textContent = "[shell]";
          this.statusIndicator.classList.add("shell");
        }
      }
    } else {
      // No agents — show mode-appropriate labels
      this.statusIndicator.innerHTML = "";
      if (this.mode === "chat") {
        const isChatVisible = this.chatContainer.style.display !== "none";
        if (isChatVisible) {
          if (this.enhanced) {
            // Show model name from last system-info event (fallback aware)
            const modelName = this.chatPane?.getModelName();
            this.statusIndicator.textContent = modelName ? `[${modelName}]` : "[enhanced]";
            this.statusIndicator.classList.remove("shell");
            this.statusIndicator.classList.add("claude");
          } else {
            this.statusIndicator.textContent = "[chat]";
            this.statusIndicator.classList.remove("shell");
            this.statusIndicator.classList.add("claude");
          }
        } else {
          this.statusIndicator.textContent = "[shell]";
          this.statusIndicator.classList.remove("claude");
          this.statusIndicator.classList.add("shell");
        }
      } else if (this.activeTerminal === SessionKey.CLAUDE) {
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
   * Build/rebuild the agent tab bar. Called from updateStatusIndicator.
   */
  private renderAgentTabBar(): void {
    const agents = this.agentManager?.getAgentList() ?? [];
    const hasAgents = agents.length > 0;

    this.agentTabBar.style.display = hasAgents ? "" : "none";
    if (!hasAgents) return;

    this.agentTabBar.innerHTML = "";

    const activeAgentId = this.agentManager?.getActiveAgentId() ?? null;

    // ORCH tab — always first
    const orchTab = document.createElement("span");
    orchTab.className = "agent-tab agent-tab-orch";
    if (activeAgentId == null) orchTab.classList.add("agent-tab-active");
    orchTab.textContent = "ORCH";
    orchTab.addEventListener("click", () => {
      this.agentManager?.switchToAgent(null);
    });
    this.agentTabBar.appendChild(orchTab);

    // Agent tabs — numbered 1, 2, 3...
    agents.forEach((agent, index) => {
      const tab = document.createElement("span");
      tab.className = "agent-tab";
      if (agent.agentId === activeAgentId) tab.classList.add("agent-tab-active");

      const led = document.createElement("span");
      led.className = `agent-led agent-led-${agent.state}`;

      const label = document.createTextNode(`${index + 1}`);

      tab.appendChild(led);
      tab.appendChild(label);
      tab.title = `${agent.label} (${agent.state})\n${agent.task?.slice(0, 100) ?? ""}`;
      tab.addEventListener("click", () => {
        this.agentManager?.switchToAgent(agent.agentId);
      });

      this.agentTabBar.appendChild(tab);
    });
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
   * Focus the active terminal without changing scroll position.
   */
  focus(): void {
    if (this.agentManager?.getActiveAgentId() != null) {
      this.agentManager.focus();
      return;
    }

    if (this.mode === "chat" && this.chatContainer.style.display !== "none") {
      this.chatPane?.focus();
      return;
    }

    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.focus();
    } else {
      this.manualTerminal?.focus();
    }
  }

  /**
   * Focus the active terminal and scroll to bottom.
   */
  focusAtBottom(): void {
    if (this.activeTerminal === SessionKey.CLAUDE) {
      this.claudeTerminal?.focusAtBottom();
    } else {
      this.manualTerminal?.focusAtBottom();
    }
  }

  /**
   * Update terminal color theme (called when user switches themes).
   */
  updateTheme(): void {
    this.claudeTerminal?.updateTheme();
    this.manualTerminal?.updateTheme();
    this.agentManager?.updateAllThemes();
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
    this.ws.off("chat-stream", this.boundHandlers.chatStream);

    this.claudeTerminal?.dispose();
    this.manualTerminal?.dispose();
    this.chatPane?.dispose();
    this.statusIndicator.remove();
    this.agentTabBar.remove();
  }
}
