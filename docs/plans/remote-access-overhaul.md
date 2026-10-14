---
title: Remote Access Overhaul
created: 2026-10-14
updated: 2026-10-14
status: in-progress
tags: [plan, remote, mobile, terminal, transport, pwa]
---

# Remote Access Overhaul

Operate every CADE session (Claude Code, Codex, manual shells) from a phone or any other device, with smooth low-latency rendering, easy input, adjustable output size, and usable file navigation.

## Shipped

Phases 1 to 4 landed on 14 Oct 2026. Their design and rationale now live in [[../technical/core/remote-sessions]] (substrate: broadcaster, sequenced reconnect, size policy, session directory, liveness, attention, push, files) and [[../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]] (composer, key strip, session strip, font size, screens). User-facing behaviour is in [[../user/mobile-guide]]. The `?demo=mobile-remote` scenario exercises every surface without a backend.

Dropped along the way, with reasons recorded in the architecture doc: persisting the session registry to disk (PTYs do not survive a restart), and tmux's smallest-client size rule (it would shrink the desktop whenever a phone looked in).

## Remaining

### Topology decision

Real sessions run in the desktop app's local backend; `glann` is a separate box. For the phone to drive desktop sessions the desktop backend must be reachable. Options: (a) Tailscale Serve or a Cloudflare Tunnel in front of the local backend, using the existing token login; (b) run sessions on a server and have the desktop connect as a client; (c) both, with the session directory spanning backends. (a) is the least change. Push on iOS needs HTTPS either way.

### Phase 0: measurement on a device

Never done on hardware. Still worth doing once a phone can reach a backend:

- Input→echo round trip and write→paint on the phone, reported through `client-diagnostic`.
- Canvas (current) vs WebGL renderer on iOS Safari and Android Chrome; `webgl-renderer.ts` loads `CanvasAddon` and should be renamed or switched once measured.

### Phase 5: chat pane parity

The structured chat pane (LiteLLM API providers) has no phone layout. Lower priority: the ask was terminals.

### QR sign-in

Deferred. `glann` signs in through Google SSO and a tunnelled desktop backend uses the token login page; a QR would only shorten typing the token once. The roadmap still lists it.

## Open Questions

1. Controller handover: "last to type owns the size" can surprise a desktop user when the phone types. An explicit "take control" action may be wanted after real use.
2. Attention sources beyond hooks: should the backend also mark a session `input` when the TUI prints a known permission prompt, for agents without hooks?
3. `pywebpush` is now a backend dependency; confirm the PyInstaller build ships it before the next desktop release.

## Evidence Links

- [[../technical/core/remote-sessions]]
- [[../user/mobile-guide]]
- [[../future/remote-deployment]] (deployment phases shipped)
- [[../future/terminal-ui-issues]] (cursor and rendering issues that interact with the renderer choice)
