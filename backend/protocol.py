"""WebSocket protocol message types - single source of truth.

This module defines all message type constants used in client-server communication.
The frontend mirrors these constants in protocol.ts.
"""

from __future__ import annotations


class MessageType:
    """Message type constants for WebSocket protocol."""

    # Client -> Server
    INPUT = "input"  # Terminal input: { type, data: str, sessionKey?: str }
    RESIZE = "resize"  # Terminal resize: { type, cols: int, rows: int, sessionKey?: str }
    GET_FILE = "get-file"  # Request file content: { type, path: str }
    GET_TREE = "get-tree"  # Request file tree: { type }
    WRITE_FILE = "write-file"  # Write file content: { type, path: str, content: str }
    CREATE_FILE = "create-file"  # Create new file: { type, path: str, content?: str }
    SAVE_SESSION = "save-session"  # Save session state: { type, state: SessionState }
    SET_PROJECT = "set-project"  # Set project directory: { type, path: str, sessionId?: str }
    GET_LATEST_PLAN = "get-latest-plan"  # Request most recent plan file: { type }

    # Server -> Client
    OUTPUT = "output"  # Terminal output: { type, data: str, sessionKey?: str }
    FILE_TREE = "file-tree"  # File tree response: { type, data: FileNode[] }
    FILE_CHANGE = "file-change"  # File changed: { type, event: str, path: str }
    FILE_CONTENT = "file-content"  # File content: { type, path: str, content: str }
    FILE_WRITTEN = "file-written"  # File written successfully: { type, path: str }
    FILE_CREATED = "file-created"  # File created successfully: { type, path: str }
    VIEW_FILE = "view-file"  # External view request: { type, path: str, content: str }
    ERROR = "error"  # Error message: { type, code: str, message: str }
    CONNECTED = "connected"  # Connection established: { type, working_dir: str }
    SESSION_RESTORED = "session-restored"  # Session reattached: { type, sessionId: str, scrollback: str }
    STARTUP_STATUS = "startup-status"  # Startup progress: { type, message: str }
    PTY_EXITED = "pty-exited"  # PTY process exited: { type, code: str, message: str, sessionKey?: str }


class SessionKey:
    """Session key constants for dual-terminal support."""

    CLAUDE = "claude"  # Primary terminal running Claude Code
    MANUAL = "manual"  # Secondary terminal for manual shell access


class ErrorCode:
    """Error codes for structured error responses."""

    PTY_SPAWN_FAILED = "pty-spawn-failed"
    PTY_READ_FAILED = "pty-read-failed"
    PTY_WRITE_FAILED = "pty-write-failed"
    FILE_NOT_FOUND = "file-not-found"
    FILE_READ_FAILED = "file-read-failed"
    FILE_WRITE_FAILED = "file-write-failed"
    FILE_CREATE_FAILED = "file-create-failed"
    FILE_EXISTS = "file-exists"
    INVALID_PATH = "invalid-path"
    INVALID_MESSAGE = "invalid-message"
    PTY_EXITED = "pty-exited"
    INTERNAL_ERROR = "internal-error"
