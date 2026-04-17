import { toWebSocketUrl } from "@core/platform/url-utils";
import type { RemoteProfile, RemoteProfilesConfig, SavedProject } from "./types";

const STORAGE_KEY = "cade_remote_profiles";
const CONFIG_VERSION = 1;

export class RemoteProfileManager {
  private profiles: RemoteProfile[] = [];

  // Evaluated at call time so it works even if Tauri injects
  // window.__TAURI__ after this class is constructed
  private get isTauri(): boolean {
    return typeof window !== "undefined" && (window as any).__TAURI__ === true;
  }

  constructor() {}

  async loadProfiles(): Promise<RemoteProfile[]> {
    try {
      const config = await this.loadConfig();
      this.profiles = config.profiles;
      return this.profiles;
    } catch (error) {
      console.error("Failed to load remote profiles:", error);
      this.profiles = [];
      return [];
    }
  }

  async saveProfile(profile: RemoteProfile): Promise<void> {
    const existingIndex = this.profiles.findIndex((p) => p.id === profile.id);
    if (existingIndex >= 0) {
      this.profiles[existingIndex] = profile;
    } else {
      this.profiles.push(profile);
    }
    await this.saveConfig();
  }

  async deleteProfile(id: string): Promise<void> {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    await this.saveConfig();
  }

  async updateProfile(profile: RemoteProfile): Promise<void> {
    await this.saveProfile(profile);
  }

  async getProfile(id: string): Promise<RemoteProfile | undefined> {
    return this.profiles.find((p) => p.id === id);
  }

  async testConnection(url: string, token?: string): Promise<boolean> {
    try {
      let wsUrl = toWebSocketUrl(url);
      if (token) {
        wsUrl += `?token=${encodeURIComponent(token)}`;
      }
      const ws = new WebSocket(wsUrl);

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
      });
    } catch (error) {
      console.error("Connection test failed:", error);
      return false;
    }
  }

  async markProfileUsed(id: string): Promise<void> {
    const profile = this.profiles.find((p) => p.id === id);
    if (profile) {
      profile.lastUsed = Date.now();
      await this.saveConfig();
    }
  }

  private async loadConfig(): Promise<RemoteProfilesConfig> {
    try {
      if (this.isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = await invoke<string>("load_remote_profiles");
        return JSON.parse(data);
      } else {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
          return JSON.parse(data);
        }
      }
    } catch (error) {
      console.warn("Failed to load remote profiles config:", error);
    }
    return this.getDefaultConfig();
  }

  private async saveConfig(): Promise<void> {
    const config: RemoteProfilesConfig = {
      version: CONFIG_VERSION,
      profiles: this.profiles,
    };

    const data = JSON.stringify(config, null, 2);

    if (this.isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_remote_profiles", { data });
    } else {
      localStorage.setItem(STORAGE_KEY, data);
    }
  }

  private getDefaultConfig(): RemoteProfilesConfig {
    return {
      version: CONFIG_VERSION,
      profiles: [],
    };
  }

  // Project management methods
  async getProjects(profileId: string): Promise<SavedProject[]> {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) return [];
    return profile.projects || [];
  }

  async saveProject(profileId: string, project: SavedProject): Promise<void> {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) {
      throw new Error(`Profile ${profileId} not found`);
    }

    if (!profile.projects) {
      profile.projects = [];
    }

    const existingIndex = profile.projects.findIndex((p) => p.id === project.id);
    if (existingIndex >= 0) {
      profile.projects[existingIndex] = project;
    } else {
      profile.projects.push(project);
    }

    await this.saveConfig();
  }

  async deleteProject(profileId: string, projectId: string): Promise<void> {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile || !profile.projects) return;

    profile.projects = profile.projects.filter((p) => p.id !== projectId);
    await this.saveConfig();
  }

  async markProjectUsed(profileId: string, projectId: string): Promise<void> {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile || !profile.projects) return;

    const project = profile.projects.find((p) => p.id === projectId);
    if (project) {
      project.lastUsed = Date.now();
      await this.saveConfig();
    }
  }

}
