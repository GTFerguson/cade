---
title: Architecture Specification
created: 2026-01-16
updated: 2026-01-16
status: active
tags: [architecture, technical, spec]
---

# Architecture Specification

Technical architecture for ccplus MVP.

## Tech Stack

**Hybrid: FastAPI (Python) backend + TypeScript frontend**

| Layer | Technology | Why |
|-------|------------|-----|
| Backend Runtime | **Python 3.11+** | Familiar, portable, nkrdn-compatible |
| Backend Framework | **FastAPI** | Async, WebSocket support, fast |
| PTY | **pexpect** or **pty** module | Spawn real terminal processes |
| File Watching | **watchfiles** | Async-native, efficient |
| Frontend | **TypeScript** | Type safety, tooling |
| Terminal UI | **xterm.js** | Industry standard |
| Markdown | **mertex.md** | Your library, KaTeX + Mermaid |
| Bundler | **Vite** | Fast, simple |
| Communication | **WebSocket** | Real-time, bidirectional |

## Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser                                          │
│  ┌────────────┐  ┌─────────────────────────┐  ┌───────────────────────────┐  │
│  │ File Tree  │  │     Terminal Pane       │  │     Markdown Pane         │  │
│  │            │  │     (xterm.js)          │  │     (mertex.md)           │  │
│  │ 📁 src/    │  │                         │  │                           │  │
│  │  📄 app.ts │  │  ┌───────────────────┐  │  │  ┌─────────────────────┐  │  │
│  │  📄 cli.ts │  │  │ Claude Code CLI   │  │  │  │ Rendered markdown   │  │  │
│  │ 📁 docs/   │  │  │                   │  │  │  │ - Code highlighting │  │  │
│  │  📄 *.md   │  │  │ > help me with... │  │  │  │ - KaTeX math        │  │  │
│  │            │  │  └───────────────────┘  │  │  │ - Mermaid diagrams  │  │  │
│  │ [watches]  │  │                         │  │  └─────────────────────┘  │  │
│  └────────────┘  └─────────────────────────┘  └───────────────────────────┘  │
│        │                     │                              │                 │
└────────┼─────────────────────┼──────────────────────────────┼─────────────────┘
         │                     │ WebSocket                    │
         │                     ▼                              │
┌────────┼────────────────────────────────────────────────────┼─────────────────┐
│        │              Bun Server                            │                 │
│        ▼                                                    │                 │
│  ┌───────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┴────────┐       │
│  │ File      │  │ Static      │  │  WebSocket  │  │      PTY        │       │
│  │ Watcher   │  │ Server      │  │  Handler    │  │    Manager      │       │
│  └───────────┘  └─────────────┘  └─────────────┘  └─────────────────┘       │
│        │                                                    │                 │
└────────┼────────────────────────────────────────────────────┼─────────────────┘
         │ (fs events)                                        │
         ▼                                                    ▼
    ┌──────────┐                                     ┌───────────────┐
    │ Project  │                                     │  Claude Code  │
    │  Files   │                                     │   (spawned)   │
    └──────────┘                                     └───────────────┘
```

## Components

### Backend (Bun Server)

#### Entry Point (`src/server/index.ts`)

```typescript
// Responsibilities:
// - Start HTTP server
// - Serve static files from client build
// - Initialize WebSocket server
// - Open browser on startup
```

#### PTY Manager (`src/server/pty.ts`)

```typescript
// Responsibilities:
// - Spawn Claude Code (or shell) in PTY
// - Handle stdin from WebSocket
// - Stream stdout to WebSocket
// - Handle resize events
// - Clean up on disconnect
```

#### WebSocket Handler (`src/server/websocket.ts`)

```typescript
// Message types:
interface WSMessage {
  type: 'input' | 'resize' | 'markdown' | 'file-tree' | 'file-content';
  payload: unknown;
}

// Responsibilities:
// - Route messages between client and PTY
// - Parse terminal output for markdown
// - Broadcast to markdown pane
// - Send file tree updates
// - Serve file contents on request
```

#### File Watcher (`src/server/file-watcher.ts`)

```typescript
// Responsibilities:
// - Watch project directory for changes
// - Respect .gitignore patterns
// - Emit events: file added, modified, deleted
// - Debounce rapid changes
// - Send updates via WebSocket
```

### Frontend (Browser)

#### Terminal Component (`src/client/terminal.ts`)

```typescript
// Responsibilities:
// - Initialize xterm.js
// - Connect to WebSocket
// - Handle user input → send to server
// - Receive output → render in terminal
// - Handle resize → notify server
```

#### Markdown Component (`src/client/markdown.ts`)

```typescript
// Responsibilities:
// - Initialize mertex.md renderer
// - Receive markdown updates from WebSocket
// - Stream render as content arrives
// - Handle scroll behavior
```

#### File Tree Component (`src/client/file-tree.ts`)

```typescript
// Responsibilities:
// - Render file tree from server data
// - Handle expand/collapse folders
// - Show file change indicators (recently modified)
// - Emit click events → open file in viewer
// - Update in real-time as files change
```

#### File Viewer Component (`src/client/file-viewer.ts`)

```typescript
// Responsibilities:
// - Request file content from server
// - Render with syntax highlighting
// - Handle different file types
// - Could replace markdown pane or be separate
```

#### Layout Manager (`src/client/layout.ts`)

```typescript
// Responsibilities:
// - Create three-pane layout (file tree | terminal | markdown)
// - Handle resize drag on dividers
// - Maintain pane proportions
// - Keyboard shortcuts for navigation between panes
// - Support swapping pane contents (e.g., file viewer replaces markdown)
```

## Data Flow

### User Input Flow

```
User types in terminal
        │
        ▼
