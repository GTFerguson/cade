---
title: Roadmap & Future Plans
created: 2026-01-16
updated: 2026-01-18
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

### Multi-Project Tabs ✓

Implemented in [[../technical/core/frontend-architecture#Tab System|Frontend Architecture]].

- Separate terminal session (PTY) per tab
- Independent file tree per project
- Isolated viewer content
- Session state persisted in `.cade/session.json`
- Obsidian-style tab bar above terminal pane

## Planned Features

*Features being actively developed have been moved to `plans/` for rapid iteration.*

## Blocking Issues

See [[blocking-issues]] for critical issues that must be resolved before major progress.

*No blocking issues documented yet.*

## Contents

### Integration & Architecture

- [[mobile-interface]] - Mobile-optimized interface for phones and tablets
- [[state-management-refactor]] - Extract state logic into testable state machines
- [[hook-improvements]] - Claude Code hook infrastructure improvements

### User Interface & Experience

- [[terminal-ui-issues]] - Terminal UI polish and refinements

## See Also

- [[../README|Documentation Hub]]
- [[../technical/README|Technical Docs]]
