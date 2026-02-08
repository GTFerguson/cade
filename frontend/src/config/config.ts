/**
 * Client-side configuration.
 */

// Vite injects BASE_URL from the `base` option (with trailing slash).
// Strip the trailing slash so concatenation is clean: basePath + "/ws"
export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Build WebSocket URL based on environment.
// Re-evaluated on each call so Tauri's async eval() injection is picked up.
const getWsUrl = (): string => {
  // 1. Check for environment variable (remote backend)
  const envBackendUrl = import.meta.env.VITE_BACKEND_URL;
  if (envBackendUrl) {
    return `ws://${envBackendUrl.replace('http://', '').replace('https://', '')}/ws`;
  }

  // 2. Check for Tauri injection
  const backendUrl = (window as any).__BACKEND_URL__;
  if (backendUrl) {
    return `ws://${backendUrl.replace('http://', '')}/ws`;
  }

  // 3. Default: use current host (works with Vite proxy in dev)
  return `ws://${window.location.host}${basePath}/ws`;
};

// Detect Tauri production environment where the backend URL
// must be injected via eval() before WebSocket can connect.
const needsInjectedUrl = (): boolean => {
  return window.location.hostname === "tauri.localhost"
    || (window as any).__TAURI__ === true;
};

/**
 * Returns true if running inside the Tauri desktop app.
 */
export function isTauri(): boolean {
  return window.location.hostname === "tauri.localhost"
    || (window as any).__TAURI__ === true;
}

/**
 * Returns true if running in a browser accessing a remote server.
 * (Not Tauri desktop app, and not localhost)
 */
export function isRemoteBrowserAccess(): boolean {
  if (isTauri()) return false;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "tauri.localhost";
}

export const config = {
  /**
   * WebSocket URL. Re-evaluated each access so the Tauri-injected
   * backend URL is picked up even if eval() runs after module load.
   */
  get wsUrl(): string {
    return getWsUrl();
  },

  /**
   * Whether the WebSocket URL requires injection (Tauri desktop).
   * When true and no __BACKEND_URL__ is set yet, connection should wait.
   */
  get wsUrlPending(): boolean {
    return needsInjectedUrl() && !(window as any).__BACKEND_URL__;
  },

  /**
   * Default project path when no tabs exist.
   */
  defaultProjectPath: ".",

  /**
   * Maximum reconnection attempts before giving up.
   */
  reconnectMaxAttempts: 5,

  /**
   * Base delay for reconnection (exponential backoff).
   */
  reconnectBaseDelay: 1000,

  /**
   * Maximum reconnection delay.
   */
  reconnectMaxDelay: 30000,

  /**
   * LocalStorage key for layout preferences.
   */
  layoutStorageKey: "cade-layout",
} as const;
