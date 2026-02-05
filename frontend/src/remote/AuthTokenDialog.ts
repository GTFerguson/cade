/**
 * Auth token re-entry dialog.
 * TUI-styled modal for recovering from authentication failures.
 * Kept as a modal (not full-pane) because it's error recovery that
 * can appear at any time over active terminal content.
 */

export class AuthTokenDialog {
  private overlay: HTMLDivElement;
  private tokenInput: HTMLInputElement;
  private statusEl: HTMLDivElement;
  private selectedIndex = 0;
  private optionEls: HTMLElement[] = [];
  private resolve: ((token: string | null) => void) | null = null;
  private boundHandleKeyDown = this.handleKeyDown.bind(this);

  constructor(profileName: string) {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "auth-token-dialog";
    modal.innerHTML = `
      <div class="pane-header">[ AUTH FAILED ]</div>
      <p class="auth-token-message">
        Connection to <strong>${this.escapeHtml(profileName)}</strong> was rejected.
      </p>
      <div class="input-wrapper">
        <span class="input-prompt">token:</span>
        <input
          type="password"
          class="input-field"
          placeholder=""
          spellcheck="false"
          autocomplete="off"
        />
      </div>
      <div class="auth-token-status"></div>
      <div class="auth-options">
        <div class="auth-option selected" data-action="connect">[connect]</div>
        <div class="auth-option" data-action="cancel">[cancel]</div>
      </div>
      <div class="pane-help">
        <span class="help-key">enter</span> submit
        <span class="help-key">esc</span> cancel
      </div>
    `;

    this.overlay.appendChild(modal);

    this.tokenInput = modal.querySelector(".input-field")!;
    this.statusEl = modal.querySelector(".auth-token-status")!;

    this.optionEls = Array.from(modal.querySelectorAll(".auth-option"));
    this.optionEls.forEach((el, index) => {
      el.addEventListener("click", () => {
        this.selectedIndex = index;
        this.renderSelection();
        this.handleOptionSelect();
      });
    });

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.tokenInput.focus();
      }
    });
  }

  show(): Promise<string | null> {
    document.body.appendChild(this.overlay);
    document.addEventListener("keydown", this.boundHandleKeyDown);

    requestAnimationFrame(() => this.tokenInput.focus());

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private handleOptionSelect(): void {
    const action = this.optionEls[this.selectedIndex]?.dataset.action;
    if (action === "connect") {
      this.submit();
    } else if (action === "cancel") {
      this.close(null);
    }
  }

  private renderSelection(): void {
    this.optionEls.forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
    });
  }

  private submit(): void {
    const token = this.tokenInput.value.trim();
    if (!token) {
      this.statusEl.textContent = "token cannot be empty";
      this.statusEl.className = "auth-token-status auth-token-error";
      this.tokenInput.focus();
      return;
    }
    this.close(token);
  }

  private close(result: string | null): void {
    document.removeEventListener("keydown", this.boundHandleKeyDown);
    this.overlay.remove();
    this.resolve?.(result);
    this.resolve = null;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Escape") {
        (e.target as HTMLInputElement).blur();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
        return;
      }
      return;
    }

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.optionEls.length;
      this.renderSelection();
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      this.selectedIndex =
        (this.selectedIndex - 1 + this.optionEls.length) % this.optionEls.length;
      this.renderSelection();
    } else if (e.key === "l" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      this.handleOptionSelect();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close(null);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
