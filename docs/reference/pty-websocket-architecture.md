---
title: PTY–WebSocket Architecture for Terminal Session Management
created: 2026-04-28
tags: [research, pty, websocket, terminal]
---

# PTY–WebSocket Architecture for Terminal Session Management

This document covers the design space for running PTY (pseudo-terminal) subprocesses over WebSocket transport in browser-based development environments. It draws from the CADE implementation, academic literature on WebSocket protocol design, and the engineering practices of VS Code Remote, GitHub Codespaces, and similar systems.

## 1. Overview

Browser-based terminal emulators (xterm.js, hterm) cannot natively spawn OS processes. Bridging the gap requires:

1. A **server-side PTY** that owns the shell process
2. A **WebSocket transport** that streams bytes between PTY and browser
3. A **session layer** that maintains PTY state across disconnections

```
Browser (xterm.js)  ←→  WebSocket  ←→  Backend (PTY + shell)
```

**CADE's approach:** One WebSocket connection per session. Each session owns 1–2 PTYs (primary Claude Code terminal + optional manual shell). The `SessionRegistry` keeps PTYs alive when the WebSocket disconnects, enabling transparent reconnection with scrollback replay.

## 2. PTY Lifecycle Management

### 2.1 Creation

PTY creation is platform-specific:

**Unix:** `pexpect.spawn()` opens a pseudo-terminal pair. The child is forked with the PTY as stdin/stdout/stderr. The `TERM` environment variable is set to `xterm-256color` for 24-bit color support.

**Windows:** `pywinpty.PTY` with fallback between WinPTY and ConPTY backends. WSL detection triggers special argument parsing (resolving to `wsl.exe -e bash --login` with `--cd`).

```python
# CADE's PTYManager abstracts platform differences
class PTYManager:
    async def spawn(self, command: str, cwd: Path, size: TerminalSize) -> None:
        self._pty = self._create_pty()  # UnixPTY or WindowsPTY
        await self._pty.spawn(command, cwd, size)
```

The shell command, working directory, and initial terminal dimensions are required at spawn time. CADE defaults to 80 columns × 24 rows.

### 2.2 Ownership Model

Two ownership patterns exist in production systems:

| Pattern | Examples | Trade-offs |
|---------|----------|------------|
| **Per-connection PTY** | Jupyter terminal | Simple; PTY dies on disconnect |
| **Registry-backed PTY** | CADE, VS Code Server | Complex; survives reconnections |

CADE uses the registry pattern: `SessionRegistry` holds `PTYSession` objects keyed by a session ID (tab UUID from the frontend). The registry is global (module-level singleton) so PTYs survive across WebSocket disconnections.

### 2.3 Teardown

PTY teardown must handle:

- **Graceful close:** Send SIGHUP or call the PTY library's close method with `force=True`
- **Output task cancellation:** The async task reading PTY output must be cancelled before closing the PTY to avoid "read failed: PTY closed" errors
- **WSL recovery:** On Windows with WSL, certain error patterns trigger a WSL restart and retry before giving up

```python
# CADE teardown sequence
async def _close_session(self, session: PTYSession) -> None:
    for terminal in session.terminals.values():
        if terminal.output_task is not None:
            terminal.output_task.cancel()
            await terminal.output_task  # wait for cancellation
        await terminal.pty.close()
```

### 2.4 Orphan Cleanup

Long-running registries must evict dead or stale sessions:

- Sessions with no alive PTYs are removed
- Sessions older than `session_max_age` (default 24 hours) are removed
- A background task runs every 60 seconds to check

## 3. WebSocket Transport

### 3.1 Framing and Message Types

CADE uses JSON frames for all control messages and raw UTF-8 text for terminal I/O:

| Direction | Type | Payload |
|-----------|------|---------|
| C→S | `input` | `{ data: string, sessionKey?: string }` |
| C→S | `resize` | `{ cols: number, rows: number, sessionKey?: string }` |
| S→C | `output` | `{ data: string, sessionKey?: string }` |
| S→C | `pty-exited` | `{ code: string, message: string, sessionKey?: string }` |

The `sessionKey` field enables **session multiplexing** within a single WebSocket connection (see Section 4). CADE defines two session keys: `claude` (primary terminal running Claude Code) and `manual` (secondary shell for user commands).

### 3.2 Binary vs Text Frames

Terminal data is UTF-8 encoded text (ANSI escape sequences + printable characters). Using **text frames** avoids base64 overhead but requires:

- Bytes must decode as valid UTF-8 (true for ANSI terminals with proper `TERM` settings)
- Binary control sequences (e.g., some OSC 52 clipboard operations) may need special handling

