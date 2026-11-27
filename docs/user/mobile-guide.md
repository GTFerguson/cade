---
title: Mobile Guide
created: 2026-02-02
updated: 2026-11-27
status: active
tags: [user, mobile, guide]
---

# Mobile Guide

On a screen 768px wide or narrower CADE switches to a phone layout: the terminal fills the screen, a session strip sits above it and an input bar below. You can drive any session running on the backend, including ones you started on the desktop.

## Interface Overview

| Element | Position | Purpose |
|---------|----------|---------|
| Session strip | Top | Current session and agent; ‹ › or swipe to switch; dots show other tabs' state; the session's pull request at the right |
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

## The queue

**[cmd] → [queue]** deals out the sessions that want you, one card at a time: agents waiting for permission first, then agents with a question, then agents that have finished their turn. Within each, the one that has waited longest comes first. The menu entry says how many are waiting, for example "2 blocked · 1 finished".

A card shows the session and its workspace, what it is waiting for and for how long, and, if that session is open on this phone, the bottom of its screen, where the prompt is. Tap **go to it** to open the session and answer it there, or **next** to put the card aside and see the next one. When you have been through them all, **deal them again** brings back the ones you put aside. A prompt answered somewhere else, on the desktop for example, leaves the queue within a few seconds.

The queue covers the sessions on the backend this tab is connected to.

## Pull requests

When the session's work has a pull request, the strip shows its number and a mark at the right, coloured by how it stands. Tap it to open the pull request on GitHub.

| Mark | Meaning |
|------|---------|
| ≠ (red) | Conflicts with its base branch |
| ✗ (red) | Checks failing |
| ✎ (yellow) | Changes requested |
| … (blue) | Checks running |
| ✓ (green) | Approved |
| no mark, green | Checks passing |
| `merged` / `closed` | Merged or closed |

The **[cmd]** menu says the same in words beside each session, for example "needs you · #412 ✗ checks failing". The pull request is the one for the session's handoff when CADE knows it, otherwise the one for the branch its folder is on, the same one the line above a desktop terminal names.

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
