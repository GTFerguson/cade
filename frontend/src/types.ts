/**
 * TypeScript interfaces for CADE frontend.
 */

import type { ErrorCodeValue, MessageTypeValue, AnySessionKey } from "./platform/protocol";
import type { UserConfig } from "./config/user-config";

/**
 * Represents a file or directory in the file tree.
 */
export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  modified?: number;
  hasMore?: boolean;
}

/**
 * Component lifecycle interface.
 */
export interface Component {
  initialize(): void | Promise<void>;
  dispose(): void | Promise<void>;
}

/**
 * Base message structure.
 */
export interface BaseMessage {
  type: MessageTypeValue;
}

/**
 * Terminal input message (client -> server).
 */
export interface InputMessage extends BaseMessage {
  type: "input";
  data: string;
  sessionKey?: AnySessionKey;
}

/**
 * Terminal resize message (client -> server).
 */
export interface ResizeMessage extends BaseMessage {
  type: "resize";
  cols: number;
  rows: number;
  sessionKey?: AnySessionKey;
}

/**
 * Get file request (client -> server).
 */
export interface GetFileMessage extends BaseMessage {
  type: "get-file";
  path: string;
}

/**
 * Get tree request (client -> server).
 */
export interface GetTreeMessage extends BaseMessage {
  type: "get-tree";
  showIgnored?: boolean;
}

/**
 * Get latest plan request (client -> server).
 */
export interface GetLatestPlanMessage extends BaseMessage {
  type: "get-latest-plan";
}

/**
 * Get directory children request (client -> server).
 */
export interface GetChildrenMessage extends BaseMessage {
  type: "get-children";
  path: string;
  showIgnored?: boolean;
}

export interface BrowseChildrenMessage extends BaseMessage {
  type: "browse-children";
  path: string;
}

export interface BrowseChildrenResponseMessage extends BaseMessage {
  type: "browse-children";
  path: string;
  children: FileNode[];
}

/**
 * Write file request (client -> server).
 */
export interface WriteFileMessage extends BaseMessage {
  type: "write-file";
  path: string;
  content: string;
}

/**
 * Create file request (client -> server).
 */
export interface CreateFileMessage extends BaseMessage {
  type: "create-file";
  path: string;
  content: string;
}

/**
 * Layout pane proportions.
 */
export interface LayoutProportions {
  fileTree: number;
  terminal: number;
  viewer: number;
}

/**
 * Session state for persistence.
 */
export interface SessionState {
  version: number;
  expandedPaths: string[];
  viewerPath: string | null;
  viewerPlanPath: string | null;
  viewerHidden: boolean;
  layout: LayoutProportions | null;
}

/**
 * Save session request (client -> server).
 */
export interface SaveSessionMessage extends BaseMessage {
  type: "save-session";
  state: Partial<SessionState>;
}

/**
 * Set project directory (client -> server).
 */
export interface SetProjectMessage extends BaseMessage {
  type: "set-project";
  path: string;
  sessionId?: string;
}

/**
 * Terminal output message (server -> client).
 */
export interface OutputMessage extends BaseMessage {
  type: "output";
  data: string;
  sessionKey?: AnySessionKey;
}

/**
 * File tree response (server -> client).
 */
export interface FileTreeMessage extends BaseMessage {
  type: "file-tree";
  data: FileNode[];
}

/**
 * Directory children response (server -> client).
 */
export interface FileChildrenMessage extends BaseMessage {
  type: "file-children";
  path: string;
  children: FileNode[];
}

/**
 * File change notification (server -> client).
 */
export interface FileChangeMessage extends BaseMessage {
  type: "file-change";
  event: "created" | "modified" | "deleted";
  path: string;
}

/**
 * File content response (server -> client).
 */
export interface FileContentMessage extends BaseMessage {
  type: "file-content";
  path: string;
  content: string;
  fileType: string;
}

/**
 * View file message (server -> client).
 * Pushed from CLI `cade view` command to display external files.
 */
export interface ViewFileMessage extends BaseMessage {
  type: "view-file";
  path: string;
  content: string;
  fileType: string;
  isPlan?: boolean;
}

/**
 * Error message (server -> client).
 */
export interface ErrorMessage extends BaseMessage {
  type: "error";
  code: ErrorCodeValue;
  message: string;
}

/**
 * Connected message (server -> client).
 */
