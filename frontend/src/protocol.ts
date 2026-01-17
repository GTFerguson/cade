/**
 * WebSocket protocol message types - mirrors backend/protocol.py
 *
 * This is the single source of truth for message types on the client side.
 * Keep in sync with backend/protocol.py.
 */

export const MessageType = {
  // Client -> Server
  INPUT: "input",
  RESIZE: "resize",
  GET_FILE: "get-file",
  GET_TREE: "get-tree",
  SAVE_SESSION: "save-session",
  SET_PROJECT: "set-project",

  // Server -> Client
  OUTPUT: "output",
  FILE_TREE: "file-tree",
  FILE_CHANGE: "file-change",
  FILE_CONTENT: "file-content",
  ERROR: "error",
  CONNECTED: "connected",
  SESSION_RESTORED: "session-restored",
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

export const ErrorCode = {
  PTY_SPAWN_FAILED: "pty-spawn-failed",
  PTY_READ_FAILED: "pty-read-failed",
  PTY_WRITE_FAILED: "pty-write-failed",
  FILE_NOT_FOUND: "file-not-found",
  FILE_READ_FAILED: "file-read-failed",
  INVALID_MESSAGE: "invalid-message",
  INTERNAL_ERROR: "internal-error",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
