---
title: Remote Access Overhaul
created: 2026-10-14
updated: 2026-11-26
status: partially-shipped
tags: [plan, remote, mobile, terminal, transport, pwa]
---

# Remote Access Overhaul

Operate every CADE session (Claude Code, Codex, manual shells) from a phone or any other device, with smooth low-latency rendering, easy input, adjustable output size, and usable file navigation. This plan holds what is left to build.

## Shipped

The substrate and the phone interface are built. Their design and rationale live in [[../technical/core/remote-sessions]] (substrate: broadcaster, sequenced reconnect, size policy, session directory, liveness, attention, push, files) and [[../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]] (composer, key strip, session strip, font size, screens). User-facing behaviour is in [[../user/mobile-guide]]. The `?demo=mobile-remote` scenario exercises every surface without a backend.

Dropped along the way, with reasons recorded in the architecture doc: persisting the session registry to disk (PTYs do not survive the process ending; an in-place upgrade later made them survive *that* by carrying the registry in a handoff, see [[infrastructure/seamless-upgrade]]), and tmux's smallest-client size rule (it would shrink the desktop whenever a phone looked in).

## Remaining

### Write up how a phone reaches the desktop backend

Real sessions run in the desktop app's local backend, so a phone has to reach that backend. No doc in `docs/user/` or `docs/technical/` describes a route. Once Gary confirms the route in use, write it up in [[../user/remote-connections]] and point to it from the Boundaries of [[../technical/core/remote-sessions]].

The options that were considered:

- A private network or tunnel in front of the local backend (Tailscale Serve, a Cloudflare Tunnel). This is the least change.
- Sessions run on a server and the desktop connects as a client.
- Both, with the session directory spanning backends.

Whichever route is written up has to cover:

- The backend's port is picked at each app launch, so anything pointed at it has to be repointed.
- Push on iOS needs HTTPS.
- The desktop app starts its backend with `--host 0.0.0.0` (`desktop/src-tauri/src/python.rs`) and auth is off unless `CADE_AUTH_ENABLED` is set, so the backend is also reachable on the local network. Whether to bind it to loopback is part of the decision.

### Measurement on a device

Never done on hardware:

- Input to echo round trip, and write to paint, on the phone, reported through `client-diagnostic`.
- Canvas (current) against the WebGL renderer on iOS Safari and Android Chrome. `webgl-renderer.ts` loads `CanvasAddon` and should be renamed or switched once measured.

### Chat pane on the phone

The structured chat pane (LiteLLM API providers) has no phone layout. Lower priority: the ask was terminals.

### QR sign-in

Deferred. A backend reached through a tunnel uses the token login page, and a QR code would only save typing the token once. The roadmap still lists it ([[../future/README]]).

## Open Questions

1. Controller handover: "last to type owns the size" can surprise a desktop user when the phone types. An explicit "take control" action may be wanted after real use.
2. Attention for agents without hooks: Codex approval prompts are now read from the title it sets on its terminal (`backend/terminal/attention.py`). Should the backend also look for a known prompt in the output of an agent that gives neither a hook nor a title, such as Cursor?

## Evidence Links

- [[../technical/core/remote-sessions]]
- [[../user/mobile-guide]]
- [[../future/remote-deployment]] (running the backend on a server)
- [[../future/terminal-ui-issues]] (cursor and rendering issues that interact with the renderer choice)
