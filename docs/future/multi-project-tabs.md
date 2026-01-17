---
title: Multi-Project Tabs Feature
created: 2026-01-17
updated: 2026-01-17
status: planned
tags: [feature, tabs, multi-project]
---

# Multi-Project Tabs Feature

Enable multiple projects to be open as tabs, similar to tmux windows.

## Concept

Each tab represents an independent project with its own terminal session, file tree, and viewer state.

## User Experience

### Tab Bar

A tab bar at the top of the interface displays open projects:

```
┌─────────────────────────────────────────────────────────────────┐
│ [ccplus] [website] [api-server] [+]                             │
├─────────────────────────────────────────────────────────────────┤
│  FileTree  │      Terminal       │       Viewer                 │
│            │                     │                              │
```

**Tab Elements:**

- Project name (directory name by default)
- Close button on hover
- Visual indicator for active tab
- New tab button (+)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+1-9` | Jump to tab by position |
| `Ctrl+W` | Close current tab |
| `Ctrl+T` | New tab (open project) |

### Tab Independence

Each tab maintains completely isolated state:

| Component | Isolation Level |
|-----------|----------------|
| Terminal | Separate PTY process |
| File Tree | Independent directory root |
| Viewer | Separate viewed file |
| Layout | Independent pane proportions |

## Session Persistence

### `.ccplus/` Directory

Each project directory can contain a `.ccplus/` folder for session state:

```
project-root/
├── .ccplus/
│   ├── session.json       # Session metadata
│   ├── layout.json        # Pane proportions
│   └── history/           # Terminal scroll-back (optional)
└── ... (project files)
```

**session.json example:**

```json
{
  "name": "ccplus",
  "lastOpened": "2026-01-17T10:30:00Z",
  "viewerPath": "docs/README.md",
  "expandedFolders": ["src", "docs", "docs/technical"]
}
```

### Pause/Resume Workflow

1. **Session Pause:**
   - Save terminal scroll-back
   - Save viewer position
   - Save file tree expansion state
   - Record last active file

2. **Session Resume:**
   - Restore pane layout
   - Reopen viewer to last file
   - Restore file tree state
   - Optionally restore terminal history

## Implementation Considerations

### Server Architecture

**Option A: Single server, multiple PTYs**

- One ccplus server manages all project tabs
- Each tab spawns its own PTY in the target directory
- Simpler client code, complex server

**Option B: Multiple servers**

- Each tab connects to a separate ccplus server
- Server started on demand per project
- More process overhead, simpler isolation

### Mobile Considerations

- Tab bar could be a swipeable carousel
- Or a hamburger menu listing projects
- Consider screen real estate carefully

## Open Questions

1. **Default behavior:** Should ccplus start with a single tab, or prompt to open a project?
2. **Cross-project features:** Should search or other features work across all open projects?
3. **Resource limits:** Maximum number of open tabs? Memory management?
4. **Tab naming:** Auto-detect project name from package.json, Cargo.toml, etc.?

## See Also

- [[claude-code-hooks-integration]] - Claude Code integration
- [[README]] - Roadmap overview
