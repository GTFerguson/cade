/**
 * TypeScript interfaces for CADE frontend.
 */

import type { ErrorCodeValue, MessageTypeValue, SessionKeyValue } from "./protocol";
import type { UserConfig } from "./user-config";

/**
 * Represents a file or directory in the file tree.
 */
export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  modified?: number;
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
  sessionKey?: SessionKeyValue;
}

/**
 * Terminal resize message (client -> server).
 */
export interface ResizeMessage extends BaseMessage {
  type: "resize";
  cols: number;
  rows: number;
  sessionKey?: SessionKeyValue;
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
  sessionKey?: SessionKeyValue;
}

/**
 * File tree response (server -> client).
 */
export interface FileTreeMessage extends BaseMessage {
  type: "file-tree";
  data: FileNode[];
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
}

/**
 * Session restored message (server -> client).
 * Sent when reconnecting to an existing PTY session.
 */
export interface SessionRestoredMessage extends BaseMessage {
  type: "session-restored";
  sessionId: string;
  scrollback: string;
  sessionKey?: SessionKeyValue;
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
 * Union of all client -> server messages.
 */
export type ClientMessage =
  | InputMessage
  | ResizeMessage
  | GetFileMessage
  | GetTreeMessage
  | SaveSessionMessage
  | SetProjectMessage;

/**
 * Union of all server -> client messages.
 */
export type ServerMessage =
  | OutputMessage
  | FileTreeMessage
  | FileChangeMessage
  | FileContentMessage
  | ErrorMessage
  | ConnectedMessage
  | SessionRestoredMessage
  | StartupStatusMessage;

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
