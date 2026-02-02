---
title: Mobile Guide
created: 2026-02-02
updated: 2026-02-02
status: active
tags: [user, mobile, guide]
---

# Mobile Guide

CADE automatically switches to a mobile-optimized interface on devices with a screen width of 768px or less. The mobile interface is designed for a terminal-first experience — full-screen terminal with touch-friendly controls for file browsing and document viewing.

## Interface Overview

On mobile, the three-pane desktop layout collapses into a full-screen terminal with three supporting elements:

| Element | Position | Purpose |
|---------|----------|---------|
| Terminal | Full screen | Your shell or Claude Code session |
| Touch Toolbar | Bottom edge | Common terminal keys |
| MD Button | Bottom-right | Open document viewer |

## Touch Toolbar

A fixed bar at the bottom of the screen provides buttons for keys that are awkward to type on a mobile keyboard:

| Button | Sends | Use For |
|--------|-------|---------|
| ↑ | Arrow Up | Scroll through command history |
| Tab | Tab | Autocomplete commands and paths |
| Esc | Escape | Cancel operations, exit modes |
| ^C | Ctrl+C | Interrupt running commands |
| ^D | Ctrl+D | Send EOF, exit shells |
| ⋯ | *(opens menu)* | Tab switching, file explorer, actions |

> [!TIP]
> When the virtual keyboard opens, the toolbar automatically repositions above it so all buttons remain accessible.

## Overflow Menu

Tap the **⋯** button on the touch toolbar to open the overflow menu — a bottom sheet that slides up.

**Available actions:**

- **Open tabs** — Switch between your project tabs (active tab is highlighted)
- **File Explorer** — Browse your project's files and folders
- **Current File** — View the most recently opened file
- **Reconnect** — Re-establish the connection if it drops

Dismiss the menu by tapping the backdrop area above it.

## File Explorer

The file explorer opens in a slideout panel from the right side of the screen.

**How to use:**

1. Open the overflow menu (⋯) and tap **File Explorer**
2. Browse the folder tree — tap folders to expand them
3. Use the **back button** (←) in the header to navigate to the parent folder
4. Tap any file to view it — the panel switches to the document viewer

> [!NOTE]
> The file tree shows the same project structure as the desktop file tree pane, with real-time updates when files change on disk.

## Document Viewer

The slideout viewer panel displays files with syntax highlighting. There are two ways to open it:

### Via MD Button

The floating **MD** button in the bottom-right corner opens the viewer directly:

| Button Appearance | Meaning |
|-------------------|---------|
| Gray outline | No new content |
| Solid blue with pulse | A file has changed — tap to view it |

When the button is pulsing blue, tapping it loads the changed file automatically.

### Via File Explorer

Tap any file in the file explorer to view it. The panel switches from explorer mode to viewer mode.

### Closing the Viewer

- Tap the **X** button in the panel header
- Tap the darkened backdrop behind the panel

The viewer supports:

- Syntax-highlighted markdown with formatting
- Code files with language-aware highlighting
- Auto-refresh when the currently viewed file changes on disk

## Multi-Device Sessions

One of CADE's strengths is connecting to the same session from multiple devices. When the backend runs on a remote server:

- **Start work on desktop**, then check progress from your phone
- **Monitor long-running builds** from a tablet while away from your desk
- **View generated documentation** on mobile while coding on desktop

All connected clients share the terminal session and file tree state. Each client maintains its own viewer state (which file you're looking at, whether the slideout is open).

## Tips

### Terminal on Mobile

- Use the touch toolbar buttons instead of trying to type modifier keys
- A Bluetooth keyboard provides a full desktop-like experience
- Terminal multiplexers (tmux) give additional session resilience

### Staying Connected

- Switching apps briefly preserves the connection
- If the connection drops, use the **Reconnect** option in the overflow menu
- Refresh the page as a last resort — your terminal session persists server-side

### Best Experience

- Use landscape orientation for more terminal columns
- The viewer panel width is capped at 400px for readability
- Safe area insets are handled automatically on notched devices

## See Also

- [[README|User Guide]]
- [[../technical/core/frontend-architecture#Mobile Support|Mobile Architecture]]
- [[../future/remote-deployment|Remote Deployment]]
