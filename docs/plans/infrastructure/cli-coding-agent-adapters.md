---
title: CLI Coding Agent Adapters
created: 2026-06-03
status: shipped
tags: [cade, cli-agents, claude-code, codex, cursor, mcp]
---

# CLI Coding Agent Adapters

CADE should support Codex CLI and Cursor CLI through the same integration class as Claude Code CLI: an interactive coding-agent process running in CADE's terminal, with CADE's workflow optimisations attached around it.

This is intentionally separate from the LiteLLM/API provider path. LiteLLM has its own provider ecosystem, structured chat loop, tool dispatcher, and chat-pane runtime. That path can remain independent. This plan is only about terminal-first coding agents that CADE launches and supervises through a PTY.

## Goal

Make Claude Code, Codex, and Cursor interchangeable CLI coding agents for CADE's primary terminal workflow.

The shared contract:

- launch an interactive CLI coding agent in the project PTY
- seed the agent with an initial prompt for plan/handoff launches
- attach CADE's MCP tools when the agent supports MCP
- expose orchestrator, permissions, dashboard, file, memory, and workflow tools through that bridge
- install vendor-specific hooks when available
- fall back to CADE file watching and event bus when hooks are unavailable
- preserve CADE's handoff resume-on-exit behaviour
- surface the selected CLI agent and its capabilities to the frontend

## Non-Goals

- Do not add Codex or Cursor as LiteLLM providers.
- Do not route CLI agents through `APIProvider`.
- Do not require terminal CLIs to emit `ChatEvent` streams.
- Do not reimplement Codex/Cursor agent loops inside CADE.
- Do not make the frontend know vendor-specific launch or hook details.

## Current State

Claude Code CLI integration is mostly hardcoded but already has useful seams:

- `backend.config.CliAgent` describes the command and prompt seed style.
- `backend/terminal/agent_launch.py` builds the launch command and handoff resume wrapper.
- `backend/terminal/sessions.py` and `backend/websocket.py` call `build_launch_command()`.
- `backend/orchestrator/mcp_config.py` builds CADE MCP server config.
- `backend/hooks/*` installs Claude Code hook scripts.
- `backend/cc_session_resolver.py` reads Claude-specific session history.

The main problem is that generic-looking code still assumes Claude Code in several places:

- default command is `claude`
- MCP attachment assumes `--mcp-config`
- hook installation assumes `~/.claude/settings.json`
- session resolution assumes Claude's history format
- docs and env names still say Claude in places where they now mean "CLI coding agent"

## Target Architecture

Introduce a CLI coding agent adapter layer below the terminal/session code:

```python
class CliCodingAgentAdapter:
    id: str
    display_name: str
    command: str

    def build_launch_command(...)
    def build_seeded_command(...)
    def build_mcp_args(...)
    def install_hooks(...)
    def supports_hooks(...)
    def supports_mcp(...)
    def supports_session_resolution(...)
```

Concrete adapters:

- `ClaudeCodeAdapter`
- `CodexAdapter`
- `CursorAdapter`

The terminal layer asks the selected adapter how to launch and integrate. The adapter owns vendor-specific syntax. CADE owns the common workflow.

## Capability Model

Each adapter should declare capabilities so CADE can degrade gracefully:

| Capability | Meaning | Fallback |
|------------|---------|----------|
| `prompt_seed` | Agent can start with a one-shot prompt | Start plain terminal, optionally paste prompt manually later |
| `mcp` | Agent can attach CADE MCP servers | Disable MCP-only workflow tools for that agent |
| `hooks` | Agent can report tool/file events through vendor hooks | Use file watcher and event bus |
| `permissions` | Agent can delegate permissions to CADE MCP server | Use agent-native permission UI |
| `session_resolution` | CADE can map agent sessions to projects/plans | Disable vendor-specific resume/history features |
| `handoff_resume` | Agent can be relaunched with a handoff brief prompt | Keep manual `resume` shell function when possible |

Claude Code should be the first adapter and should preserve current behaviour.

## Configuration

Keep global env overrides for simple cases, but add explicit named CLI agents:

```toml
[cli]
default_agent = "claude-code"

[cli.agents.claude-code]
command = "claude"
seed_style = "positional"

[cli.agents.codex]
command = "codex"
seed_style = "positional"

[cli.agents.cursor]
command = "cursor-agent"
seed_style = "flag"
seed_flag = "--prompt"
```

Exact Codex and Cursor defaults must be verified against current official CLI docs before shipping. The adapter interface should not depend on those defaults being stable.

## Phase 1 - Extract Claude Code Adapter

Goal: no behaviour change.

