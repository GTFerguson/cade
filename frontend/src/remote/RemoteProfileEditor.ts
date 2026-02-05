import type { RemoteProfile } from "./types";
import { RemoteProfileManager } from "./profile-manager";
import { pickFile, getUserHomePath } from "../platform/tauri-bridge";

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
  private selectedIndex: number = 0;
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

    this.setupEventListeners();
  }

  private getInputFields(): HTMLInputElement[] {
    return [this.nameInput, this.hostInput, this.userInput, this.keyInput];
  }

  private navigateFields(direction: number, current: HTMLInputElement): void {
    const fields = this.getInputFields();
    const idx = fields.indexOf(current);
    if (idx < 0) return;

    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < fields.length) {
      fields[nextIdx]!.focus();
    } else if (direction > 0) {
      // Past last input — select first option
      current.blur();
      this.selectedIndex = 0;
      this.renderSelection();
    }
  }

  private setupEventListeners(): void {
    this.keyBrowseButton.addEventListener("click", () => this.handleBrowseKey());

    const options = this.optionsList.querySelectorAll(".option");
    options.forEach((option, index) => {
      option.addEventListener("click", () => {
        this.selectedIndex = index;
        this.handleOptionSelect();
      });
      option.addEventListener("focus", () => {
        this.selectedIndex = index;
        this.renderSelection();
      });
    });

    this.container.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT") {
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          this.navigateFields(e.key === "ArrowDown" ? 1 : -1, e.target as HTMLInputElement);
        }
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          this.navigateOptions(1);
          break;

        case "k":
        case "ArrowUp":
          e.preventDefault();
          this.navigateOptions(-1);
          break;

        case "l":
        case " ":
        case "Enter":
          e.preventDefault();
          this.handleOptionSelect();
          break;

        case "h":
        case "Backspace":
          e.preventDefault();
          this.handleCancel();
          break;
      }
    });
  }

  private renderSelection(): void {
    const options = this.optionsList.querySelectorAll(".option");
    options.forEach((opt, i) => {
      opt.classList.toggle("selected", i === this.selectedIndex);
    });
  }

  private navigateOptions(delta: number): void {
    const options = this.optionsList.querySelectorAll(".option");

    if (delta < 0 && this.selectedIndex === 0) {
      // Going up from first option — jump to last input field
      options[0]?.classList.remove("selected");
      const fields = this.getInputFields();
      fields[fields.length - 1]?.focus();
      return;
    }

    options[this.selectedIndex]?.classList.remove("selected");
    this.selectedIndex = (this.selectedIndex + delta + options.length) % options.length;
    options[this.selectedIndex]?.classList.add("selected");
  }

  private handleOptionSelect(): void {
    const options = this.optionsList.querySelectorAll(".option");
    const selectedOption = options[this.selectedIndex] as HTMLElement;
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

    const remotePort = 3000;
    const localPort = 3000;

    const profile: RemoteProfile = {
      id: this.profile?.id || generateId(),
      name,
      url: `http://localhost:${localPort}`,
      connectionType: "ssh-tunnel",
      sshHost: host,
      sshUser: user,
      sshKeyPath: key,
      localPort,
      remotePort,
      ...(this.profile?.lastUsed !== undefined ? { lastUsed: this.profile.lastUsed } : {}),
    };

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
