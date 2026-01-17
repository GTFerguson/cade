/**
 * WebSocket client with auto-reconnection and event handling.
 */

import { config } from "./config";
import { MessageType } from "./protocol";
import type {
  ClientMessage,
  ConnectedMessage,
  ErrorMessage,
  EventHandler,
  FileChangeMessage,
  FileContentMessage,
  FileTreeMessage,
  OutputMessage,
  ServerMessage,
} from "./types";

type ConnectionState = "disconnected" | "connecting" | "connected";

interface WebSocketEvents {
  connected: ConnectedMessage;
  disconnected: void;
  output: OutputMessage;
  "file-tree": FileTreeMessage;
  "file-change": FileChangeMessage;
  "file-content": FileContentMessage;
  error: ErrorMessage;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private handlers: Map<keyof WebSocketEvents, Set<EventHandler<unknown>>> =
    new Map();

  constructor(private url: string = config.wsUrl) {}

  /**
   * Register an event handler.
   */
  on<K extends keyof WebSocketEvents>(
    event: K,
    handler: EventHandler<WebSocketEvents[K]>
  ): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  /**
   * Remove an event handler.
   */
  off<K extends keyof WebSocketEvents>(
    event: K,
    handler: EventHandler<WebSocketEvents[K]>
  ): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  /**
   * Emit an event to all registered handlers.
   */
  private emit<K extends keyof WebSocketEvents>(
    event: K,
    data: WebSocketEvents[K]
  ): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in ${event} handler:`, e);
      }
    });
  }

  /**
   * Connect to the WebSocket server.
   */
  connect(): void {
    if (this.state !== "disconnected") {
      return;
    }

    this.state = "connecting";
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.state = "connected";
      this.reconnectAttempts = 0;
      console.log("WebSocket connected");
    };

    this.ws.onclose = () => {
      this.state = "disconnected";
      this.ws = null;
      this.emit("disconnected", undefined);
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string);
    };
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }

    this.state = "disconnected";
  }

  /**
   * Send a message to the server.
   */
  send(message: ClientMessage): void {
    if (this.ws === null || this.state !== "connected") {
      console.warn("Cannot send message: not connected");
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send terminal input.
   */
  sendInput(data: string): void {
    this.send({ type: MessageType.INPUT, data });
  }

  /**
   * Send terminal resize.
   */
  sendResize(cols: number, rows: number): void {
    this.send({ type: MessageType.RESIZE, cols, rows });
  }

  /**
   * Request file tree.
   */
  requestTree(): void {
    this.send({ type: MessageType.GET_TREE });
  }

  /**
   * Request file content.
   */
  requestFile(path: string): void {
    this.send({ type: MessageType.GET_FILE, path });
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.state === "connected";
  }

  /**
   * Handle incoming message.
   */
  private handleMessage(data: string): void {
    let message: ServerMessage;

    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      console.error("Failed to parse message:", data);
      return;
    }

    switch (message.type) {
      case MessageType.CONNECTED:
        this.emit("connected", message);
        break;

      case MessageType.OUTPUT:
        this.emit("output", message);
        break;

      case MessageType.FILE_TREE:
        this.emit("file-tree", message);
        break;

      case MessageType.FILE_CHANGE:
        this.emit("file-change", message);
        break;

      case MessageType.FILE_CONTENT:
        this.emit("file-content", message);
        break;

      case MessageType.ERROR:
        this.emit("error", message);
        console.error("Server error:", message.code, message.message);
        break;

      default:
        console.warn("Unknown message type:", message);
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= config.reconnectMaxAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    const delay = Math.min(
      config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
      config.reconnectMaxDelay
    );

    this.reconnectAttempts++;
    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
