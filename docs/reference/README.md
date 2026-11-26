---
title: Reference Documentation
created: 2026-04-22
updated: 2026-04-22
---

# Reference Documentation

Evidence base for CADE's design decisions. Each doc covers a single topic with full citations and evidence tiers. The PROVEN principles (`~/.claude/rules/proven-documentation.md`) set the quality standard.

## Documents

- [[agent-memory-systems]] — Retrieval scoring formula (Park et al. triple), context budget strategies, documented failure modes, Padarax reference implementation
- [[agent-memory-capture]] — Phase 4 capture-surface design synthesis: explicit-call tools, dedup/supersedes, MADR-shaped body, quality gates
- [[coding-agent-prompts]] — Prompt Alchemy (Ye et al., 2025) and ACE-based prompt patterns for code generation
- [[agentic-context-engineering]] — ACE framework: itemized context, Generator-Reflector-Curator, self-improving agent contexts
- [[self-improving-agent-systems]] — SICA, Memento-Skills, SkillClaw, EvolveR: memory, skill libraries, and experience evolution
- [[browser-terminal-emulators]] — xterm.js landscape, WebGL vs canvas vs DOM tradeoffs, documented rendering failures and patches
- [[xterm-rendering-issue]] — Black-block glyph corruption: full attempt log, confirmed dead-ends, current theory, escalation path
- [[xterm-webfont-loading]] — Official `@xterm/addon-web-fonts` solution, gap analysis vs our implementation, recommended migration
- [[pty-websocket-architecture]] — PTY–WebSocket architecture for terminal session management
- [[session-persistence]] — Session persistence for agentic development environments
- [[provider-architecture]] — LLM provider architectures for agentic development environments
- [[multi-provider-failover]] — Multi-provider LLM failover and load balancing strategies
- [[context-window-management]] — Context window management strategies for LLM agents
- [[tool-design-for-agents]] — Tool design for LLM-powered coding agents
- [[permission-allowance-models]] — Permission allowance models for LLM agents
- [[dashboard-config-driven-ui]] — Config-driven UI: live rendering from declarative configuration
- [[brand-voice-guide]] — How to write a brand voice YAML

## Common Knowledge

The agent research docs below are also published in the shared library. Canonical home is `common-knowledge/ai-agents/` — search with `nkrdn search "topic" --source docs` to find them.

| Local doc | Common Knowledge |
|-----------|-----------------|
| [[coding-agent-prompts]] | [[common-knowledge/ai-agents/coding-agent-prompts]] |
| [[agentic-context-engineering]] | [[common-knowledge/ai-agents/agentic-context-engineering]] |
| [[self-improving-agent-systems]] | [[common-knowledge/ai-agents/self-improving-agent-systems]] |

[[agent-memory-capture]] cites three common-knowledge docs that don't have local mirrors:

- [[common-knowledge/ai-agents/agent-memory-write-tools]] — capture surface design
- [[common-knowledge/ai-agents/memory-write-deduplication]] — write-time dedup
- [[common-knowledge/ai-agents/architecture-decision-records]] — ADR practice

## Navigation

- Architecture docs (how CADE systems work): `docs/technical/`
- Active plans: `docs/plans/`
- Future roadmap: `docs/future/`
