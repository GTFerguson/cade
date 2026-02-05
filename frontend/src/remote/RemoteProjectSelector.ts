import type { RemoteProfile, SavedProject } from "./types";
import { RemoteProfileManager } from "./profile-manager";
import { RemoteProfileEditor } from "./RemoteProfileEditor";
import { WebSocketClient } from "../platform/websocket";
import { toWebSocketUrl } from "../platform/url-utils";
import type { FileNode } from "../types";

type Screen = "connections" | "projects" | "new-project" | "new-connection" | "browse";

interface SelectionResult {
  profile: RemoteProfile;
  path: string;
  projectName: string | undefined;
  ws: WebSocketClient;
}

export class RemoteProjectSelector {
  private container: HTMLDivElement;
  private profileManager: RemoteProfileManager;
  private profiles: RemoteProfile[] = [];
  private selectedProfile: RemoteProfile | null = null;
  private projects: SavedProject[] = [];
  private currentScreen: Screen = "connections";
  private selectedIndex: number = 0;
  private resolve: ((result: SelectionResult | null) => void) | null = null;
  private boundHandleKeyDown = this.handleKeyDown.bind(this);
  private ws: WebSocketClient | null = null;
  private currentBrowsePath: string = "";
  private browseEntries: FileNode[] = [];

  constructor(container: HTMLDivElement, profileManager: RemoteProfileManager) {
    this.container = container;
    this.profileManager = profileManager;

    this.container.className = "remote-project-selector";
  }

