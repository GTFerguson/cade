// @vitest-environment happy-dom
/**
 * CADE WebSocket client: output sequence tracking for delta reconnects, the
 * set-project handshake, and the foreground liveness probe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketClient } from "./websocket";
import { MessageType } from "@core/platform/protocol";

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
  simulateOpen(): void {
    this.onopen?.({});
  }
  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  simulateClose(code = 1006): void {
    this.closed = true;
    this.onclose?.({ code });
  }
  sentJson(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function connectedClient(sessionId = "tab-1"): { client: WebSocketClient; socket: FakeWebSocket } {
  const client = new WebSocketClient("ws://test/ws");
  client.sendSetProject("/proj", sessionId, undefined, undefined, undefined, undefined, "my tab");
  client.connect();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  socket.simulateOpen();
  socket.simulateMessage({ type: MessageType.CONNECTED, workingDir: "/proj", connectionId: "c1" });
  return { client, socket };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("set-project handshake", () => {
  it("carries the tab label", () => {
    const { socket } = connectedClient();
    const setProject = socket.sentJson().find((m) => m.type === MessageType.SET_PROJECT);
    expect(setProject.label).toBe("my tab");
    expect(setProject.lastSeq).toBeUndefined();
  });

  it("hands back the last seen sequence per terminal on reconnect", () => {
    const { client, socket } = connectedClient();
    socket.simulateMessage({ type: MessageType.OUTPUT, data: "a", sessionKey: "claude", seq: 7 });
    socket.simulateMessage({ type: MessageType.OUTPUT, data: "b", sessionKey: "manual", seq: 3 });
    socket.simulateMessage({ type: MessageType.OUTPUT, data: "synthetic" }); // no seq: ignored
    expect(client.getLastSeq()).toEqual({ claude: 7, manual: 3 });

    socket.simulateClose();
    vi.advanceTimersByTime(5000);
    const next = FakeWebSocket.instances[1]!;
    next.simulateOpen();
    const setProject = next.sentJson().find((m) => m.type === MessageType.SET_PROJECT);
    expect(setProject.lastSeq).toEqual({ claude: 7, manual: 3 });
  });

  it("takes the sequence from a cold-attach scrollback too", () => {
    const { client, socket } = connectedClient();
    socket.simulateMessage({
      type: MessageType.SESSION_RESTORED, sessionId: "tab-1", scrollback: "x", sessionKey: "claude", seq: 42,
    });
    expect(client.getLastSeq()).toEqual({ claude: 42 });
  });

  it("forgets positions when pointed at a different session", () => {
    const { client, socket } = connectedClient();
    socket.simulateMessage({ type: MessageType.OUTPUT, data: "a", sessionKey: "claude", seq: 7 });
    client.sendSetProject("/other", "tab-2");
    expect(client.getLastSeq()).toEqual({});
  });
});

describe("liveness probe", () => {
  it("pings when connected and is satisfied by a pong", () => {
    const { client, socket } = connectedClient();
    client.probeLiveness();
    const ping = socket.sentJson().find((m) => m.type === MessageType.PING);
    expect(ping).toBeDefined();

    socket.simulateMessage({ type: MessageType.PONG, t: ping.t });
    vi.advanceTimersByTime(10_000);
    expect(socket.closed).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("treats an unanswered ping as a dead socket and reconnects", () => {
    const { client, socket } = connectedClient();
    client.probeLiveness();
    vi.advanceTimersByTime(3000);
    expect(socket.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("reconnects immediately when waiting out a backoff", () => {
    const { client, socket } = connectedClient();
    socket.simulateClose();
    expect(FakeWebSocket.instances).toHaveLength(1);
    client.probeLiveness();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does nothing for a client the tab has closed", () => {
    const { client } = connectedClient();
    client.disconnect();
    client.probeLiveness();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("runs on page foreground", () => {
    const { socket } = connectedClient();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(socket.sentJson().some((m) => m.type === MessageType.PING)).toBe(true);
  });
});
