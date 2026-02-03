/**
 * Convert an HTTP backend URL to a WebSocket URL with the /ws endpoint path.
 *
 * Remote profiles store HTTP URLs (e.g. "http://localhost:3000" or
 * "http://52.30.205.70/cade").  The WebSocket endpoint lives at /ws
 * relative to the base path, so this preserves any path prefix for
 * reverse-proxy deployments (e.g. /cade → /cade/ws).
 */
export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const basePath = url.pathname.replace(/\/+$/, "");
  return `${protocol}//${url.host}${basePath}/ws`;
}
