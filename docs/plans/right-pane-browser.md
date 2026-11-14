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

Two phases, in order; phase 2 now has its own plan. A third approach was considered and rejected (see below).

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

Split into its own plan: [[integrated-scout-browser]]. Showing the agent's own
browser live in the pane, with the user able to take over, has different
integration points and is one to two weeks of work on its own.

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

## Integration points

- **Right pane.** Phase 1 is a further renderer inside the viewer, beside the
  HTML panel, not a new `RightPaneManager` mode.
- **Agent tools.** `backend/orchestrator/mcp_server.py` holds `view_file` and
  `show_html`. A URL tool belongs beside them and should use the same
  caller-tab routing, so a page opens only in the tab that asked.
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
- Estimates above are from reading the code and knowledge of Tauri; neither
  phase 1 nor the rejected approach has been prototyped.

## See also

- [[integrated-scout-browser]] — phase 2: the agent's scout-browse session in the pane
- [[remote-access-overhaul]] — constraints on what works in a hosted CADE
- [[dashboard/agent-ui-system]] — the other route by which agents put UI in the right pane
