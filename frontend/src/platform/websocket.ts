/**
 * CADE WebSocket client. Wraps the generic BaseWSClient primitive with
 * CADE-specific protocol methods, typed event signatures, and the CADE
 * auth path (remote token, Google id_token, /login redirect).
 */

import { BaseWSClient, type WSAuthFailedEvent } from "@core/platform/ws-client";
import { appendTokenToUrl } from "../auth/tokenManager";
import { getStoredIdToken } from "../auth/googleAuth";
import { basePath, config, isRemoteBrowserAccess } from "../config/config";
import { ErrorCode, MessageType, type AnySessionKey } from "@core/platform/protocol";
import type {
  AgentKilledMessage,
  AgentSpawnedMessage,
  AgentStateChangedMessage,
  ChatHistoryMessage,
  ChatModeChangeMessage,
  ChatStreamMessage,
  ClientMessage,
  ConnectedMessage,
  DashboardClearedMessage,
  DashboardConfigMessage,
  DashboardDataMessage,
  ErrorMessage,
  EventHandler,
  FileChangeMessage,
  FileChildrenMessage,
  FileContentMessage,
  FileTreeMessage,
  NeovimExitedMessage,
  NeovimOutputMessage,
  NeovimReadyMessage,
  NeovimRpcResponseMessage,
  OutputMessage,
  ProviderListMessage,
  PtyExitedMessage,
  SessionRestoredMessage,
  SessionState,
  SetProjectMessage,
  StartupStatusMessage,
  ViewFileMessage,
} from "../types";

interface WebSocketEvents {
  connected: ConnectedMessage;
  disconnected: void;
  output: OutputMessage;
  "file-tree": FileTreeMessage;
  "file-children": FileChildrenMessage;
  "browse-children": FileChildrenMessage;
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
  "chat-stream": ChatStreamMessage;
  "chat-history": ChatHistoryMessage;
  "chat-mode-change": ChatModeChangeMessage;
  "provider-list": ProviderListMessage;
  "agent-spawned": AgentSpawnedMessage;
  "agent-killed": AgentKilledMessage;
  "agent-state-changed": AgentStateChangedMessage;
  "dashboard-config": DashboardConfigMessage;
  "dashboard-data": DashboardDataMessage;
  "dashboard-cleared": DashboardClearedMessage;
  "dashboard-focus-view": { type: string; view_id: string };
  "dashboard-hide-view": { type: string; view_id: string };
  "dashboard-push-panel": {
    type: string;
    panel: { id: string; title: string; component: string };
    data: Record<string, unknown>[];
  };
  "notification": { type: string; message: string; style: string };
  error: ErrorMessage;
  "auth-failed": { code: number };
  "google-auth-required": { client_id: string };
  "connection-lost": void;
  "connection-failed": void;
}

// Message types that the base primitive already dispatches by `type`. Events
// in WebSocketEvents that don't map to a wire message type (connection-level
// signals, derived events) need manual bridging — tracked below.
type BridgedEventKey =
  | "connected"
  | "disconnected"
  | "auth-failed"
  | "google-auth-required"
  | "connection-lost"
  | "connection-failed";

// MessageType enum value → WebSocketEvents key mapping for protocol messages
// whose base-primitive dispatch type does not match our event name.
const EVENT_ALIAS: Partial<Record<string, keyof WebSocketEvents>> = {
  [MessageType.BROWSE_CHILDREN]: "browse-children",
};

export class WebSocketClient extends BaseWSClient {
  private remoteAuthToken: string | null;
  private googleIdToken: string | null = null;
  private pendingGoogleAuth: { client_id: string } | null = null;
  private pendingProjectPath: string | null = null;
  private pendingSessionId: string | null = null;
  private pendingDashboardFile: string | null = null;
  private pendingProviderOverride: string | null = null;

  // Bridged subscribers for events that aren't just message-type passthrough.
  private connectedHandlers = new Set<EventHandler<ConnectedMessage>>();
  private disconnectedHandlers = new Set<EventHandler<void>>();
  private authFailedHandlers = new Set<EventHandler<{ code: number }>>();
  private googleAuthHandlers = new Set<EventHandler<{ client_id: string }>>();
  private connectionLostHandlers = new Set<EventHandler<void>>();
  private connectionFailedHandlers = new Set<EventHandler<void>>();

