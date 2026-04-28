---
title: Architecture Documentation
created: 2026-04-24
updated: 2026-04-24
status: active
tags: [index, architecture]
---

# Architecture Documentation

System architecture documentation for CADE — what exists, how it works, and why it is designed that way.

## Contents

- [[overview|Overview]] — System purpose, tech stack, architecture style, system diagram, key design decisions
- [[components|Components]] — Full component inventory with responsibilities, dependencies, and dependency graph
- [[data-flow|Data Flow]] — Major data flows with Mermaid sequence diagrams
- [[dependencies|Dependencies]] — External services, key libraries, environment variables, configuration files
- [[nkrdn-agent-memory|nkrdn Agent Memory]] — Persistent agent memory: stable symbol identity, `.cade/memory/` ingestion, wiki-link resolution (Phases 1–2 shipped)

## See Also

- [[../technical/README|Technical Documentation]]
- [[../technical/reference/websocket-protocol|WebSocket Protocol Reference]]
- [[../technical/core/agent-orchestration|Agent Orchestration]]
- [[../technical/core/prompt-composition|Prompt Composition]]
