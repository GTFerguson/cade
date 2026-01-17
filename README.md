# ccplus

Unified terminal environment combining tmux, vim, and Claude Code into a cohesive development experience.

## Quick Start

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
| `CCPLUS_PORT` | 3000 | Server port |
| `CCPLUS_HOST` | localhost | Server host |
| `CCPLUS_WORKING_DIR` | cwd | Working directory |
| `CCPLUS_SHELL_COMMAND` | claude | Shell command to run |
| `CCPLUS_AUTO_OPEN_BROWSER` | true | Open browser on start |
| `CCPLUS_DEBUG` | false | Enable debug mode |

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
ccplus/
├── backend/
│   ├── __init__.py       # Package init
│   ├── main.py           # Entry point, FastAPI app
│   ├── config.py         # Configuration management
│   ├── protocol.py       # WebSocket message types
│   ├── types.py          # Data types (FileNode, etc.)
│   ├── errors.py         # Custom exceptions
│   ├── pty_manager.py    # PTY lifecycle (cross-platform)
│   ├── websocket.py      # WebSocket handlers
│   ├── file_watcher.py   # File system watching
│   └── file_tree.py      # Tree building and file reading
│
├── frontend/
│   ├── index.html        # Main HTML
│   ├── src/
│   │   ├── main.ts       # Entry point
│   │   ├── config.ts     # Client config
│   │   ├── protocol.ts   # Message types (mirrors backend)
│   │   ├── types.ts      # TypeScript interfaces
│   │   ├── websocket.ts  # WebSocket client
│   │   ├── terminal.ts   # xterm.js wrapper
│   │   ├── markdown.ts   # Markdown/code viewer
│   │   ├── file-tree.ts  # File tree component
│   │   └── layout.ts     # Three-pane layout
│   ├── styles/
│   │   └── main.css      # Dark theme styles
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── pyproject.toml        # Python project config
├── requirements.txt      # Python dependencies
└── README.md             # This file
```

## WebSocket Protocol

### Client -> Server

| Type | Payload | Description |
|------|---------|-------------|
| `input` | `{ data: string }` | Terminal input |
| `resize` | `{ cols: number, rows: number }` | Terminal resize |
| `get-tree` | `{}` | Request file tree |
| `get-file` | `{ path: string }` | Request file content |

### Server -> Client

| Type | Payload | Description |
|------|---------|-------------|
| `connected` | `{ workingDir: string }` | Connection established |
| `output` | `{ data: string }` | Terminal output |
| `file-tree` | `{ data: FileNode[] }` | File tree response |
| `file-content` | `{ path, content, fileType }` | File content |
| `file-change` | `{ event, path }` | File changed |
| `error` | `{ code, message }` | Error message |

## License

MIT