**When to use binary frames:** Applications streaming non-UTF-8 data or mixing binary protocol data (e.g., the SSH channel mux protocol). Most terminal WebSocket bridges use text frames.

### 3.3 Heartbeat / Keepalive

WebSocket connections can idle indefinitely behind NAT gateways or proxies. Standard practice is:

1. **WebSocket ping/pong frames:** The WebSocket protocol (RFC 6455) has built-in ping/pong frames at the framing layer. Most server libraries (FastAPI/starlette, uvicorn) support these.
2. **Application-level heartbeat:** Periodic JSON heartbeat messages are more portable across load balancers and provide a RTT measurement.

CADE relies on uvicorn's WebSocket keepalive (ping/pong at the transport layer). The `session-restored` message serves as a semantic signal that the connection succeeded.

### 3.4 Flow Control and Backpressure

PTY output is streaming. Without flow control:

- A fast process (e.g., `find /`) can flood the WebSocket send buffer
- The WebSocket send buffer filling up causes `write()` to block in the output loop
- The async output task deadlocks

**Mitigation:** Check if the WebSocket write is keeping up. In CADE's output loop, each chunk is sent immediately (4KB reads from pexpect). For high-throughput scenarios, consider batching output into larger frames or using WebSocket `BINARY_FRAME` with a size prefix.

## 4. Multiplexing Strategies

### 4.1 Single vs Multiple Connections

| Strategy | Pros | Cons |
|----------|------|------|
| **One WS per PTY** | Simple; natural isolation | Browser limits concurrent connections; extra latency on setup |
| **Multiple PTYs over one WS** | Shared keepalive, single handshake | Must demultiplex on client; session ID overhead in every frame |

CADE multiplexes **up to two PTYs** (claude + manual) over a single WebSocket connection using the `sessionKey` field. This is a deliberate simplification: two terminals is the known upper bound, so the complexity of a generic channel mux protocol is not warranted.

### 4.2 Channel-Based Multiplexing

For systems needing many concurrent terminals (multiplayer SSH gateways, container orchestration UIs), a channel-based protocol is used:

```
WS frame: { channel: 1, type: "data", payload: "..." }
WS frame: { channel: 2, type: "resize", cols: 80, rows: 24 }
```

