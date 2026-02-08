import type { RemoteProfile, SavedProject } from "./types";
import { RemoteProfileManager } from "./profile-manager";
import { RemoteProfileEditor } from "./RemoteProfileEditor";
import { WebSocketClient } from "../platform/websocket";
import { toWebSocketUrl } from "../platform/url-utils";
import { MenuNav, escapeHtml } from "../ui/menu-nav";
import { buildTunnelArgs, computeParentPath, filterDirectories, sortProjectsByLastUsed, getProfileDisplayMeta } from "./profile-utils";
import type { FileNode } from "../types";

type Screen = "connections" | "projects" | "new-project" | "new-connection" | "browse";

interface SelectionResult {
  profile: RemoteProfile;
  path: string;
  projectName: string | undefined;
  ws: WebSocketClient;
  tunnelPid?: number;
}

export class RemoteProjectSelector {
  private container: HTMLDivElement;
  private profileManager: RemoteProfileManager;
  private profiles: RemoteProfile[] = [];
  private selectedProfile: RemoteProfile | null = null;
  private projects: SavedProject[] = [];
  private currentScreen: Screen = "connections";
  private resolve: ((result: SelectionResult | null) => void) | null = null;
  private nav: MenuNav;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private ws: WebSocketClient | null = null;
  private wsUrl: string = "";
  private wsAuthToken: string | undefined;
  private tunnelPid: number | undefined;
  private currentBrowsePath: string = "";
  private browseEntries: FileNode[] = [];

  constructor(container: HTMLDivElement, profileManager: RemoteProfileManager) {
    this.container = container;
    this.profileManager = profileManager;

    this.container.className = "remote-project-selector";

    this.nav = new MenuNav({
      getOptions: () => this.container.querySelectorAll(".option"),
      getInputFields: () => this.container.querySelectorAll<HTMLInputElement>(".input-field"),
      onSelect: () => this.handleSelect(),
      onBack: () => this.handleBack(),
      onCancel: () => this.handleEscape(),
    });

    this.boundHandleKeyDown = (e: KeyboardEvent) => this.nav.handleKeyDown(e);
  }

