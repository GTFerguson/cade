/**
 * @vitest-environment node
 *
 * Regression tests for remote WebSocket URL construction.
 *
 * Covers the bug where remote tabs connected to ws://host/ instead of
 * ws://host/ws, causing 403 errors because the backend only serves
 * WebSocket connections on the /ws endpoint.
 */

import { describe, it, expect } from "vitest";
import { toWebSocketUrl } from "./url-utils";

describe("toWebSocketUrl", () => {
  it("converts http URL to ws with /ws path", () => {
    expect(toWebSocketUrl("http://localhost:3000")).toBe(
      "ws://localhost:3000/ws"
    );
  });

  it("converts https URL to wss with /ws path", () => {
    expect(toWebSocketUrl("https://example.com")).toBe(
      "wss://example.com/ws"
    );
  });

  it("preserves non-standard port", () => {
    expect(toWebSocketUrl("http://192.168.1.10:8080")).toBe(
      "ws://192.168.1.10:8080/ws"
    );
  });

  it("preserves base path for reverse-proxy deployments", () => {
    expect(toWebSocketUrl("http://localhost:3000/cade")).toBe(
      "ws://localhost:3000/cade/ws"
    );
  });

  it("preserves base path with IP and no port", () => {
    expect(toWebSocketUrl("http://52.30.205.70/cade")).toBe(
      "ws://52.30.205.70/cade/ws"
    );
  });

  it("strips trailing slash from base path", () => {
    expect(toWebSocketUrl("http://localhost:3000/cade/")).toBe(
      "ws://localhost:3000/cade/ws"
    );
  });

  it("handles https with custom port", () => {
    expect(toWebSocketUrl("https://remote.example.com:4443")).toBe(
      "wss://remote.example.com:4443/ws"
    );
  });
});
