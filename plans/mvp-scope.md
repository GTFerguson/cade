---
title: MVP Scope
created: 2026-01-16
updated: 2026-01-17
status: active
tags: [mvp, scope, planning]
---

# MVP Scope

Defines what's in and out of scope for the minimum viable product.

## Core Problem We're Solving

**Limited visibility when working with Claude Code in a terminal.**

- Can't see what files Claude is creating/modifying
- No visual file tree
- Hard to follow along as Claude works
- Manual context switching to check on changes

**ccplus gives both user and Claude better visibility into the work.**

## Goal

A working local web app where you can:
1. Run Claude Code in an embedded terminal
2. See Claude's markdown output rendered beautifully in real-time
3. **See the file tree and watch it update as Claude creates/modifies files**
4. Open files to view content
5. Have everything visible simultaneously

## User Flow

```
$ ccplus
  → Local server starts (Bun)
  → Browser opens to localhost:3000
  → Three-pane layout:
      [File Tree] [Terminal (Claude Code)] [Markdown Viewer]
  → User types in terminal, Claude responds
  → File tree updates as files are created/modified
  → Markdown pane renders Claude's output in real-time
  → Click file in tree → opens in viewer
```

## In Scope (MVP)

### Core Features

| Feature | Description | Priority | Status |
|---------|-------------|----------|--------|
| Embedded terminal | xterm.js running Claude Code | P0 | ✓ Done |
| File tree | See project structure, watch for changes | P0 | ✓ Done |
| Markdown rendering | mertex.md with wiki-links | P0 | ✓ Done |
| Multi-pane layout | File tree + terminal + markdown | P0 | ✓ Done |
| Auto-launch | `ccplus` command opens browser | P0 | Partial (manual) |
| File viewer | Click file → see contents | P1 | ✓ Done |
| Basic styling | Clean, readable dark theme | P1 | ✓ Done |
| Resize panes | Drag dividers to resize | P1 | ✓ Done |
| File change highlighting | Visual indicator when files change | P1 | ✓ Done |
| **Multi-project tabs** | Multiple projects open as tabs | Bonus | ✓ Done |
| **Session persistence** | UI state survives refresh | Bonus | ✓ Done |
| **Mobile support** | Responsive layout + slide-out viewer | Bonus | ✓ Done |

### Terminal Pane

**A real terminal, not Claude-only.**

- xterm.js with proper PTY connection
- Full terminal emulation (colors, cursor, etc.)
- Spawns user's shell (bash/zsh/pwsh) with Claude Code started by default
- Can exit Claude and use terminal normally (git, npm, etc.)
- Can restart Claude with `claude` command
- Full shell capabilities - it's your terminal

**Default behavior:**
```
$ ccplus
  → Terminal opens with Claude Code running
  → Exit Claude (Ctrl+C or /exit) → drops to shell
  → Run git status, npm install, whatever
  → Type `claude` → back to Claude Code
```

### Markdown Pane

**Core insight:** Don't parse terminal output. Watch files instead.

When Claude enters plan mode, it writes to `.claude/plans/`. The markdown viewer:
- Watches the active plan file for changes
- Re-renders as Claude writes (file watcher triggers update)
- Streams updates in real-time

**General markdown viewer features:**
- Uses mertex.md for rendering
- Opens any `.md` file from file tree
- Wiki-link navigation (`[[other-doc]]` → click to open)
- Syntax highlighting for code blocks
- Tables, headers, lists render properly
- KaTeX math rendering
- Mermaid diagram rendering
- Auto-refresh on file change

**Obsidian-like experience:**
- File tree for navigation
- Wiki-links work
- Renders markdown beautifully
- All in one tool

### File Tree Pane

- Shows project directory structure
- Watches filesystem for changes (chokidar or native)
- Updates in real-time as files are created/modified/deleted
- Visual indicators for recently changed files
- Click file → opens in viewer/editor pane
- Collapsible folders
- Respects .gitignore (hide node_modules, etc.)

### File Viewer

- Read-only view of file contents
- Syntax highlighting (via highlight.js or similar)
- Opens when clicking file in tree
- Could replace markdown pane or open in new pane

### Layout

**MVP: Three fixed panes**
```
┌────────────┬─────────────────────┬───────────────────────┐
│ File Tree  │     Terminal        │      Viewer           │
│   (20%)    │      (40%)          │      (40%)            │
│            │                     │  (content switches)   │
└────────────┴─────────────────────┴───────────────────────┘
```

