/**
 * Auth token re-entry dialog.
 * TUI-styled modal for recovering from authentication failures.
 * Kept as a modal (not full-pane) because it's error recovery that
 * can appear at any time over active terminal content.
 */

import { MenuNav, escapeHtml, renderHelpBar } from "../ui/menu-nav";

export class AuthTokenDialog {
  private overlay: HTMLDivElement;
  private tokenInput: HTMLInputElement;
  private statusEl: HTMLDivElement;
  private optionEls: HTMLElement[] = [];
  private resolve: ((token: string | null) => void) | null = null;
  private nav: MenuNav;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;

  constructor(profileName: string) {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "auth-token-dialog";
    modal.innerHTML = `
      <div class="pane-header">[ AUTH FAILED ]</div>
      <p class="auth-token-message">
        Connection to <strong>${escapeHtml(profileName)}</strong> was rejected.
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
        ${renderHelpBar([
          { key: "enter", label: "submit" },
          { key: "esc", label: "cancel" },
        ])}
      </div>
    `;

    this.overlay.appendChild(modal);

    this.tokenInput = modal.querySelector(".input-field")!;
    this.statusEl = modal.querySelector(".auth-token-status")!;
    this.optionEls = Array.from(modal.querySelectorAll(".auth-option"));

    this.nav = new MenuNav({
      getOptions: () => this.optionEls,
      getInputFields: () => [this.tokenInput],
      onSelect: () => this.handleOptionSelect(),
      onCancel: () => this.close(null),
      onInputKey: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
          return true;
        }
        return false;
      },
    });

    this.nav.wireClickHandlers();

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.tokenInput.focus();
      }
    });

    this.boundHandleKeyDown = (e: KeyboardEvent) => this.nav.handleKeyDown(e);
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
    const action = this.optionEls[this.nav.selectedIndex]?.dataset.action;
    if (action === "connect") {
      this.submit();
    } else if (action === "cancel") {
      this.close(null);
    }
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
}
