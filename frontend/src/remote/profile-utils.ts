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
 * Strips the last path segment. Returns "/" at root.
 */
export function computeParentPath(currentPath: string): string {
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

// Re-export shared navigation utility so existing imports keep working
export { wrapIndex } from "../nav";
