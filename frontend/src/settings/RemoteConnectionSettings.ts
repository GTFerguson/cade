/**
 * Remote backend connection settings modal.
 *
 * Allows users to configure connection to a remote CADE backend.
 */

import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
} from "../auth/tokenManager";

export class RemoteConnectionSettings {
  private overlay: HTMLElement | null = null;

  /**
   * Show the settings modal.
   */
  show(): void {
    if (this.overlay) {
      return; // Already showing
    }

    // Load current settings
    const currentToken = getAuthToken() || "";
    const remoteBackendUrl =
      localStorage.getItem("cade_remote_backend_url") || "";
    const remoteEnabled =
      localStorage.getItem("cade_remote_enabled") === "true";

    // Create overlay
    this.overlay = document.createElement("div");
    this.overlay.className = "settings-overlay";
    this.overlay.innerHTML = `
      <div class="settings-modal">
        <h2>Remote Backend Settings</h2>
        <p class="settings-description">
          Connect to a remote CADE backend running on EC2 or another server.
        </p>

        <div class="settings-form">
          <div class="form-group">
            <label for="remote-enabled">
              <input type="checkbox" id="remote-enabled" ${remoteEnabled ? "checked" : ""}>
              Enable Remote Backend
            </label>
          </div>

          <div class="form-group">
            <label for="backend-url">Backend URL</label>
            <input
              type="text"
              id="backend-url"
              placeholder="http://EC2_IP:3000"
              value="${remoteBackendUrl}"
              ${!remoteEnabled ? "disabled" : ""}
            >
            <small>Example: http://12.34.56.78:3000 or https://cade.example.com</small>
          </div>

          <div class="form-group">
            <label for="auth-token">Authentication Token</label>
            <input
              type="password"
              id="auth-token"
              placeholder="Enter token from server"
              value="${currentToken}"
              ${!remoteEnabled ? "disabled" : ""}
            >
            <small>Required when auth is enabled on the backend</small>
          </div>

          <div class="settings-actions">
            <button class="btn-test" ${!remoteEnabled ? "disabled" : ""}>Test Connection</button>
            <button class="btn-save">Save</button>
            <button class="btn-cancel">Cancel</button>
          </div>

          <div class="connection-status"></div>
        </div>

        <div class="settings-warning">
          <strong>Note:</strong> Changing to remote mode requires restarting the app.
          Local mode will start the local backend automatically.
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Hide and destroy the modal.
   */
  hide(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /**
   * Setup event listeners for form controls.
   */
  private setupEventListeners(): void {
    if (!this.overlay) return;

    const remoteEnabledCheckbox = this.overlay.querySelector(
      "#remote-enabled"
    ) as HTMLInputElement;
    const backendUrlInput = this.overlay.querySelector(
      "#backend-url"
    ) as HTMLInputElement;
    const authTokenInput = this.overlay.querySelector(
      "#auth-token"
    ) as HTMLInputElement;
    const testButton = this.overlay.querySelector(
      ".btn-test"
    ) as HTMLButtonElement;
    const saveButton = this.overlay.querySelector(
      ".btn-save"
    ) as HTMLButtonElement;
    const cancelButton = this.overlay.querySelector(
      ".btn-cancel"
    ) as HTMLButtonElement;
    const statusDiv = this.overlay.querySelector(
      ".connection-status"
    ) as HTMLElement;

    // Toggle input fields based on checkbox
    remoteEnabledCheckbox?.addEventListener("change", () => {
      const enabled = remoteEnabledCheckbox.checked;
      backendUrlInput.disabled = !enabled;
      authTokenInput.disabled = !enabled;
      testButton.disabled = !enabled;
    });

    // Test connection
    testButton?.addEventListener("click", async () => {
      const url = backendUrlInput.value.trim();
      const token = authTokenInput.value.trim();

      if (!url) {
        this.showStatus("Please enter a backend URL", "error");
        return;
      }

      this.showStatus("Testing connection...", "info");
      testButton.disabled = true;

      try {
        // Try to connect to the backend
        const wsUrl = url.replace("http://", "ws://").replace("https://", "wss://");
        const testUrl = token ? `${wsUrl}/ws?token=${encodeURIComponent(token)}` : `${wsUrl}/ws`;

        const ws = new WebSocket(testUrl);

        const timeout = setTimeout(() => {
          ws.close();
          this.showStatus("Connection timed out", "error");
          testButton.disabled = false;
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          this.showStatus("✓ Connection successful!", "success");
          testButton.disabled = false;
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          this.showStatus("✗ Connection failed", "error");
          testButton.disabled = false;
        };
      } catch (e) {
        this.showStatus(`Error: ${e}`, "error");
        testButton.disabled = false;
      }
    });

    // Save settings
    saveButton?.addEventListener("click", () => {
      const enabled = remoteEnabledCheckbox.checked;
      const url = backendUrlInput.value.trim();
      const token = authTokenInput.value.trim();

      if (enabled && !url) {
        this.showStatus("Please enter a backend URL", "error");
        return;
      }

      // Save to localStorage
      localStorage.setItem("cade_remote_enabled", enabled.toString());
      localStorage.setItem("cade_remote_backend_url", url);

      if (token) {
        setAuthToken(token);
      } else {
        clearAuthToken();
      }

      this.showStatus("✓ Settings saved. Please restart the app.", "success");

      // Close after a delay
      setTimeout(() => {
        this.hide();
      }, 2000);
    });

    // Cancel
    cancelButton?.addEventListener("click", () => {
      this.hide();
    });

    // Close on overlay click (outside modal)
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    // Close on Escape key
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.hide();
        document.removeEventListener("keydown", handleKeydown);
      }
    };
    document.addEventListener("keydown", handleKeydown);
  }

  /**
   * Show a status message.
   */
  private showStatus(message: string, type: "info" | "success" | "error"): void {
    if (!this.overlay) return;

    const statusDiv = this.overlay.querySelector(
      ".connection-status"
    ) as HTMLElement;

    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = `connection-status status-${type}`;
    }
  }
}

// Export singleton instance
export const remoteConnectionSettings = new RemoteConnectionSettings();
