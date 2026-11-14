---
title: Integrated Scout Browser
created: 2026-11-14
updated: 2026-11-14
status: planning
tags: [plan, browser, scout-browse, right-pane, agents, remote]
---

# Integrated Scout Browser

Make the browser agents already use, scout-browse, a shared part of CADE: shown
live in the right pane, drivable by the user and the agent in turn, and known
to CADE as a session rather than as files on disk.

Split out of [[right-pane-browser]], where it was phase 2. That plan keeps
phase 1 (loading a URL into the viewer's frame), which is independent of this.

## Context

CADE bundles scout-browse, a Patchright (anti-detection Chromium) CLI from the
sibling `scout-engine` repo, and puts it on every agent's PATH. Agents drive it
through their bash tool: `open`, `goto`, `click`, `fill`, `snapshot`,
`screenshot`, `close`. Its advantages over a plain browser are a persistent
Google-logged-in profile and a CAPTCHA-solving extension.

Today the user cannot see any of this. Snapshots and screenshots land in the
caller's `.scout-browse/` directory, and the only way to know what an agent is
looking at is to open those files. When a site needs a login or a CAPTCHA the
solver cannot clear, the agent is stuck and the user has no way in.

## How scout-browse works today

These facts constrain the design; all are from `scout-engine/src/scout/browse.py`
and `scout/scraping/`.

- **One browser per user, not per project.** State (Chrome's debugging endpoint,
  pid, tab tracking, `last_used`) lives in a fixed global file,
  `~/.scout/browse/state.json`, deliberately not in the working directory, so
  that `open` and `close` from different directories agree. A second `open`
  while one is live fails with "already running". Output files still go to the
  caller's `.scout-browse/`.
- **Chrome is launched directly with a debugging port**, and every later command
  reconnects over the Chrome DevTools Protocol (CDP) using the endpoint in
  `state.json`. So anything that can read that file can attach to the session.
- **The profile is exclusive.** `~/.scout/profiles/google` is guarded by a
  `flock`-based `ProfileLock`; only one browser can hold it.
- **Headless sessions die when idle.** A watchdog kills a headless browser once
  `last_used` is more than ten minutes old. Headed sessions have no such limit.
- **Headed is the default**, and opens a real window on the desktop.

## What it adds

### 1. CADE knows about the session

The backend watches `~/.scout/browse/state.json`, attaches over CDP when a
session appears, and drops it when the session closes or the browser dies. It
reports the session to the frontend: current URL, title, tab list, and which
project's agent opened it, where that can be told.

No change to scout-browse is needed for this, and agents keep using the CLI.

### 2. Live view in the right pane

A browser mode in the right pane showing the session's active tab as a live
stream: CDP's screencast for frames, sent to the frontend over the existing
websocket. A small chrome around it shows the URL, tabs, and who has control.

The stream runs only while the pane is visible; hidden, the backend stops the
screencast.

### 3. Take-over

The user can click and type into the stream; CADE maps pane coordinates to page
coordinates and dispatches the events over CDP. Control is explicit: a
"take over" action pauses the agent's commands (or warns it), and "hand back"
releases them. Typical uses: logging in, clearing a CAPTCHA, dismissing a
dialog the agent cannot see past.

### 4. Agent tools

First-class tools beside `view_file` and `show_html` in
`backend/orchestrator/mcp_server.py`, wrapping the session CADE now holds:
open, navigate, snapshot, and "ask the user to take over" (which surfaces the
pane and waits for the hand-back). The bash CLI keeps working; the tools are
for the cases where CADE's involvement matters, chiefly the hand-off.

### 5. User-started sessions

A way to open the browser from the pane itself, and to point an agent at it
("look at this page"). This reuses the same single session, so it is the same
model in reverse, not a second browser.

## Key challenges

- **Ownership of a global session.** One browser serves every project and every
  agent on the machine. With several CADE tabs open, which tab's pane shows it,
  and which agent may drive it? The session has no project identity today
  beyond the working directory of whoever ran `open`.
- **Turn-taking.** The agent's CLI and the user's input reach the same page with
  no coordination. Pausing the agent needs either a lock scout-browse honours,
  or CADE refusing its tools while the user has control (which does not stop
  the bash CLI).
- **Headed or headless.** A headed session already has a window, so the stream
  duplicates it on the desktop; a headless one is invisible except through
  CADE but is killed after ten idle minutes, including while the user is
  reading it. The watchdog must count viewing as activity, or CADE-attached
  sessions need a different lifetime.
- **Input fidelity.** Text entry, IME, modifier keys, scrolling, focus,
  drag, and file pickers each need mapping. Coordinates must survive pane
  resizes and device-pixel ratio. Native dialogs (print, file chooser, HTTP
  auth) do not appear in the screencast at all.
- **Stream cost.** Frames compete with terminal output on the same websocket.
  Quality and frame rate must adapt, and a remote link sets a hard ceiling.
- **Remote deployments.** On a hosted CADE (glann) the browser runs on the
  server: its profile, logins and cookies are the server's, not the user's,
  and a headed session has no display. Headless is the only option there, with
  its own profile, and logging into it happens through the stream.
- **Attaching without interfering.** CADE's CDP connection sits beside
  scout-browse's own reconnects. It must not change the active tab, steal
  focus, or keep the browser alive after `close`.

## Integration points

- **scout-engine.** Read-only use of `state.json` and the CDP endpoint covers
  sections 1 and 2. A control lock for take-over, and an activity signal for
  the headless watchdog, would be changes in scout-engine, not CADE.
- **Right pane.** A new `RightPaneManager` mode, closer to the neovim pane than
  to the viewer: a long-lived surface with its own input handling. The
  keybinding manager must route keys to it while it has focus.
- **Websocket protocol.** New messages for session state, frames, and input,
  in `core/frontend/platform/protocol.ts` and `backend/protocol.py`. Frames
  should be sent only to the tab showing the pane.
- **Agent tools and routing.** The caller-tab routing used by `view_file` and
  `show_html` (`_caller_project_root` in `backend/main.py`) decides which tab
  a "please take over" request surfaces in.
- **Packaging.** The desktop build already freezes scout-browse and bundles
  Chromium. A CDP client in the backend (Patchright's, or a raw websocket) adds
  a dependency to the PyInstaller build.
- **Viewer lock.** The existing lock that stops hooks changing the viewer should
  also stop a browser session taking over the pane.

## Suggested order

1. Session awareness and a read-only live view (sections 1 and 2). Useful on its
   own: watching an agent browse.
2. Take-over and hand-back (section 3), with the watchdog and control-lock
   changes in scout-engine.
3. Agent tools (section 4), centred on the hand-off request.
4. User-started sessions and remote deployments (section 5 and the hosted case).

Estimated effort for steps 1 and 2: one to two weeks. Not prototyped; the CDP
attach is confirmed possible from how scout-browse stores its endpoint, but the
screencast's quality and latency over the websocket are untested.

## Open questions

- Should a CADE-attached session be headless by default, with the pane as its
  only window? That removes the duplicate desktop window but brings in the
  idle watchdog.
- Is one global session enough, or should scout-browse grow per-project
  sessions (separate profiles or contexts) so two projects can browse at once?
- How does the agent learn the user has taken over: a tool error, a message in
  its next tool result, or nothing (it just waits)?
- On a hosted CADE, whose profile is it, and is a server-side Google login
  acceptable at all?
- Does the screencast need replacing (with a video encoder) for remote links,
  or is adaptive JPEG quality enough?

## See also

- [[right-pane-browser]] — phase 1, URLs in the viewer frame
- [[remote-access-overhaul]] — hosted-deployment constraints
