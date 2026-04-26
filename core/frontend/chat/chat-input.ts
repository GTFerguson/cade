/**
 * Prompt-style chat input with auto-resizing textarea.
 *
 * Renders as: ❯ [underline text field]
 * Enter sends the message (Shift+Enter for newline).
 * Disabled during streaming.
 *
 * Skill highlighting: a backdrop div sits below the (transparent-text) textarea
 * and renders /command tokens in accent-blue. Only active when a skill match exists.
 */

export class ChatInput {
  private row: HTMLElement;
  private wrapper: HTMLElement;
  private backdrop: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private disabled = false;
  private onSend: (text: string) => void;
  private onCancel: (() => void) | null = null;
  private lastEscapeTime = 0;
  private onSlashInput: ((text: string) => void) | null = null;
  private onArrowUp: (() => boolean) | null = null;
  private onArrowDown: (() => boolean) | null = null;
  private onTabComplete: (() => void) | null = null;
  /** Called on Enter before sending. Return true to suppress send (e.g. Tab-complete only). */
  private onEnterIntercept: (() => boolean) | null = null;

  constructor(container: HTMLElement, onSend: (text: string) => void) {
    this.onSend = onSend;

    this.row = document.createElement("div");
    this.row.className = "chat-input-row";

    const prompt = document.createElement("span");
    prompt.className = "chat-input-prompt";
    prompt.textContent = "❯";

    // Wrapper holds backdrop + textarea in the same stack
    this.wrapper = document.createElement("div");
    this.wrapper.className = "chat-input-wrapper";

    this.backdrop = document.createElement("div");
    this.backdrop.className = "chat-input-backdrop";
    this.backdrop.setAttribute("aria-hidden", "true");

    this.textarea = document.createElement("textarea");
    this.textarea.className = "chat-input";
    this.textarea.dataset.kbPrefix = "true";
    this.textarea.placeholder = "Send a message...";
    this.textarea.rows = 1;

    this.textarea.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.textarea.addEventListener("input", () => {
      this.autoResize();
      this.onSlashInput?.(this.textarea.value);
    });
    // Keep backdrop scroll in sync with textarea
    this.textarea.addEventListener("scroll", () => {
      this.backdrop.scrollTop = this.textarea.scrollTop;
    });

    this.wrapper.appendChild(this.backdrop);
    this.wrapper.appendChild(this.textarea);
    this.row.appendChild(prompt);
    this.row.appendChild(this.wrapper);
    container.appendChild(this.row);
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowUp") {
      if (this.onArrowUp?.()) {
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      if (this.onArrowDown?.()) {
        e.preventDefault();
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      this.onTabComplete?.();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (this.onEnterIntercept?.()) return;
      this.send();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      const isDoubleTap = now - this.lastEscapeTime < 400;
      this.lastEscapeTime = isDoubleTap ? 0 : now;
      if (isDoubleTap) {
        this.onCancel?.();
      } else if (!this.disabled) {
        this.textarea.blur();
      }
      return;
    }
  }

  private send(): void {
    const text = this.textarea.value.trim();
    if (!text) return;

    this.textarea.value = "";
    this.autoResize();
    this.clearSkillHighlight();
    this.onSend(text);
  }

  private autoResize(): void {
    this.textarea.style.height = "auto";
    const lineHeight = 18;
    const maxHeight = lineHeight * 3;
    const newHeight = Math.min(this.textarea.scrollHeight, maxHeight) + "px";
    this.textarea.style.height = newHeight;
    // Keep wrapper height in sync so backdrop matches
    this.wrapper.style.minHeight = newHeight;
  }

  /**
   * Highlight a skill token inside the input.
   * `skillToken` is the exact text to highlight (e.g. "/proven-research").
   * The backdrop renders the full textarea value with that token in blue.
   */
  setSkillHighlight(text: string, skillToken: string): void {
    const idx = text.indexOf(skillToken);
    if (idx === -1) {
      this.clearSkillHighlight();
      return;
    }

    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(skillToken);
    const after = escapeHtml(text.slice(idx + skillToken.length));

    this.backdrop.innerHTML =
      `${before}<span class="chat-input-skill">${match}</span>${after}`;
    this.textarea.classList.add("chat-input--skill-active");
    this.backdrop.classList.add("chat-input-backdrop--active");
    this.backdrop.scrollTop = this.textarea.scrollTop;
  }

  clearSkillHighlight(): void {
    this.textarea.classList.remove("chat-input--skill-active");
    this.backdrop.classList.remove("chat-input-backdrop--active");
    this.backdrop.innerHTML = "";
  }

  setOnCancel(cb: () => void): void {
    this.onCancel = cb;
  }

  setOnSlashInput(cb: (text: string) => void): void {
    this.onSlashInput = cb;
  }

  setOnArrowUp(cb: () => boolean): void {
    this.onArrowUp = cb;
  }

  setOnArrowDown(cb: () => boolean): void {
    this.onArrowDown = cb;
  }

  setOnTabComplete(cb: () => void): void {
    this.onTabComplete = cb;
  }

  /** Intercept Enter before send. Return true to suppress send (fill-only completion). */
  setOnEnterIntercept(cb: () => boolean): void {
    this.onEnterIntercept = cb;
  }

  setValue(text: string): void {
    this.textarea.value = text;
    this.autoResize();
  }

  showQueued(text: string): void {
    this.textarea.value = text;
    this.autoResize();
    this.textarea.classList.add("chat-input--queued");
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    if (!disabled) {
      this.textarea.placeholder = "Send a message...";
      this.textarea.classList.remove("chat-input--queued");
    } else {
      this.textarea.placeholder = "Queue a message (Esc×2 to stop)...";
    }
  }

  isFocused(): boolean {
    return document.activeElement === this.textarea;
  }

  focus(): void {
    this.textarea.focus();
  }

  blur(): void {
    this.textarea.blur();
  }

  dispose(): void {
    this.row.remove();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
