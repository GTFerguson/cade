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
    GET_CHILDREN = "get-children"  # Request directory children: { type, path: str, showIgnored?: bool }
    BROWSE_CHILDREN = "browse-children"  # Browse absolute filesystem path: { type, path: str }

    # Chat - Client -> Server
    CHAT_MESSAGE = "chat-message"  # Send chat message: { type, content: str, providerId?: str }
    CHAT_CANCEL = "chat-cancel"  # Cancel in-progress chat stream: { type }
    PROVIDER_SWITCH = "provider-switch"  # Switch provider: { type, providerId: str }

    # Server -> Client
    OUTPUT = "output"  # Terminal output: { type, data: str, sessionKey?: str }
    FILE_TREE = "file-tree"  # File tree response: { type, data: FileNode[] }
    FILE_CHILDREN = "file-children"  # Directory children: { type, path: str, children: FileNode[] }
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

    # Chat - Server -> Client
    CHAT_STREAM = "chat-stream"  # Streaming event: { type, event: str, content?: str, usage?: dict, message?: str }
    CHAT_HISTORY = "chat-history"  # Chat history replay: { type, messages: list[dict] }
    CHAT_MODE_CHANGE = "chat-mode-change"  # Mode switched: { type, mode: str }
    CHAT_COMPACT = "chat-compact"  # Session compacted: { type, context: str, filePath?: str }
    COMPACT_PREVIEW = "compact-preview"  # Handoff ready for approval: { type, filePath?: str, content: str }
    PROVIDER_LIST = "provider-list"  # Available providers: { type, providers: list, default?: str }

    # Chat - Client -> Server
    COMPACT_PREVIEW_RESOLVED = "compact-preview-resolved"  # User approved/rejected compact: { type, approved: bool }
    CHAT_CLEAR = "chat-clear"  # Clear session immediately: { type }

    # Orchestrator - Client -> Server
    AGENT_APPROVE = "agent-approve"  # Approve pending agent: { type, agentId }
    AGENT_REJECT = "agent-reject"  # Reject pending agent: { type, agentId }
    AGENT_APPROVE_REPORT = "agent-approve-report"  # Approve agent report: { type, agentId }
    AGENT_REJECT_REPORT = "agent-reject-report"  # Reject agent report: { type, agentId }
    AGENT_MESSAGE = "agent-message"  # Send message to running agent: { type, agentId, content }
    AGENT_GUIDANCE_RESPOND = "agent-guidance-respond"  # Respond to agent guidance request: { type, agentId, response }

    # Orchestrator - Server -> Client
    AGENT_SPAWNED = "agent-spawned"  # Agent created (pending approval): { type, agentId, name, task, mode }
    AGENT_KILLED = "agent-killed"  # Agent terminated: { type, agentId }
    AGENT_STATE_CHANGED = "agent-state-changed"  # Agent state update: { type, agentId, state }
    AGENT_GUIDANCE_REQUEST = "agent-guidance-request"  # Agent needs user input: { type, agentId, question }

    # Neovim - Client -> Server
    NEOVIM_SPAWN = "neovim-spawn"  # Request Neovim instance: { type, sessionId }
    NEOVIM_KILL = "neovim-kill"  # Terminate Neovim instance: { type, sessionId }
    NEOVIM_INPUT = "neovim-input"  # Terminal input to Neovim: { type, data: str }
    NEOVIM_RESIZE = "neovim-resize"  # Resize Neovim terminal: { type, cols: int, rows: int }
    NEOVIM_RPC = "neovim-rpc"  # RPC command: { type, method: str, args: list, requestId: str }

    NEOVIM_OPEN_DIFF = "neovim-open-diff"  # Request diff view for a file: { type, filePath: str }

    # Neovim - Server -> Client
    NEOVIM_READY = "neovim-ready"  # Neovim running: { type, pid: int }
    NEOVIM_OUTPUT = "neovim-output"  # Terminal output from Neovim: { type, data: str }
    NEOVIM_RPC_RESPONSE = "neovim-rpc-response"  # RPC response: { type, requestId, result?, error? }
    NEOVIM_EXITED = "neovim-exited"  # Neovim exited: { type, exitCode: int }
    NEOVIM_DIFF_AVAILABLE = "neovim-diff-available"  # Diff ready: { type, filePath, hunkCount, added, removed }

    # Permissions - Client -> Server
    PERMISSION_APPROVE = "permission-approve"  # Approve tool use: { type, requestId }
    PERMISSION_DENY = "permission-deny"  # Deny tool use: { type, requestId }

    # Dashboard - Client -> Server
    DASHBOARD_GET_CONFIG = "dashboard-get-config"  # Request dashboard config: { type }
    DASHBOARD_GET_DATA = "dashboard-get-data"  # Request data: { type, sourceId?: str }
    DASHBOARD_ACTION = "dashboard-action"  # User interaction: { type, action, source, entityId, patch }

    # Dashboard - Server -> Client
    DASHBOARD_CONFIG = "dashboard-config"  # Config payload: { type, config: dict }
    DASHBOARD_DATA = "dashboard-data"  # Data payload: { type, sources: dict[str, list] }
    DASHBOARD_CLEARED = "dashboard-cleared"  # Config removed: { type }
    DASHBOARD_FOCUS_VIEW = "dashboard-focus-view"  # Programmatic tab switch: { type, view_id }
    DASHBOARD_HIDE_VIEW = "dashboard-hide-view"  # Hide a tab: { type, view_id }


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
    NEOVIM_SPAWN_FAILED = "neovim-spawn-failed"
    NEOVIM_NOT_FOUND = "neovim-not-found"
    NEOVIM_RPC_FAILED = "neovim-rpc-failed"
