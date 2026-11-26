---
title: Quick Fixes
created: 2026-11-26
updated: 2026-11-26
status: active
tags: [index, plans, quick-fixes]
---

# Quick Fixes

Small, known defects that are not fixed yet. Each file records the evidence and a fix direction. A file is deleted when everything in it is fixed.

Larger unbuilt work belongs in a plan, listed in [[../README|Plans]].

| File | Priority | What it covers |
|------|----------|----------------|
| [[failover-never-triggers]] | high | A failover provider never falls back: every API provider emits a status event before any error, and failover only acts on an error that comes first |
| [[context-gauge-over-reads]] | medium | The context gauge adds up prompt tokens across the tool turns of one reply, so it reads too high |
| [[chat-prompt-names-wrong-tools]] | medium | The chat agent's prompt says plan docs open by themselves, which is true only in the terminal, and never mentions the tools that show a file or a page |
| [[dead-provider-code]] | low | Three classes in the provider layer that nothing registers, and an endpoint that reads attributes its manager does not have |
| [[dashboard-schema-loose-ends]] | medium | Dashboard config: component names not validated, fields parsed and never rendered, a prompt module that teaches a source type with no adapter, patches that cannot land |
