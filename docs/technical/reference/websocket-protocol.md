---
title: WebSocket Protocol Reference
created: 2026-02-25
updated: 2026-10-14
status: complete
tags: [reference, protocol, websocket, api]
---

# WebSocket Protocol Reference

The protocol is defined in `backend/protocol.py` (server) and `frontend/src/platform/protocol.ts` (client). All messages are JSON with a `type` field.

## Terminal

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `input` | C->S | `{ data, sessionKey? }` | Terminal input. Also makes the sender the terminal's controller (see `pty-size`) and clears the session's attention state. |
| `resize` | C->S | `{ cols, rows, sessionKey? }` | Requested size. Applied only when the sender controls the terminal or nobody does; otherwise answered with `pty-size`. |
| `repaint` | C->S | `{ sessionKey? }` | Ask the TUI to redraw (the server resizes the PTY one row and back). |
| `output` | S->C | `{ data, sessionKey?, seq? }` | Terminal output. `seq` is the position in the terminal's stream; absent on synthetic frames (startup suppression flushes, error text). |
| `pty-size` | S->C | `{ sessionKey, cols, rows, controller }` | The PTY's current size and the connection id that owns it (`null` when unowned). Non-controllers render at this size. |
| `pty-exited` | S->C | `{ code, message, sessionKey? }` | PTY process exited |

See [[../core/remote-sessions]] for the broadcaster, replay and size policy behind these.

## Files

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `get-tree` | C->S | `{}` | Request file tree |
| `get-file` | C->S | `{ path }` | Request file content |
| `write-file` | C->S | `{ path, content }` | Write file |
| `create-file` | C->S | `{ path, content? }` | Create new file |
| `get-children` | C->S | `{ path, showIgnored? }` | Request directory children |
| `browse-children` | C->S | `{ path }` | Browse absolute filesystem path |
| `get-plans-list` | C->S | `{ root? }` | Request the project's plans/handoffs index |
| `list-files` | C->S | `{ root? }` | Flat file listing for fuzzy search, under the tree's ignore rules |
| `get-file-diff` | C->S | `{ path, root? }` | Git diff of one file against HEAD |
| `file-tree` | S->C | `{ data: FileNode[] }` | File tree response |
| `file-children` | S->C | `{ path, children }` | Directory children response |
| `file-content` | S->C | `{ path, content, fileType, encoding, size, mime? }` | File content. `encoding` is `utf-8` (text), `base64` (binary bytes; `fileType` is `pdf`, `image` or `binary`, `mime` set) or `none` (binary over the 25 MB preview cap; `content` empty, only `size`). |
| `file-written` | S->C | `{ path }` | Write confirmation |
| `file-created` | S->C | `{ path }` | Create confirmation |
| `file-change` | S->C | `{ event, path }` | Filesystem change notification |
| `view-file` | S->C | `{ path, content, fileType, encoding, size, mime?, isPlan? }` | External view request (e.g. plan overlay); same encoding rules as `file-content` |
| `plans-list` | S->C | `{ root, plans: PlanEntry[], handoffs: PlanEntry[] }` | Plans/handoffs index (see [[frontend-architecture#Plans & Handoffs Pane]]). `PlanEntry = { name, relPath, modified, title, isLatest? }`. Re-emitted after `/compact` writes a handoff. |
| `file-list` | S->C | `{ root, files: string[], truncated }` | Relative POSIX paths, sorted; `truncated` when cut at the server's cap |
| `file-diff` | S->C | `{ path, diff, untracked, error? }` | Unified diff; `untracked` files are diffed against nothing. `error` for a non-git project or missing file. |

## Session

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `connected` | S->C | `{ workingDir, connectionId, cliAgent, ... }` | Connection established. `connectionId` is what `pty-size.controller` refers to. |
| `set-project` | C->S | `{ path, sessionId?, label?, lastSeq?, dashboardFile?, providerOverride?, initialPrompt?, chatHandoff? }` | Set project directory. `label` names the session in listings. `lastSeq` maps session keys to the last `output.seq` seen, so a reconnect replays only the gap. `initialPrompt` seeds a new Claude Code CLI session (`claude "<prompt>"`); `chatHandoff` is a one-shot path the frontend uses to prime enhanced chat — both set only for a tab spawned from the Plans pane. See [[frontend-architecture#Plans & Handoffs Pane]]. |
| `save-session` | C->S | `{ state }` | Persist session state |
| `session-restored` | S->C | `{ sessionId, scrollback, sessionKey?, seq }` | Cold attach: full sanitized scrollback running up to `seq`. Not sent when the gap could be replayed as `output`. |
| `ping` | C->S | `{ t? }` | Liveness probe; answered with `pong` carrying the same `t` |
| `pong` | S->C | `{ t? }` | Liveness reply |
| `list-sessions` | C->S | `{}` | Live sessions on this backend |
| `session-list` | S->C | `{ sessions: LiveSession[] }` | `LiveSession = { id, label, projectPath, agent, createdAt, lastActivity, alive, clients, attention, attentionMessage, terminals }`. Same shape as `GET /api/sessions`. |
| `session-attention` | S->C | `{ sessionId, attention, message? }` | The agent needs the user (`"input"`), finished a turn (`"idle"`) or is working again (`null`). Sent to the session's clients on change and once on attach. |
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

## Dashboard

See [[dashboard-interactive-primitives]] for the end-to-end design. Message shapes:

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `dashboard-get-config` | C->S | `{}` | Request dashboard config |
| `dashboard-get-data` | C->S | `{ sourceId? }` | Request a fresh source snapshot |
| `dashboard-action` | C->S | `{ action, source, entityId?, patch?, message? }` | User interaction. `action: "patch"` applies `patch` to the named source via `DashboardHandler._apply_patch`. `action: "provider_message"` forwards `message` through the active provider's `send_frame` to the engine. |
| `dashboard-config` | S->C | `{ config }` | Config payload (views, panels, data sources) |
| `dashboard-data` | S->C | `{ sources }` | Data payload keyed by source name |
| `dashboard-cleared` | S->C | `{}` | Config removed |
| `dashboard-focus-view` | S->C | `{ view_id }` | Programmatic tab switch. Frontend switches if `view_id` is declared by the current config; silent no-op otherwise. Typically emitted when the provider's server pushes a `dashboard_focus` frame. |

## Errors

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `error` | S->C | `{ code, message }` | Error response |

Error codes: `pty-spawn-failed`, `pty-read-failed`, `pty-write-failed`, `file-not-found`, `file-read-failed`, `file-write-failed`, `file-create-failed`, `file-exists`, `invalid-path`, `invalid-message`, `pty-exited`, `internal-error`, `neovim-spawn-failed`, `neovim-not-found`, `neovim-rpc-failed`

## See Also

- [[frontend-architecture]] - Frontend WebSocket client
- `backend/protocol.py` - Server-side message definitions
- `frontend/src/platform/protocol.ts` - Client-side message types
