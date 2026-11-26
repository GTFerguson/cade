---
title: Dead Code in the Provider and Permission Layers
created: 2026-11-26
updated: 2026-11-26
status: active
priority: low
tags: [quick-fix, providers, permissions, cleanup]
---

# Dead Code in the Provider and Permission Layers

Not fixed. Items 1 to 3 were found by searching for call sites. Item 4 was confirmed by a one-line check, described below. What is wired into chat is in [[../../technical/core/provider-stack]].

## Problem

1. **`AgentSpawnerTool` is never registered.** Its `execute()` is a placeholder that returns a JSON description of the request. Chat agents get `spawn_agent` from the orchestrator MCP server.
2. **`NkrdnExecutor` is never registered.** The docstring of the function that builds the tool registry says nkrdn is always included. It is not. Chat agents reach nkrdn through `bash`.
3. **`HandoffCompactor` is used only by its own tests.** `/compact` does not call it.
4. **`/api/permissions/prompt-and-wait` reads attributes that do not exist.** It reads `allow_read`, `allow_write` and `allow_tools` from the `PermissionManager`. Those are fields of the per-connection `ConnectionState`, not of the manager. The endpoint would raise `AttributeError` for any request. Nothing appears to call it.

## Evidence

Item 1:

- `core/backend/providers/agent_spawner.py:60-87`: the placeholder `execute()`.
- `backend/providers/registry.py:16`: imported. No instance is created anywhere outside `backend/tests/test_agent_spawner.py`.
- `backend/providers/registry.py:109-114`: the orchestrator MCP adapter that does supply `spawn_agent`.
- `docs/technical/core/agent-orchestration.md` lists `AgentSpawnerTool` in its key files as the tool definition used in the LiteLLM registry. That is out of date.

Item 2:

- `core/backend/providers/tool_executor.py:124` (`NkrdnExecutor`) and `:168` (`make_nkrdn_registry`). The only caller of either is `backend/tests/test_tool_executor.py`.
- `backend/providers/registry.py:26`: the docstring "Includes: nkrdn (always)". The function body registers no nkrdn tool.

Item 3:

- `backend/providers/handoff_compactor.py:11`.
- `backend/providers/registry.py:11`: imported and not used.
- `backend/websocket.py` (`_do_compact`): the compact flow takes the handoff text from the last assistant message and never touches this class.

Item 4:

- `backend/main.py:1199`, `:1204`, `:1208`: `manager.allow_read`, `manager.allow_write`, `manager.allow_tools`.
- `backend/permissions/manager.py:47-49`: the fields are on `ConnectionState`. `PermissionManager` (`:57` onward) has `accept_edits` and per-connection getters, and none of the three names.
- Check run: `hasattr(PermissionManager(), name)` returned `False` for all three and `True` for `accept_edits`. The endpoint itself was not called.
- `backend/permissions/mcp_server.py:3`: the only client of the endpoint is the `permission_prompt` MCP tool, which Claude Code uses when started with `--permission-prompt-tool`. A search of `backend/`, `core/`, `scripts/` and `frontend/src/` finds nothing that passes that flag.
- `backend/orchestrator/mcp_config.py:82-95`: the `cade-permissions` server is still written into every CLI agent's MCP config.

## Why it matters

- The three classes read as live features, and the orchestration doc still lists one as part of the chat path. Anyone extending spawning, nkrdn access or compaction may start from the wrong class.
- The wrong docstring sends a reader looking for a tool that is not there.
- The endpoint is a trap: if a future change starts using the permission MCP server, every prompt fails with a 500 instead of asking the user.
- Starting an extra MCP server process per CLI agent that nothing can call costs memory and start-up time. Whether Claude Code does start it without the flag has not been checked.

## Suggested fix direction

- Items 1 and 3: delete the classes, their imports in `registry.py` and their test files, and correct the key-files table in `docs/technical/core/agent-orchestration.md`. If automatic compaction ([[../infrastructure/tool-support-and-failover]]) wants a brief formatter, it can be written then against the real flow.
- Item 2: decide whether chat agents should have a dedicated nkrdn tool. If yes, register `NkrdnExecutor` in `_create_tool_registry()`; the nkrdn prompt module already describes the commands. If no, delete the class and fix the docstring. Either way the docstring changes.
- Item 4: first decide whether the permission MCP server has a future. If not, remove the endpoint, `backend/permissions/mcp_server.py`, the `cade-permissions` entry in `mcp_config.py` and the `permissions` choice of the `mcp-server` subcommand in `backend/main.py`. If it stays, read the three flags through `get_permissions(connection_id)` using the `X-Connection-Id` header the endpoint already receives, and add a test that calls the endpoint.