export interface ConnectedMessage extends BaseMessage {
  type: "connected";
  workingDir: string;
  session?: SessionState;
  config?: UserConfig;
  sessionRestored?: boolean;
  idleSeconds?: number;
  wslHealthy?: boolean;
  providers?: ProviderInfo[];
  defaultProvider?: string;
  chatMode?: string;
}

/**
 * Session restored message (server -> client).
 * Sent when reconnecting to an existing PTY session.
 */
export interface SessionRestoredMessage extends BaseMessage {
  type: "session-restored";
  sessionId: string;
  scrollback: string;
  sessionKey?: AnySessionKey;
}

/**
 * Startup status message (server -> client).
 * Sent during initialization to update splash screen.
 */
export interface StartupStatusMessage extends BaseMessage {
  type: "startup-status";
  message: string;
}

/**
 * PTY exited message (server -> client).
 * Sent when the terminal process dies unexpectedly.
 */
export interface PtyExitedMessage extends BaseMessage {
  type: "pty-exited";
  code: string;
  message: string;
  sessionKey?: AnySessionKey;
}

/**
 * File written confirmation (server -> client).
 */
export interface FileWrittenMessage extends BaseMessage {
  type: "file-written";
  path: string;
}

/**
 * File created confirmation (server -> client).
 */
export interface FileCreatedMessage extends BaseMessage {
  type: "file-created";
  path: string;
}

/**
 * Neovim spawn request (client -> server).
 */
export interface NeovimSpawnMessage extends BaseMessage {
  type: "neovim-spawn";
  filePath?: string;
}

/**
 * Neovim kill request (client -> server).
 */
export interface NeovimKillMessage extends BaseMessage {
  type: "neovim-kill";
}

/**
 * Neovim terminal input (client -> server).
 */
export interface NeovimInputMessage extends BaseMessage {
  type: "neovim-input";
  data: string;
}

/**
 * Neovim terminal resize (client -> server).
 */
export interface NeovimResizeMessage extends BaseMessage {
  type: "neovim-resize";
  cols: number;
  rows: number;
}

/**
 * Neovim RPC command (client -> server).
 */
export interface NeovimRpcMessage extends BaseMessage {
  type: "neovim-rpc";
  method: string;
  args: unknown[];
  requestId: string;
}

/**
 * Neovim ready notification (server -> client).
 */
export interface NeovimReadyMessage extends BaseMessage {
  type: "neovim-ready";
  pid: number;
}

/**
 * Neovim terminal output (server -> client).
 */
export interface NeovimOutputMessage extends BaseMessage {
  type: "neovim-output";
  data: string;
}

/**
 * Neovim RPC response (server -> client).
 */
export interface NeovimRpcResponseMessage extends BaseMessage {
  type: "neovim-rpc-response";
  requestId: string;
  result?: unknown;
  error?: string;
}

/**
 * Neovim exited notification (server -> client).
 */
export interface NeovimExitedMessage extends BaseMessage {
  type: "neovim-exited";
  exitCode: number;
}

// --- Chat types ---

/**
 * Provider information returned by the backend.
 */
export interface ProviderInfo {
  name: string;
  model: string;
  type: "api" | "cli" | "claude-code";
  capabilities: {
    streaming: boolean;
    tool_use: boolean;
    vision: boolean;
  };
}

/**
 * Chat message (client -> server).
 */
export interface ChatMessageRequest extends BaseMessage {
  type: "chat-message";
  content: string;
  providerId?: string;
}

/**
 * Chat cancel (client -> server).
 */
export interface ChatCancelMessage extends BaseMessage {
  type: "chat-cancel";
}

/**
 * Provider switch (client -> server).
 */
export interface ProviderSwitchMessage extends BaseMessage {
  type: "provider-switch";
  providerId: string;
}

/**
 * Chat stream event (server -> client).
 */
export interface ChatStreamMessage extends BaseMessage {
  type: "chat-stream";
  event: "text-delta" | "done" | "error" | "tool-use-start" | "tool-result" | "thinking-delta" | "system-info" | "user-message" | "agent-approval-request" | "agent-approval-resolved" | "report-review-request" | "permission-request" | "permission-resolved";
  content?: string;
  usage?: Record<string, number>;
  message?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  status?: string;
  cancelled?: boolean;
  cost?: number;
  agentId?: string;
  // system-info fields
  model?: string;
  sessionId?: string;
  tools?: string[];
  slashCommands?: string[];
  version?: string;
  // agent approval fields
  targetAgentId?: string;
  name?: string;
  task?: string;
  mode?: string;
  resolution?: string;
  // report review fields
  report?: string;
  // permission prompt fields
  requestId?: string;
  description?: string;
  decision?: string;
}

