---
title: Roadmap & Future Plans
created: 2026-01-16
updated: 2026-02-01
status: active
tags: [index, roadmap, future]
---

# Roadmap & Future Plans

This section contains planned features, improvements, and the project roadmap.

> [!IMPORTANT]
> Changes to this roadmap require user approval.

## Vision

CADE (Claude Agentic Development Environment) is an agent-first development environment with Claude Code in a terminal shell as its centerpiece. The interface provides a unified workspace where AI-assisted development is the primary workflow.

## Current Status

Core MVP is functional with multi-project tabs, three-pane layout, and session persistence.

## Recently Implemented

### Desktop App (Tauri) ✓

Native desktop application wrapping the web frontend with a bundled Python backend.

- Tauri v2 with embedded WebView
- PyInstaller-packaged Python backend started automatically
- Native window controls integrated into tab bar
- WSL terminal support on Windows

### Remote Deployment (Phases 1-3) ✓

See [[remote-deployment]] for full details.

- Backend runs on remote servers (EC2, VPS), accessible via browser or desktop app
- Token-based auth with HMAC session cookies and WebSocket auth
- Login page, CORS middleware, base path support for reverse proxies
- Desktop app connects via SSH tunnels with per-profile auth tokens
- Remote profile management (CRUD, connection testing, SSH tunnel config)

### Multi-Project Tabs ✓

Implemented in [[../technical/core/frontend-architecture#Tab System|Frontend Architecture]].

- Separate terminal session (PTY) per tab
- Independent file tree per project
- Isolated viewer content
- Session state persisted in `.cade/session.json`
- Obsidian-style tab bar above terminal pane
- Remote project tabs via SSH tunnel or direct connection

## Planned Features

*Features being actively developed have been moved to `plans/` for rapid iteration.*

## Blocking Issues

See [[blocking-issues]] for critical issues that must be resolved before major progress.

*No blocking issues documented yet.*

## Contents

### Integration & Architecture

- [[remote-deployment]] - Remote server deployment (Phases 1-3 complete, 4-5 planned)
- [[neovim-integration]] - Neovim integration for collaborative editing workflows
- [[mobile-interface]] - Mobile-optimized interface for phones and tablets
- [[state-management-refactor]] - Extract state logic into testable state machines
- [[hook-improvements]] - Claude Code hook infrastructure improvements

### User Interface & Experience

- [[terminal-ui-issues]] - Terminal UI polish and refinements

## See Also

- [[../README|Documentation Hub]]
- [[../technical/README|Technical Docs]]