Status: **shipped**. `ClaudeCodeAdapter` in `cli_agent_adapters.py` owns all
Claude-specific launch syntax (`--mcp-config`, hook gating, session
resolution). The adapter registry, `CADE_CLI_AGENT_ADAPTER` env var, and
`claude-compatible` escape hatch are wired through config → agent_launch →
main.py. All 40+ tests pass.

## Phase 2 - Shared MCP Bridge

Goal: make CADE tools attach through adapter-defined MCP config.

Status: **shipped**. Each adapter implements `install_mcp_config()` and
`remove_mcp_config()`. `prepare_cli_orchestrator_env()` calls the adapter after
writing the canonical JSON. Session teardown calls `remove_adapter_mcp_config()`.

- Claude Code: no-op — reads the generated JSON via `--mcp-config` CLI arg.
- Codex: merges `[mcp_servers.*]` entries into `~/.codex/config.toml`.
- Cursor: merges `mcpServers` entries into `.cursor/mcp.json` (project-level).

## Phase 3 - Codex Adapter

Goal: support Codex CLI as a first-class terminal coding agent.

Status: **shipped** (adapter code + tests). Not yet end-to-end tested with a
real Codex install.

Research findings (June 2026):

- Command: `codex`
- Prompt seeding: positional — `codex "prompt"`
- MCP: configured in `~/.codex/config.toml` under `[mcp_servers]`. No
  `--mcp-config` flag. CADE merges server entries into the user-level TOML and
  strips them on session teardown.
- Hooks: none. File watcher fallback applies.
- Permissions: Codex has its own `--full-auto` / approval policies. No
  delegation to CADE permission manager.
- Session resolution: none.
- Config override: `-c key=value` for ad-hoc TOML overrides. Project-level
  `.codex/config.toml` for scoped settings (requires trust).

## Phase 4 - Cursor Adapter

Goal: support Cursor CLI as a first-class terminal coding agent.

Status: **shipped** (adapter code + tests). Not yet end-to-end tested with a
real Cursor install.

Research findings (June 2026):

- Command: `cursor-agent`
- Prompt seeding: positional — `cursor-agent "prompt"` (interactive),
  `-p "prompt"` (print/non-interactive mode)
- MCP: configured in `.cursor/mcp.json` (project-level) or
  `~/.cursor/mcp.json` (global). Auto-discovered — no `--mcp-config` flag.
  `--approve-mcps` auto-approves all configured servers. `--force`/`--yolo`
  skips all interactive approval prompts.
- Hooks: none. File watcher fallback applies.
- Permissions: `--force`/`--yolo` for auto-approval; `--trust` for workspace
  trust. No delegation to CADE permission manager.
- Session resolution: none.

## Phase 5 - Frontend and Docs Polish

Goal: make the selected CLI agent visible without vendor leakage.

Status: **shipped**.

- WebSocket `connected` payload includes `cliAgent` with `id`, `displayName`,
  and capability flags.
- Frontend `ConnectedMessage` type extended with `CliAgentInfo`.
- Terminal status indicator (`[claude]`, `[codex]`, `[cursor]`) driven by the
  adapter's `displayName` instead of hardcoded text.
- Protocol and doc comments updated from "Claude terminal" to "agent terminal"
  where the reference is generic.
- `docs/user/configuration.md` updated with CLI Coding Agent section: how to
  select Claude Code / Codex / Cursor, MCP integration differences, and
  capability matrix.

## Open Questions

- ~~Does Codex CLI currently support MCP config injection?~~ **Answered**: No `--mcp-config` flag. Uses `~/.codex/config.toml`. CADE merges entries directly.
- ~~Does Cursor CLI currently support MCP config injection?~~ **Answered**: No `--mcp-config` flag. Uses `.cursor/mcp.json` with auto-discovery. `--approve-mcps` handles approval.
- ~~Do either expose hook/event callbacks?~~ **Answered**: Neither Codex nor Cursor has hooks. File watcher fallback applies.
- Should per-project `.cade/launch.yml` be allowed to select the CLI coding agent, or should it remain user/global configuration only?
- Should `cc_session_resolver.py` become a vendor-specific optional service, or should session resolution be removed from the generic CLI path?

## Implementation Notes

Keep the naming sharp:

- `api provider`: LiteLLM/structured chat path
- `cli coding agent`: Claude Code/Codex/Cursor terminal path
- `adapter`: per-CLI launch/config/hook bridge
- `MCP bridge`: shared CADE tools exposed to CLI agents
- `hook bridge`: optional vendor-specific event feed back into CADE

This distinction is the core design guardrail. Codex and Cursor should integrate the way Claude Code integrates today, not the way LiteLLM providers integrate.
