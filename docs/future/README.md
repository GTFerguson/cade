---
title: Roadmap & Future Plans
created: 2026-01-16
updated: 2026-01-17
status: active
tags: [index, roadmap, future]
---

# Roadmap & Future Plans

This section contains planned features, improvements, and the project roadmap.

> [!IMPORTANT]
> Changes to this roadmap require user approval.

## Vision

ccplus aims to create a unified terminal development environment that seamlessly integrates:
- **tmux** - Terminal multiplexing and session management
- **vim** - Text editing and navigation
- **Claude Code** - AI-assisted development

## Current Status

Project is in early planning phase. Core conventions and documentation structure are being established.

## Planned Features

### Multi-Project Tabs

Open multiple projects simultaneously as tabs, similar to tmux windows. Each tab maintains independent state:

- Separate terminal session (PTY)
- Independent file tree
- Isolated viewer content
- Persisted layout per project

Session state stored in `.ccplus/` directory within each project enables pause/resume workflows.

See [[multi-project-tabs]] for detailed design.

### Claude Code Hooks Integration

Lightweight integration with Claude Code using hooks instead of MCP:

- CLI commands (`ccplus view`, `ccplus notify`, `ccplus tree reveal`)
- Hook into PostToolUse events to auto-display edited files
- No additional server processes or protocol overhead

See [[claude-code-hooks-integration]] for detailed design.

## Blocking Issues

See [[blocking-issues]] for critical issues that must be resolved before major progress.

*No blocking issues documented yet.*

## Contents

- [[multi-project-tabs]] - Tabbed multi-project support
- [[claude-code-hooks-integration]] - Claude Code hooks integration

## See Also

- [[../README|Documentation Hub]]
- [[../technical/README|Technical Docs]]
