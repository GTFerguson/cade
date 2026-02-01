/**
 * Convert an HTTP backend URL to a WebSocket URL with the /ws endpoint path.
 *
 * Remote profiles store HTTP URLs (e.g. "http://localhost:3000").
 * The WebSocket endpoint lives at /ws, so this transforms the URL
 * to the correct protocol and path.
 */
export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/ws`;
}
