---
title: Agent Lifecycle & Orchestration
created: 2026-01-31
updated: 2026-05-06
status: implemented
tags: [agents, orchestration, lifecycle, architecture]
---

# Agent Lifecycle & Orchestration

Multi-agent system where an orchestrator session spawns specialized worker agents to delegate work. Each worker is a fresh `APIProvider` running its own conversation loop in the same backend process, with output streamed to a dedicated tab in the orchestrator's UI. Two-gate approval (spawn → report) keeps the user in the loop, and a hierarchical parent/root model lets workers spawn workers without losing the routing path back to the original WS connection.

## Surface area

- `/orch` slash command toggles **orchestrator mode** for the active session.
- The MCP server `cade-orchestrator` (`backend/orchestrator/mcp_server.py`) exposes `spawn_agent(name, task, mode)` and `list_agents()` to the orchestrator. Both are filtered out for non-orchestrator sessions via `APIProvider._ORCHESTRATOR_ONLY_TOOLS`.
- HTTP routes under `/api/orchestrator/*` (`backend/main.py`): `spawn-and-wait`, `approve-agent`, `reject-agent`, `approve-report`, `reject-report`, `message`.
- Frontend renders one tab per worker plus an agent overview pane with state pills.

## Lifecycle state machine

`AgentState` (`backend/orchestrator/models.py`) drives both backend logic and UI state.

```
spawn_agent       approve_agent      stream         ChatDone
   ↓                  ↓                ↓               ↓
PENDING ─────────► STARTING ─────► BUSY ─────► REVIEW ─────► CLOSED
   │                                  │            │
   │ reject_agent                     │ ChatError  │ reject_report
   ▼                                  ▼            ▼
ERROR                              ERROR         CLOSED
```

- `PENDING` — record exists; awaiting user/auto approval.
- `STARTING` → `BUSY` — provider is streaming; transitions on first `TextDelta`.
- `REVIEW` — agent finished its turn; report awaiting approval (auto-approved when `auto_approve_reports` is on).
- `CLOSED` — final report stored in `final_result`; `completion_event` set.
- `ERROR` — fault path (provider error, kill, rejection); also sets `completion_event`.

`OrchestratorManager.await_completion()` blocks on the `completion_event`, so `spawn-and-wait` is a true blocking RPC for the orchestrator's tool call.

## Two-gate approval

Both gates send WS events to the **root** WS connection (not the calling agent), so user-facing prompts always land in the original tab.

| Gate | Event sent | User action | Resolution |
|------|------------|-------------|------------|
| Spawn | `agent-approval-request` | Approve / reject | `approve_agent` creates the provider and starts streaming; `reject_agent` short-circuits to ERROR |
| Report | `report-review-request` | Approve / reject | `approve_report` returns the report text to the MCP caller; `reject_report` returns the rejection message |

Autonomous mode (`allow_subagents=True`) auto-approves the spawn gate in the `spawn-and-wait` route. Auto-approve reports is a separate per-connection toggle read in `_run_agent`.

## Worker provider construction

`_make_worker_provider()` builds an isolated `APIProvider` per worker:

- Clones the default API provider config (or first API-type provider as fallback).
- Composes the system prompt for the worker's mode via `compose_prompt(mode, working_dir)`.
- Wires its own `ToolRegistry` via `_create_tool_registry`, scoped to the **worker's `agent_id`** as the connection id.

That last point is the key isolation trick: the worker's `agent_id` doubles as its `PermissionManager` connection id, so `pm.set_mode(record.mode, connection_id=agent_id)` gives the worker its own mode without touching the parent. Tool executors (file ops, bash) read `pm.get_mode(connection_id)` and enforce read-only for `plan` / `architect` / `review` modes regardless of what the orchestrator's mode is.

Permission prompts are forwarded to the owner's WS via `pm.register_broadcast(agent_id, owner_fn)`. When the worker exits, `_run_agent`'s `finally` calls `pm.drop_connection(agent_id)` to clean up.

## Hierarchical spawning

`AgentRecord.parent_agent_id` is set when the caller's `connection_id` is itself a registered agent. `_root_connection_id()` walks the chain to find the original WS connection — used everywhere we send a UI-facing message:

```python
def _root_connection_id(self, connection_id: str) -> str:
    cur = connection_id
    while cur not in self._connections:
        record = self._agents.get(cur)
        if record is None: break
        cur = record.owner_connection_id
    return cur
```

This lets a worker call `spawn_agent` and have the approval dialog land in the user's tab, not in the worker's own (non-existent) WS connection.

`kill_connection_agents()` uses the same walk to tear down a whole subtree when a connection drops.

## Multi-turn steering

Each running agent has an `asyncio.Queue` in `_message_queues`. Inside `_run_agent`, after the provider yields `ChatDone`, the loop checks the queue:

- **Empty:** transition to `REVIEW`, send `report-review-request`, optionally auto-approve, return.
- **Not empty:** pop the message, rebuild the conversation as `[orig_user, assistant_reply, new_user]`, restart the outer turn.

The `send_message_to_agent` HTTP route enqueues messages while the agent is `BUSY` or `STARTING`. Once the agent is in `REVIEW` or terminal, the route returns 400 — at that point the user goes through the report flow instead of steering.

