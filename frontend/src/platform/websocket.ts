/**
 * WebSocket client with auto-reconnection and event handling.
 */

import { appendTokenToUrl } from "../auth/tokenManager";
import { basePath, config } from "../config/config";
import { ErrorCode, MessageType, type AnySessionKey } from "./protocol";
import type {
  ClientMessage,
  ConnectedMessage,
  ErrorMessage,
  EventHandler,
  FileChangeMessage,
  FileContentMessage,
  FileTreeMessage,
  NeovimExitedMessage,
  NeovimOutputMessage,
  NeovimReadyMessage,
  NeovimRpcResponseMessage,
  OutputMessage,
  PtyExitedMessage,
  ServerMessage,
  SessionRestoredMessage,
  SessionState,
  SetProjectMessage,
  StartupStatusMessage,
  ViewFileMessage,
} from "../types";

type ConnectionState = "disconnected" | "connecting" | "connected";

interface WebSocketEvents {
  connected: ConnectedMessage;
  disconnected: void;
  output: OutputMessage;
  "file-tree": FileTreeMessage;
  "file-change": FileChangeMessage;
  "file-content": FileContentMessage;
  "file-written": { path: string };
  "file-created": { path: string };
  "view-file": ViewFileMessage;
  "session-restored": SessionRestoredMessage;
  "startup-status": StartupStatusMessage;
  "pty-exited": PtyExitedMessage;
  "neovim-ready": NeovimReadyMessage;
  "neovim-output": NeovimOutputMessage;
  "neovim-rpc-response": NeovimRpcResponseMessage;
  "neovim-exited": NeovimExitedMessage;
  error: ErrorMessage;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private handlers: Map<keyof WebSocketEvents, Set<EventHandler<unknown>>> =
    new Map();
  private pendingProjectPath: string | null = null;
  private pendingSessionId: string | null = null;
  private urlPollTimer: number | null = null;
  private readonly explicitUrl: boolean;
  private fatalError = false;
  private remoteAuthToken: string | null = null;
  private url: string;

  constructor(url?: string, authToken?: string) {
    this.explicitUrl = url !== undefined;
    this.url = url || config.wsUrl;
    this.remoteAuthToken = authToken ?? null;
  }

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

    // In Tauri, the backend URL is injected via eval() which may not have
    // run yet. Poll until the URL is available rather than connecting to
    // a wrong address.
    if (!this.explicitUrl && config.wsUrlPending) {
      if (this.urlPollTimer === null) {
        this.urlPollTimer = window.setInterval(() => {
          if (!config.wsUrlPending) {
            window.clearInterval(this.urlPollTimer!);
            this.urlPollTimer = null;
            this.connect();
          }
        }, 50);
      }
      return;
    }

    // Always re-read the URL so Tauri's late-injected value is picked up
    // (but only if an explicit URL wasn't provided for remote connections)
    if (!this.explicitUrl) {
      this.url = config.wsUrl;
    }

    // Use per-connection token for remote profiles, global token otherwise
    const urlWithAuth = this.remoteAuthToken
      ? appendTokenToUrl(this.url, this.remoteAuthToken)
      : appendTokenToUrl(this.url);

    this.state = "connecting";
    this.ws = new WebSocket(urlWithAuth);

    this.ws.onopen = () => {
      this.state = "connected";
      this.reconnectAttempts = 0;
      console.log("WebSocket connected");

      if (this.pendingProjectPath !== null) {
        const message: SetProjectMessage = {
          type: MessageType.SET_PROJECT,
          path: this.pendingProjectPath,
        };
        if (this.pendingSessionId !== null) {
          message.sessionId = this.pendingSessionId;
        }
        this.send(message);
      }
    };

