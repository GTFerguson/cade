import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrefixController } from "./prefix-controller";

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function newController(timeoutMs = 500) {
  const changes: boolean[] = [];
  const controller = new PrefixController({
    getTimeout: () => timeoutMs,
    onChange: (active) => changes.push(active),
  });
  return { controller, changes };
}

describe("PrefixController", () => {
  describe("basic activation", () => {
    it("is inactive by default", () => {
      const { controller } = newController();
      expect(controller.isActive()).toBe(false);
    });

    it("activate() arms prefix mode and fires onChange(true)", () => {
      const { controller, changes } = newController();
      controller.activate();
      expect(controller.isActive()).toBe(true);
      expect(changes).toEqual([true]);
    });

    it("deactivate() disarms and fires onChange(false)", () => {
      const { controller, changes } = newController();
      controller.activate();
      controller.deactivate();
      expect(controller.isActive()).toBe(false);
      expect(changes).toEqual([true, false]);
    });

    it("deactivate() is a no-op when already inactive", () => {
      const { controller, changes } = newController();
      controller.deactivate();
      expect(changes).toEqual([]);
    });

    it("re-activating does not double-fire onChange(true)", () => {
      const { controller, changes } = newController();
      controller.activate();
      controller.activate();
      expect(changes).toEqual([true]);
    });
  });

  describe("auto-deactivation timeout", () => {
    it("deactivates after the configured timeout", () => {
      const { controller, changes } = newController(200);
      controller.activate();
      vi.advanceTimersByTime(199);
      expect(controller.isActive()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(controller.isActive()).toBe(false);
      expect(changes).toEqual([true, false]);
    });

    it("re-activating restarts the timeout", () => {
      const { controller } = newController(200);
      controller.activate();
      vi.advanceTimersByTime(150);
      controller.activate();
      vi.advanceTimersByTime(150);
      expect(controller.isActive()).toBe(true); // 150 ms since re-arm
      vi.advanceTimersByTime(60);
      expect(controller.isActive()).toBe(false);
    });

    it("picks up timeout changes per activation (live config)", () => {
      let t = 200;
      const controller = new PrefixController({ getTimeout: () => t });
      controller.activate();
      vi.advanceTimersByTime(201);
      expect(controller.isActive()).toBe(false);

      t = 50;
      controller.activate();
      vi.advanceTimersByTime(51);
      expect(controller.isActive()).toBe(false);
    });
  });

  describe("tap-then-shortcut flow", () => {
    it("notifyShortcutUsed() deactivates when prefix key is NOT held", () => {
      const { controller } = newController();
      controller.activate();
      // Simulate: prefix key was released before the shortcut key was pressed.
      controller.notifyShortcutUsed();
      expect(controller.isActive()).toBe(false);
    });
  });

  describe("hold-and-shortcut flow", () => {
    it("notifyShortcutUsed() keeps prefix active while key is held", () => {
      const { controller } = newController();
      controller.keyHeld();
      controller.activate();
      controller.notifyShortcutUsed();
      expect(controller.isActive()).toBe(true); // still held
      controller.notifyShortcutUsed();
      expect(controller.isActive()).toBe(true); // multiple shortcuts OK
    });

    it("keyReleased() deactivates if any shortcut fired while held", () => {
      const { controller, changes } = newController();
      controller.keyHeld();
      controller.activate();
      controller.notifyShortcutUsed();
      controller.keyReleased();
      expect(controller.isActive()).toBe(false);
      expect(changes).toEqual([true, false]);
    });

    it("keyReleased() WITHOUT shortcut usage leaves tap-flow timeout intact", () => {
      const { controller } = newController(200);
      controller.keyHeld();
      controller.activate();
      controller.keyReleased();
      // No shortcut fired while held; prefix stays active for the tap timeout.
      expect(controller.isActive()).toBe(true);
      vi.advanceTimersByTime(201);
      expect(controller.isActive()).toBe(false);
    });

    it("isKeyHeld() reflects held state", () => {
      const { controller } = newController();
      expect(controller.isKeyHeld()).toBe(false);
      controller.keyHeld();
      expect(controller.isKeyHeld()).toBe(true);
      controller.keyReleased();
      expect(controller.isKeyHeld()).toBe(false);
    });
  });

  describe("dispose", () => {
    it("cancels pending timeout", () => {
      const { controller, changes } = newController(200);
      controller.activate();
      controller.dispose();
      vi.advanceTimersByTime(300);
      // No extra onChange from a late-firing timeout.
      expect(changes).toEqual([true]);
    });

    it("resets all state", () => {
      const { controller } = newController();
      controller.keyHeld();
      controller.activate();
      controller.dispose();
      expect(controller.isActive()).toBe(false);
      expect(controller.isKeyHeld()).toBe(false);
    });
  });
});