/**
 * Chat history replay (server -> client).
 */
export interface ChatHistoryMessage extends BaseMessage {
  type: "chat-history";
  messages: Array<{ role: string; content: string }>;
}

/**
 * Chat mode change (server -> client).
 */
export interface ChatModeChangeMessage extends BaseMessage {
  type: "chat-mode-change";
  mode: string;
}

/**
 * Agent spawned (server -> client).
 */
export interface AgentSpawnedMessage extends BaseMessage {
  type: "agent-spawned";
  agentId: string;
  name: string;
  task: string;
  mode: string;
}

/**
 * Agent killed (server -> client).
 */
export interface AgentKilledMessage extends BaseMessage {
  type: "agent-killed";
  agentId: string;
}

/**
 * Agent state changed (server -> client).
 */
export interface AgentStateChangedMessage extends BaseMessage {
  type: "agent-state-changed";
  agentId: string;
  state: string;
}

/**
 * Provider list (server -> client).
 */
export interface ProviderListMessage extends BaseMessage {
  type: "provider-list";
  providers: ProviderInfo[];
  default?: string;
}

/**
 * Union of all client -> server messages.
 */
export type ClientMessage =
  | InputMessage
  | ResizeMessage
  | GetFileMessage
  | GetTreeMessage
  | GetChildrenMessage
  | BrowseChildrenMessage
  | GetLatestPlanMessage
  | WriteFileMessage
  | CreateFileMessage
  | SaveSessionMessage
  | SetProjectMessage
  | ChatMessageRequest
  | ChatCancelMessage
  | ProviderSwitchMessage
  | NeovimSpawnMessage
  | NeovimKillMessage
  | NeovimInputMessage
  | NeovimResizeMessage
  | NeovimRpcMessage
  | DashboardGetConfigMessage
  | DashboardGetDataMessage
  | DashboardActionMessage;

// Dashboard messages
export interface DashboardGetConfigMessage {
  type: typeof import("./platform/protocol").MessageType.DASHBOARD_GET_CONFIG;
}
export interface DashboardGetDataMessage {
  type: typeof import("./platform/protocol").MessageType.DASHBOARD_GET_DATA;
  sourceId?: string;
}
export interface DashboardActionMessage {
  type: typeof import("./platform/protocol").MessageType.DASHBOARD_ACTION;
  action: string;
  source: string;
  entityId?: string;
  patch?: Record<string, unknown>;
}
export interface DashboardConfigMessage {
  type: typeof import("./platform/protocol").MessageType.DASHBOARD_CONFIG;
  config: import("./dashboard/types").DashboardConfig;
}
export interface DashboardDataMessage {
  type: typeof import("./platform/protocol").MessageType.DASHBOARD_DATA;
  sources: Record<string, Record<string, unknown>[]>;
}
export interface DashboardClearedMessage {
  type: typeof import("./platform/protocol").MessageType.DASHBOARD_CLEARED;
}

/**
 * Union of all server -> client messages.
 */
export type ServerMessage =
  | OutputMessage
  | FileTreeMessage
  | FileChildrenMessage
  | BrowseChildrenResponseMessage
  | FileChangeMessage
  | FileContentMessage
  | FileWrittenMessage
  | FileCreatedMessage
  | ViewFileMessage
  | ErrorMessage
  | ConnectedMessage
  | SessionRestoredMessage
  | StartupStatusMessage
  | PtyExitedMessage
  | ChatStreamMessage
  | ChatHistoryMessage
  | ChatModeChangeMessage
  | ProviderListMessage
  | NeovimReadyMessage
  | NeovimOutputMessage
  | NeovimRpcResponseMessage
  | NeovimExitedMessage
  | AgentSpawnedMessage
  | AgentKilledMessage
  | AgentStateChangedMessage
  | DashboardConfigMessage
  | DashboardDataMessage
  | DashboardClearedMessage
  | { type: "dashboard-push-panel"; panel: { id: string; title: string; component: string }; data: Record<string, unknown>[] }
  | { type: "notification"; message: string; style: string };

/**
 * Event handler type.
 */
export type EventHandler<T> = (data: T) => void;

/**
 * Event emitter interface.
 */
export interface EventEmitter<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void;
  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void;
  emit<K extends keyof Events>(event: K, data: Events[K]): void;
}
