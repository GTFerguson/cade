/**
 * Client-side configuration.
 */

export const config = {
  /**
   * WebSocket URL - uses current host for production, proxied in dev.
   */
  wsUrl: `ws://${window.location.host}/ws`,

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