  private async handleSelect(): Promise<void> {
    if (this.currentScreen === "connections") {
      if (this.nav.selectedIndex < this.profiles.length) {
        const profile = this.profiles[this.nav.selectedIndex];
        if (!profile) return;
        this.selectedProfile = profile;
        await this.showProjectsScreen();
      } else {
        this.showNewConnectionScreen();
      }
    } else if (this.currentScreen === "projects") {
      if (this.nav.selectedIndex < this.projects.length) {
        const project = this.projects[this.nav.selectedIndex];
        if (!project) return;
        await this.profileManager.markProjectUsed(this.selectedProfile!.id, project.id);
        this.finishSelection(project.path, project.name);
      } else {
        this.showNewProjectScreen();
      }
    } else if (this.currentScreen === "new-project") {
      if (this.nav.selectedIndex === 0) {
        await this.saveAndOpen();
      } else if (this.nav.selectedIndex === 1) {
        this.showBrowseScreen();
      }
    } else if (this.currentScreen === "browse") {
      const actionEl = this.container.querySelector('[data-action="select"]');
      const isFocusedOnSelect = actionEl?.classList.contains('selected');

      if (isFocusedOnSelect) {
        this.selectBrowseDirectory();
      } else if (this.nav.selectedIndex < this.browseEntries.length) {
        const entry = this.browseEntries[this.nav.selectedIndex];
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
      const parent = computeParentPath(this.currentBrowsePath);
      if (parent !== this.currentBrowsePath) {
        this.navigateToDirectory(parent);
      } else {
        this.showNewProjectScreen();
      }
    } else if (this.currentScreen === "connections") {
      this.close();
    }
  }

  private handleEscape(): void {
    if (this.currentScreen === "browse") {
      this.showNewProjectScreen();
    } else if (this.currentScreen === "new-project") {
      this.showProjectsScreen();
    } else if (this.currentScreen === "projects") {
      this.showConnectionsScreen();
    } else {
      this.close();
    }
  }

  private navigateToDirectory(path: string): void {
    this.currentBrowsePath = path;
    this.nav.reset();
    if (this.ws) {
      this.ws.requestBrowseChildren(path);
      const browserList = this.container.querySelector('.browser-list');
      if (browserList) {
        browserList.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Loading...</p>';
      }
    }
  }

  private selectBrowseDirectory(): void {
    const nameInput = this.container.querySelector("#browse-project-name") as HTMLInputElement;
    const name = nameInput?.value.trim();

    if (name) {
      const project: SavedProject = {
        id: crypto.randomUUID(),
        name,
        path: this.currentBrowsePath,
        lastUsed: Date.now(),
      };
      this.profileManager.saveProject(this.selectedProfile!.id, project);
      this.finishSelection(this.currentBrowsePath, name);
    } else {
      this.finishSelection(this.currentBrowsePath);
    }
  }

  private async showConnectionsScreen(): Promise<void> {
    this.currentScreen = "connections";
    this.nav.reset();
    this.profiles = await this.profileManager.loadProfiles();

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ REMOTE CONNECTIONS ]</div>
          <div class="options-list">
            ${this.profiles.map((profile, i) => `
              <div class="option ${i === 0 ? 'selected' : ''}" data-index="${i}">
                <span class="option-label">[${escapeHtml(profile.name)}]</span>
                <span class="option-meta">${escapeHtml(getProfileDisplayMeta(profile))}</span>
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

    this.nav.wireClickHandlers();
  }

  private async startTunnelIfNeeded(profile: RemoteProfile): Promise<void> {
    if (profile.connectionType !== "ssh-tunnel") return;

    const isTauri = (window as any).__TAURI__ === true;
    if (!isTauri) {
      throw new Error(
        "SSH tunnels require the desktop app. " +
        "Either use the desktop app or edit this profile to use direct connection."
      );
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const args = buildTunnelArgs(profile);
    this.tunnelPid = await invoke<number>("start_ssh_tunnel", args);
    console.log(`[CADE] SSH tunnel started: PID ${this.tunnelPid}`);

    // Probe the tunnel until it's forwarding (or timeout after 10s)
    const probeUrl = `http://localhost:${profile.localPort || 3000}`;
    const deadline = Date.now() + 10_000;
    let tunnelReady = false;

    while (Date.now() < deadline) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        await fetch(probeUrl, {
          method: "HEAD",
          mode: "no-cors",
          signal: controller.signal,
        });
        clearTimeout(timer);
        tunnelReady = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    if (!tunnelReady) {
      console.warn("[CADE] SSH tunnel probe timed out, proceeding anyway");
    }
  }

  private async showProjectsScreen(): Promise<void> {
    this.currentScreen = "projects";
    this.nav.reset();
    this.projects = await this.profileManager.getProjects(this.selectedProfile!.id);

    this.projects = sortProjectsByLastUsed(this.projects);

    // Start SSH tunnel before connecting WebSocket
    if (!this.ws && this.selectedProfile) {
      try {
        await this.startTunnelIfNeeded(this.selectedProfile);
      } catch (error) {
        console.error("[CADE] Tunnel failed:", error);
        this.showConnectionsScreen();
        return;
      }

      this.wsUrl = toWebSocketUrl(this.selectedProfile.url);
      this.wsAuthToken = this.selectedProfile.authToken;
      this.ws = new WebSocketClient(this.wsUrl, this.wsAuthToken);

      this.ws.on("browse-children", (message) => {
        if (message.path) {
          this.currentBrowsePath = message.path;
        }
        this.handleBrowseResults(message.children);
      });

      this.currentBrowsePath = this.selectedProfile.defaultPath || "~";

      // Connect now so browse-children requests work
      this.ws.sendSetProject(this.selectedProfile.defaultPath || "~");
      this.ws.connect();
    }

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ ${escapeHtml(this.selectedProfile!.name).toUpperCase()} ]</div>
          <div class="options-list">
            ${this.projects.map((project, i) => `
              <div class="option ${i === 0 ? 'selected' : ''}" data-index="${i}">
                <span class="option-label">[${escapeHtml(project.name)}]</span>
                <span class="option-meta">${escapeHtml(project.path)}</span>
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

    this.nav.wireClickHandlers();
  }

  private showNewConnectionScreen(): void {
    this.currentScreen = "new-connection";
    this.nav.reset();

    const editor = new RemoteProfileEditor(this.profileManager);

    editor.setSaveCallback(async () => {
      await this.showConnectionsScreen();
    });

    editor.setCancelCallback(() => {
      void this.showConnectionsScreen();
    });

    this.container.innerHTML = "";
    this.container.appendChild(editor.getElement());
    editor.focus();
  }

  private showNewProjectScreen(): void {
    this.currentScreen = "new-project";
    this.nav.reset();

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
            <div class="new-project-status"></div>
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
          <div><span class="help-key">h/esc</span> back</div>
        </div>
      </div>
    `;

    this.nav.wireClickHandlers();

    const nameInput = this.container.querySelector("#project-name") as HTMLInputElement;
    nameInput?.focus();
  }

  private showBrowseScreen(): void {
    this.currentScreen = "browse";
    this.nav.reset();

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ BROWSE ]</div>
          <div class="browser-section">
            <div class="browser-path">${escapeHtml(this.currentBrowsePath)}</div>
            <div class="browser-loading">
              <p style="color: var(--text-muted); text-align: center;">Loading...</p>
            </div>
          </div>
        </div>
        <div class="pane-help">
          <div><span class="help-key">j/k</span> navigate files</div>
          <div><span class="help-key">l</span> enter directory</div>
          <div><span class="help-key">h</span> parent dir</div>
          <div><span class="help-key">esc</span> back</div>
        </div>
      </div>
    `;

    if (this.ws) {
      this.ws.requestBrowseChildren(this.currentBrowsePath);
    }
  }

  private handleBrowseResults(entries: FileNode[]): void {
    this.browseEntries = filterDirectories(entries);
    this.renderBrowseScreen();
  }

  private renderBrowseScreen(): void {
    if (this.currentScreen !== "browse") return;

    const directoriesHtml = this.browseEntries
      .map((entry, i) => `
        <div class="option ${i === this.nav.selectedIndex ? 'selected' : ''}" data-index="${i}">
          <span class="option-label">[${escapeHtml(entry.name)}/]</span>
        </div>
      `)
      .join("");

    const nameInput = this.container.querySelector("#browse-project-name") as HTMLInputElement;
    const currentName = nameInput?.value || "";

    const isButtonSelected = this.nav.selectedIndex >= this.browseEntries.length;

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ BROWSE ]</div>
          <div class="browser-section">
            <div class="browser-path">${escapeHtml(this.currentBrowsePath)}</div>
            <div class="options-list browser-list">
              ${this.browseEntries.length > 0 ? directoriesHtml : '<p style="color: var(--text-muted); text-align: center;">No directories found</p>'}
            </div>
            <div class="divider"></div>
            <div class="input-group">
              <div class="input-label">project name (optional)</div>
              <div class="input-wrapper">
                <span class="input-prompt">name:</span>
                <input type="text" class="input-field" id="browse-project-name" placeholder="" value="${escapeHtml(currentName)}" />
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
          <div><span class="help-key">h</span> parent dir</div>
          <div><span class="help-key">esc</span> back</div>
        </div>
      </div>
    `;

    this.nav.wireClickHandlers();
  }

  private async saveAndOpen(): Promise<void> {
    const nameInput = this.container.querySelector("#project-name") as HTMLInputElement;
    const pathInput = this.container.querySelector("#project-path") as HTMLInputElement;

    const name = nameInput?.value.trim();
    const path = pathInput?.value.trim();

    if (!path) {
      pathInput?.focus();
      const statusEl = this.container.querySelector(".new-project-status");
      if (statusEl) {
        statusEl.textContent = "enter a valid remote path";
        statusEl.className = "new-project-status auth-token-error";
      }
      return;
    }

    if (name) {
      const project: SavedProject = {
        id: crypto.randomUUID(),
        name,
        path,
        lastUsed: Date.now(),
      };

      await this.profileManager.saveProject(this.selectedProfile!.id, project);
      this.finishSelection(path, name);
    } else {
      this.finishSelection(path);
    }
  }

  private finishSelection(path: string, projectName?: string): void {
    if (this.resolve && this.selectedProfile && this.ws) {
      // Disconnect the browse ws — it has the wrong project context.
      // Create a fresh ws for the tab so initializeTabContext can send
      // SET_PROJECT with the correct path on connect.
      this.ws.disconnect();
      const tabWs = new WebSocketClient(this.wsUrl, this.wsAuthToken);

      const result: SelectionResult = {
        profile: this.selectedProfile,
        path,
        projectName,
        ws: tabWs,
      };
      if (this.tunnelPid !== undefined) {
        result.tunnelPid = this.tunnelPid;
      }
      this.resolve(result);
      this.ws = null;
      this.tunnelPid = undefined;
    }
    this.remove();
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

    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }

    if (this.tunnelPid !== undefined) {
      this.stopTunnel(this.tunnelPid);
      this.tunnelPid = undefined;
    }

    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  private async stopTunnel(pid: number): Promise<void> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_ssh_tunnel", { tunnelPid: pid });
      console.log(`[CADE] SSH tunnel stopped: PID ${pid}`);
    } catch (error) {
      console.warn("[CADE] Failed to stop tunnel:", error);
    }
  }
}
