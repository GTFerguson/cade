/**
 * Generic WebSocket client primitive.
 *
 * Handles connection lifecycle, exponential-backoff reconnection, URL
 * resolution, auth-token injection via hooks, and JSON message dispatch keyed
 * on a message's `type` field. Knows nothing about any particular wire
 * protocol — product-specific clients (CADE, Padarax, etc.) subclass or
 * compose this and layer their own typed methods on top.
 *
 * The event bus dispatches server-to-client messages by their `type` field;
 * connection-level events (`connected`, `disconnected`, `auth-failed`,
 * `connection-lost`, `connection-failed`) are emitted on reserved channels
 * that cannot collide with protocol types because they include a leading
 * `@` sentinel — consumers subscribe via the helper methods below.
 */
export type ConnectionState = "disconnected" | "connecting" | "connected";

export type MessageHandler<T = unknown> = (message: T) => void;

export interface WSAuthFailedEvent {
  code: number;
  event: CloseEvent;
}

export interface BaseWSClientOptions {
  /**
   * Fixed URL. If omitted, `getUrl` is consulted on each connect attempt
   * so the subclass can integrate with late-injected values (e.g. Tauri).
   */
  url?: string;

  /**
   * Lazy URL resolver. Called on every connect attempt when `url` is not
   * provided at construction time. Should return the current best URL.
   */
  getUrl?: () => string;

  /**
   * Returns true while the URL is not yet available (e.g. Tauri eval()
   * hasn't run). When true, the client polls until it flips to false
   * rather than opening a socket to a wrong address.
   */
  isUrlPending?: () => boolean;

  /**
   * Given the resolved URL, return the URL to actually connect to. Use this
   * to append auth tokens, query params, etc. Must be pure.
   */
  transformUrl?: (url: string) => string;

  /**
   * Maximum reconnect attempts before switching to connection-lost mode
   * (keeps retrying at the cap delay after that). Defaults to 10.
   */
  maxReconnectAttempts?: number;

  /**
   * Base delay in ms for exponential backoff. Delay = base * 2^attempt,
   * capped at maxDelay. Defaults to 500ms.
   */
  reconnectBaseDelay?: number;

  /**
   * Maximum backoff delay in ms. Defaults to 30_000.
   */
  reconnectMaxDelay?: number;

  /**
   * If the initial connection does not establish within this window,
   * the socket is force-closed so reconnect logic takes over rather than
   * hanging against an unreachable host. Set to 0 to disable. Only applies
   * when a URL was provided explicitly (see note in connect()).
   * Defaults to 10_000ms.
   */
  initialConnectTimeoutMs?: number;
}

const CONN_CHANNEL_PREFIX = "@";
const CHANNEL_CONNECTED = "@connected";
const CHANNEL_DISCONNECTED = "@disconnected";
const CHANNEL_AUTH_FAILED = "@auth-failed";
const CHANNEL_CONNECTION_LOST = "@connection-lost";
const CHANNEL_CONNECTION_FAILED = "@connection-failed";
const CHANNEL_UNKNOWN_MESSAGE = "@unknown-message";
const CHANNEL_STATE = "@state";
const CHANNEL_RAW_ERROR = "@error";

interface BaseMessage {
  type?: string;
}

/**
 * Generic WebSocket client primitive.
 *
 * Subclass or instantiate directly. For typed message dispatch, subclasses
 * typically expose narrower `on`/`send` signatures that delegate here.
 */
