---
title: User Guide
created: 2026-01-16
updated: 2026-02-02
status: active
tags: [index, user, guide]
---

# User Guide

CADE (Claude Agentic Development Environment) is an agent-first development environment built around Claude Code. The interface inherits its aesthetic and workflow philosophy from terminal tools (tmux, vim) while extending beyond terminal constraints with structured chat rendering, mode-based workflows, and multi-agent orchestration. It provides a three-pane layout with file navigation, a terminal or structured chat pane, and a document viewer.

## Access Methods

CADE can be accessed from multiple platforms:

| Platform | How | Best For |
|----------|-----|----------|
| **Desktop App** | Native Tauri application | Primary development |
| **Web Browser** | Connect to a remote CADE backend | Access from any machine |
| **Mobile** | Responsive mobile interface | Monitoring, quick tasks, viewing docs |

All platforms connect to the same backend and share the same terminal session, enabling multi-device workflows. See [[remote-connections|Remote Connections]] for remote setup.

## Interface Overview

The interface is divided into three panes:

| Pane | Purpose |
|------|---------|
| File Tree (left) | Navigate your project's files and folders |
| Terminal (center) | Interactive terminal with your shell or Claude Code |
| Viewer (right) | View markdown files and code with syntax highlighting |

Panes are resizable by dragging the handles between them.

## Project Tabs

Open multiple projects simultaneously using tabs. Each tab maintains:

- Its own terminal session (persists across page refreshes)
- Independent file tree state
- Separate viewer content

### Managing Tabs

- **Add tab**: Click the `+` button and enter a project path
- **Add remote tab**: `Shift+click` the `+` button or `Ctrl-a` + `Shift+C`
- **Switch tabs**: Click on a tab
- **Close tab**: Hover over a tab and click the `×` button

Tab state persists in your browser's localStorage. See [[remote-connections|Remote Connections]] for connecting to remote backends.

## File Tree

The left pane shows your project's directory structure.

- **Expand/collapse folders**: Click on folder names
- **View files**: Click on a file to open it in the viewer
- **Recent changes**: Recently modified files briefly highlight

The file tree automatically updates when files change on disk.

## Terminal

The center pane is a full terminal emulator powered by xterm.js.

### Features

- Full ANSI color support
- Clickable URLs
- Copy/paste support
- Automatic resize to fit the pane

### Session Persistence

Your terminal session persists across page refreshes:

- The PTY process stays alive when you reload
- Output history (scrollback) is restored
- Works with both shell sessions and Claude Code

## Document Viewer

The right pane displays file content with syntax highlighting.

### Supported Content

- **Markdown**: Rendered with formatting, code blocks, and wiki-links
- **Code files**: Syntax highlighted based on file extension
- **Other text**: Displayed as plain text

### Wiki-Links

The viewer supports Obsidian-style wiki-links for navigation:

| Syntax | Description |
|--------|-------------|
| `[[filename]]` | Link to file (`.md` added automatically) |
| `[[path/to/file]]` | Link with path |
| `[[file\|Display Text]]` | Link with custom display text |
| `[[folder/]]` | Link to folder's README.md |

Click wiki-links to navigate between documents.

## Session Persistence

Your workspace state is automatically saved and restored:

- **Expanded folders**: The file tree remembers which folders you had open
- **Current file**: The file you were viewing is restored
- **Pane sizes**: Your layout proportions are preserved
- **Terminal session**: Your shell/Claude session continues where you left off

Session data is stored in `.CADE/session.json` within your project directory.

## Keyboard Navigation

CADE uses a tmux-style prefix key system combined with vim-style navigation. The terminal receives all keystrokes except the prefix key (`Ctrl+a`), which activates global shortcuts.

### Quick Reference

| Context | Common Keys |
|---------|-------------|
| Global (after `Ctrl+a`) | `h`/`l` focus pane, `t`/`r` switch tabs, `?` help |
| File Tree | `j`/`k` move, `h`/`l` collapse/expand, `/` search |
| Viewer | `j`/`k` scroll, `Enter` follow link |

See [[keybindings|Keyboard Navigation Guide]] for complete documentation including workflow examples and customization.

## Configuration

CADE can be customized through TOML configuration files:

- **appearance.toml** - Colors, fonts, terminal settings
- **keybindings.toml** - Keyboard shortcuts and prefix key
- **behavior.toml** - Session, file tree, and layout defaults

See [[configuration|Configuration Guide]] for details.

## Claude Code Integration

CADE integrates with Claude Code in two ways:

### Enhanced CC Mode

The primary workflow runs Claude Code as a subprocess with structured output rendering in a ChatPane instead of a raw terminal. This provides:

- **Markdown rendering** — responses rendered with syntax-highlighted code blocks, tables, and math via mertex.md
- **Tool-use blocks** — inline indicators showing tool name and status (`▸` running, `✓` done, `✗` failed)
- **Thinking blocks** — collapsible sections that auto-collapse when complete
- **Streaming** — real-time token-by-token output
- **Session continuity** — multi-turn conversations maintained via `--resume`

### Mode Switching

Switch Claude Code's behavior with slash commands:

| Command | Mode | Description |
|---------|------|-------------|
| `/code` | Code | Full tool access — implement changes |
| `/plan` | Architect | Read-only — explore, analyze, plan |
| `/review` | Review | Read-only — review code for issues |
| `/orch` | Orchestrator | Spawn and coordinate worker agents |

The current mode is shown in the chat statusline.

### Orchestrator Mode

In orchestrator mode, Claude Code can spawn worker agents that run as independent subprocesses, each in their own tab. The workflow:

1. Orchestrator proposes an agent — an inline approval block appears in chat
2. You approve or reject the spawn
3. On approval, the agent's tab opens and you can watch it work
4. When the agent finishes, a report approval block appears in the agent's tab
5. You approve or reject the report — the result returns to the orchestrator

### Plan Viewer Hook

Automatically display plan files when Claude creates or edits them:

```bash
python -m backend.main setup-hook
```

This configures a PostToolUse hook that sends plan file edits to the markdown viewer. See [[plan-viewer|Plan Viewer Hook]] for setup options and troubleshooting.

## Mobile Interface

On phones and tablets, CADE switches to a full-screen terminal with a touch toolbar at the bottom, a file explorer in a slideout panel, and a document viewer for reading files on the go.

See [[mobile-guide|Mobile Guide]] for full details on using the mobile interface.

## See Also

- [[../README|Documentation Hub]]
- [[../future/README|Roadmap]] - See what's planned
- [[mobile-guide|Mobile Guide]] - Using CADE on phones and tablets
