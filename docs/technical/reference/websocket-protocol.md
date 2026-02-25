---
title: WebSocket Protocol Reference
created: 2026-02-25
updated: 2026-02-25
status: complete
tags: [reference, protocol, websocket, api]
---

# WebSocket Protocol Reference

The protocol is defined in `backend/protocol.py` (server) and `frontend/src/platform/protocol.ts` (client). All messages are JSON with a `type` field.

## Terminal

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `input` | C->S | `{ data, sessionKey? }` | Terminal input |
| `resize` | C->S | `{ cols, rows, sessionKey? }` | Terminal resize |
| `output` | S->C | `{ data, sessionKey? }` | Terminal output |
| `pty-exited` | S->C | `{ code, message, sessionKey? }` | PTY process exited |

## Files

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `get-tree` | C->S | `{}` | Request file tree |
| `get-file` | C->S | `{ path }` | Request file content |
| `write-file` | C->S | `{ path, content }` | Write file |
| `create-file` | C->S | `{ path, content? }` | Create new file |
| `get-children` | C->S | `{ path, showIgnored? }` | Request directory children |
| `browse-children` | C->S | `{ path }` | Browse absolute filesystem path |
| `file-tree` | S->C | `{ data: FileNode[] }` | File tree response |
| `file-children` | S->C | `{ path, children }` | Directory children response |
| `file-content` | S->C | `{ path, content, fileType }` | File content |
| `file-written` | S->C | `{ path }` | Write confirmation |
| `file-created` | S->C | `{ path }` | Create confirmation |
| `file-change` | S->C | `{ event, path }` | Filesystem change notification |
| `view-file` | S->C | `{ path, content, fileType, isPlan? }` | External view request (e.g. plan overlay) |

## Session

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `connected` | S->C | `{ workingDir }` | Connection established |
| `set-project` | C->S | `{ path, sessionId? }` | Set project directory |
| `save-session` | C->S | `{ state }` | Persist session state |
| `session-restored` | S->C | `{ sessionId, scrollback }` | Session reattached after reconnect |
| `startup-status` | S->C | `{ message }` | Startup progress indicator |
| `get-latest-plan` | C->S | `{}` | Request most recent plan file |

## Neovim

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `neovim-spawn` | C->S | `{ sessionId }` | Spawn Neovim instance |
| `neovim-kill` | C->S | `{ sessionId }` | Terminate Neovim |
| `neovim-input` | C->S | `{ data }` | Terminal input to Neovim |
| `neovim-resize` | C->S | `{ cols, rows }` | Resize Neovim terminal |
| `neovim-rpc` | C->S | `{ method, args, requestId }` | RPC command |
| `neovim-ready` | S->C | `{ pid }` | Neovim running |
| `neovim-output` | S->C | `{ data }` | Terminal output from Neovim |
| `neovim-rpc-response` | S->C | `{ requestId, result?, error? }` | RPC response |
| `neovim-exited` | S->C | `{ exitCode }` | Neovim exited |

## Errors

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `error` | S->C | `{ code, message }` | Error response |

Error codes: `pty-spawn-failed`, `pty-read-failed`, `pty-write-failed`, `file-not-found`, `file-read-failed`, `file-write-failed`, `file-create-failed`, `file-exists`, `invalid-path`, `invalid-message`, `pty-exited`, `internal-error`, `neovim-spawn-failed`, `neovim-not-found`, `neovim-rpc-failed`

## See Also

- [[frontend-architecture]] - Frontend WebSocket client
- `backend/protocol.py` - Server-side message definitions
- `frontend/src/platform/protocol.ts` - Client-side message types