  constructor(url?: string, authToken?: string, maxReconnectAttempts?: number) {
    super({
      ...(url !== undefined && { url }),
      getUrl: () => config.wsUrl,
      isUrlPending: () => config.wsUrlPending,
      maxReconnectAttempts: maxReconnectAttempts ?? config.reconnectMaxAttempts,
      reconnectBaseDelay: config.reconnectBaseDelay,
      reconnectMaxDelay: config.reconnectMaxDelay,
      transformUrl: (resolvedUrl) => this.buildAuthedUrl(resolvedUrl),
    });

    this.remoteAuthToken = authToken ?? null;

    // Route connection-level signals from the base primitive into the
    // CADE-style typed event handlers.
    this.onConnectionLost(() => this.fireBridged("connection-lost", undefined));
    this.onConnectionFailed(() =>
      this.fireBridged("connection-failed", undefined)
    );
    this.onDisconnected(() => this.fireBridged("disconnected", undefined));
  }

  // ---------------------------------------------------------------------
  // Typed event API — layered on top of BaseWSClient.on/off
  // ---------------------------------------------------------------------

  on<K extends keyof WebSocketEvents>(
    event: K,
    handler: EventHandler<WebSocketEvents[K]>
  ): () => void;
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  on(event: string, handler: EventHandler<any>): () => void {
    const bridged = this.bridgedRegister(event, handler);
    if (bridged !== null) {
      return bridged;
    }
    return super.on(event, handler);
  }

  off<K extends keyof WebSocketEvents>(
    event: K,
    handler: EventHandler<WebSocketEvents[K]>
  ): void;
  off<T = unknown>(event: string, handler: EventHandler<T>): void;
  off(event: string, handler: EventHandler<any>): void {
    if (this.bridgedUnregister(event, handler)) {
      return;
    }
    super.off(event, handler);
  }

  private bridgedRegister(
    event: string,
    handler: EventHandler<any>
  ): (() => void) | null {
    switch (event as BridgedEventKey) {
      case "connected":
        this.connectedHandlers.add(handler);
        return () => this.connectedHandlers.delete(handler);
      case "disconnected":
        this.disconnectedHandlers.add(handler);
        return () => this.disconnectedHandlers.delete(handler);
      case "auth-failed":
        this.authFailedHandlers.add(handler);
        return () => this.authFailedHandlers.delete(handler);
      case "google-auth-required":
        this.googleAuthHandlers.add(handler);
        return () => this.googleAuthHandlers.delete(handler);
      case "connection-lost":
        this.connectionLostHandlers.add(handler);
        return () => this.connectionLostHandlers.delete(handler);
      case "connection-failed":
        this.connectionFailedHandlers.add(handler);
        return () => this.connectionFailedHandlers.delete(handler);
    }
    return null;
  }

  private bridgedUnregister(
    event: string,
    handler: EventHandler<any>
  ): boolean {
    switch (event as BridgedEventKey) {
      case "connected":
        this.connectedHandlers.delete(handler);
        return true;
      case "disconnected":
        this.disconnectedHandlers.delete(handler);
        return true;
      case "auth-failed":
        this.authFailedHandlers.delete(handler);
        return true;
      case "google-auth-required":
        this.googleAuthHandlers.delete(handler);
        return true;
      case "connection-lost":
        this.connectionLostHandlers.delete(handler);
        return true;
      case "connection-failed":
        this.connectionFailedHandlers.delete(handler);
        return true;
    }
    return false;
  }

  protected fireBridged<K extends BridgedEventKey>(
    event: K,
    payload: WebSocketEvents[K]
  ): void {
    const target =
      event === "connected"
        ? this.connectedHandlers
        : event === "disconnected"
          ? this.disconnectedHandlers
          : event === "auth-failed"
            ? this.authFailedHandlers
            : event === "google-auth-required"
              ? this.googleAuthHandlers
              : event === "connection-lost"
                ? this.connectionLostHandlers
                : this.connectionFailedHandlers;
    target.forEach((handler) => {
      try {
        (handler as EventHandler<WebSocketEvents[K]>)(payload);
      } catch (e) {
        console.error(`Error in ${event} handler:`, e);
      }
    });
  }

  // ---------------------------------------------------------------------
  // BaseWSClient hooks
  // ---------------------------------------------------------------------

  protected override onOpen(): void {
    console.log("WebSocket connected");

    if (this.pendingProjectPath !== null) {
      const message: SetProjectMessage = {
        type: MessageType.SET_PROJECT,
        path: this.pendingProjectPath,
      };
      if (this.pendingSessionId !== null) {
        message.sessionId = this.pendingSessionId;
      }
      if (this.pendingDashboardFile !== null) {
        message.dashboardFile = this.pendingDashboardFile;
      }
      if (this.pendingProviderOverride !== null) {
        message.providerOverride = this.pendingProviderOverride;
      }
      this.send(message);
    }
  }

