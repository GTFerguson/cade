/**
 * Lightweight dialog for re-entering an auth token after authentication failure.
 * Shows a simple prompt instead of the full profile manager.
 */

export class AuthTokenDialog {
  private overlay: HTMLDivElement;
  private tokenInput: HTMLInputElement;
  private statusEl: HTMLDivElement;
  private resolve: ((token: string | null) => void) | null = null;
  private boundHandleKeyDown = this.handleKeyDown.bind(this);

  constructor(profileName: string) {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "auth-token-dialog";
    modal.innerHTML = `
      <div class="modal-title">Authentication Failed</div>
      <p class="auth-token-message">
        Connection to <strong>${this.escapeHtml(profileName)}</strong> was rejected.
        Enter the current auth token to reconnect.
      </p>
      <input
        type="password"
        class="modal-input"
        placeholder="Paste auth token"
        spellcheck="false"
        autocomplete="off"
      />
      <div class="auth-token-status"></div>
      <div class="modal-buttons">
        <button class="modal-button auth-token-cancel">Cancel</button>
        <button class="modal-button modal-button-primary auth-token-connect">Connect</button>
      </div>
    `;

    this.overlay.appendChild(modal);

    this.tokenInput = modal.querySelector(".modal-input")!;
    this.statusEl = modal.querySelector(".auth-token-status")!;

    modal.querySelector(".auth-token-cancel")!.addEventListener("click", () => {
      this.close(null);
    });

    modal.querySelector(".auth-token-connect")!.addEventListener("click", () => {
      this.submit();
    });

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.close(null);
      }
    });
  }

  /**
   * Show the dialog and return the entered token, or null if cancelled.
   */
  show(): Promise<string | null> {
    document.body.appendChild(this.overlay);
    document.addEventListener("keydown", this.boundHandleKeyDown);

    // Focus input after DOM paint
    requestAnimationFrame(() => this.tokenInput.focus());

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private submit(): void {
    const token = this.tokenInput.value.trim();
    if (!token) {
      this.statusEl.textContent = "Token cannot be empty";
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
    if (e.key === "Escape") {
      e.preventDefault();
      this.close(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.submit();
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