Protocol choice: [xterm's conpty-proxy](https://github.com/microsoft/node-pty) uses a simple JSON envelope. SSH.NET and similar use their own binary framing. Neither is a published standard — implementors design their own.

### 4.3 Session Resumption

Reconnection requires:

1. **Session ID persistence:** The frontend stores the session ID in tab localStorage
2. **PTY survival:** The registry keeps the PTY process alive between connections
3. **Scrollback replay:** The `session-restored` message carries the scrollback buffer

**Scrollback sanitization:** Terminal query sequences (DA1, CPR, DSR) must be stripped before replay, otherwise the client re-sends them and the PTY may respond unexpectedly. CADE's `TERMINAL_QUERY_PATTERN` regex strips:

- RIS sequences (`ESC c`)
- CSI DA/DSR/CPR/XTVERSION/DECRQM responses
- OSC color-query sequences (`ESC ] 10 ; ? BEL`)

## 5. Terminal Resize and Window Size Negotiation

### 5.1 Resize Flow

```
Client (xterm.js) detects window resize
    → Client sends: { type: "resize", cols: 120, rows: 40 }
        → Backend: pty.setwinsize(120, 40)  # Unix pexpect or winpty
            → PTY kernel: SIGWINCH to child process
                → Shell/editor re-reads window size
```

### 5.2 Initial Size

The terminal size must be set at spawn time. On Unix via pexpect:

```python
pexpect.spawn(command, cwd=str(cwd), dimensions=(rows, cols), ...)
```

On Windows via pywinpty:

```python
pty = PTY(cols, rows, backend)
pty.spawn(exe, cwd=cwd, cmdline=args)
```

**Note:** The dimension argument order differs: pexpect takes `(rows, cols)` while pywinpty takes `(cols, rows)`. CADE's `TerminalSize(cols, rows)` is normalized at the call site.

### 5.3 Debouncing

Rapid resize events (window drag) should be debounced on the client side before sending to the server. xterm.js emits resize events on every animation frame; sending all of them causes excessive PTY ioctl calls. A 100ms debounce is typical.

## 6. Security and Isolation

### 6.1 Process Isolation

PTY sessions are untrusted from the perspective of the host. Key mitigations:

| Concern | Mitigation |
|---------|------------|
| Resource exhaustion | Session cleanup (age limits), max output truncation (64KB per stream in CADE's bash tool) |
| Shell injection | `shlex.split()` for argument parsing; `bash_tool.py` classification (hard_deny / auto / prompt) |
| Path traversal | Project-relative path resolution; absolute paths rejected outside project scope |
| Credential access | `~/.ssh`, `~/.aws`, `~/.gnupg` patterns in hard-deny list |
| Download-and-exec | `curl ... \| bash` and `wget ... \| sh` patterns explicitly denied |

### 6.2 What Gets Logged / Transmitted

**Logged:** Debug logs (command classification decisions, PTY spawn success/failure, session lifecycle). Never logged: PTY output content, command arguments (even truncated).

**Transmitted over WebSocket:**

- Terminal I/O (input and output bytes)
- Scrollback buffer (up to 512KB per terminal in CADE)
- File content (via separate file protocol messages)
- Chat messages

**NOT transmitted:** Shell environment variables, process credentials, PTY file descriptors.

### 6.3 Network Security

- WebSocket connections should use TLS (WSS) in production
- Token-based authentication via query parameter or `Sec-WebSocket-Protocol` header
- Origin validation to prevent cross-site WebSocket hijacking
- CADE uses `validate_token()` on connection and per-message authorization checks

### 6.4 Comparison: VS Code, GitHub Codespaces, SSH3

**VS Code Remote / Codespaces:** Both tunnel terminal I/O through their own remoting protocol (based on msgpack-rpc over WebSocket or SPDY). The server is VS Code Server (Node.js process with a PTY for each terminal tab). Terminal resize is negotiated through the same RPC channel.

**SSH3** (Towards SSH3: HTTP/3 improves secure shells, arXiv:2312.08396): Proposes replacing SSH's binary channel protocol with HTTP/3 and WebSocket. Terminal I/O would become an HTTP stream (bidirectional with `CONNECT` method or WebSocket). This is experimental; no production adoption as of 2026.

**Key insight:** The terminal transport problem is largely solved. The architectural decisions are:
- Where to place the PTY (server-side process, container, or user machine)
- Whether to multiplex or use separate connections
- How to handle session resumption

## 7. Key Sources

1. **Building AI Coding Agents for the Terminal** (arXiv:2603.05344, 2026) — Survey of terminal-native AI agent architectures; covers PTY bridging and session management patterns.

2. **Towards SSH3: How HTTP/3 Improves Secure Shells** (arXiv:2312.08396, 2023) — Evaluates WebSocket/HTTP3 as SSH transport; relevant to WebSocket framing and multiplexing trade-offs.

3. **HTML5 WebSocket Protocol and Its Application to Distributed Computing** (Cranfield University, 2014) — Foundational analysis of WebSocket framing, heartbeat patterns, and connection lifecycle.

4. **A Systematic Taxonomy of Security Vulnerabilities in OpenClaw AI Agent Frameworks** (arXiv:2603.27517, 2026) — Security analysis of agent frameworks connecting LLMs to shell/filesystem; directly relevant to PTY isolation concerns.

5. **Session Types for the Transport Layer** (arXiv:2404.05478, 2024) — Formal treatment of protocol session types; applicable to terminal mux protocol design.

6. **node-pty** (microsoft/node-pty, GitHub) — The de facto standard PTY library for Node.js; xterm.js uses it in server-side implementations.

7. **pexpect** (pexpect/pexpect, GitHub) — Python PTY library used in CADE's Unix implementation.

8. **pywinpty** (pywinpty, PyPI) — Python bindings for Windows PTY (WinPTY and ConPTY).

9. **xterm.js** (xtermjs/xterm.js, GitHub) — Browser terminal emulator; its WebSocket integration pattern is the de facto standard.

10. **CADE backend implementation** (`backend/terminal/pty.py`, `backend/terminal/sessions.py`, `backend/websocket.py`) — Source of truth for the current implementation.

## See Also

- [[websocket-protocol]] — Full WebSocket message protocol reference for CADE
- `backend/terminal/pty.py` — PTY lifecycle (Unix and Windows implementations)
- `backend/terminal/sessions.py` — Session registry and scrollback management
- `backend/websocket.py` — WebSocket handler wiring PTY to protocol
- `backend/protocol.py` — Message type constants
- `docs/technical/reference/websocket-protocol.md` — Protocol message shapes
- [xterm.js documentation](https://xtermjs.org/) — Browser terminal emulator
- [node-pty GitHub](https://github.com/microsoft/node-pty) — Cross-platform PTY support for Node.js
- [RFC 6455](https://tools.ietf.org/html/rfc6455) — The WebSocket Protocol
