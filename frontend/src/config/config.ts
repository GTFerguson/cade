/**
 * Client-side configuration.
 */

// Vite injects BASE_URL from the `base` option (with trailing slash).
// Strip the trailing slash so concatenation is clean: basePath + "/ws"
export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// A page served over https cannot open an insecure ws:// socket — browsers
// block it as mixed content before the request leaves the tab. Match the
// socket scheme to the page so reverse-proxied TLS deployments work.
const wsScheme = (): string =>
  typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss"
    : "ws";

/**
 * The desktop shell sets these on `window` once, after its backend is up. A
 * page reload discards them and the shell does not set them again, which
 * would leave the page with no backend to connect to. So they are mirrored
 * into sessionStorage and put back when a page loads without them.
 */
const SHELL_GLOBALS = ["__BACKEND_URL__", "__TAURI__", "__HOME_DIR__"] as const;
const SHELL_GLOBALS_KEY = "cade-shell-globals";

function syncShellGlobals(): void {
  const w = window as any;
  try {
    if (w.__BACKEND_URL__) {
      // Injection can land at any point after load, so every read re-saves
      // it; a fresh value from the shell always wins over a remembered one.
      const current = JSON.stringify(Object.fromEntries(SHELL_GLOBALS.map((k) => [k, w[k]])));
      if (window.sessionStorage.getItem(SHELL_GLOBALS_KEY) !== current) {
        window.sessionStorage.setItem(SHELL_GLOBALS_KEY, current);
      }
      return;
    }
    const saved = window.sessionStorage.getItem(SHELL_GLOBALS_KEY);
    if (!saved) return;
    const values = JSON.parse(saved) as Record<string, unknown>;
    for (const key of SHELL_GLOBALS) {
      if (values[key] !== undefined && w[key] === undefined) w[key] = values[key];
    }
  } catch {
    // Storage can be unavailable or hold junk; the page then behaves as it
    // would on a first load and waits for the shell.
  }
}

// Restore before any other module looks at the globals.
if (typeof window !== "undefined") syncShellGlobals();

// Build WebSocket URL based on environment.
// Re-evaluated on each call so Tauri's async eval() injection is picked up.
const getWsUrl = (): string => {
  // 1. Check for environment variable (remote backend)
  const envBackendUrl = import.meta.env.VITE_BACKEND_URL;
  if (envBackendUrl) {
    const scheme = envBackendUrl.startsWith("https://") ? "wss" : "ws";
    return `${scheme}://${envBackendUrl.replace(/^https?:\/\//, "")}/ws`;
  }

  // 2. Check for Tauri injection (desktop app, localhost backend)
  syncShellGlobals();
  const backendUrl = (window as any).__BACKEND_URL__;
  if (backendUrl) {
    return `ws://${backendUrl.replace('http://', '')}/ws`;
  }

  // 3. Default: use current host (works with Vite proxy in dev)
  return `${wsScheme()}://${window.location.host}${basePath}/ws`;
};

/**
 * Where the backend's HTTP API is, to put in front of an `/api/...` path.
 *
 * In a browser the page is served by the backend, so a path relative to the
 * page reaches it. The desktop window's page belongs to the app shell: there
 * a relative path goes to the shell, which has no API, and every request
 * quietly comes back empty. The shell tells the page where its backend is,
 * and that address has to be used instead.
 */
export function apiBase(): string {
  const envBackendUrl = import.meta.env.VITE_BACKEND_URL;
  if (envBackendUrl) return envBackendUrl.replace(/\/$/, "");
  syncShellGlobals();
  const backendUrl = (window as any).__BACKEND_URL__;
  if (typeof backendUrl === "string" && backendUrl) return backendUrl.replace(/\/$/, "");
  return basePath;
}

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
    syncShellGlobals();
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

  /**
   * Google OAuth client ID, or undefined when Google auth is not configured.
   * Set VITE_GOOGLE_CLIENT_ID in the environment to enable Google Sign-In.
   */
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined,
} as const;