    this.ws.onclose = (event) => {
      this.state = "disconnected";
      this.ws = null;
      this.emit("disconnected", undefined);

      // Code 1008 = Policy Violation (auth failure) — redirect to login
      // instead of reconnecting in a loop
      const isTauri =
        window.location.hostname === "tauri.localhost" ||
        (window as any).__TAURI__ === true;

      if (event.code === 1008 && !isTauri) {
        console.warn("WebSocket auth rejected (1008), redirecting to login");
        window.location.href = basePath + "/login";
        return;
      }

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
    if (this.urlPollTimer !== null) {
      window.clearInterval(this.urlPollTimer);
      this.urlPollTimer = null;
    }

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
  sendInput(data: string, sessionKey?: AnySessionKey): void {
    const message = {
      type: MessageType.INPUT,
      data,
      ...(sessionKey !== undefined && { sessionKey }),
    } as const;
    this.send(message);
  }

  /**
   * Send terminal resize.
   */
  sendResize(cols: number, rows: number, sessionKey?: AnySessionKey): void {
    const message = {
      type: MessageType.RESIZE,
      cols,
      rows,
      ...(sessionKey !== undefined && { sessionKey }),
    } as const;
    this.send(message);
  }

  /**
   * Request file tree.
   */
  requestTree(showIgnored?: boolean): void {
    const message: { type: string; showIgnored?: boolean } = {
      type: MessageType.GET_TREE,
    };
    if (showIgnored !== undefined) {
      message.showIgnored = showIgnored;
    }
    this.send(message as ClientMessage);
  }

  /**
   * Request file content.
   */
  requestFile(path: string): void {
    this.send({ type: MessageType.GET_FILE, path });
  }

  /**
   * Write file content.
   */
  writeFile(path: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const handleWritten = (message: any) => {
        if (message.path === path) {
          this.off("file-written", handleWritten);
          this.off("error", handleError);
          resolve();
        }
      };

      const handleError = (message: ErrorMessage) => {
        this.off("file-written", handleWritten);
        this.off("error", handleError);
        reject(new Error(message.message));
      };

      this.on("file-written", handleWritten);
      this.on("error", handleError);

      this.send({ type: MessageType.WRITE_FILE, path, content });
    });
  }

  /**
   * Create a new file.
   */
  createFile(path: string, content: string = ""): Promise<void> {
    return new Promise((resolve, reject) => {
      const handleCreated = (message: any) => {
        if (message.path === path) {
          this.off("file-created", handleCreated);
          this.off("error", handleError);
          resolve();
        }
      };

      const handleError = (message: ErrorMessage) => {
        this.off("file-created", handleCreated);
        this.off("error", handleError);
        reject(new Error(message.message));
      };

      this.on("file-created", handleCreated);
      this.on("error", handleError);

      this.send({ type: MessageType.CREATE_FILE, path, content });
    });
  }

  /**
   * Save session state.
   */
  saveSession(state: Partial<SessionState>): void {
    this.send({ type: MessageType.SAVE_SESSION, state });
  }

  /**
   * Request the most recent plan file.
   */
  requestLatestPlan(): void {
    this.send({ type: MessageType.GET_LATEST_PLAN });
  }

  /**
   * Spawn a Neovim instance on the backend.
   */
  neovimSpawn(): void {
    this.send({ type: MessageType.NEOVIM_SPAWN });
  }

  /**
   * Kill the Neovim instance on the backend.
   */
  neovimKill(): void {
    this.send({ type: MessageType.NEOVIM_KILL });
  }

  /**
   * Send terminal input to Neovim.
   */
  neovimSendInput(data: string): void {
    this.send({ type: MessageType.NEOVIM_INPUT, data });
  }

  /**
   * Send terminal resize to Neovim.
   */
  neovimSendResize(cols: number, rows: number): void {
    this.send({ type: MessageType.NEOVIM_RESIZE, cols, rows });
  }

  /**
   * Send an RPC command to Neovim.
   */
  neovimRpc(method: string, args: unknown[], requestId: string): void {
    this.send({ type: MessageType.NEOVIM_RPC, method, args, requestId });
  }

  /**
   * Set project directory for this connection.
   * If not connected yet, the path is stored and sent on connect.
   */
  sendSetProject(path: string, sessionId?: string): void {
    this.pendingProjectPath = path;
    this.pendingSessionId = sessionId ?? null;
    if (this.state === "connected") {
      const message: SetProjectMessage = {
        type: MessageType.SET_PROJECT,
        path,
      };
      if (sessionId !== undefined) {
        message.sessionId = sessionId;
      }
      this.send(message);
    }
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

      case MessageType.FILE_WRITTEN:
        this.emit("file-written", message as { path: string });
        break;

      case MessageType.FILE_CREATED:
        this.emit("file-created", message as { path: string });
        break;

      case MessageType.VIEW_FILE:
        this.emit("view-file", message as ViewFileMessage);
        break;

      case MessageType.ERROR:
        this.emit("error", message);
        console.error("Server error:", message.code, message.message);
        if (message.code === ErrorCode.PTY_SPAWN_FAILED) {
          this.fatalError = true;
        }
        break;

      case MessageType.SESSION_RESTORED:
        this.emit("session-restored", message);
        break;

      case MessageType.STARTUP_STATUS:
        this.emit("startup-status", message);
        break;

      case MessageType.PTY_EXITED:
        this.emit("pty-exited", message as PtyExitedMessage);
        console.error("PTY exited:", message);
        break;

      case MessageType.NEOVIM_READY:
        this.emit("neovim-ready", message as NeovimReadyMessage);
        break;

      case MessageType.NEOVIM_OUTPUT:
        this.emit("neovim-output", message as NeovimOutputMessage);
        break;

      case MessageType.NEOVIM_RPC_RESPONSE:
        this.emit("neovim-rpc-response", message as NeovimRpcResponseMessage);
        break;

      case MessageType.NEOVIM_EXITED:
        this.emit("neovim-exited", message as NeovimExitedMessage);
        break;

      default:
        console.warn("Unknown message type:", message);
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.fatalError) {
      console.error("Not reconnecting: terminal failed to start");
      return;
    }

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
