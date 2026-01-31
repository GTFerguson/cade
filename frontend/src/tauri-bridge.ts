/**
 * Bridge between frontend and Tauri native APIs.
 * Falls back to browser equivalents when not running in Tauri.
 */

const isTauri = (): boolean => (window as any).__TAURI__ === true;

/**
 * Open a native folder picker dialog.
 * Falls back to window.prompt() in browser mode.
 * Returns the selected path, or null if cancelled.
 */
export async function pickProjectFolder(
  defaultPath?: string
): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const resolvedDefault = defaultPath ?? getUserHomePath();
      const options: Record<string, unknown> = {
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      };
      if (resolvedDefault) {
        options.defaultPath = resolvedDefault;
      }
      const selected = await open(options as any);
      return typeof selected === "string" ? selected : null;
    } catch (e) {
      console.error("[tauri-bridge] Failed to open folder picker:", e);
      return null;
    }
  }

  return window.prompt("Enter project path:", defaultPath ?? ".");
}

/**
 * Get the user's home directory path, injected by the Rust backend.
 * Returns null in browser mode.
 */
export function getUserHomePath(): string | null {
  const home = (window as any).__HOME_DIR__;
  return typeof home === "string" && home.length > 0 ? home : null;
}
