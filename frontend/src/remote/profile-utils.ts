import type { RemoteProfile, SavedProject } from "./types";
import type { FileNode } from "../types";

export interface ProfileInputs {
  name: string;
  host: string;
  user: string;
  keyPath: string;
  id?: string | undefined;
  lastUsed?: number | undefined;
}

export interface DirectProfileInputs {
  name: string;
  url: string;
  token?: string | undefined;
  id?: string | undefined;
  lastUsed?: number | undefined;
}

/**
 * Build a RemoteProfile from user-provided SSH connection inputs.
 * Pure function — no DOM or side effects.
 */
/**
 * Build a RemoteProfile for a direct WebSocket connection (no SSH tunnel).
 * Pure function — no DOM or side effects.
 */
export function buildDirectProfile(
  inputs: DirectProfileInputs,
  generateId: () => string
): RemoteProfile {
  const profile: RemoteProfile = {
    id: inputs.id || generateId(),
    name: inputs.name,
    url: inputs.url,
    connectionType: "direct",
  };

  if (inputs.token) {
    profile.authToken = inputs.token;
  }
  if (inputs.lastUsed !== undefined) {
    profile.lastUsed = inputs.lastUsed;
  }

  return profile;
}

/**
 * Build a RemoteProfile from user-provided SSH connection inputs.
 * Pure function — no DOM or side effects.
 */
export function buildSshTunnelProfile(
  inputs: ProfileInputs,
  generateId: () => string
): RemoteProfile {
  const localPort = 3000;
  const remotePort = 3000;

  const profile: RemoteProfile = {
    id: inputs.id || generateId(),
    name: inputs.name,
    url: `http://localhost:${localPort}`,
    connectionType: "ssh-tunnel",
    sshHost: inputs.host,
    sshUser: inputs.user,
    sshKeyPath: inputs.keyPath,
    localPort,
    remotePort,
  };

  if (inputs.lastUsed !== undefined) {
    profile.lastUsed = inputs.lastUsed;
  }

  return profile;
}

export interface TunnelArgs {
  sshHost: string | undefined;
  localPort: number;
  remotePort: number;
  sshUser: string | null;
  sshKeyPath: string | null;
  [key: string]: unknown;
}

/**
 * Build SSH tunnel invocation arguments from a RemoteProfile.
 * Pure function — extracts exactly what gets passed to the Tauri command.
 */
export function buildTunnelArgs(profile: RemoteProfile): TunnelArgs {
  return {
    sshHost: profile.sshHost,
    localPort: profile.localPort || 3000,
    remotePort: profile.remotePort || 3000,
    sshUser: profile.sshUser || null,
    sshKeyPath: profile.sshKeyPath || null,
  };
}

/**
 * Compute the parent path for directory navigation.
 * Strips the last path segment. Handles both absolute paths (/...) and
 * tilde paths (~...) — tilde acts as a root that can't be navigated above.
 */
export function computeParentPath(currentPath: string): string {
  // Tilde-prefixed paths: ~ is the root
  if (currentPath === "~") return "~";
  if (currentPath.startsWith("~/")) {
    const rest = currentPath.slice(2); // strip "~/"
    const parts = rest.split("/").filter((p) => p);
    if (parts.length <= 1) return "~";
    parts.pop();
    return "~/" + parts.join("/");
  }

  // Absolute paths
  const parts = currentPath.split("/").filter((p) => p);
  if (parts.length === 0) return "/";
  parts.pop();
  const parent = "/" + parts.join("/");
  return parent || "/";
}

/**
 * Filter file entries to directories only (for browse screen).
 */
export function filterDirectories(entries: FileNode[]): FileNode[] {
  return entries.filter((e) => e.type === "directory");
}

/**
 * Build a SavedProject from browse or manual entry inputs.
 */
export function buildSavedProject(
  name: string,
  path: string,
  generateId: () => string
): SavedProject {
  return {
    id: generateId(),
    name,
    path,
    lastUsed: Date.now(),
  };
}

/**
 * Sort projects by most recently used (descending).
 */
export function sortProjectsByLastUsed(
  projects: SavedProject[]
): SavedProject[] {
  return [...projects].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

/**
 * Compute the base path for file creation from a selected file tree node.
 * Directories get a trailing slash; files resolve to their parent directory.
 */
export function computeFileCreationBasePath(
  selectedPath: string | null,
  nodeType: "file" | "directory" | null
): string {
  if (!selectedPath) return "";
  if (nodeType === "directory") return selectedPath + "/";

  const lastSlash = selectedPath.lastIndexOf("/");
  return lastSlash !== -1 ? selectedPath.substring(0, lastSlash + 1) : "";
}

/**
 * Get a human-readable connection description for display in the connections list.
 * SSH tunnel profiles show user@host; direct profiles show the URL.
 */
export function getProfileDisplayMeta(profile: RemoteProfile): string {
  if (profile.connectionType === "ssh-tunnel" && profile.sshHost) {
    return profile.sshUser
      ? `${profile.sshUser}@${profile.sshHost}`
      : profile.sshHost;
  }
  return profile.url;
}

// Re-export shared navigation utility so existing imports keep working
export { wrapIndex } from "../nav";
