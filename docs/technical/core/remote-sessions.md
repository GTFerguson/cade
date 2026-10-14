---
title: Remote Sessions
created: 2026-10-14
updated: 2026-10-14
status: active
tags: [technical, backend, frontend, sessions, mobile, transport, attention, push]
---

# Remote Sessions

How several devices drive one terminal session: the output broadcaster, sequenced reconnects, the one-size policy, the session directory, agent attention, and push. This is the substrate under the mobile UI described in [[frontend-architecture#Mobile Support]].

## Purpose

A tab's PTY session lives on the backend, but until October 2026 only the browser that created it could see it: tab ids were in that browser's `localStorage`, two clients on one session split its output between them, a reconnect replayed the whole scrollback, and every client resized the PTY as it pleased. Operating a session from a phone needed all four fixed at the transport, not in the widgets.

## Output: one reader, many subscribers

`TerminalState` (`backend/terminal/sessions.py`) owns one reader task per PTY, started when the terminal is created (`ensure_reader`). The reader stamps every chunk with a sequence number and keeps it in the scrollback deque, which now holds `(seq, chunk)` and doubles as the replay ring buffer (bounded by `MAX_SCROLLBACK_SIZE`). Each attached client has an `OutputSubscriber` with a bounded queue. A subscriber that cannot keep up is dropped rather than allowed to stall the reader; its connection notices the sentinel and cold-reattaches.

The reader outlives connections. Output produced while nobody is attached lands in the buffer, which is what makes "start on the desktop, check from the phone" work.

A connection's `_drain_output` coalesces everything already queued into one `output` frame. A TUI redraw arrives as a burst of small PTY reads; sending them as one JSON message with one `seq` halves the frame count and the xterm writes.

## Reconnect: delta or cold

`output` and `session-restored` frames carry `seq`. The client remembers the last `seq` per terminal (`WebSocketClient.lastSeq`) and sends the map as `lastSeq` in `set-project`. On attach (`ConnectionHandler._attach_terminal`):

| Client position | Server does |
|---|---|
| Known and still within the buffer | Replays the gap as ordinary `output` frames |
| Unknown (page reload), ahead of the buffer, or trimmed away | Sends the sanitized scrollback as `session-restored` with its `seq`; the client resets and redraws |
| New session | Buffered startup output goes through the normal chunk path so startup suppression still applies |

Chunks published between subscribing and finishing the replay also arrive on the queue; the drain skips anything at or below the last delivered `seq`, so nothing is sent twice.

When the buffer no longer starts at the beginning and the attaching client may own the size, the server nudges the PTY one row and back. Both Claude Code and Codex repaint their whole screen on SIGWINCH, which is cheaper and more faithful than replaying a raw stream drawn for a different screen. A `repaint` message triggers the same nudge on demand (the ⟳ key on the phone).

## Size: the controller owns it

The PTY has one size. The client that last typed into a terminal is its controller (`PTYSession.claim_control`); its most recent `resize` is applied, and other clients' resizes are refused. Every client is told the current size and owner through `pty-size`. A non-controller mirrors that size (`Terminal.applyPtySize`): xterm is resized to the controller's columns and the font shrinks so they fit the width (`fontSizeForCols`). Taking control restores the client's own fit.

This was chosen over tmux's smallest-client rule, which would shrink a desktop every time a phone glanced in. The cost is that typing on the phone narrows the desktop until the desktop types again; the session strip and `pty-size.controller` make the handover visible.

The phone's on-screen keyboard never resizes the PTY either: the input bar reports keyboard open/close before the pane shrinks, and `Terminal.lockRows` freezes the row count while it is up. The pane scrolls to the prompt line instead.

## Session directory

`GET /api/sessions` and the `list-sessions` message describe every live session (`backend/terminal/session_listing.py`): id, label, project, agent adapter, attached client count, attention, and per-terminal size, controller and last `seq`. Tabs send their name as `label` in `set-project`. `TabManager.adoptSession` opens a tab whose id *is* the session id, so connecting attaches to the existing PTY instead of spawning one. The mobile menu lists adoptable sessions under "on server".

The registry is not persisted: PTYs do not survive a backend restart, so a file would only list sessions that no longer exist.

## Liveness

Server-side pings (`ws_ping_interval`) do not reach page JavaScript, and a backgrounded phone's socket can die without `onclose` ever firing. `WebSocketClient` probes on `visibilitychange` (to visible) and `online`: connected, it sends `ping` and treats three seconds without `pong` as a dead socket; waiting out a backoff, it reconnects immediately. Both go through `BaseWSClient.reconnectNow`, which detaches the stale socket's handlers first so its late close cannot schedule a second reconnect. `disconnect()` detaches the same way, which fixed a latent bug where a deliberately closed socket could later null out a newer socket's handle.

## Attention

`PTYSession.attention` is `"input"` (the agent is waiting on a prompt), `"idle"` (a turn finished) or `None`. It is fed by agent hooks (`backend/terminal/attention.py`):

| Source | Event | State |
|---|---|---|
| Claude Code `Notification` hook | `permission_prompt`, `idle_prompt`, `elicitation_dialog` | input |
| Claude Code `Stop` hook | | idle |
| Claude Code `UserPromptSubmit` hook | | cleared |
| Codex `notify` | `agent-turn-complete` | idle |
| Any terminal input from a client | | cleared |

`~/.cade/hooks/attention.py` is installed beside the view hook by `setup_cade_hooks` and registered for the three Claude Code events; the Codex adapter writes a marked `notify` line into `~/.codex/config.toml` unless the user already has one. The hook POSTs to `/api/sessions/attention`. CADE injects `CADE_SESSION_ID` into every agent's PTY environment so the hook names its session; a hook without it falls back to the unique live session in its `cwd`.

Changes are broadcast to the session's clients as `session-attention` and included in the session listing. The frontend shows them on the session strip and in the menu, raises a browser `Notification` when the page is hidden (`frontend/src/ui/attention-notify.ts`), and the backend sends a Web Push for `input` and `idle`.

## Web Push and the installable app

`backend/push.py` keeps a VAPID key pair and the browsers' subscriptions under `~/.cade/push/`. Routes: `GET /api/push/status`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, cookie-authenticated like `/api/sessions`. Delivery runs `pywebpush` in an executor; subscriptions the push service reports gone (404/410) are dropped. Without `pywebpush` installed, `push_available()` is false and everything else is unaffected.

The frontend registers `sw.js` in production builds under the base path (`frontend/src/push.ts`). The worker shows push notifications, focuses or opens the app on click, and falls back to a cached shell page for navigations when offline; it caches nothing else, so a stale script can never shadow a deploy. `manifest.webmanifest` and the icons (from the Tauri set) make the page installable, which iOS requires before it will deliver push. The mobile menu's `[notify]` entry drives subscribe and unsubscribe.

## Files on the phone

`list-files` returns a flat listing under the file tree's ignore rules (`backend/files/listing.py`, capped at `DEFAULT_FILE_LIMIT`), which the search screen ranks with `frontend/src/ui/mobile/fuzzy.ts`. `get-file-diff` runs `git diff HEAD -- <path>` (`backend/files/diff.py`); an untracked file is diffed against nothing so a new file shows as additions. Paths go through the same `validate_path` as file reads.

## Configuration

| Knob | Where | Default |
|---|---|---|
| Replay buffer per terminal | `MAX_SCROLLBACK_SIZE` in `sessions.py` | 512 KB |
| Subscriber queue depth | `SUBSCRIBER_QUEUE_LIMIT` | 4096 chunks |
| Pong timeout | `WebSocketClient.PONG_TIMEOUT_MS` | 3 s |
| Font size range and fit ratio | `frontend/src/terminal/font-size.ts` | 7 to 28 px, 0.6 em per glyph |
| Push TTL | `PUSH_TTL_SECONDS` in `push.py` | 10 min |
| File list cap | `DEFAULT_FILE_LIMIT` in `listing.py` | 20 000 |

## Boundaries

- Reaching a desktop backend from a phone (a tunnel, a certificate) is deployment, not covered here; see [[../../future/remote-deployment]].
- The structured chat pane has no mobile-specific layout.
- Sessions are per backend; the directory does not span backends.

## See Also

- [[frontend-architecture]]
- [[../reference/websocket-protocol]]
- [[../../user/mobile-guide|Mobile Guide]]
