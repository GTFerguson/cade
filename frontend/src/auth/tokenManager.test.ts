/**
 * @vitest-environment node
 *
 * Regression tests for auth token management.
 *
 * Covers the bug where remote connections used the global auth token
 * instead of the per-profile token, causing 403 errors when the
 * remote backend expected a different token.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub localStorage before importing the module
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

// Clear VITE_AUTH_TOKEN so tests control the token source
vi.stubEnv("VITE_AUTH_TOKEN", "");

import { appendTokenToUrl, getAuthToken, setAuthToken, clearAuthToken } from "./tokenManager";

describe("appendTokenToUrl", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("returns URL unchanged when no token is set and no override given", () => {
    expect(appendTokenToUrl("ws://localhost:3000/ws")).toBe(
      "ws://localhost:3000/ws"
    );
  });

  it("appends global token from localStorage", () => {
    setAuthToken("global-token-123");
    const result = appendTokenToUrl("ws://localhost:3000/ws");
    expect(result).toBe("ws://localhost:3000/ws?token=global-token-123");
  });

  it("uses override token instead of global token", () => {
    setAuthToken("global-token-123");
    const result = appendTokenToUrl("ws://localhost:3000/ws", "remote-token-456");
    expect(result).toBe("ws://localhost:3000/ws?token=remote-token-456");
  });

  it("uses override token when no global token is set", () => {
    const result = appendTokenToUrl("ws://localhost:3000/ws", "remote-token-456");
    expect(result).toBe("ws://localhost:3000/ws?token=remote-token-456");
  });

  it("URL-encodes special characters in token", () => {
    const result = appendTokenToUrl("ws://localhost/ws", "token with spaces&stuff");
    expect(result).toContain("token=token%20with%20spaces%26stuff");
  });

  it("uses & separator when URL already has query params", () => {
    const result = appendTokenToUrl("ws://localhost/ws?existing=1", "my-token");
    expect(result).toBe("ws://localhost/ws?existing=1&token=my-token");
  });
});

describe("getAuthToken / setAuthToken / clearAuthToken", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("returns null when no token is stored", () => {
    expect(getAuthToken()).toBeNull();
  });

  it("returns stored token after setAuthToken", () => {
    setAuthToken("test-token");
    expect(getAuthToken()).toBe("test-token");
  });

  it("returns null after clearAuthToken", () => {
    setAuthToken("test-token");
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
  });
});