  private navigateInputFields(direction: number, current: HTMLInputElement): void {
    const inputs = Array.from(this.container.querySelectorAll<HTMLInputElement>(".input-field"));
    const idx = inputs.indexOf(current);
    if (idx < 0) return;

    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < inputs.length) {
      inputs[nextIdx]!.focus();
    } else if (direction > 0) {
      // Past last input — select first option
      current.blur();
      this.selectedIndex = 0;
      this.updateSelection();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Arrow keys navigate between fields; other keys pass through to inputs
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Escape") {
        (e.target as HTMLInputElement).blur();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.navigateInputFields(e.key === "ArrowDown" ? 1 : -1, e.target as HTMLInputElement);
      }
      return;
    }

    const options = this.container.querySelectorAll(".option");
    const inputs = this.container.querySelectorAll<HTMLInputElement>(".input-field");

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % options.length;
      this.updateSelection();
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      if (this.selectedIndex === 0 && inputs.length > 0) {
        // Jump from first option back to last input field
        options[0]?.classList.remove("selected");
        inputs[inputs.length - 1]!.focus();
      } else {
        this.selectedIndex = (this.selectedIndex - 1 + options.length) % options.length;
        this.updateSelection();
      }
    } else if (e.key === "l" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      this.handleSelect();
    } else if (e.key === "h" || e.key === "Backspace") {
      e.preventDefault();
      this.handleBack();
    }
  }

  private updateSelection(): void {
    const options = this.container.querySelectorAll(".option");
    options.forEach((opt, i) => {
      opt.classList.toggle("selected", i === this.selectedIndex);
    });
  }

  private async handleSelect(): Promise<void> {
    if (this.currentScreen === "connections") {
      if (this.selectedIndex < this.profiles.length) {
        // Select connection
        const profile = this.profiles[this.selectedIndex];
        if (!profile) return;
        this.selectedProfile = profile;
        await this.showProjectsScreen();
      } else {
        // [+ new connection]
        this.showNewConnectionScreen();
      }
    } else if (this.currentScreen === "projects") {
      if (this.selectedIndex < this.projects.length) {
        // Select saved project
        const project = this.projects[this.selectedIndex];
        if (!project) return;
        await this.profileManager.markProjectUsed(this.selectedProfile!.id, project.id);
        this.finishSelection(project.path, project.name);
      } else {
        // [+ new project]
        this.showNewProjectScreen();
      }
    } else if (this.currentScreen === "new-project") {
      if (this.selectedIndex === 0) {
        // [save & open]
        await this.saveAndOpen();
      } else if (this.selectedIndex === 1) {
        // [browse files]
        this.showBrowseScreen();
      }
    } else if (this.currentScreen === "browse") {
      const actionEl = this.container.querySelector('[data-action="select"]');
      const isFocusedOnSelect = actionEl?.classList.contains('selected');

      if (isFocusedOnSelect) {
        // Select current directory
        this.selectBrowseDirectory();
      } else if (this.selectedIndex < this.browseEntries.length) {
        // Enter selected directory
        const entry = this.browseEntries[this.selectedIndex];
        if (entry) {
          this.navigateToDirectory(entry.path);
        }
      }
    }
  }

  private handleBack(): void {
    if (this.currentScreen === "projects") {
      this.showConnectionsScreen();
    } else if (this.currentScreen === "new-project") {
      this.showProjectsScreen();
    } else if (this.currentScreen === "browse") {
      // Go to parent directory
      this.navigateToParent();
    } else if (this.currentScreen === "connections") {
      this.close();
    }
  }

  private navigateToDirectory(path: string): void {
    this.currentBrowsePath = path;
    this.selectedIndex = 0;
    if (this.ws) {
      this.ws.requestChildren(path);
      // Show loading state
      const browserList = this.container.querySelector('.browser-list');
      if (browserList) {
        browserList.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Loading...</p>';
      }
    }
  }

  private navigateToParent(): void {
    // Simple parent directory logic - go up one level
    const parts = this.currentBrowsePath.split('/').filter(p => p);
    if (parts.length > 0) {
      parts.pop();
      this.currentBrowsePath = '/' + parts.join('/');
      if (!this.currentBrowsePath) this.currentBrowsePath = '/';
      this.navigateToDirectory(this.currentBrowsePath);
    }
  }

  private selectBrowseDirectory(): void {
    const nameInput = this.container.querySelector("#browse-project-name") as HTMLInputElement;
    const name = nameInput?.value.trim();

    if (name) {
      // Save as project
      const project: SavedProject = {
        id: crypto.randomUUID(),
        name,
        path: this.currentBrowsePath,
        lastUsed: Date.now(),
      };
      this.profileManager.saveProject(this.selectedProfile!.id, project);
      this.finishSelection(this.currentBrowsePath, name);
    } else {
      // One-time open
      this.finishSelection(this.currentBrowsePath);
    }
  }

  private async showConnectionsScreen(): Promise<void> {
    this.currentScreen = "connections";
    this.selectedIndex = 0;
    this.profiles = await this.profileManager.loadProfiles();

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ REMOTE CONNECTIONS ]</div>
          <div class="options-list">
            ${this.profiles.map((profile, i) => `
              <div class="option ${i === 0 ? 'selected' : ''}" data-index="${i}">
                <span class="option-label">[${this.escapeHtml(profile.name)}]</span>
                <span class="option-meta">${this.escapeHtml(profile.url)}</span>
              </div>
            `).join("")}
            <div class="divider"></div>
            <div class="option" data-index="${this.profiles.length}">
              <span class="option-label">[+ new connection]</span>
            </div>
          </div>
        </div>
        <div class="pane-help">
          <div><span class="help-key">j/k</span> or <span class="help-key">↑/↓</span> navigate</div>
          <div><span class="help-key">l</span> select</div>
          <div><span class="help-key">h</span> cancel</div>
        </div>
      </div>
    `;

    this.attachOptionListeners();
  }

  private async showProjectsScreen(): Promise<void> {
    this.currentScreen = "projects";
    this.selectedIndex = 0;
    this.projects = await this.profileManager.getProjects(this.selectedProfile!.id);

    // Sort by most recently used
    this.projects.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

    // Create WebSocket connection for this profile (for browsing)
    if (!this.ws && this.selectedProfile) {
      const wsUrl = toWebSocketUrl(this.selectedProfile.url);
      this.ws = new WebSocketClient(wsUrl, this.selectedProfile.authToken);

      // Set up handler for directory listings
      this.ws.on("file-children", (message) => {
        this.handleBrowseResults(message.children);
      });

      // Set default browse path to home or defaultPath
      this.currentBrowsePath = this.selectedProfile.defaultPath || "~";
    }

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ ${this.escapeHtml(this.selectedProfile!.name).toUpperCase()} ]</div>
          <div class="options-list">
            ${this.projects.map((project, i) => `
              <div class="option ${i === 0 ? 'selected' : ''}" data-index="${i}">
                <span class="option-label">[${this.escapeHtml(project.name)}]</span>
                <span class="option-meta">${this.escapeHtml(project.path)}</span>
              </div>
            `).join("")}
            <div class="divider"></div>
            <div class="option" data-index="${this.projects.length}">
              <span class="option-label">[+ new project]</span>
            </div>
          </div>
        </div>
        <div class="pane-help">
          <div><span class="help-key">j/k</span> or <span class="help-key">↑/↓</span> navigate</div>
          <div><span class="help-key">l</span> open project</div>
          <div><span class="help-key">h</span> back to connections</div>
        </div>
      </div>
    `;

    this.attachOptionListeners();
  }

  private showNewConnectionScreen(): void {
    this.currentScreen = "new-connection";
    this.selectedIndex = 0;

    const editor = new RemoteProfileEditor(this.profileManager);

    editor.setSaveCallback(async () => {
      // Profile saved, go back to connections list and reload
      await this.showConnectionsScreen();
    });

    editor.setCancelCallback(() => {
      // Cancelled, go back to connections list
      void this.showConnectionsScreen();
    });

    this.container.innerHTML = "";
    this.container.appendChild(editor.getElement());
    editor.focus();
  }

  private showNewProjectScreen(): void {
    this.currentScreen = "new-project";
    this.selectedIndex = 0;

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ NEW PROJECT ]</div>
          <div class="input-section">
            <div class="input-group">
              <div class="input-label">project name (optional - leave blank to open once)</div>
              <div class="input-wrapper">
                <span class="input-prompt">name:</span>
                <input type="text" class="input-field" id="project-name" placeholder="" />
              </div>
            </div>
            <div class="input-group">
              <div class="input-label">remote path</div>
              <div class="input-wrapper">
                <span class="input-prompt">path:</span>
                <input type="text" class="input-field" id="project-path" placeholder="/home/user/..." />
              </div>
            </div>
            <div class="divider"></div>
            <div class="options-list">
              <div class="option" data-index="0" tabindex="0">
                <span class="option-label">[save & open]</span>
              </div>
              <div class="option" data-index="1" tabindex="0">
                <span class="option-label">[browse files]</span>
              </div>
            </div>
          </div>
        </div>
        <div class="pane-help">
          <div><span class="help-key">↑/↓</span> navigate fields</div>
          <div><span class="help-key">l</span> select action</div>
          <div><span class="help-key">h</span> back</div>
        </div>
      </div>
    `;

    this.attachOptionListeners();

    const nameInput = this.container.querySelector("#project-name") as HTMLInputElement;
    nameInput?.focus();
  }

  private showBrowseScreen(): void {
    this.currentScreen = "browse";
    this.selectedIndex = 0;

    // Show loading state initially
    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ BROWSE ]</div>
          <div class="browser-section">
            <div class="browser-path">${this.escapeHtml(this.currentBrowsePath)}</div>
            <div class="browser-loading">
              <p style="color: var(--text-muted); text-align: center;">Loading...</p>
            </div>
          </div>
        </div>
        <div class="pane-help">
          <div><span class="help-key">j/k</span> navigate files</div>
          <div><span class="help-key">l</span> enter directory</div>
          <div><span class="help-key">h</span> parent directory</div>
        </div>
      </div>
    `;

    // Request directory listing
    if (this.ws) {
      this.ws.requestChildren(this.currentBrowsePath);
    }
  }

  private handleBrowseResults(entries: FileNode[]): void {
    this.browseEntries = entries.filter((e) => e.type === "directory");

    // Re-render browse screen with results
    this.renderBrowseScreen();
  }

  private renderBrowseScreen(): void {
    if (this.currentScreen !== "browse") return;

    const directoriesHtml = this.browseEntries
      .map((entry, i) => `
        <div class="option ${i === this.selectedIndex ? 'selected' : ''}" data-index="${i}">
          <span class="option-label">[${this.escapeHtml(entry.name)}/]</span>
        </div>
      `)
      .join("");

    const nameInput = this.container.querySelector("#browse-project-name") as HTMLInputElement;
    const currentName = nameInput?.value || "";

    // Button is selected when selectedIndex is beyond all directories
    const isButtonSelected = this.selectedIndex >= this.browseEntries.length;

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ BROWSE ]</div>
          <div class="browser-section">
            <div class="browser-path">${this.escapeHtml(this.currentBrowsePath)}</div>
            <div class="options-list browser-list">
              ${this.browseEntries.length > 0 ? directoriesHtml : '<p style="color: var(--text-muted); text-align: center;">No directories found</p>'}
            </div>
            <div class="divider"></div>
            <div class="input-group">
              <div class="input-label">project name (optional)</div>
              <div class="input-wrapper">
                <span class="input-prompt">name:</span>
                <input type="text" class="input-field" id="browse-project-name" placeholder="" value="${this.escapeHtml(currentName)}" />
              </div>
            </div>
            <div class="divider"></div>
            <div class="options-list">
              <div class="option ${isButtonSelected ? 'selected' : ''}" data-action="select">
                <span class="option-label">[select current directory]</span>
              </div>
            </div>
          </div>
        </div>
        <div class="pane-help">
          <div><span class="help-key">j/k</span> navigate files</div>
          <div><span class="help-key">l</span> enter directory</div>
          <div><span class="help-key">h</span> parent directory</div>
        </div>
      </div>
    `;

    this.attachOptionListeners();
  }

  private async saveAndOpen(): Promise<void> {
    const nameInput = this.container.querySelector("#project-name") as HTMLInputElement;
    const pathInput = this.container.querySelector("#project-path") as HTMLInputElement;

    const name = nameInput?.value.trim();
    const path = pathInput?.value.trim();

    if (!path) {
      alert("Please enter a remote path");
      pathInput?.focus();
      return;
    }

    if (name) {
      // Save as project
      const project: SavedProject = {
        id: crypto.randomUUID(),
        name,
        path,
        lastUsed: Date.now(),
      };

      await this.profileManager.saveProject(this.selectedProfile!.id, project);
      this.finishSelection(path, name);
    } else {
      // One-time open
      this.finishSelection(path);
    }
  }

  private finishSelection(path: string, projectName?: string): void {
    if (this.resolve && this.selectedProfile && this.ws) {
      this.resolve({
        profile: this.selectedProfile,
        path,
        projectName,
        ws: this.ws,
      });
      // Don't close WebSocket - we're passing it to the tab
      this.ws = null;
    }
    this.remove();
  }

  private attachOptionListeners(): void {
    const options = this.container.querySelectorAll(".option");
    options.forEach((opt, index) => {
      opt.addEventListener("click", () => {
        this.selectedIndex = index;
        this.updateSelection();
        this.handleSelect();
      });
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async show(): Promise<SelectionResult | null> {
    await this.showConnectionsScreen();
    document.addEventListener("keydown", this.boundHandleKeyDown);

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

    // Clean up WebSocket if user cancelled
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }

    // Remove the container from DOM
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
