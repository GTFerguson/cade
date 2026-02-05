import type { RemoteProfile } from "./types";
import { RemoteProfileManager } from "./profile-manager";
import { MenuNav } from "../ui/menu-nav";
import { pickFile, getUserHomePath } from "../platform/tauri-bridge";
import { buildSshTunnelProfile } from "./profile-utils";

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
  private hostInput: HTMLInputElement;
  private userInput: HTMLInputElement;
  private keyInput: HTMLInputElement;
  private keyBrowseButton: HTMLButtonElement;
  private optionsList: HTMLDivElement;
  private profile: RemoteProfile | null;
  private profileManager: RemoteProfileManager;
  private nav: MenuNav;
  private onSave: ((profile: RemoteProfile) => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(profileManager: RemoteProfileManager, profile?: RemoteProfile) {
    this.profileManager = profileManager;
    this.profile = profile || null;
    this.container = document.createElement("div");
    this.container.className = "pane-view";

    this.container.innerHTML = `
      <div class="pane-content">
        <div class="pane-header">[ ${profile ? "EDIT CONNECTION" : "NEW CONNECTION"} ]</div>

        <div class="input-section">
          <div class="input-wrapper">
            <span class="input-prompt">name:</span>
            <input type="text" class="input-field" placeholder="" data-field="name" />
          </div>

          <div class="input-wrapper">
            <span class="input-prompt">host:</span>
            <input type="text" class="input-field" placeholder="hostname or ip" data-field="host" />
          </div>

          <div class="input-wrapper">
            <span class="input-prompt">user:</span>
            <input type="text" class="input-field" placeholder="" data-field="user" />
          </div>

          <div class="input-wrapper">
            <span class="input-prompt">key:</span>
            <input type="text" class="input-field" placeholder="~/.ssh/id_rsa" data-field="key" />
            <button type="button" class="btn-browse" title="Browse for SSH key">...</button>
          </div>

          <div class="divider"></div>

          <div class="options-list">
            <div class="option selected" data-action="save" tabindex="0">
              <span class="option-label">[save & connect]</span>
            </div>
            <div class="option" data-action="cancel" tabindex="0">
              <span class="option-label">[cancel]</span>
            </div>
          </div>
        </div>
      </div>

      <div class="pane-help">
        <div><span class="help-key">↑/↓</span> navigate fields</div>
        <div><span class="help-key">tab</span> next field</div>
        <div><span class="help-key">l</span> select</div>
        <div><span class="help-key">h</span> back</div>
      </div>
    `;

    this.nameInput = this.container.querySelector('[data-field="name"]')!;
    this.hostInput = this.container.querySelector('[data-field="host"]')!;
    this.userInput = this.container.querySelector('[data-field="user"]')!;
    this.keyInput = this.container.querySelector('[data-field="key"]')!;
    this.keyBrowseButton = this.container.querySelector(".btn-browse")!;
    this.optionsList = this.container.querySelector(".options-list")!;

    if (profile) {
      this.nameInput.value = profile.name;
      this.hostInput.value = profile.sshHost || "";
      this.userInput.value = profile.sshUser || "";
      this.keyInput.value = profile.sshKeyPath || "";
    }

    this.nav = new MenuNav({
      getOptions: () => this.optionsList.querySelectorAll(".option"),
      getInputFields: () => this.getInputFields(),
      onSelect: () => this.handleOptionSelect(),
      onBack: () => this.handleCancel(),
    });

    this.setupEventListeners();
  }

  private getInputFields(): HTMLInputElement[] {
    return [this.nameInput, this.hostInput, this.userInput, this.keyInput];
  }

  private setupEventListeners(): void {
    this.keyBrowseButton.addEventListener("click", () => this.handleBrowseKey());

    this.nav.wireClickHandlers();

    const options = this.optionsList.querySelectorAll(".option");
    options.forEach((option, index) => {
      option.addEventListener("focus", () => {
        this.nav.selectedIndex = index;
        this.nav.renderSelection();
      });
    });

    this.container.addEventListener("keydown", (e) => this.nav.handleKeyDown(e));
  }

  private handleOptionSelect(): void {
    const options = this.optionsList.querySelectorAll(".option");
    const selectedOption = options[this.nav.selectedIndex] as HTMLElement;
    const action = selectedOption?.dataset.action;

    if (action === "save") {
      this.handleSave();
    } else if (action === "cancel") {
      this.handleCancel();
    }
  }

  private async handleBrowseKey(): Promise<void> {
    const homePath = getUserHomePath();
    const defaultPath = homePath ? `${homePath}/.ssh` : undefined;

    const selectedPath = await pickFile(defaultPath);
    if (selectedPath) {
      this.keyInput.value = selectedPath;
    }
  }

  private async handleSave(): Promise<void> {
    const name = this.nameInput.value.trim();
    const host = this.hostInput.value.trim();
    const user = this.userInput.value.trim();
    const key = this.keyInput.value.trim();

    if (!name) {
      this.nameInput.focus();
      return;
    }

    if (!host) {
      this.hostInput.focus();
      return;
    }

    if (!user) {
      this.userInput.focus();
      return;
    }

    if (!key) {
      this.keyInput.focus();
      return;
    }

    const profile = buildSshTunnelProfile(
      {
        name,
        host,
        user,
        keyPath: key,
        id: this.profile?.id,
        lastUsed: this.profile?.lastUsed,
      },
      generateId
    );

    try {
      await this.profileManager.saveProfile(profile);
      if (this.onSave) {
        this.onSave(profile);
      }
    } catch (error) {
      console.error("Save error:", error);
    }
  }

  private handleCancel(): void {
    if (this.onCancel) {
      this.onCancel();
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
