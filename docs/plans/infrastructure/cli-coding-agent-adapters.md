---
title: CLI Coding Agent Adapters
created: 2026-06-03
updated: 2026-11-26
status: partially-shipped
tags: [cade, cli-agents, claude-code, codex, cursor, mcp]
---

# CLI Coding Agent Adapters

Run Claude Code, Codex and Cursor as terminal coding agents through one adapter layer, separate from the LiteLLM provider path. This plan holds what is left to build.

Parent: [[../README]] (plans index).

## Shipped

The adapter layer is built: `ClaudeCodeAdapter`, `CodexAdapter` and `CursorAdapter` in `backend/terminal/cli_agent_adapters.py`, selected by `CADE_CLI_AGENT_ADAPTER` or by a tab's own choice in the project picker. Each adapter owns its launch line and its vendor config, the selected agent's id, name and capability flags are sent on `connected`, and the terminal's status label follows the agent.

- Design, terms, what the layer leaves out, and which capability flags do anything: [[../../technical/core/agent-orchestration#CLI coding agents and their adapters]]
- How each agent is given CADE's MCP servers, and why Codex gets none: [[../../technical/core/agent-orchestration#CLI delegation (Claude Code → API workers)]]
- A different agent per tab: [[../../technical/core/project-picker#Per-tab agent]]
- Selecting an agent, and the capability matrix: [[../../user/configuration#CLI Coding Agent]]

The Cursor adapter has unit tests. Nothing in the repository shows it has been run against a real `cursor-agent`, and the project picker does not offer it.

## Remaining

### Named agents in a config file

The backend's agent is set only by environment variables (`CliAgent.from_env` in `backend/config.py`). The idea was a config file that names several agents and a default, each with its command and how it takes a starting prompt:

```toml
[cli]
default_agent = "claude-code"

[cli.agents.codex]
command = "codex"
seed_style = "positional"
```

The per-tab choice in the picker now covers picking between Claude Code and Codex, so what this would still add is a custom command or prompt convention per agent without environment variables. Whether that is still wanted is open.

### `.cade/launch.yml` choosing the agent

A project's launch preset (`backend/launch_preset.py`) cannot name the agent its tabs run. The question is whether a project should be able to, or whether the agent stays a choice of the user and the tab.

### Session resolution for agents other than Claude Code

`backend/cc_session_resolver.py` reads Claude Code's session history and is imported whatever agent is configured. Adapters declare a `session_resolution` flag that nothing checks. Either the resolver becomes an optional service that only the Claude Code adapter turns on, or session resolution leaves the generic path.