export class BaseWSClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private initialConnectTimer: number | null = null;
  private urlPollTimer: number | null = null;
  private fatalError = false;
  private hasEverConnected = false;
  private handlers = new Map<string, Set<MessageHandler>>();

  protected readonly explicitUrl: boolean;
  protected currentUrl: string;

  private readonly opts: Required<
    Pick<
      BaseWSClientOptions,
      | "maxReconnectAttempts"
      | "reconnectBaseDelay"
      | "reconnectMaxDelay"
      | "initialConnectTimeoutMs"
    >
  > & BaseWSClientOptions;

  constructor(options: BaseWSClientOptions = {}) {
    this.opts = {
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      reconnectBaseDelay: options.reconnectBaseDelay ?? 500,
      reconnectMaxDelay: options.reconnectMaxDelay ?? 30_000,
      initialConnectTimeoutMs: options.initialConnectTimeoutMs ?? 10_000,
      ...options,
    };
    this.explicitUrl = options.url !== undefined;
    this.currentUrl = options.url ?? "";
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /**
   * Connect to the server. Safe to call when already connected/connecting
   * (no-op). When the URL is late-resolved and still pending, polls until
   * available.
   */
  connect(): void {
    if (this.state !== "disconnected") {
      return;
    }

    if (!this.explicitUrl && this.opts.isUrlPending?.()) {
      if (this.urlPollTimer === null) {
        this.urlPollTimer = window.setInterval(() => {
          if (!this.opts.isUrlPending?.()) {
            this.clearUrlPollTimer();
            this.connect();
          }
        }, 50);
      }
      return;
    }

    if (!this.explicitUrl && this.opts.getUrl) {
      this.currentUrl = this.opts.getUrl();
    }

    const finalUrl = this.opts.transformUrl
      ? this.opts.transformUrl(this.currentUrl)
      : this.currentUrl;

    this.setState("connecting");
    this.ws = new WebSocket(finalUrl);

    // Hung-connection watchdog. Only arm on the first connect attempt when
    // an explicit URL was provided — the late-URL path can legitimately take
    // a while to settle and the reconnect loop handles subsequent attempts.
    if (
      !this.hasEverConnected &&
      this.explicitUrl &&
      this.opts.initialConnectTimeoutMs > 0
    ) {
      this.initialConnectTimer = window.setTimeout(() => {
        this.initialConnectTimer = null;
        if (this.state === "connecting" && this.ws) {
          console.warn(
            `Initial connection timed out after ${this.opts.initialConnectTimeoutMs}ms`
          );
          this.ws.close();
        }
      }, this.opts.initialConnectTimeoutMs);
    }

    this.ws.onopen = () => {
      this.clearInitialConnectTimer();
      this.setState("connected");
      this.hasEverConnected = true;
      this.reconnectAttempts = 0;
      this.onOpen();
    };

    this.ws.onclose = (event) => {
      this.clearInitialConnectTimer();
      this.setState("disconnected");
      this.ws = null;
      this.emit(CHANNEL_DISCONNECTED, undefined);
      this.onClose(event);
    };

    this.ws.onerror = (event) => {
      this.emit(CHANNEL_RAW_ERROR, event);
    };

    this.ws.onmessage = (event) => {
      this.dispatchRaw(event.data as string);
    };
  }

  /**
   * Disconnect and cancel any pending reconnect/URL-poll timers.
   */
  disconnect(): void {
    this.clearInitialConnectTimer();
    this.clearUrlPollTimer();
    this.clearReconnectTimer();

    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }

    this.setState("disconnected");
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Send a JSON-serialised message. No-ops if not connected.
   */
  send(message: object): void {
    if (this.ws === null || this.state !== "connected") {
      console.warn("Cannot send message: not connected");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send a pre-serialised string over the wire. No-ops if not connected.
   */
  sendRaw(data: string): void {
    if (this.ws === null || this.state !== "connected") {
      console.warn("Cannot send raw data: not connected");
      return;
    }
    this.ws.send(data);
  }

  /**
   * Subscribe to messages whose `type` field matches `type`. Returns an
   * unsubscribe function. Handlers receive the whole message object.
   */
  on<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set<MessageHandler>();
    set.add(handler as MessageHandler);
    this.handlers.set(type, set);
    return () => this.off(type, handler);
  }

  off<T = unknown>(type: string, handler: MessageHandler<T>): void {
    this.handlers.get(type)?.delete(handler as MessageHandler);
  }

  /**
   * Reset the reconnect counter and backoff (e.g. after new credentials are
   * supplied). Does not itself trigger a reconnect.
   */
  resetReconnectBackoff(): void {
    this.reconnectAttempts = 0;
  }

  /**
   * Mark the connection as fatally broken so reconnect stops trying. Used
   * when the server signalled an unrecoverable failure.
   */
  setFatal(): void {
    this.fatalError = true;
  }

  clearFatal(): void {
    this.fatalError = false;
  }

  // ---------------------------------------------------------------------
  // Connection-level event subscribers (typed helpers over the `@` channels)
  // ---------------------------------------------------------------------

  onConnected(handler: () => void): () => void {
    return this.on<undefined>(CHANNEL_CONNECTED, handler as MessageHandler);
  }
  onDisconnected(handler: () => void): () => void {
    return this.on<undefined>(CHANNEL_DISCONNECTED, handler as MessageHandler);
  }
  onStateChange(handler: MessageHandler<ConnectionState>): () => void {
    return this.on(CHANNEL_STATE, handler);
  }
  onAuthFailed(handler: MessageHandler<WSAuthFailedEvent>): () => void {
    return this.on(CHANNEL_AUTH_FAILED, handler);
  }
  onConnectionLost(handler: () => void): () => void {
    return this.on<undefined>(CHANNEL_CONNECTION_LOST, handler as MessageHandler);
  }
  onConnectionFailed(handler: () => void): () => void {
    return this.on<undefined>(CHANNEL_CONNECTION_FAILED, handler as MessageHandler);
  }
  onUnknownMessage(handler: MessageHandler): () => void {
    return this.on(CHANNEL_UNKNOWN_MESSAGE, handler);
  }
  onSocketError(handler: MessageHandler<Event>): () => void {
    return this.on(CHANNEL_RAW_ERROR, handler);
  }

  // ---------------------------------------------------------------------
  // Subclass hooks — override to add product-specific behaviour
  // ---------------------------------------------------------------------

  /**
   * Called after the underlying socket's `open` event. Default is a no-op.
   * Override to perform session handshakes (e.g. send an initial frame).
   */
  protected onOpen(): void {}

  /**
   * Called on socket close. Default behaviour:
   *   - code 1008 → emit `auth-failed` event
   *   - otherwise  → schedule a reconnect
   *
   * Override to inspect the close first (for out-of-band signals) and
   * either call super.onClose(event) to retain default handling or handle
   * the close yourself.
   */
  protected onClose(event: CloseEvent): void {
    if (event.code === 1008) {
      this.emit(CHANNEL_AUTH_FAILED, { code: event.code, event });
      return;
    }
    this.scheduleReconnect();
  }

  /**
   * Called for every inbound message after JSON parse and before default
   * dispatch. Return `true` to mark the message as handled (no default
   * dispatch will happen for it). Default implementation returns `false`.
   */
  protected handleMessage(_message: unknown): boolean {
    return false;
  }

  /**
   * Dispatch a message to handlers registered on `type` as if it had arrived
   * over the wire. Intended for subclasses that want to remap or synthesise
   * protocol events without touching the socket.
   */
  protected dispatch(type: string, message: unknown): void {
    this.emit(type, message);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private emit<T>(type: string, data: T): void {
    const set = this.handlers.get(type);
    if (!set) return;
    set.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`Error in ${type} handler:`, err);
      }
    });
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit(CHANNEL_STATE, next);
    if (next === "connected") {
      this.emit(CHANNEL_CONNECTED, undefined);
    }
  }

  private dispatchRaw(raw: string): void {
    let message: BaseMessage;
    try {
      message = JSON.parse(raw) as BaseMessage;
    } catch {
      console.error("Failed to parse message:", raw);
      return;
    }

    if (this.handleMessage(message)) {
      return;
    }

    const type = message.type;
    if (typeof type !== "string" || type.startsWith(CONN_CHANNEL_PREFIX)) {
      // No type or collision with reserved channel — treat as unknown.
      this.emit(CHANNEL_UNKNOWN_MESSAGE, message);
      return;
    }

    const set = this.handlers.get(type);
    if (!set || set.size === 0) {
      this.emit(CHANNEL_UNKNOWN_MESSAGE, message);
      return;
    }
    this.emit(type, message);
  }

  private scheduleReconnect(): void {
    if (this.fatalError) {
      console.error("Not reconnecting: marked fatal");
      return;
    }

    if (
      !this.hasEverConnected &&
      this.reconnectAttempts >= this.opts.maxReconnectAttempts
    ) {
      console.warn("Connection failed: server unreachable");
      this.emit(CHANNEL_CONNECTION_FAILED, undefined);
      return;
    }

    if (this.reconnectAttempts >= this.opts.maxReconnectAttempts) {
      console.warn("Max reconnection attempts reached, will keep retrying");
      this.emit(CHANNEL_CONNECTION_LOST, undefined);
      // Keep retrying at the cap instead of giving up.
      this.reconnectAttempts = this.opts.maxReconnectAttempts - 1;
    }

    const delay = Math.min(
      this.opts.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
      this.opts.reconnectMaxDelay
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

  private clearInitialConnectTimer(): void {
    if (this.initialConnectTimer !== null) {
      window.clearTimeout(this.initialConnectTimer);
      this.initialConnectTimer = null;
    }
  }

  private clearUrlPollTimer(): void {
    if (this.urlPollTimer !== null) {
      window.clearInterval(this.urlPollTimer);
      this.urlPollTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
