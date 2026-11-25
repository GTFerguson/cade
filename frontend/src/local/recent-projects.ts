/**
 * Projects opened lately on this device, most recent first. Kept in the
 * browser because "recent" is about what this person opened here, not what
 * runs on the backend.
 */

import { withRecent } from "./picker-model";

const STORAGE_KEY = "cade-recent-projects";

export function loadRecentProjects(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecentProject(path: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withRecent(loadRecentProjects(), path)));
  } catch {
    // Storage full or unavailable: the picker just has no recents.
  }
}
