---
title: User Guide
created: 2026-01-16
updated: 2026-01-17
status: active
tags: [index, user, guide]
---

# User Guide

CADE (Claude Agentic Development Environment) is an agent-first development environment with Claude Code in a terminal shell as its centerpiece. It provides a three-pane layout with file navigation, an integrated terminal, and a document viewer.

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
- **Switch tabs**: Click on a tab
- **Close tab**: Hover over a tab and click the `×` button

Tab state persists in your browser's localStorage.

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

CADE integrates with Claude Code through hooks that automatically display files in the viewer.

### Plan Viewer Hook

Automatically display plan files when Claude creates or edits them:

```bash
python -m backend.main setup-hook
```

This configures a PostToolUse hook that sends plan file edits to the markdown viewer. See [[plan-viewer|Plan Viewer Hook]] for setup options and troubleshooting.

## See Also

- [[../README|Documentation Hub]]
- [[../future/README|Roadmap]] - See what's planned
