import type { RemoteProfile } from "./types";
import { RemoteProfileManager } from "./profile-manager";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class RemoteProfileEditor {
  private container: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private urlInput: HTMLInputElement;
  private tokenInput: HTMLInputElement;
  private pathInput: HTMLInputElement;
  private connectionTypeSelect: HTMLSelectElement;
  private sshHostInput: HTMLInputElement;
  private localPortInput: HTMLInputElement;
  private remotePortInput: HTMLInputElement;
  private tunnelFields: HTMLDivElement;
  private testButton: HTMLButtonElement;
  private saveButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private statusMessage: HTMLDivElement;
  private profile: RemoteProfile | null;
  private profileManager: RemoteProfileManager;
  private isTauri: boolean;
  private onSave: ((profile: RemoteProfile) => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(profileManager: RemoteProfileManager, profile?: RemoteProfile) {
    this.profileManager = profileManager;
    this.profile = profile || null;
    this.isTauri = typeof window !== "undefined" && "__TAURI__" in window;
    this.container = document.createElement("div");
    this.container.className = "remote-profile-editor";

    this.container.innerHTML = `
      <div class="profile-editor-header">
        <h3>${profile ? "Edit Profile" : "New Remote Profile"}</h3>
      </div>
      <div class="profile-editor-form">
        <div class="form-group">
          <label for="profile-name">Name</label>
          <input type="text" id="profile-name" placeholder="e.g., ML Server" required />
        </div>
        <div class="form-group">
          <label for="connection-type">Connection Type</label>
          <select id="connection-type">
            <option value="direct">Direct Connection</option>
            ${this.isTauri ? '<option value="ssh-tunnel">SSH Tunnel</option>' : ""}
          </select>
        </div>
        <div class="form-group">
          <label for="profile-url">Backend URL</label>
          <input type="text" id="profile-url" placeholder="http://52.30.205.70:3000" required />
        </div>
        <div class="tunnel-fields" style="display: none">
          <div class="form-group">
            <label for="ssh-host">SSH Host (from ~/.ssh/config)</label>
            <input type="text" id="ssh-host" placeholder="clann-vm" />
          </div>
          <div class="form-group">
            <label for="local-port">Local Port</label>
            <input type="number" id="local-port" placeholder="3000" />
          </div>
          <div class="form-group">
            <label for="remote-port">Remote Port</label>
            <input type="number" id="remote-port" placeholder="3000" />
          </div>
        </div>
        <div class="form-group">
          <label for="profile-token">Auth Token (optional)</label>
          <input type="password" id="profile-token" placeholder="••••••••" />
        </div>
        <div class="form-group">
          <label for="profile-path">Default Path (optional)</label>
          <input type="text" id="profile-path" placeholder="/" />
        </div>
        <div class="form-status"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-test">Test Connection</button>
          <button type="button" class="btn btn-cancel">Cancel</button>
          <button type="button" class="btn btn-primary btn-save">Save</button>
        </div>
      </div>
    `;

    this.nameInput = this.container.querySelector("#profile-name")!;
    this.urlInput = this.container.querySelector("#profile-url")!;
    this.tokenInput = this.container.querySelector("#profile-token")!;
    this.pathInput = this.container.querySelector("#profile-path")!;
    this.connectionTypeSelect = this.container.querySelector("#connection-type")!;
    this.sshHostInput = this.container.querySelector("#ssh-host")!;
    this.localPortInput = this.container.querySelector("#local-port")!;
    this.remotePortInput = this.container.querySelector("#remote-port")!;
    this.tunnelFields = this.container.querySelector(".tunnel-fields")!;
    this.testButton = this.container.querySelector(".btn-test")!;
    this.saveButton = this.container.querySelector(".btn-save")!;
    this.cancelButton = this.container.querySelector(".btn-cancel")!;
    this.statusMessage = this.container.querySelector(".form-status")!;

    if (profile) {
      this.nameInput.value = profile.name;
      this.urlInput.value = profile.url;
      this.tokenInput.value = profile.authToken || "";
      this.pathInput.value = profile.defaultPath || "";
      this.connectionTypeSelect.value = profile.connectionType || "direct";
      if (profile.sshHost) this.sshHostInput.value = profile.sshHost;
      if (profile.localPort) this.localPortInput.value = profile.localPort.toString();
      if (profile.remotePort) this.remotePortInput.value = profile.remotePort.toString();

      if (profile.connectionType === "ssh-tunnel") {
        this.tunnelFields.style.display = "block";
      }
    }

    this.setupEventListeners();
    this.setupKeyboardNavigation();
  }

  private setupEventListeners(): void {
    this.testButton.addEventListener("click", () => this.handleTestConnection());
    this.saveButton.addEventListener("click", () => this.handleSave());
    this.cancelButton.addEventListener("click", () => this.handleCancel());

    this.connectionTypeSelect.addEventListener("change", () => {
      const isTunnel = this.connectionTypeSelect.value === "ssh-tunnel";
      this.tunnelFields.style.display = isTunnel ? "block" : "none";

      if (isTunnel) {
        const localPort = this.localPortInput.value || "3000";
        this.urlInput.value = `http://localhost:${localPort}`;
      }
    });

    this.localPortInput.addEventListener("input", () => {
      if (this.connectionTypeSelect.value === "ssh-tunnel") {
        const localPort = this.localPortInput.value || "3000";
        this.urlInput.value = `http://localhost:${localPort}`;
      }
    });
  }

  private setupKeyboardNavigation(): void {
    this.container.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.handleCancel();
      } else if (e.key === "Enter" && e.target === this.saveButton) {
        e.preventDefault();
        this.handleSave();
      } else if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        this.handleTestConnection();
      }
    });

    const inputs = [this.nameInput, this.urlInput, this.tokenInput, this.pathInput];
    inputs.forEach((input, index) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (index < inputs.length - 1) {
            inputs[index + 1].focus();
          } else {
            this.handleSave();
          }
        }
      });
    });
  }

  private async handleTestConnection(): Promise<void> {
    const url = this.urlInput.value.trim();
    if (!url) {
      this.showStatus("Please enter a backend URL", "error");
      return;
    }

    if (!this.isValidUrl(url)) {
      this.showStatus("Invalid URL format", "error");
      return;
    }

    this.showStatus("Testing connection...", "info");
    this.testButton.disabled = true;

    const success = await this.profileManager.testConnection(
      url,
      this.tokenInput.value || undefined
    );

    this.testButton.disabled = false;

    if (success) {
      this.showStatus("✓ Connection successful", "success");
    } else {
      this.showStatus("✗ Connection failed - check URL and network", "error");
    }
  }

  private async handleSave(): Promise<void> {
    const name = this.nameInput.value.trim();
    const url = this.urlInput.value.trim();
    const connectionType = this.connectionTypeSelect.value as "direct" | "ssh-tunnel";

    if (!name) {
      this.showStatus("Please enter a profile name", "error");
      this.nameInput.focus();
      return;
    }

    if (!url) {
      this.showStatus("Please enter a backend URL", "error");
      this.urlInput.focus();
      return;
    }

    if (!this.isValidUrl(url)) {
      this.showStatus("Invalid URL format", "error");
      this.urlInput.focus();
      return;
    }

    if (connectionType === "ssh-tunnel") {
      if (!this.sshHostInput.value.trim()) {
        this.showStatus("Please enter SSH host", "error");
        this.sshHostInput.focus();
        return;
      }
      if (!this.localPortInput.value) {
        this.showStatus("Please enter local port", "error");
        this.localPortInput.focus();
        return;
      }
      if (!this.remotePortInput.value) {
        this.showStatus("Please enter remote port", "error");
        this.remotePortInput.focus();
        return;
      }
    }

    const profile: RemoteProfile = {
      id: this.profile?.id || generateId(),
      name,
      url,
      authToken: this.tokenInput.value || undefined,
      defaultPath: this.pathInput.value || undefined,
      lastUsed: this.profile?.lastUsed,
      connectionType,
      sshHost: connectionType === "ssh-tunnel" ? this.sshHostInput.value.trim() : undefined,
      localPort: connectionType === "ssh-tunnel" ? parseInt(this.localPortInput.value) : undefined,
      remotePort: connectionType === "ssh-tunnel" ? parseInt(this.remotePortInput.value) : undefined,
    };

    try {
      await this.profileManager.saveProfile(profile);
      if (this.onSave) {
        this.onSave(profile);
      }
    } catch (error) {
      this.showStatus("Failed to save profile", "error");
      console.error("Save error:", error);
    }
  }

  private handleCancel(): void {
    if (this.onCancel) {
      this.onCancel();
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  private showStatus(message: string, type: "info" | "success" | "error"): void {
    this.statusMessage.textContent = message;
    this.statusMessage.className = `form-status status-${type}`;
    if (type !== "info") {
      setTimeout(() => {
        this.statusMessage.textContent = "";
        this.statusMessage.className = "form-status";
      }, 3000);
    }
  }

  getElement(): HTMLDivElement {
    return this.container;
  }

  focus(): void {
    this.nameInput.focus();
  }

  setSaveCallback(callback: (profile: RemoteProfile) => void): void {
    this.onSave = callback;
  }

  setCancelCallback(callback: () => void): void {
    this.onCancel = callback;
  }
}
