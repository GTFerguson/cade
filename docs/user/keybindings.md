---
title: Keyboard Navigation Guide
created: 2026-01-18
updated: 2026-01-19
status: active
tags: [user, keybindings, navigation, vim, tmux]
---

# Keyboard Navigation Guide

ccplus is designed for keyboard-driven workflows. The keybinding system combines two philosophies:

- **tmux-style prefix keys** for global commands (switch tabs, resize panes)
- **vim-style modal navigation** for pane-specific actions (navigate files, search)

## Design Philosophy

### Why Prefix Keys?

The terminal is the center of your workflow. You need full keyboard access to your shell, editors, and Claude Code. A prefix key (`Ctrl+a`) creates a clear boundary: everything *after* the prefix is for ccplus, everything else goes to your terminal.

This is the same approach tmux uses, and for good reason—it stays out of your way until you need it.

### Why Vim Navigation?

When you're in the file tree or viewer, you're not typing commands—you're navigating. Vim-style keys (h/j/k/l) let you move quickly without reaching for arrow keys. If you use vim or vim-mode in your editor, these bindings feel natural. If you don't, they're worth learning—your hands stay on home row.

### The Three Contexts

Your keyboard does different things depending on where you are:

| Context | How keys work |
|---------|---------------|
| **Terminal focused** | All keys go to your shell/Claude (except prefix) |
| **File tree focused** | Vim navigation, search with `/` |
| **Viewer focused** | Scroll, follow links |

The prefix key (`Ctrl+a`) works everywhere—it's your escape hatch to ccplus commands.

## Global Shortcuts (Prefix Mode)

Press `Ctrl+a` to enter prefix mode. You have 2 seconds to press the next key.

### Pane Navigation

Move focus between the three panes.

| Shortcut | Action |
|----------|--------|
| `Ctrl+a` then `h` | Focus pane to the left |
| `Ctrl+a` then `l` | Focus pane to the right |
| `Ctrl+a` then `f` | Focus pane to the left (alias) |
| `Ctrl+a` then `g` | Focus pane to the right (alias) |
| `Ctrl+a` then `←` | Focus pane to the left (arrow) |
| `Ctrl+a` then `→` | Focus pane to the right (arrow) |

### Pane Resizing

Adjust the boundaries between panes.

| Shortcut | Action |
|----------|--------|
| `Ctrl+a` then `Ctrl+h` | Move divider left (shrink left pane) |
| `Ctrl+a` then `Ctrl+l` | Move divider right (shrink right pane) |

### Tab Management

Switch between project tabs.

| Shortcut | Action |
|----------|--------|
| `Ctrl+a` then `t` | Next tab |
| `Ctrl+a` then `r` | Previous tab |
| `Ctrl+a` then `0-9` | Go to tab by number |
| `Ctrl+a` then `c` | Create new tab |
| `Ctrl+a` then `x` | Close current tab |

### Other

| Shortcut | Action |
|----------|--------|
| `Ctrl+a` then `s` | Toggle between Claude and shell terminal |
| `Ctrl+a` then `?` | Show help overlay |

## File Tree Navigation

When the file tree pane is focused, use vim-style keys to navigate.

### Basic Movement

| Key | Action |
|-----|--------|
| `j` or `↓` | Move selection down |
| `k` or `↑` | Move selection up |
| `l` or `Enter` | Expand folder / Open file |
| `h` | Collapse folder / Go to parent |
| `gg` | Jump to top of tree |
| `G` | Jump to bottom of tree |

### Search & Filter

The file tree supports incremental search to quickly find files.

| Key | Action |
|-----|--------|
| `/` | Enter search mode |
| *(type)* | Filter tree to matching files |
| `Enter` | Select first result, enter navigation mode |
| `Escape` | Clear search and return to full tree |

**Search workflow:**

