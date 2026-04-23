---
title: Technical Documentation
created: 2026-01-16
updated: 2026-03-24
status: active
tags: [index, technical]
---

# Technical Documentation

Technical documentation for CADE developers. This section covers implemented systems, APIs, and design decisions.

## Contents

### Core

Architecture and essential developer documentation.

- [[core/development-setup|Development Setup]] - Running CADE for development
- [[core/frontend-architecture|Frontend Architecture]] - Component architecture and mobile support
- [[core/agent-orchestration|Agent Orchestration]] - Multi-agent coordination, MCP tools, two-gate approval flow
- [[core/prompt-composition|Prompt Composition]] - Modular system prompt assembly from markdown modules

### Reference

API documentation and specifications.

- [[reference/websocket-protocol|WebSocket Protocol]] - WebSocket message types and communication protocol

### Design

Design rationale and decision records.

- [[design/visual-design-philosophy|Visual Design Philosophy]] - UI/UX principles, terminal aesthetics, keyboard-first design

## Adding Documentation

When adding technical documentation:
1. Place in the appropriate subdirectory (core, reference, or design)
2. Include YAML frontmatter
3. Link from this index
4. Cross-reference related docs

See [[../.roo/rules/documentation-organization|documentation-organization]] for full guidelines.

## See Also

- [[../README|Documentation Hub]]
- [[../future/README|Future Plans]]
