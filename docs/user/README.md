---
title: User Guide
created: 2026-01-16
updated: 2026-01-17
status: active
tags: [index, user, guide]
---

# User Guide

ccplus is a unified terminal environment for development with Claude Code. It provides a three-pane layout with file navigation, an integrated terminal, and a document viewer.

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

Session data is stored in `.ccplus/session.json` within your project directory.

## Keyboard Shortcuts

The terminal captures most keyboard input. Standard browser shortcuts work when the terminal is not focused.

## See Also

- [[../README|Documentation Hub]]
- [[../future/README|Roadmap]] - See what's planned
