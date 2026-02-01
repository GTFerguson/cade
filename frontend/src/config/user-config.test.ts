/**
 * @vitest-environment node
 *
 * Regression tests for user-config.
 *
 * Covers the bug where the backend sent config without createRemote,
 * causing setUserConfig to replace defaults with an incomplete config
 * and matchesKeybinding to crash on undefined.
 */

import { describe, it, expect, beforeEach } from "vitest";

// Provide a minimal document stub so applyAppearanceConfig doesn't throw
// in a node environment (no jsdom needed for these pure-logic tests)
const styleProps = new Map<string, string>();
(globalThis as any).document = {
  documentElement: {
    style: {
      setProperty: (key: string, value: string) => styleProps.set(key, value),
    },
  },
};

import {
  parseKeybinding,
  matchesKeybinding,
  setUserConfig,
  getUserConfig,
  defaultUserConfig,
} from "./user-config";

// Helper to build a minimal KeyboardEvent-like object
function fakeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}

// ============================================================================
// parseKeybinding
// ============================================================================

describe("parseKeybinding", () => {
  it("parses a simple lowercase key", () => {
    const result = parseKeybinding("c");
    expect(result).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "c",
    });
  });

  it("parses an uppercase key and preserves case", () => {
    const result = parseKeybinding("C");
    expect(result).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "C",
    });
  });

  it("parses Ctrl modifier", () => {
    const result = parseKeybinding("C-a");
    expect(result.ctrl).toBe(true);
    expect(result.key).toBe("a");
  });

  it("parses Alt modifier", () => {
    const result = parseKeybinding("A-h");
    expect(result.alt).toBe(true);
    expect(result.key).toBe("h");
  });

  it("parses explicit Shift modifier", () => {
    const result = parseKeybinding("S-c");
    expect(result.shift).toBe(true);
    expect(result.key).toBe("c");
  });

  it("does NOT set shift for uppercase key without S- prefix", () => {
    const result = parseKeybinding("C");
    expect(result.shift).toBe(false);
  });

  it("parses combined modifiers", () => {
    const result = parseKeybinding("C-S-a");
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.key).toBe("a");
  });
});

// ============================================================================
// matchesKeybinding — case sensitivity for create vs createRemote
// ============================================================================

describe("matchesKeybinding", () => {
  it("lowercase 'c' binding matches lowercase key press", () => {
    const event = fakeKeyEvent({ key: "c" });
    expect(matchesKeybinding(event, "c")).toBe(true);
  });

  it("lowercase 'c' binding does NOT match uppercase key press", () => {
    const event = fakeKeyEvent({ key: "C", shiftKey: true });
    expect(matchesKeybinding(event, "c")).toBe(false);
  });

  it("uppercase 'C' binding matches uppercase key press", () => {
    const event = fakeKeyEvent({ key: "C", shiftKey: true });
    expect(matchesKeybinding(event, "C")).toBe(true);
  });

  it("uppercase 'C' binding does NOT match lowercase key press", () => {
    const event = fakeKeyEvent({ key: "c" });
    expect(matchesKeybinding(event, "C")).toBe(false);
  });

  it("'c' and 'C' never match the same event (mutually exclusive)", () => {
    const lowercase = fakeKeyEvent({ key: "c" });
    const uppercase = fakeKeyEvent({ key: "C", shiftKey: true });

    // Each event matches exactly one binding
    expect(matchesKeybinding(lowercase, "c")).toBe(true);
    expect(matchesKeybinding(lowercase, "C")).toBe(false);
    expect(matchesKeybinding(uppercase, "C")).toBe(true);
    expect(matchesKeybinding(uppercase, "c")).toBe(false);
  });

  it("Ctrl-a binding requires ctrlKey", () => {
    const withCtrl = fakeKeyEvent({ key: "a", ctrlKey: true });
    const withoutCtrl = fakeKeyEvent({ key: "a" });
    expect(matchesKeybinding(withCtrl, "C-a")).toBe(true);
    expect(matchesKeybinding(withoutCtrl, "C-a")).toBe(false);
  });
});

// ============================================================================
// setUserConfig — deep merge with defaults
// ============================================================================

describe("setUserConfig", () => {
  beforeEach(() => {
    // Reset to defaults before each test
    setUserConfig(defaultUserConfig);
  });

  it("preserves createRemote when server config omits it", () => {
    // Simulate what the server used to send: tab config without createRemote
    const serverConfig = structuredClone(defaultUserConfig) as any;
    delete serverConfig.keybindings.tab.createRemote;

    setUserConfig(serverConfig);
    const config = getUserConfig();

    // createRemote must fall back to default, not become undefined
    expect(config.keybindings.tab.createRemote).toBe("C");
  });

  it("applies server override for createRemote", () => {
    const serverConfig = structuredClone(defaultUserConfig);
    serverConfig.keybindings.tab.createRemote = "S-n";

    setUserConfig(serverConfig);
    const config = getUserConfig();

    expect(config.keybindings.tab.createRemote).toBe("S-n");
  });

  it("preserves all default keybinding fields when server sends partial tab config", () => {
    const serverConfig = structuredClone(defaultUserConfig) as any;
    serverConfig.keybindings.tab = { next: "n", previous: "p" };

    setUserConfig(serverConfig);
    const config = getUserConfig();

    expect(config.keybindings.tab.next).toBe("n");
    expect(config.keybindings.tab.previous).toBe("p");
    // Defaults preserved for fields not sent by server
    expect(config.keybindings.tab.create).toBe("c");
    expect(config.keybindings.tab.createRemote).toBe("C");
    expect(config.keybindings.tab.close).toBe("x");
  });

  it("preserves defaults when server sends completely empty keybindings", () => {
    const serverConfig = structuredClone(defaultUserConfig) as any;
    serverConfig.keybindings = {};

    setUserConfig(serverConfig);
    const config = getUserConfig();

    // All keybinding sections should fall back to defaults
    expect(config.keybindings.global.prefix).toBe("C-a");
    expect(config.keybindings.tab.create).toBe("c");
    expect(config.keybindings.tab.createRemote).toBe("C");
  });

  it("applies appearance overrides while preserving keybinding defaults", () => {
    const serverConfig = structuredClone(defaultUserConfig);
    serverConfig.appearance.colors.bgPrimary = "#000000";

    setUserConfig(serverConfig);
    const config = getUserConfig();

    expect(config.appearance.colors.bgPrimary).toBe("#000000");
    expect(config.keybindings.tab.createRemote).toBe("C");
  });
});
