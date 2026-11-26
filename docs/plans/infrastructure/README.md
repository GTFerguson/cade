---
title: Infrastructure
created: 2026-04-23
updated: 2026-11-26
status: active
tags: [index, plans, infrastructure]
---

# Infrastructure

Plans for the provider system, tooling and platform integration. Each entry is described by what it still has to build; what has shipped is in `docs/technical/` and `docs/architecture/`.

## Plans

| Plan | Remaining work |
|------|----------------|
| [[tool-support-and-failover]] | Compact automatically when the context budget is crossed (its phase 2e) |
| [[cli-coding-agent-adapters]] | Named agents in a config file, `.cade/launch.yml` choosing the agent, session resolution for agents other than Claude Code |
| [[seamless-upgrade]] | Upgrade state in the interface, keeping the size controller across an upgrade, a one-folder build in versioned install directories, a test of open descriptors; deferred: session-host daemon, remote deployments |