1. Press `/` to start searching
2. Type part of a filename—the tree filters in real-time
3. Press `Enter` to select the first match and open it
4. Use `j`/`k` to navigate filtered results
5. Press `Enter` again to open a different file
6. Press `/` to refine your search, or `Escape` to clear it

Search finds files anywhere in the tree, even in collapsed folders.

## Viewer Navigation

When the viewer pane is focused:

| Key | Action |
|-----|--------|
| `j` or `↓` | Scroll down |
| `k` or `↑` | Scroll up |
| `gg` | Scroll to top |
| `G` | Scroll to bottom |
| `Enter` | Follow link under cursor |

## Terminal Copy/Paste

The terminal uses remapped shortcuts for copy/paste to work in the browser environment.

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selected text to clipboard |
| `Ctrl+X` | Send interrupt signal (SIGINT) |
| `Ctrl+V` | Paste from clipboard |
| Right-click | Copy (with selection) / Paste (without) |

> [!NOTE]
> This differs from traditional Unix terminals where `Ctrl+C` sends SIGINT. In ccplus, use `Ctrl+X` to interrupt running commands.

## Workflow Examples

### Quick file lookup

You're in the terminal, need to check a config file:

1. `Ctrl+a` `h` — focus file tree
2. `/config` — filter to config files
3. `Enter` — open first match in viewer
4. `Ctrl+a` `l` — back to terminal

### Browsing project structure

1. `Ctrl+a` `h` — focus file tree
2. `j`/`k` — move through files
3. `l` — expand folders, `h` — collapse
4. `Enter` — open file in viewer
5. `Ctrl+a` `l` `l` — back to terminal (two panes right)

### Multi-project workflow

Working across frontend and backend:

1. `Ctrl+a` `c` — create new tab
2. Enter `/path/to/backend` — open backend project
3. `Ctrl+a` `1` — switch to tab 1 (frontend)
4. `Ctrl+a` `2` — switch to tab 2 (backend)

### Resize for focused work

Need more terminal space:

1. `Ctrl+a` `Ctrl+h` — shrink file tree
2. `Ctrl+a` `Ctrl+h` — shrink more
3. *(work in terminal)*
4. `Ctrl+a` `Ctrl+l` — restore when done

## Customization

All keybindings are configurable in `~/.config/ccplus/keybindings.toml`. See [[configuration#keybindingstoml|Configuration Guide]] for details.

Example: Change prefix to `Ctrl+b` (like tmux default):

```toml
[global]
prefix = "C-b"
```

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────┐
│                    GLOBAL (Ctrl+a +)                    │
├─────────────────────────────────────────────────────────┤
│  h/l     Focus left/right pane                          │
│  C-h/C-l Resize pane boundary                           │
│  t/r     Next/previous tab                              │
│  0-9     Go to tab N                                    │
│  c/x     Create/close tab                               │
│  s       Toggle Claude/shell                            │
│  ?       Help                                           │
├─────────────────────────────────────────────────────────┤
│                    TERMINAL                             │
├─────────────────────────────────────────────────────────┤
│  C-c     Copy selected text                             │
│  C-x     Send interrupt (SIGINT)                        │
│  C-v     Paste from clipboard                           │
│  R-click Copy (with selection) / Paste (without)        │
├─────────────────────────────────────────────────────────┤
│                    FILE TREE                            │
├─────────────────────────────────────────────────────────┤
│  j/k     Move down/up                                   │
│  h/l     Collapse/expand (or parent/open)               │
│  gg/G    Top/bottom of tree                             │
│  /       Search, Enter to select, Esc to clear          │
├─────────────────────────────────────────────────────────┤
│                    VIEWER                               │
├─────────────────────────────────────────────────────────┤
│  j/k     Scroll down/up                                 │
│  gg/G    Top/bottom                                     │
│  Enter   Follow link                                    │
└─────────────────────────────────────────────────────────┘
```

## See Also

- [[README|User Guide]] — Interface overview
- [[configuration|Configuration]] — Customize keybindings
