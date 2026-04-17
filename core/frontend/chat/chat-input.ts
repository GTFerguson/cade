/**
 * Prompt-style chat input with auto-resizing textarea.
 *
 * Renders as: ❯ [underline text field]
 * Enter sends the message (Shift+Enter for newline).
 * Disabled during streaming.
 */

export class ChatInput {
  private row: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private disabled = false;
  private onSend: (text: string) => void;
  private onCancel: (() => void) | null = null;
  private onSlashInput: ((text: string) => void) | null = null;

  constructor(container: HTMLElement, onSend: (text: string) => void) {
    this.onSend = onSend;

    this.row = document.createElement("div");
    this.row.className = "chat-input-row";

    const prompt = document.createElement("span");
    prompt.className = "chat-input-prompt";
    prompt.textContent = "\u276F"; // ❯

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

    this.row.appendChild(prompt);
    this.row.appendChild(this.textarea);
    container.appendChild(this.row);
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.send();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (this.disabled) {
        this.onCancel?.();
      } else {
        this.textarea.blur();
      }
      return;
    }
  }

  private send(): void {
    if (this.disabled) return;

    const text = this.textarea.value.trim();
    if (!text) return;

    this.textarea.value = "";
    this.autoResize();
    this.onSend(text);
  }

  private autoResize(): void {
    this.textarea.style.height = "auto";
    const lineHeight = 18;
    const maxHeight = lineHeight * 3; // 3 lines then scroll
    this.textarea.style.height =
      Math.min(this.textarea.scrollHeight, maxHeight) + "px";
  }

  setOnCancel(cb: () => void): void {
    this.onCancel = cb;
  }

  setOnSlashInput(cb: (text: string) => void): void {
    this.onSlashInput = cb;
  }

  setValue(text: string): void {
    this.textarea.value = text;
    this.autoResize();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.textarea.disabled = disabled;
    if (!disabled) {
      this.textarea.placeholder = "Send a message...";
    } else {
      this.textarea.placeholder = "Waiting for response...";
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
