---
title: Bundle Neovim with CADE and maintain a persistent instance for agents
created: 2026-04-23
status: in-progress
verified: 2026-04-24
---

# Neovim Integration — persistent instance manager

## Completed Phases

### Prompt Composition + Mermaid Self-heal — Completed 2026-04-23

Modular prompt composition: `backend/prompts/` package with `compose_prompt(mode)` assembling from markdown modules (`dashboard.md`, `nkrdn.md`, `code.md`, `architect.md`, `review.md`, `orchestrator.md`). Mermaid self-heal: `POST /api/fix-diagram` routes through `ProviderRegistry.from_config()` (full failover stack, no hardcoded model). `mertex.md` wired as proper submodule pointing to `GTFerguson/mertex.md` on GitHub.

Key code: `backend/prompts/`, `backend/main.py` (`/api/fix-diagram`), `core/frontend/chat/markdown-renderer.ts`, `frontend/src/chat/chat-pane.ts`, `frontend/styles/workspace/chat.css`

Gotcha: `MODE_PROMPTS` was imported by `backend/websocket.py` — missed import caused startup crash after migration to `compose_prompt`. Mertex.md submodule was previously a file-copy symlink, not a real GitHub ref; fixed by git init + push to `GTFerguson/mertex.md`.

### File Tools + Neovim Prereq Check — Completed 2026-04-23

File editing tools (read_file, write_file, edit_file, delete_file) with two permission layers: (1) mode gate — architect/review see only read_file, code/orchestrator get all four; (2) scope gate — writes outside project root require approval, cached at directory level for the session. `accept_edits` defaults to True.

Neovim prereq added to `scripts/setup-dev.sh`.

Key code: `backend/tools/file_tools.py`, `backend/permissions/mode_permissions.py`, `backend/permissions/manager.py`, `backend/providers/registry.py`, `backend/websocket.py`, `backend/main.py`

Design: Neovim is UI, not tool — agents write via file tools, Neovim shows the result live. Git is the safety net; no unsaved-buffer review gate.

Gotcha: `ProviderRegistry.from_config()` is called in both `websocket.py` (with `working_dir`) and the fix-diagram endpoint (without `working_dir`) — `working_dir` defaults to None so the endpoint is unaffected. `tool_definitions()` is mode-sensitive; write tools are absent from the list in architect/review, so the LLM can't call them. Execution also re-checks mode as a second guard.

## Remaining Work

### Persistent Neovim Instance Manager

Files to create:

- `backend/neovim/__init__.py` + `manager.py` — spawn `nvim --listen /tmp/cade-nvim.sock --headless`, keep alive, reconnect on crash
- `backend/prompts/modules/neovim.md` — agent prompt module describing what agents can request (open file at line, show diff)

Files to modify:

- `backend/prompts/compose.py` — add `neovim.md` to the ALWAYS modules list
- `backend/tools/file_tools.py` — add Neovim side-effect after writes (open/reload affected file via pynvim)
- `backend/main.py` — start Neovim manager in lifespan

Design decisions already settled: headless + Unix socket (`/tmp/cade-nvim.sock`), one instance per CADE session, no MCP tools for Neovim (UI-only, no agent tool), same prompt module pattern as `dashboard.md` and `nkrdn.md`.
