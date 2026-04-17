import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BaseWSClient, type BaseWSClientOptions } from "./ws-client";

// ---------------------------------------------------------------------------
// Fake WebSocket harness
// ---------------------------------------------------------------------------

type FakeListener = (...args: any[]) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  onopen: FakeListener | null = null;
  onclose: FakeListener | null = null;
  onerror: FakeListener | null = null;
  onmessage: FakeListener | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }

  // Test helpers
  simulateOpen(): void {
    this.onopen?.({});
  }
  simulateMessage(data: unknown): void {
    this.onmessage?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }
  simulateClose(code = 1006): void {
    this.closed = true;
    this.onclose?.({ code });
  }
  simulateError(): void {
    this.onerror?.({});
  }
}

function newClient(options: BaseWSClientOptions = {}): BaseWSClient {
  return new BaseWSClient({
    url: "ws://test/",
    reconnectBaseDelay: 10,
    reconnectMaxDelay: 100,
    maxReconnectAttempts: 3,
    initialConnectTimeoutMs: 0,
    ...options,
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // Delegate window.* timers to whatever globalThis.* currently points at so
  // vi.useFakeTimers() (installed below) still takes effect.
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
    setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number) => globalThis.clearInterval(id),
  });
  vi.useFakeTimers();
});

afterEach(() => {
  // Drop any still-pending fake timers before restoring real time so they
  // can't fire against unstubbed globals.
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BaseWSClient", () => {
  describe("lifecycle", () => {
    it("connects on demand and reports state", () => {
      const client = newClient();
      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toBe("disconnected");

      client.connect();
      expect(client.getState()).toBe("connecting");
      expect(FakeWebSocket.instances).toHaveLength(1);

      FakeWebSocket.instances[0]!.simulateOpen();
      expect(client.isConnected()).toBe(true);
      expect(client.getState()).toBe("connected");
    });

    it("ignores duplicate connect while already connecting", () => {
      const client = newClient();
      client.connect();
      client.connect();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it("fires state-change + connected + disconnected listeners in order", () => {
      const client = newClient();
      const states: string[] = [];
      client.onStateChange((s) => states.push(`state:${s}`));
      client.onConnected(() => states.push("connected"));
      client.onDisconnected(() => states.push("disconnected"));

      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateClose(1006);

      expect(states).toEqual([
        "state:connecting",
        "state:connected",
        "connected",
        "state:disconnected",
        "disconnected",
      ]);
    });

    it("disconnect cancels pending reconnect timer", () => {
      const client = newClient();
      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateClose(1006);

      // A reconnect is scheduled; disconnect() should cancel it.
      client.disconnect();
      vi.advanceTimersByTime(10_000);
      // Only the first socket; disconnect prevented a second.
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  describe("URL hooks", () => {
    it("applies transformUrl before opening the socket", () => {
      const client = newClient({
        transformUrl: (u) => `${u}?token=abc`,
      });
      client.connect();
      expect(FakeWebSocket.instances[0]!.url).toBe("ws://test/?token=abc");
    });

    it("polls for late-resolved URL when isUrlPending is true", () => {
      let pending = true;
      const client = new BaseWSClient({
        getUrl: () => "ws://late/",
        isUrlPending: () => pending,
        reconnectBaseDelay: 10,
        initialConnectTimeoutMs: 0,
      });
      client.connect();
      expect(FakeWebSocket.instances).toHaveLength(0);
      pending = false;
      vi.advanceTimersByTime(60);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.instances[0]!.url).toBe("ws://late/");
    });
  });

  describe("message dispatch", () => {
    it("routes messages to handlers registered on their type", () => {
      const client = newClient();
      const onHello = vi.fn();
      const onGoodbye = vi.fn();
      client.on("hello", onHello);
      client.on("goodbye", onGoodbye);

      client.connect();
      const sock = FakeWebSocket.instances[0]!;
      sock.simulateOpen();
      sock.simulateMessage({ type: "hello", greeting: "hi" });
      sock.simulateMessage({ type: "goodbye" });

      expect(onHello).toHaveBeenCalledWith({ type: "hello", greeting: "hi" });
      expect(onGoodbye).toHaveBeenCalledTimes(1);
    });

    it("off() removes a specific handler without affecting others", () => {
      const client = newClient();
      const a = vi.fn();
      const b = vi.fn();
      client.on("hello", a);
      client.on("hello", b);
      client.off("hello", a);

      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage({ type: "hello" });

      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });

    it("on() returns an unsubscribe function", () => {
      const client = newClient();
      const handler = vi.fn();
      const unsub = client.on("hello", handler);

      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      unsub();
      FakeWebSocket.instances[0]!.simulateMessage({ type: "hello" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("emits unknown-message when type has no handler", () => {
      const client = newClient();
      const unknown = vi.fn();
      client.onUnknownMessage(unknown);

      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage({ type: "mystery" });

      expect(unknown).toHaveBeenCalledWith({ type: "mystery" });
    });

    it("emits unknown-message for messages missing a type field", () => {
      const client = newClient();
      const unknown = vi.fn();
      client.onUnknownMessage(unknown);

      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage({ no: "type" });

      expect(unknown).toHaveBeenCalledWith({ no: "type" });
    });

    it("silently ignores malformed JSON", () => {
      const client = newClient();
      const unknown = vi.fn();
      client.onUnknownMessage(unknown);
      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage("not-json");
      expect(unknown).not.toHaveBeenCalled();
    });

    it("ignores messages whose type collides with a reserved @-channel", () => {
      const client = newClient();
      const unknown = vi.fn();
      const connected = vi.fn();
      client.onUnknownMessage(unknown);
      client.onConnected(connected);

      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage({ type: "@connected" });

      // Message routed to unknown, not to connected listeners.
      expect(unknown).toHaveBeenCalledWith({ type: "@connected" });
      expect(connected).toHaveBeenCalledTimes(1); // only the real open event
    });
  });

  describe("send", () => {
    it("serialises object messages as JSON", () => {
      const client = newClient();
      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      client.send({ type: "ping", n: 1 });
      expect(FakeWebSocket.instances[0]!.sent).toEqual([
        JSON.stringify({ type: "ping", n: 1 }),
      ]);
    });

    it("no-ops when not connected", () => {
      const client = newClient();
      client.connect();
      client.send({ type: "ping" }); // still connecting
      expect(FakeWebSocket.instances[0]!.sent).toEqual([]);
    });
  });

  describe("reconnect", () => {
    it("reschedules after a non-auth close with exponential backoff", () => {
      const client = newClient();
      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateClose(1006);
      expect(FakeWebSocket.instances).toHaveLength(1);

      vi.advanceTimersByTime(10);
      expect(FakeWebSocket.instances).toHaveLength(2);

      // Second attempt uses doubled delay (20ms).
      FakeWebSocket.instances[1]!.simulateClose(1006);
      vi.advanceTimersByTime(15);
      expect(FakeWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(10);
      expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it("fires auth-failed on 1008 and does NOT schedule a reconnect", () => {
      const client = newClient();
      const authFailed = vi.fn();
      client.onAuthFailed(authFailed);
      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateClose(1008);
      expect(authFailed).toHaveBeenCalledWith(
        expect.objectContaining({ code: 1008 })
      );
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it("emits connection-failed when initial attempt never connects after cap", () => {
      const client = newClient();
      const failed = vi.fn();
      client.onConnectionFailed(failed);
      client.connect();
      // Close each socket as it materialises; eventually the cap is hit
      // before we ever succeeded. Loop enough times to exceed maxReconnect.
      for (let i = 0; i < 5; i++) {
        const sock = FakeWebSocket.instances[i];
        if (!sock) break;
        sock.simulateClose(1006);
        vi.advanceTimersByTime(200);
      }
      expect(failed).toHaveBeenCalled();
    });

    it("emits connection-lost (not failed) after once-connected drop", () => {
      const client = newClient();
      const lost = vi.fn();
      const failed = vi.fn();
      client.onConnectionLost(lost);
      client.onConnectionFailed(failed);

      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateClose(1006);
      for (let i = 1; i < 4; i++) {
        vi.advanceTimersByTime(200);
        FakeWebSocket.instances[i]!.simulateClose(1006);
      }
      expect(lost).toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
    });

    it("setFatal() stops reconnect attempts", () => {
      const client = newClient();
      client.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      client.setFatal();
      FakeWebSocket.instances[0]!.simulateClose(1006);
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  describe("subclass hooks", () => {
    it("onOpen runs after socket open", () => {
      const calls: string[] = [];
      class Sub extends BaseWSClient {
        protected override onOpen(): void {
          calls.push("onOpen");
        }
      }
      const sub = new Sub({
        url: "ws://x",
        reconnectBaseDelay: 1,
        initialConnectTimeoutMs: 0,
      });
      sub.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      expect(calls).toEqual(["onOpen"]);
    });

    it("handleMessage returning true short-circuits default dispatch", () => {
      const handled: unknown[] = [];
      const normal = vi.fn();
      class Sub extends BaseWSClient {
        protected override handleMessage(msg: unknown): boolean {
          handled.push(msg);
          return true;
        }
      }
      const sub = new Sub({
        url: "ws://x",
        reconnectBaseDelay: 1,
        initialConnectTimeoutMs: 0,
      });
      sub.on("hello", normal);
      sub.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage({ type: "hello" });
      expect(handled).toHaveLength(1);
      expect(normal).not.toHaveBeenCalled();
    });

    it("onClose override can suppress default reconnect", () => {
      class Sub extends BaseWSClient {
        protected override onClose(_event: CloseEvent): void {
          // Deliberately do not call super -> no reconnect.
        }
      }
      const sub = new Sub({
        url: "ws://x",
        reconnectBaseDelay: 1,
        initialConnectTimeoutMs: 0,
      });
      sub.connect();
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateClose(1006);
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it("dispatch() delivers synthesised messages to registered handlers", () => {
      class Sub extends BaseWSClient {
        synthesise(): void {
          this.dispatch("synth", { type: "synth", n: 7 });
        }
      }
      const sub = new Sub({
        url: "ws://x",
        initialConnectTimeoutMs: 0,
      });
      const received = vi.fn();
      sub.on("synth", received);
      sub.synthesise();
      expect(received).toHaveBeenCalledWith({ type: "synth", n: 7 });
    });
  });
});
