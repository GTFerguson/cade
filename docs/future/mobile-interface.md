---
title: Mobile Interface
created: 2026-01-17
updated: 2026-01-17
status: planned
tags: [future, mobile, planned]
---

# Mobile Interface

> [!NOTE]
> This feature is planned but not yet implemented.

CADE provides a mobile-optimized interface for accessing your development session from phones and tablets.

## Overview

The mobile interface is designed for a terminal-first experience. When you access CADE from a device with a screen width of 768px or less, the interface automatically switches to mobile mode.

**Mobile Design Philosophy:**

- **Terminal-first**: Full-screen terminal for productive command-line work
- **Read-focused**: Document viewing via slide-out panel (no editing)
- **Session sharing**: Connect to the same session from multiple devices

## Interface Elements

### Full-Screen Terminal

On mobile, the terminal expands to fill the entire screen. The file tree and viewer panels are hidden to maximize working space.

You can:
- Run commands
- Navigate files
- Use all terminal features (vim, git, etc.)

### MD Button

A floating button labeled "MD" appears in the bottom-right corner. This button provides access to markdown and file viewing.

**Button States:**

| Appearance | Meaning |
|------------|---------|
| Outline (gray border) | Normal state - no new content |
| Solid blue with pulse | A markdown file has changed |

When a markdown file changes in your project, the button turns solid blue and pulses to indicate new content is available.

### Slide-Out Viewer

Tap the MD button to open the slide-out viewer panel. This panel slides in from the right side of the screen.

**Opening the Viewer:**

1. Tap the MD button
2. If the button was solid blue (indicating updates), the changed file loads automatically
3. Otherwise, your previously viewed file is shown

**Closing the Viewer:**

- Tap the close button (X) in the header
- Tap anywhere on the darkened backdrop
- Tap the MD button again

The viewer supports:
- Syntax-highlighted markdown
- Code blocks with highlighting
- Basic formatting (headers, lists, emphasis)

## Multi-Device Sessions

You can connect to the same CADE session from multiple devices simultaneously. This enables workflows like:

- Start a long-running command on desktop
- Check progress from your phone
- View generated documentation on a tablet while coding on desktop

All connected clients share:
- The same terminal session
- Real-time file change notifications
- Synchronized file tree state

Each client maintains its own:
- Viewer content (what file you're looking at)
- Slide-out panel state (open/closed)

## Tips for Mobile Use

### Terminal Tips

- Use a Bluetooth keyboard for extended typing
- Enable "Desktop site" in your browser for a slightly larger terminal
- Consider using terminal multiplexers (tmux) for session persistence

### Viewing Content

- The solid blue MD button means a file changed - tap to see it
- The viewer auto-refreshes when the currently viewed file changes
- Swipe down to scroll in the viewer panel

### Connection

- The session persists if you switch apps briefly
- Reconnection is automatic if the connection drops
- Refresh the page if the terminal stops responding

## Limitations

Mobile mode is designed for monitoring and light interaction, not primary development:

- No file tree navigation (use terminal commands)
- View-only for documents (no editing)
- Smaller screen limits terminal visibility

For full functionality, use a desktop browser.

## See Also

- [[README|Future Plans Index]]
- [[../technical/core/frontend-architecture|Frontend Architecture]]
