import type { RemoteProfile } from "./types";
import { RemoteProfileManager } from "./profile-manager";
import { RemoteProfileEditor } from "./RemoteProfileEditor";

export class RemoteConnectionModal {
  private overlay: HTMLDivElement;
  private modal: HTMLDivElement;
  private profileList: HTMLDivElement;
  private editorContainer: HTMLDivElement;
  private profileManager: RemoteProfileManager;
  private profiles: RemoteProfile[] = [];
  private selectedIndex: number = 0;
  private resolve: ((profile: RemoteProfile | null) => void) | null = null;
  private isEditing: boolean = false;
  private boundHandleKeyDown = this.handleKeyDown.bind(this);

  constructor(profileManager: RemoteProfileManager) {
    this.profileManager = profileManager;

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    this.modal = document.createElement("div");
    this.modal.className = "remote-connection-modal";

    this.modal.innerHTML = `
      <div class="modal-header">
        <h2>Remote Connections</h2>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="profile-list-container">
          <div class="profile-list-header">
            <h3>Saved Profiles</h3>
            <div class="profile-list-actions">
              <button class="btn btn-primary btn-new-profile">New Profile (n)</button>
            </div>
          </div>
          <div class="profile-list"></div>
          <div class="profile-list-empty">
            <p>No remote profiles yet.</p>
            <p>Create one to get started.</p>
          </div>
          <div class="profile-list-footer">
            <div class="keyboard-hints">
              <span><kbd>↑</kbd><kbd>↓</kbd> or <kbd>j</kbd><kbd>k</kbd> Navigate</span>
              <span><kbd>Enter</kbd> Connect</span>
              <span><kbd>n</kbd> New</span>
              <span><kbd>e</kbd> Edit</span>
              <span><kbd>d</kbd> Delete</span>
              <span><kbd>Esc</kbd> Close</span>
            </div>
          </div>
        </div>
        <div class="profile-editor-container"></div>
      </div>
    `;

    this.profileList = this.modal.querySelector(".profile-list")!;
    this.editorContainer = this.modal.querySelector(".profile-editor-container")!;

    this.overlay.appendChild(this.modal);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const closeButton = this.modal.querySelector(".modal-close")!;
    closeButton.addEventListener("click", () => this.close());

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    const newProfileButton = this.modal.querySelector(".btn-new-profile")!;
    newProfileButton.addEventListener("click", () => this.showEditor());

    document.addEventListener("keydown", this.boundHandleKeyDown);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!document.body.contains(this.overlay)) {
      return;
    }

    if (this.isEditing) {
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        this.close();
        break;

      case "ArrowUp":
      case "k":
        e.preventDefault();
        this.navigateList(-1);
        break;

      case "ArrowDown":
      case "j":
        e.preventDefault();
        this.navigateList(1);
        break;

      case "Enter":
        e.preventDefault();
        this.connectToSelected();
        break;

      case "n":
        e.preventDefault();
        this.showEditor();
        break;

      case "e":
        e.preventDefault();
        this.editSelected();
        break;

      case "d":
        e.preventDefault();
        this.deleteSelected();
        break;
    }
  }

  private navigateList(delta: number): void {
    if (this.profiles.length === 0) return;

    this.selectedIndex = (this.selectedIndex + delta + this.profiles.length) % this.profiles.length;
    this.renderProfiles();
  }

  private async connectToSelected(): Promise<void> {
    if (this.profiles.length === 0) return;

    const profile = this.profiles[this.selectedIndex];
    await this.profileManager.markProfileUsed(profile.id);

    if (this.resolve) {
      this.resolve(profile);
    }
    this.remove();
  }

  private showEditor(profile?: RemoteProfile): void {
    this.isEditing = true;
    this.profileList.parentElement!.style.display = "none";
    this.editorContainer.style.display = "block";

    const editor = new RemoteProfileEditor(this.profileManager, profile);

    editor.setSaveCallback(async () => {
      await this.loadProfiles();
      this.hideEditor();
    });

    editor.setCancelCallback(() => {
      this.hideEditor();
    });

    this.editorContainer.innerHTML = "";
    this.editorContainer.appendChild(editor.getElement());
    editor.focus();
  }

  private hideEditor(): void {
    this.isEditing = false;
    this.editorContainer.style.display = "none";
    this.editorContainer.innerHTML = "";
    this.profileList.parentElement!.style.display = "block";
  }

  private editSelected(): void {
    if (this.profiles.length === 0) return;
    const profile = this.profiles[this.selectedIndex];
    this.showEditor(profile);
  }

  private async deleteSelected(): Promise<void> {
    if (this.profiles.length === 0) return;

    const profile = this.profiles[this.selectedIndex];
    const confirmed = confirm(`Delete profile "${profile.name}"?`);

    if (confirmed) {
      await this.profileManager.deleteProfile(profile.id);
      await this.loadProfiles();
      if (this.selectedIndex >= this.profiles.length) {
        this.selectedIndex = Math.max(0, this.profiles.length - 1);
      }
    }
  }

  private async loadProfiles(): Promise<void> {
    this.profiles = await this.profileManager.loadProfiles();
    this.profiles.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    this.renderProfiles();
  }

  private renderProfiles(): void {
    const emptyState = this.modal.querySelector(".profile-list-empty") as HTMLDivElement;

    if (this.profiles.length === 0) {
      this.profileList.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    this.profileList.style.display = "block";
    emptyState.style.display = "none";

    this.profileList.innerHTML = this.profiles
      .map((profile, index) => {
        const isSelected = index === this.selectedIndex;
        const lastUsed = profile.lastUsed
          ? new Date(profile.lastUsed).toLocaleDateString()
          : "Never";

        const icon = profile.connectionType === "ssh-tunnel" ? "🔒" : "🌐";
        const connType = profile.connectionType === "ssh-tunnel" ? "SSH Tunnel" : "Direct";

        return `
          <div class="profile-item ${isSelected ? "selected" : ""}" data-index="${index}">
            <div class="profile-item-header">
              <span class="profile-name">${this.escapeHtml(profile.name)}</span>
              <span class="profile-indicator" title="${connType}">${icon}</span>
            </div>
            <div class="profile-item-details">
              <span class="profile-url">${this.escapeHtml(profile.url)}</span>
              ${profile.defaultPath ? `<span class="profile-path">${this.escapeHtml(profile.defaultPath)}</span>` : ""}
            </div>
            <div class="profile-item-meta">
              <span class="profile-last-used">Last used: ${lastUsed}</span>
            </div>
          </div>
        `;
      })
      .join("");

    const items = this.profileList.querySelectorAll(".profile-item");
    items.forEach((item, index) => {
      item.addEventListener("click", () => {
        this.selectedIndex = index;
        this.connectToSelected();
      });
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async show(): Promise<RemoteProfile | null> {
    await this.loadProfiles();
    document.body.appendChild(this.overlay);

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private close(): void {
    if (this.resolve) {
      this.resolve(null);
    }
    this.remove();
  }

  private remove(): void {
    document.removeEventListener("keydown", this.boundHandleKeyDown);
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }
}
