---
title: Mobile Guide
created: 2026-02-02
updated: 2026-10-14
status: active
tags: [user, mobile, guide]
---

# Mobile Guide

On a screen 768px wide or narrower CADE switches to a phone layout: the terminal fills the screen, a session strip sits above it and an input bar below. You can drive any session running on the backend, including ones you started on the desktop.

## Interface Overview

| Element | Position | Purpose |
|---------|----------|---------|
| Session strip | Top | Current session and agent; ‹ › or swipe to switch; dots show other tabs' state |
| Terminal | Middle | The agent or shell session |
| Composer | Above the key strip | Type a prompt, tap **send** |
| Key strip | Bottom | Keys that are awkward on a phone keyboard |

## Attaching to a session

Your tabs live in the browser, but sessions live on the backend. Sessions already running there appear on the start screen as **[ATTACH name · agent]** entries; tap one and you are in that shell. Once you have a tab open, the same list is under **on server** in the **[cmd]** menu.

Several devices can be attached at once. Everyone sees the same output. The device that last typed owns the terminal's size; the others shrink their text so the whole line fits.

## Typing

**Composer.** Type in the field above the key strip and press Enter or **send**. The text is pasted into the terminal as one block and submitted, so multi-line prompts work. ↑ and ↓ in an empty composer recall earlier prompts.

**Raw keys.** Tap the terminal itself to type straight into it, for vim or a shell.

**Key strip** (scrolls sideways):

| Key | Sends |
|-----|-------|
| esc, tab, ^c, ^d | The corresponding key |
| ↑ ↓ | Arrow keys (menus, history) |
| ⏎ | Enter |
| y, n | `y` or `n` followed by Enter, for yes/no prompts |
| A- A+ | Smaller or larger text |
| ⟳ | Ask the agent's screen to redraw |

Opening the keyboard no longer shrinks the terminal; it scrolls instead, so the prompt line stays in view.

## Text size

Pinch the terminal with two fingers, or use **A-** / **A+**. The size is remembered on this device and applies to every tab and to the file viewer.

## Session strip dots

| Dot | Meaning |
|-----|---------|
| Green | The tab you are looking at |
| Blue | Output arrived in that tab while you were elsewhere |
| Orange, pulsing | The agent there is waiting for you: a permission prompt or a question |
| Cyan | The agent there finished its turn |

The same markers appear next to each tab in the **[cmd]** menu.

## Files

From **[cmd]**:

- **[search]** finds a file by typing a few letters of its name.
- **[recent]** lists files changed on disk this session, newest first.
- **[files]** browses the tree.
- **[viewer]** reopens the last file.

In the viewer, tap **diff** (or press `d`) to see the file's changes against the last commit. New files show as all additions.

## Notifications

To be told when an agent needs you while CADE is closed:

1. Add CADE to your home screen (Share → Add to Home Screen on iOS; Install app on Android).
2. Open it from the home screen, tap **[cmd]**, then **[notify]**, and allow notifications.

While CADE is open in a background tab, the browser shows a notification without any setup.

## Staying Connected

- Switching apps briefly preserves the connection. On return CADE checks the connection and reconnects at once if it dropped, replaying only what you missed.
- **Reconnect** in the **[cmd]** menu forces a fresh connection.
- Your terminal session persists on the backend even if the page is closed.

## See Also

- [[README|User Guide]]
- [[../technical/core/remote-sessions|Remote Sessions]]
- [[../technical/core/frontend-architecture#Mobile Support|Mobile Architecture]]
- [[../future/remote-deployment|Remote Deployment]]