## Cost & usage tracking

`APIProvider._compute_cost()` calls `litellm.cost_per_token(model, prompt_tokens, completion_tokens)` and yields the result on `ChatDone`. `_run_agent` writes `event.cost` and `event.usage` to the `AgentRecord`, and both are returned by `await_completion()` and `get_report()`.

Cost is per-turn — for multi-turn agents the field reflects the most recent turn. There is no aggregated cost across the full lifecycle.

## Naming

Caller-supplied names are coerced to a kebab-case slug in `_slugify()` (lowercase, alnum-only, runs of separators collapsed to `-`, capped at 30 chars). `_resolve_name()` falls back to a slug of the task description, then to `"agent"`, when the supplied name produces an empty slug.

Display-name uniqueness is enforced only among **active** sub-agents (`PENDING / STARTING / BUSY / DONE / REVIEW`). On collision a numeric suffix is appended (`worker-2`, `worker-3`, …); names of `CLOSED` and `ERROR` agents are reusable. The full `agent_id` is always unique because of the trailing 6-char UUID hex (`agent-{name}-{uuid_hex[:6]}`).

## Configuration

Per-connection toggles in `PermissionManager`:

| Toggle | Effect |
|--------|--------|
| `orchestrator` | Gates whether `spawn_agent` is callable at all |
| `allowSubagents` | Required to actually spawn; when on, `spawn-and-wait` auto-approves the spawn gate |
| `autoApproveReports` | Skips the report gate, closes the agent immediately on `ChatDone` |
| `allow_write` (per worker connection-id) | Inherited at spawn time; `False` forces `accept_edits=False` for the worker |

Modes flow through unchanged: a worker spawned with `mode="plan"` is read-only regardless of the orchestrator's mode.

## Boundaries

What this system **doesn't** do:

- **No agent-to-agent direct messaging.** Workers can spawn workers but can't send arbitrary messages between siblings; coordination flows through the parent.
- **No DAG traversal API.** `parent_agent_id` is recorded but no endpoint surfaces the spawn tree.
- **No persistence across backend restarts.** `OrchestratorManager` state is in-memory only.
- **No aggregated cost.** Cost is the last turn's cost, not a running total.
- **No agent templates or perf metrics.** Listed as future enhancements; not in scope.

## CLI delegation (Claude Code → API workers)

Claude Code running inside a CADE terminal tab can delegate work to CADE's LiteLLM API workers via the same `spawn_agent` MCP tool. The wiring:

1. On websocket connect, `prepare_cli_orchestrator_env` writes a per-session MCP config to `~/.cade/mcp/session-<id>.json` and injects its path as `CADE_CLI_MCP_CONFIG` into the PTY environment.
2. `cade-resume.sh` (sourced by the PTY shell) reads `$CADE_CLI_MCP_CONFIG` and launches Claude Code as `claude --mcp-config <path>`, making `mcp__cade-orchestrator__spawn_agent` available in that session.
3. Claude Code stays on the Max plan for planning and review; worker tasks (implementation, multi-file edits, research) are delegated to the configured LiteLLM provider (typically Minimax).

### MCP config generation

`backend/orchestrator/mcp_config.py` writes the per-session JSON. The command/args depend on context:

- **Dev mode** (`sys.frozen` is False): venv Python + source `mcp_server.py` scripts
- **Packaged binary** (`sys.frozen` is True): `cade-backend mcp-server --type orchestrator|permissions` subcommand

The `mcp-server` subcommand was added to `main.py` specifically for this. Older packaged binaries that called `cade-backend /path/to/mcp_server.py` are handled by a legacy path in `main.py`'s entry point, and by `__cade_patch_mcp_config` in `cade-resume.sh` which fixes the config in place before Claude Code starts.

## Key files

| File | Role |
|------|------|
| `backend/orchestrator/manager.py` | `OrchestratorManager`, slug/name helpers, worker provider factory |
| `backend/orchestrator/models.py` | `AgentSpec`, `AgentRecord`, `AgentState` |
| `backend/orchestrator/mcp_server.py` | stdio MCP server exposing `spawn_agent` / `list_agents` |
| `backend/orchestrator/mcp_config.py` | Writes per-session MCP config files for CLI tabs |
| `backend/terminal/agent_launch.py` | Generates `cade-resume.sh`; includes `__cade_patch_mcp_config` |
| `core/backend/providers/agent_spawner.py` | `AgentSpawnerTool` — tool definition surfaced inside the LiteLLM tool registry |
| `backend/main.py` (`/api/orchestrator/*`) | HTTP routes + `mcp-server` subcommand |
| `backend/prompts/modules/orchestrator.md` | Mode-specific system prompt for orchestrator sessions |
| `backend/tests/test_orchestrator_manager.py` | Manager + naming + multi-turn coverage |
| `backend/tests/test_agent_spawner.py` | `AgentSpawnerTool` interface tests |

## See Also

- [[frontend-architecture|Frontend Architecture]]
- [[prompt-composition|Prompt Composition]]
- [[agent-tools|Agent Tools]]
