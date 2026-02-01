/**
 * Token manager for authentication.
 *
 * Handles storage and retrieval of authentication tokens for remote deployments.
 */

const TOKEN_STORAGE_KEY = "cade_auth_token";

/**
 * Get the stored authentication token.
 *
 * Returns the token from environment variable, localStorage, or null if not set.
 */
export function getAuthToken(): string | null {
  // Check environment variable first (for development/testing)
  const envToken = import.meta.env.VITE_AUTH_TOKEN;
  if (envToken) {
    return envToken;
  }

  // Fall back to localStorage
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Set the authentication token.
 *
 * Stores the token in localStorage for persistence across sessions.
 */
export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch (e) {
    console.error("Failed to store auth token:", e);
  }
}

/**
 * Clear the authentication token.
 */
export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear auth token:", e);
  }
}

/**
 * Append auth token to a URL if one is set.
 *
 * If a token is stored, appends it as a query parameter.
 * Used for WebSocket connection URLs.
 */
export function appendTokenToUrl(url: string, overrideToken?: string): string {
  const token = overrideToken ?? getAuthToken();
  if (!token) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}
