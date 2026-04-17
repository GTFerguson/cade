/**
 * Normalize a user-entered URL by prepending http:// if no protocol is given.
 *
 * Handles common inputs like "192.168.1.1:3000", "myhost:3000/cade",
 * or "example.com" and ensures they become valid URLs.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/**
 * Convert an HTTP backend URL to a WebSocket URL with the /ws endpoint path.
 *
 * Remote profiles store HTTP URLs (e.g. "http://localhost:3000" or
 * "http://52.30.205.70/cade").  The WebSocket endpoint lives at /ws
 * relative to the base path, so this preserves any path prefix for
 * reverse-proxy deployments (e.g. /cade → /cade/ws).
 */
export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(normalizeUrl(httpUrl));
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const basePath = url.pathname.replace(/\/+$/, "");
  return `${protocol}//${url.host}${basePath}/ws`;
}
