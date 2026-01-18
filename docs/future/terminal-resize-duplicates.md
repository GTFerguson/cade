---
title: Fix Terminal Resize Duplicate Text
created: 2026-01-18
updated: 2026-01-18
status: planned
tags: [terminal, xterm, resize, ui-bug]
---

# Fix Terminal Resize Duplicate Text

Eliminate duplicate/ghost text when resizing the terminal pane while Claude Code is running.

## Problem

When resizing the terminal pane during a Claude Code session, the prompt and UI elements can appear duplicated. This is a visual glitch that doesn't affect functionality.

## Root Cause

1. xterm.js reflows existing content when terminal dimensions change
2. Claude Code (running in alternate screen buffer) receives SIGWINCH and redraws the entire screen
3. Both operations affect the display, causing momentary duplicates

## Current Mitigations

- Debounce resize events (150ms) to reduce frequency
- Skip resize if dimensions unchanged
- Skip resize when terminal container is hidden

## Proposed Solution

Track whether terminal is in alternate screen buffer by watching output for:
- `\x1b[?1049h` - Enter alternate screen buffer
- `\x1b[?1049l` - Exit alternate screen buffer

When in alternate screen buffer AND resizing:
- Clear the screen before resize (`\x1b[2J\x1b[H`)
- The TUI app will redraw everything anyway

When in normal screen buffer:
- Let xterm.js handle reflow naturally (preserves shell history)

## Implementation

```typescript
// In Terminal class
private inAlternateBuffer = false;

// In output handler
if (data.includes("\x1b[?1049h")) {
  this.inAlternateBuffer = true;
} else if (data.includes("\x1b[?1049l")) {
  this.inAlternateBuffer = false;
}

// In fit()
if (this.inAlternateBuffer && sizeChanged) {
  this.terminal.write("\x1b[2J\x1b[H");
}
```

## Complexity

Medium - requires intercepting output stream and tracking state across the terminal lifecycle.

## See Also

- `frontend/src/terminal.ts` - Current resize handling
