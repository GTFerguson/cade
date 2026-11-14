---
title: Right-Pane Browser
created: 2026-11-14
updated: 2026-11-14
status: planning
tags: [plan, viewer, right-pane, browser, scout-browse, agents]
---

# Right-Pane Browser

Give CADE a browser in the right pane, so looking at a web page (a dev server, a
doc site, whatever an agent is browsing) no longer means leaving the workspace.

## Context

The viewer already renders HTML documents as live pages in a sandboxed frame
(`frontend/src/markdown/html-view.ts`), and agents can draw into it with the
`show_html` tool. That covers pages CADE is *handed*. It does not cover pages
that live at a URL.

Separately, CADE bundles `scout-browse` as a command-line tool on every agent's
PATH. Agents browse with it, but the user cannot see what they are looking at:
snapshots and screenshots land in `.scout-browse/` on disk, and nothing in the
frontend shows the session.

So there are two distinct needs, and they are not solved by the same thing:

| Need | Who drives the browser |
|------|------------------------|
| Look at a URL without tabbing out (dev server, own apps) | The user |
| Watch, and take over, what an agent is browsing | The agent, with the user able to step in |

## What it adds

Two phases, in order. A third approach was considered and rejected (see below).

### Phase 1: open a URL in the pane

An address bar with back, forward and reload, loading a URL into the existing
right-pane frame. Agents get a tool to point the pane at a URL, alongside
`view_file` and `show_html`.

**Covers:** localhost dev servers, the user's own apps, and any site that
permits framing.

**Does not cover:** most public sites. GitHub, Google and most documentation
sites refuse to be framed, and a frame cannot override that.

Estimated effort: an hour or two. It builds directly on the HTML panel.

### Phase 2: a shared, streamed scout-browse session

Show the agent's own browser live in the pane, and forward the user's clicks and
keys back to it. The backend attaches to a running scout-browse browser, streams
frames to the frontend over the existing websocket, and relays input.

This is the only option where the user and the agent share one page: watch the
agent browse, take over to log in or clear a CAPTCHA, hand back. It works on
both the desktop app and a remote deployment, because the browser runs beside
the backend rather than in the client. It also keeps scout-browse's anti-bot
profile, so sites that block a plain frame still load.

Estimated effort: one to two weeks.

## Key challenges

- **Framing refusals (phase 1).** The pane must say plainly when a site refuses
  to load, and not show a blank frame. A frame gives the parent almost no signal
  about why a cross-origin load failed, so detection is the hard part.
- **Sandbox for external pages (phase 1).** A URL-loaded page needs its own
  origin to work at all (cookies, storage, same-site requests), unlike the
  opaque-origin sandbox used for handed-over HTML. The two cases need different
  frame settings, and the looser one must never apply to a CADE-origin URL.
- **Remote deployments (phase 1).** In a hosted CADE, `localhost` in a frame
  means the viewer's machine, not the server, and an `http:` page inside an
  `https:` CADE is blocked as mixed content. Phase 1 is mostly a desktop and
  local-dev feature.
- **Session ownership (phase 2).** scout-browse is one browser per working
  directory, launched and closed by the agent. The pane has to follow a session
  it does not own: appear when one starts, survive the agent navigating, and
  clear when it closes.
- **Input fidelity (phase 2).** Forwarded input must map pane coordinates to
  page coordinates across resizes, and handle text entry, modifier keys,
  scrolling and focus. Typing latency will be noticeable on a remote deployment.
- **Turn-taking (phase 2).** The user and the agent can act on the same page at
  the same moment. There needs to be a visible notion of who has control.
- **Stream cost (phase 2).** Frames over the websocket compete with terminal and
  chat traffic. The stream should stop when the pane is hidden.

## Integration points

- **Right pane.** `RightPaneManager` switches between modes (viewer, neovim,
  agents, dashboard, plans). The browser is either a new mode or a further
  renderer inside the viewer; phase 1 fits the viewer, phase 2 is closer to a
  mode of its own, like the neovim pane.
- **Agent tools.** `backend/orchestrator/mcp_server.py` holds `view_file` and
  `show_html`. A URL tool belongs beside them and should use the same
  caller-tab routing, so a page opens only in the tab that asked.
- **scout-browse.** It starts Chrome with a debugging port and records the
  endpoint and process id in `.scout-browse/state.json` under the working
  directory, so a running session can be attached to without changing how
  agents launch it. Chrome's screencast and input-dispatch protocol commands are
  the expected transport.
- **Viewer lock.** The existing lock stops hooks changing the viewer. It should
  equally stop an agent navigating the pane away.

## Rejected: a native child webview

Tauri 2 can place a second native webview over the right pane, giving a real
browser for any site. Rejected because:

- It is desktop only; a remote deployment gets nothing.
- It depends on a multi-webview feature Tauri still marks unstable.
- The native view sits above the DOM. Its bounds must be re-synced on every
  resize, split drag and mode switch, and CADE's own flyouts cannot draw over it.
- The agent cannot see or drive it, so it serves only the first need, which
  phase 1 mostly covers at a fraction of the cost.

Worth revisiting only if phase 1's framing refusals prove to be the main
complaint and phase 2 is not built.

## Open questions

- Does phase 1 need a persistent history and bookmarks, or is "the last URL per
  project" enough?
- Should relative local assets in HTML files (a coverage report's sibling CSS
  and JS) be solved here, by serving project files over HTTP to the frame? It is
  the same gap from the other side, and it raises the question of whether a
  sandboxed frame receives the session cookie on an authenticated deployment.
- In phase 2, does the pane attach to the agent's session only, or can the user
  start one themselves and hand it to an agent?
- What frame rate and image quality are acceptable over a remote link, and is
  the Chrome screencast adequate or is a different transport needed?
- How does control pass between user and agent: explicit take-over, or
  last-input-wins with an indicator?
- Estimates above are from reading the code and knowledge of Tauri and the
  Chrome protocol; none of the three approaches has been prototyped.

## See also

- [[remote-access-overhaul]] — constraints on what works in a hosted CADE
- [[dashboard/agent-ui-system]] — the other route by which agents put UI in the right pane
