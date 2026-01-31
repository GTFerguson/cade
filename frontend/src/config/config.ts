/**
 * Client-side configuration.
 */

// Build WebSocket URL based on environment.
// Re-evaluated on each call so Tauri's async eval() injection is picked up.
const getWsUrl = (): string => {
  const backendUrl = (window as any).__BACKEND_URL__;
  if (backendUrl) {
    return `ws://${backendUrl.replace('http://', '')}/ws`;
  }
  // In browser, use current host (works with Vite proxy in dev)
  return `ws://${window.location.host}/ws`;
};

// Detect Tauri production environment where the backend URL
// must be injected via eval() before WebSocket can connect.
const needsInjectedUrl = (): boolean => {
  return window.location.hostname === "tauri.localhost"
    || (window as any).__TAURI__ === true;
};

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
