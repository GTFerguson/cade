/**
 * WebSocket protocol message types - mirrors backend/protocol.py
 *
 * This is the single source of truth for message types on the client side.
 * Keep in sync with backend/protocol.py.
 */

export const SessionKey = {
  CLAUDE: "claude",
  MANUAL: "manual",
} as const;

export type SessionKeyValue = (typeof SessionKey)[keyof typeof SessionKey];

/**
 * Accepts both well-known session keys and dynamic agent keys like "agent-tests".
 */
export type AnySessionKey = SessionKeyValue | string;

export const MessageType = {
  // Client -> Server
  INPUT: "input",
  RESIZE: "resize",
  CHAT_MESSAGE: "chat-message",
  CHAT_CANCEL: "chat-cancel",
  PROVIDER_SWITCH: "provider-switch",
  GET_FILE: "get-file",
  GET_TREE: "get-tree",
  WRITE_FILE: "write-file",
  CREATE_FILE: "create-file",
  SAVE_SESSION: "save-session",
  SET_PROJECT: "set-project",
  GET_LATEST_PLAN: "get-latest-plan",
  GET_CHILDREN: "get-children",
  BROWSE_CHILDREN: "browse-children",

  // Server -> Client
  OUTPUT: "output",
  FILE_TREE: "file-tree",
  FILE_CHILDREN: "file-children",
  FILE_CHANGE: "file-change",
  FILE_CONTENT: "file-content",
  FILE_WRITTEN: "file-written",
  FILE_CREATED: "file-created",
  VIEW_FILE: "view-file",
  ERROR: "error",
  CONNECTED: "connected",
  SESSION_RESTORED: "session-restored",
  STARTUP_STATUS: "startup-status",
  PTY_EXITED: "pty-exited",

  // Chat - Server -> Client
  CHAT_STREAM: "chat-stream",
  CHAT_HISTORY: "chat-history",
  PROVIDER_LIST: "provider-list",

  // Neovim - Client -> Server
  NEOVIM_SPAWN: "neovim-spawn",
  NEOVIM_KILL: "neovim-kill",
  NEOVIM_INPUT: "neovim-input",
  NEOVIM_RESIZE: "neovim-resize",
  NEOVIM_RPC: "neovim-rpc",

  // Neovim - Server -> Client
  NEOVIM_READY: "neovim-ready",
  NEOVIM_OUTPUT: "neovim-output",
  NEOVIM_RPC_RESPONSE: "neovim-rpc-response",
  NEOVIM_EXITED: "neovim-exited",
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

export const ErrorCode = {
  PTY_SPAWN_FAILED: "pty-spawn-failed",
  PTY_READ_FAILED: "pty-read-failed",
  PTY_WRITE_FAILED: "pty-write-failed",
  FILE_NOT_FOUND: "file-not-found",
  FILE_READ_FAILED: "file-read-failed",
  FILE_WRITE_FAILED: "file-write-failed",
  FILE_CREATE_FAILED: "file-create-failed",
  FILE_EXISTS: "file-exists",
  INVALID_PATH: "invalid-path",
  INVALID_MESSAGE: "invalid-message",
  PTY_EXITED: "pty-exited",
  INTERNAL_ERROR: "internal-error",
  NEOVIM_SPAWN_FAILED: "neovim-spawn-failed",
  NEOVIM_NOT_FOUND: "neovim-not-found",
  NEOVIM_RPC_FAILED: "neovim-rpc-failed",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
