/**
 * TypeScript interfaces for ccplus frontend.
 */

import type { ErrorCodeValue, MessageTypeValue } from "./protocol";

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
}

/**
 * Terminal resize message (client -> server).
 */
export interface ResizeMessage extends BaseMessage {
  type: "resize";
  cols: number;
  rows: number;
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
 * Terminal output message (server -> client).
 */
export interface OutputMessage extends BaseMessage {
  type: "output";
  data: string;
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
}

/**
 * Union of all client -> server messages.
 */
export type ClientMessage =
  | InputMessage
  | ResizeMessage
  | GetFileMessage
  | GetTreeMessage;

/**
 * Union of all server -> client messages.
 */
export type ServerMessage =
  | OutputMessage
  | FileTreeMessage
  | FileChangeMessage
  | FileContentMessage
  | ErrorMessage
  | ConnectedMessage;

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