  protected override onClose(event: CloseEvent): void {
    if (event.code === 1008) {
      // Project-level Google gate: server sent `auth-required` just before
      // closing with 1008. Route to Google sign-in instead of generic auth.
      if (this.pendingGoogleAuth) {
        const { client_id } = this.pendingGoogleAuth;
        this.pendingGoogleAuth = null;
        console.warn("WebSocket auth required (1008), showing Google Sign-In");
        this.fireBridged("google-auth-required", { client_id });
        return;
      }

      const isTauri =
        window.location.hostname === "tauri.localhost" ||
        (window as any).__TAURI__ === true;

      if (isTauri || isRemoteBrowserAccess()) {
        console.warn("WebSocket auth rejected (1008), showing auth dialog");
        this.fireBridged("auth-failed", { code: event.code });
      } else {
        console.warn("WebSocket auth rejected (1008), redirecting to login");
        window.location.href = basePath + "/login";
      }
      return;
    }

    super.onClose(event);
  }

  protected override handleMessage(message: unknown): boolean {
    const typed = message as { type?: string; provider?: string; client_id?: string };

    // Out-of-band auth-required frame sent just before a 1008 close. Stash
    // the client_id so onClose can emit google-auth-required with it.
    if (typed.type === "auth-required") {
      if (typed.provider === "google" && typeof typed.client_id === "string") {
        this.pendingGoogleAuth = { client_id: typed.client_id };
      }
      return true;
    }

    // Track fatal errors (PTY spawn failure) so reconnect stops trying.
    if (typed.type === MessageType.ERROR) {
      const err = message as ErrorMessage;
      console.error("Server error:", err.code, err.message);
      if (err.code === ErrorCode.PTY_SPAWN_FAILED) {
        this.setFatal();
      }
      this.dispatch("error", err);
      return true;
    }

    if (typed.type === MessageType.CONNECTED) {
      this.fireBridged("connected", message as ConnectedMessage);
      return true;
    }

    if (typed.type === MessageType.PTY_EXITED) {
      const msg = message as PtyExitedMessage;
      console.error("PTY exited:", msg);
      this.dispatch("pty-exited", msg);
      return true;
    }

    // Remap protocol types whose dispatch key differs from the MessageType.
    if (typeof typed.type === "string") {
      const alias = EVENT_ALIAS[typed.type];
      if (alias !== undefined) {
        this.dispatch(alias, message);
        return true;
      }
    }

    return false;
  }

// ---------------------------------------------------------------------
  // URL building (auth token injection)
  // ---------------------------------------------------------------------

  private buildAuthedUrl(url: string): string {
    let urlWithAuth = this.remoteAuthToken
      ? appendTokenToUrl(url, this.remoteAuthToken)
      : appendTokenToUrl(url);

    const googleToken = this.googleIdToken ?? getStoredIdToken();
    if (googleToken) {
      const sep = urlWithAuth.includes("?") ? "&" : "?";
      urlWithAuth = `${urlWithAuth}${sep}google_token=${encodeURIComponent(googleToken)}`;
    }

    return urlWithAuth;
  }

  /**
   * Update the auth token for reconnection after auth failure.
   */
  setAuthToken(token: string): void {
    this.remoteAuthToken = token;
    this.resetReconnectBackoff();
  }

  /**
   * Store a Google id_token to be appended to the WS URL on connect.
   */
  setGoogleIdToken(token: string): void {
    this.googleIdToken = token;
  }

  // ---------------------------------------------------------------------
  // CADE protocol send methods
  // ---------------------------------------------------------------------

  sendInput(data: string, sessionKey?: AnySessionKey): void {
    const message = {
      type: MessageType.INPUT,
      data,
      ...(sessionKey !== undefined && { sessionKey }),
    } as const;
    this.send(message);
  }

  sendResize(cols: number, rows: number, sessionKey?: AnySessionKey): void {
    const message = {
      type: MessageType.RESIZE,
      cols,
      rows,
      ...(sessionKey !== undefined && { sessionKey }),
    } as const;
    this.send(message);
  }

  requestTree(showIgnored?: boolean): void {
    const message: { type: string; showIgnored?: boolean } = {
      type: MessageType.GET_TREE,
    };
    if (showIgnored !== undefined) {
      message.showIgnored = showIgnored;
    }
    this.send(message as ClientMessage);
  }