xterm.js captures keystroke
        │
        ▼
WebSocket sends: { type: 'input', payload: 'a' }
        │
        ▼
Server writes to PTY stdin
        │
        ▼
Claude Code receives input
```

### Output Flow

```
Claude Code writes to stdout
        │
        ▼
PTY captures output
        │
        ▼
Server processes:
├── Send raw output to terminal: { type: 'output', payload: '...' }
└── Extract markdown, send to viewer: { type: 'markdown', payload: '...' }
        │
        ├─────────────────┐
        ▼                 ▼
Terminal renders    Markdown pane renders
(xterm.js)          (mertex.md)
```

## Markdown Strategy (Simplified)

### Decision: Watch Files, Not Terminal

Instead of parsing terminal output, we watch the filesystem:

```
Claude enters plan mode
        │
        ▼
Writes/updates .claude/plans/plan-name.md
        │
        ▼
File watcher detects change
        │
        ▼
Server reads file, sends to client
        │
        ▼
Markdown pane re-renders with mertex.md
```

### Benefits

- No complex terminal parsing
- Works with any markdown file, not just Claude output
- Obsidian-like experience (navigate, wiki-links)
- Simpler architecture

### File Watcher Behavior

- Watch project directory recursively
- On `.md` file change: notify client if file is currently viewed
- On any file change: update file tree
- Debounce rapid changes (Claude may write in chunks)

## WebSocket Protocol

### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `input` | `string` | Keyboard input for PTY |
| `resize` | `{ cols, rows }` | Terminal resize event |
| `get-file` | `{ path: string }` | Request file contents |
| `get-tree` | `{}` | Request full file tree |

### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `output` | `string` | Raw terminal output |
| `markdown` | `string` | Extracted markdown content |
| `file-tree` | `FileNode[]` | Full or partial file tree |
| `file-change` | `{ type, path }` | File added/modified/deleted |
| `file-content` | `{ path, content }` | Requested file contents |

### File Tree Types

```typescript
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  modified?: number;  // timestamp, for change highlighting
}
```

## File Structure

```
ccplus/
├── backend/                      # FastAPI Python backend
│   ├── __init__.py
│   ├── main.py                   # FastAPI app entry, static serving
│   ├── pty_manager.py            # PTY spawning and management
│   ├── websocket.py              # WebSocket handlers
│   ├── file_watcher.py           # Filesystem watching + notifications
│   ├── file_tree.py              # Build file tree, read files
│   └── requirements.txt          # Python dependencies
│
├── frontend/                     # TypeScript frontend
│   ├── index.html                # Main HTML shell
│   ├── src/
│   │   ├── main.ts               # Client entry point
│   │   ├── terminal.ts           # xterm.js wrapper
│   │   ├── markdown.ts           # mertex.md integration, wiki-links
│   │   ├── file-tree.ts          # File tree UI component
│   │   ├── layout.ts             # Three-pane management
│   │   ├── websocket.ts          # WebSocket client
│   │   └── types.ts              # TypeScript types
│   ├── styles/
│   │   └── main.css              # Styling (dark theme)
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── pyproject.toml                # Python project config (or setup.py)
├── README.md
│
├── docs/                         # Maintained docs (approval required)
├── plans/                        # Active planning
└── .roo/rules/                   # Project conventions
```

## Dependencies

### Backend (Python)

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server |
| `websockets` | WebSocket support |
| `watchfiles` | Async file watching |
| `pexpect` | PTY management (Unix) |
| `pywinpty` | PTY management (Windows) |

### Frontend (TypeScript)

| Package | Purpose |
|---------|---------|
| `xterm` | Terminal emulator |
| `xterm-addon-fit` | Auto-resize terminal |
| `xterm-addon-web-links` | Clickable links |
| `mertex.md` | Markdown rendering |
| `highlight.js` | Syntax highlighting |

### Development

| Package | Purpose |
|---------|---------|
| `typescript` | Type safety |
| `vite` | Bundler + dev server |

## Configuration (Future)

For MVP, hardcode defaults. Future config structure:

```toml
# ~/.config/ccplus/config.toml

[general]
theme = "dark"
open_browser = true

[terminal]
shell = "claude"  # or "bash", "zsh", etc.
font_size = 14

[layout]
default_split = "horizontal"  # or "vertical"
split_ratio = 0.5

[markdown]
katex = true
mermaid = true
syntax_theme = "github-dark"
```

## Security Considerations

- Server binds to `localhost` only (no remote access by default)
- PTY runs with user's permissions
- No authentication for MVP (single user, local machine)
- Future: optional auth for remote/EC2 usage

## Performance Considerations

- WebSocket for low-latency communication
- Streaming markdown render (don't wait for complete response)
- Debounce resize events
- Virtual scrolling for long outputs (future)

## Testing Strategy

See [[testing-conventions-brainstorm]] for detailed approach.

For MVP:
- Manual testing primary
- Unit tests for markdown extraction logic
- Integration test: spawn, send input, verify output