- File tree (narrow, ~20%) | Terminal (~40%) | Viewer (~40%)
- Resizable via drag handles
- Viewer pane shows ONE thing at a time (file or markdown)
- Click file in tree → viewer switches to that file
- Multiple panes/tabs/splits → TMUX phase (not MVP)

## Out of Scope (MVP)

Future features not in MVP:

| Feature | Status | Notes |
|---------|--------|-------|
| ~~Tabs/workspaces~~ | ✓ Done | Implemented with multi-project tabs |
| ~~Session persistence~~ | ✓ Done | Per-project `.ccplus/session.json` |
| Editor integration | Deferred | Terminal is enough for MVP |
| Vim keybindings | Deferred | Depends on editor integration |
| Configuration file | Deferred | Hardcode sensible defaults first |
| Tauri desktop wrapper | Phase 2 | |
| Pure terminal mode | Phase 3 | |
| nkrdn integration | Long-term | |
| Obsidian/Notion sync | Long-term | |

## Technical Requirements

### Backend (Bun)

- Serve static frontend files
- WebSocket server for terminal PTY
- Spawn child process (Claude Code)
- Stream stdout to frontend
- Handle stdin from frontend

### Frontend (TypeScript)

- xterm.js terminal component
- mertex.md markdown renderer
- Split pane layout (CSS grid or flexbox)
- WebSocket connection to backend
- Parse terminal output for markdown extraction

### Markdown Source (Simplified)

**Decision:** Watch files, don't parse terminal output.

Claude Code writes plans to `.claude/plans/`. We simply:
1. Watch that directory for file changes
2. When a file changes, re-read and re-render
3. No terminal parsing needed for MVP

This also enables general markdown viewing - any `.md` file can be opened and viewed.

## Success Criteria

MVP is complete when:

- [ ] `ccplus` command starts server and opens browser
- [x] Terminal pane shows Claude Code running
- [x] Can type prompts and see Claude respond
- [x] Markdown pane renders files in real-time
- [x] Code blocks have syntax highlighting
- [x] Tables render as actual tables
- [x] Panes can be resized
- [x] Wiki-links work for navigation
- [x] File tree updates on file changes
- [x] Multiple projects can be open as tabs

## Resolved Questions

| Question | Answer |
|----------|--------|
| Markdown extraction | Watch files, don't parse terminal. Claude writes to `.claude/plans/` |
| Which content to show | Plan files primarily; any `.md` file via file tree |
| File viewer vs markdown pane | **Single viewer pane** - content switches based on file clicked. `.md` → rendered markdown, other files → syntax-highlighted view |
| Multiple panes/tabs | Deferred to TMUX phase. MVP has one viewer pane that switches. |

## Open Questions (Minor - decide during build)

| Question | Likely Answer |
|----------|---------------|
| Scroll behavior | Smart scroll: auto if at bottom, else maintain position |
| Working directory | Default cwd, `--dir` flag to override |
| Port | Default 3000, auto-increment if busy |
| Shell | Detect user's default shell, start with `claude` command |

## Dependencies

### Backend (Python)
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `watchfiles` - File watching
- `pexpect` / `pywinpty` - PTY management

### Frontend (TypeScript)
- `xterm` + addons - Terminal emulator
- `mertex.md` - Markdown rendering
- `highlight.js` - Syntax highlighting
- `vite` - Bundler

## File Structure (Proposed)

```
ccplus/
├── backend/                  # FastAPI Python backend
│   ├── main.py               # Entry point
│   ├── pty_manager.py        # PTY management
│   ├── websocket.py          # WebSocket handlers
│   ├── file_watcher.py       # File watching
│   └── file_tree.py          # File tree building
│
├── frontend/                 # TypeScript frontend
│   ├── index.html
│   ├── src/
│   │   ├── main.ts           # Entry point
│   │   ├── terminal.ts       # xterm.js wrapper
│   │   ├── markdown.ts       # mertex.md integration
│   │   ├── file-tree.ts      # File tree UI
│   │   └── layout.ts         # Pane management
│   └── package.json
│
├── pyproject.toml            # Python config
└── README.md
```

## Next Steps

1. ~~Scaffold project structure~~ ✓
2. ~~Get FastAPI + WebSocket working~~ ✓
3. ~~Get xterm.js + PTY working~~ ✓
4. ~~Add file watcher + tree~~ ✓
5. ~~Integrate mertex.md~~ ✓
6. ~~Build three-pane layout~~ ✓
7. ~~Add multi-project tabs~~ ✓
8. Add `ccplus` CLI command for auto-launch
9. Package for distribution
