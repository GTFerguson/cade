# CADE

**Claude Agentic Development Environment** - An agent-first development environment with Claude Code in a terminal shell as its centerpiece.

Available as both a **web application** and **native desktop application** (Windows, macOS, Linux).

## Desktop Application

CADE is now available as a native desktop application built with Tauri:

```bash
# Setup prerequisites and dependencies
make setup

# Start desktop app in dev mode
make dev-desktop

# Build desktop installers
make build-desktop
```

See [SETUP.md](SETUP.md) for detailed setup instructions or [desktop/QUICKSTART.md](desktop/QUICKSTART.md) for desktop-specific documentation.

## Quick Start (Web Version)

### Prerequisites

- Python 3.11+
- Node.js 18+
- npm

### Backend Setup

```bash
# Create and activate virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Or install as editable package
pip install -e .
```

### Frontend Setup

```bash
cd frontend
npm install
npm run build
cd ..
```

### Running

```bash
# Start the server (opens browser automatically)
python -m backend.main

# Or with options
python -m backend.main --port 8080 --dir /path/to/project --no-browser
```

### Development Mode

For frontend development with hot reload:

```bash
# Terminal 1: Start backend
python -m backend.main --no-browser

# Terminal 2: Start frontend dev server
cd frontend
npm run dev
```

Then open http://localhost:5173 (Vite dev server proxies WebSocket to backend).

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CADE_PORT` | 3000 | Server port |
| `CADE_HOST` | localhost | Server host |
| `CADE_WORKING_DIR` | cwd | Working directory |
| `CADE_SHELL_COMMAND` | claude | Shell command to run |
| `CADE_AUTO_OPEN_BROWSER` | true | Open browser on start |
| `CADE_DEBUG` | false | Enable debug mode |

### CLI Arguments

```
python -m backend.main --help

options:
  -p, --port PORT       Server port (default: 3000)
  -H, --host HOST       Server host (default: localhost)
  -d, --dir DIR         Working directory (default: current)
  -c, --command CMD     Shell command to run (default: claude)
  --no-browser          Don't open browser automatically
  --debug               Enable debug mode
```

## Project Structure

```
backend/
├── main.py                # FastAPI app, CLI entry point
├── config.py              # Configuration management
├── protocol.py            # WebSocket message types
├── auth.py                # Token auth + session cookies
├── websocket.py           # WebSocket handler
├── models.py              # Data models
├── middleware.py           # CORS setup
├── connection_registry.py # Multi-connection tracking
├── cc_session_resolver.py # Claude Code session discovery
├── files/                 # File operations
│   ├── tree.py            # File tree building
│   ├── watcher.py         # Filesystem watching
│   ├── operations.py      # Read/write/create
│   └── user_config.py     # User config files
├── terminal/              # PTY management
│   ├── pty.py, sessions.py, connections.py
├── hooks/                 # Claude Code hook integration
├── neovim/                # Neovim backend support
├── wsl/                   # WSL path translation & health
└── tests/

frontend/src/
├── main.ts                # App entry point
├── config/                # Config, themes, user preferences
├── platform/              # protocol.ts, websocket.ts, tauri-bridge.ts
├── terminal/              # xterm.js terminal + session manager
├── markdown/              # Markdown/code viewer + editor
├── file-tree/             # File tree component
├── tabs/                  # Tab management + project context
├── remote/                # Remote connection profiles, SSH
├── agents/                # Agent session management
├── input/                 # Keybinding system
├── ui/                    # Splash, layout, help, theme selector, mobile
├── neovim/                # Neovim pane
├── auth/                  # Token management
└── right-pane/            # Right pane manager

desktop/                   # Tauri 2.0 native wrapper (Windows, macOS, Linux)
scripts/                   # Build, deploy, and dev scripts
```

## WebSocket Protocol

The protocol is defined in `backend/protocol.py` (server) and `frontend/src/platform/protocol.ts` (client). All messages are JSON with a `type` field.

### Terminal

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `input` | C→S | `{ data, sessionKey? }` | Terminal input |
| `resize` | C→S | `{ cols, rows, sessionKey? }` | Terminal resize |
| `output` | S→C | `{ data, sessionKey? }` | Terminal output |
| `pty-exited` | S→C | `{ code, message, sessionKey? }` | PTY process exited |

### Files

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `get-tree` | C→S | `{}` | Request file tree |
| `get-file` | C→S | `{ path }` | Request file content |
| `write-file` | C→S | `{ path, content }` | Write file |
| `create-file` | C→S | `{ path, content? }` | Create new file |
| `get-children` | C→S | `{ path, showIgnored? }` | Request directory children |
| `browse-children` | C→S | `{ path }` | Browse absolute filesystem path |
| `file-tree` | S→C | `{ data: FileNode[] }` | File tree response |
| `file-children` | S→C | `{ path, children }` | Directory children response |
| `file-content` | S→C | `{ path, content, fileType }` | File content |
| `file-written` | S→C | `{ path }` | Write confirmation |
| `file-created` | S→C | `{ path }` | Create confirmation |
| `file-change` | S→C | `{ event, path }` | Filesystem change notification |
| `view-file` | S→C | `{ path, content, fileType, isPlan? }` | External view request (e.g. plan overlay) |

### Session

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `connected` | S→C | `{ workingDir }` | Connection established |
| `set-project` | C→S | `{ path, sessionId? }` | Set project directory |
| `save-session` | C→S | `{ state }` | Persist session state |
| `session-restored` | S→C | `{ sessionId, scrollback }` | Session reattached after reconnect |
| `startup-status` | S→C | `{ message }` | Startup progress indicator |
| `get-latest-plan` | C→S | `{}` | Request most recent plan file |

### Neovim

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `neovim-spawn` | C→S | `{ sessionId }` | Spawn Neovim instance |
| `neovim-kill` | C→S | `{ sessionId }` | Terminate Neovim |
| `neovim-input` | C→S | `{ data }` | Terminal input to Neovim |
| `neovim-resize` | C→S | `{ cols, rows }` | Resize Neovim terminal |
| `neovim-rpc` | C→S | `{ method, args, requestId }` | RPC command |
| `neovim-ready` | S→C | `{ pid }` | Neovim running |
| `neovim-output` | S→C | `{ data }` | Terminal output from Neovim |
| `neovim-rpc-response` | S→C | `{ requestId, result?, error? }` | RPC response |
| `neovim-exited` | S→C | `{ exitCode }` | Neovim exited |

### Errors

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `error` | S→C | `{ code, message }` | Error response |

Error codes: `pty-spawn-failed`, `pty-read-failed`, `pty-write-failed`, `file-not-found`, `file-read-failed`, `file-write-failed`, `file-create-failed`, `file-exists`, `invalid-path`, `invalid-message`, `pty-exited`, `internal-error`, `neovim-spawn-failed`, `neovim-not-found`, `neovim-rpc-failed`

## License

MIT