  requestChildren(path: string, showIgnored?: boolean): void {
    const message: { type: string; path: string; showIgnored?: boolean } = {
      type: MessageType.GET_CHILDREN,
      path,
    };
    if (showIgnored !== undefined) {
      message.showIgnored = showIgnored;
    }
    this.send(message as ClientMessage);
  }

  requestBrowseChildren(path: string): void {
    this.send({
      type: MessageType.BROWSE_CHILDREN,
      path,
    } as ClientMessage);
  }

  requestFile(path: string): void {
    this.send({ type: MessageType.GET_FILE, path });
  }

  readFileAsync(path: string): Promise<string> {
    return new Promise((resolve) => {
      const handle = (msg: FileContentMessage) => {
        if (msg.path === path) {
          this.off("file-content", handle as never);
          resolve(msg.content);
        }
      };
      this.on("file-content", handle as never);
      this.requestFile(path);
    });
  }

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

  saveSession(state: Partial<SessionState>): void {
    this.send({ type: MessageType.SAVE_SESSION, state });
  }

  requestLatestPlan(): void {
    this.send({ type: MessageType.GET_LATEST_PLAN });
  }

  neovimSpawn(filePath?: string, cols?: number, rows?: number): void {
    const msg: Record<string, any> = { type: MessageType.NEOVIM_SPAWN };
    if (filePath !== undefined) {
      msg.filePath = filePath;
    }
    if (cols !== undefined && rows !== undefined) {
      msg.cols = cols;
      msg.rows = rows;
    }
    this.send(msg as any);
  }

  neovimKill(): void {
    this.send({ type: MessageType.NEOVIM_KILL });
  }

  neovimSendInput(data: string): void {
    this.send({ type: MessageType.NEOVIM_INPUT, data });
  }

  neovimSendResize(cols: number, rows: number): void {
    this.send({ type: MessageType.NEOVIM_RESIZE, cols, rows });
  }

  neovimRpc(method: string, args: unknown[], requestId: string): void {
    this.send({ type: MessageType.NEOVIM_RPC, method, args, requestId });
  }

  sendChatCancel(): void {
    this.send({ type: MessageType.CHAT_CANCEL } as any);
  }

  sendChatMessage(content: string, providerId?: string): void {
    const msg: Record<string, any> = {
      type: MessageType.CHAT_MESSAGE,
      content,
    };
    if (providerId !== undefined) {
      msg.providerId = providerId;
    }
    this.send(msg as any);
  }

  sendAgentApprove(agentId: string): void {
    this.send({ type: MessageType.AGENT_APPROVE, agentId } as any);
  }

  sendAgentReject(agentId: string): void {
    this.send({ type: MessageType.AGENT_REJECT, agentId } as any);
  }

  sendAgentApproveReport(agentId: string): void {
    this.send({ type: MessageType.AGENT_APPROVE_REPORT, agentId } as any);
  }

  sendAgentRejectReport(agentId: string): void {
    this.send({ type: MessageType.AGENT_REJECT_REPORT, agentId } as any);
  }

  switchProvider(providerId: string): void {
    this.send({
      type: MessageType.PROVIDER_SWITCH,
      providerId,
    } as any);
  }

  /**
   * Set project directory for this connection. If not connected yet, the
   * path is stored and sent on connect.
   */
  sendSetProject(
    path: string,
    sessionId?: string,
    dashboardFile?: string,
    providerOverride?: string,
  ): void {
    this.pendingProjectPath = path;
    this.pendingSessionId = sessionId ?? null;
    this.pendingDashboardFile = dashboardFile ?? null;
    this.pendingProviderOverride = providerOverride ?? null;
    if (this.isConnected()) {
      const message: SetProjectMessage = {
        type: MessageType.SET_PROJECT,
        path,
      };
      if (sessionId !== undefined) {
        message.sessionId = sessionId;
      }
      if (dashboardFile !== undefined) {
        message.dashboardFile = dashboardFile;
      }
      if (providerOverride !== undefined) {
        message.providerOverride = providerOverride;
      }
      this.send(message);
    }
  }

  /** Dev-only: fire a synthetic inbound event as if received from the server. */
  injectEvent(type: string, data: unknown): void {
    if (!import.meta.env.DEV) return;
    const BRIDGED: ReadonlySet<string> = new Set([
      "connected", "disconnected", "auth-failed",
      "google-auth-required", "access-not-approved",
      "connection-lost", "connection-failed",
    ]);
    if (BRIDGED.has(type)) {
      this.fireBridged(type as BridgedEventKey, data as never);
    } else {
      this.dispatch(type, data);
    }
  }

}

// Re-export for consumers that imported the event-payload shape by name.
export type { WSAuthFailedEvent };
