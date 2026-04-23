---
title: Neovim persistent instance + file tools wired to Neovim side-effects
created: 2026-04-23
status: in-flight
---

# Resume: Neovim integration — persistent instance manager + editor side-effects on file writes

## Contract — how to use this file

1. **Execute** — read this file first, then resume the Next actions below.
2. **Update as you go** — tick off next-actions, add gotchas, revise file lists.
3. **Graduate on completion** — design decisions → `docs/technical/core/`, then delete this file.
4. **Delete this file** — its existence means work is in the air.

## Where we are

File tools (read_file, write_file, edit_file, delete_file) are shipped and wired. Neovim's role is UI-only: agents edit via file tools, Neovim shows the result live. Two things remain: (1) the persistent Neovim instance manager in `backend/neovim/`, and (2) hooking the file tools to open/reload the affected file in Neovim after each write.

## Worktree / branch

- Path: `/home/gary/projects/cade`
- Branch: `main`
- Last commit: `a431f12 feat: file editing tools with mode permissions and scope enforcement`

## Shipped this session

- `8496604` feat: modular prompt composition + mertex error display
- `f8d30b3` feat: mermaid self-heal via adaptive provider
- `a9e281a` fix: wire mertex.md as proper submodule pointing to GitHub
- `b3c7f3c` feat: add Neovim prereq check to setup-dev.sh
- `a431f12` feat: file editing tools with mode permissions and scope enforcement

## In flight (uncommitted work)

Nothing. Working tree is clean.

## Next actions (ordered)

All done. Graduate to architecture doc.

## Key design decisions

- **Neovim is UI, not tool** — agents never call Neovim directly. File tools write to disk; Neovim side-effect is transparent.
- **Auto-save** — no unsaved-buffer review gate. Git is the safety net. File tools write straight to disk; Neovim just opens/reloads.
- **Headless + Unix socket** — `nvim --listen /tmp/cade-nvim.sock --headless`. pynvim attaches via socket. One instance per CADE session.
- **File tools permission layers** (shipped):
  - Mode gate: architect/review see only read_file
  - Scope gate: writes outside project root require approval, cached at directory level
  - Accept-edits toggle: off = every write prompts; on = auto-approve within scope
- **accept_edits defaults to True** for convenience.
- **Out-of-scope approval caches at directory level** — approving `/some/other/dir/foo.py` approves the whole `/some/other/dir/` prefix for the session.

## Files touched / to touch

Shipped:
- `/home/gary/projects/cade/backend/tools/__init__.py`
- `/home/gary/projects/cade/backend/tools/file_tools.py`
- `/home/gary/projects/cade/backend/permissions/mode_permissions.py`
- `/home/gary/projects/cade/backend/permissions/manager.py`
- `/home/gary/projects/cade/backend/providers/registry.py`
- `/home/gary/projects/cade/backend/websocket.py`
- `/home/gary/projects/cade/backend/main.py`

Pending (Neovim work):
- `/home/gary/projects/cade/backend/neovim/__init__.py` — new
- `/home/gary/projects/cade/backend/neovim/manager.py` — new
- `/home/gary/projects/cade/backend/prompts/modules/neovim.md` — new
- `/home/gary/projects/cade/backend/prompts/compose.py` — add neovim.md to ALWAYS
- `/home/gary/projects/cade/backend/tools/file_tools.py` — add Neovim side-effect after writes
- `/home/gary/projects/cade/backend/main.py` — start Neovim manager in lifespan

## Build & verify

```bash
# Verify file tools + permission layers
python3 -c "
from backend.tools.file_tools import FileToolExecutor
from backend.permissions.manager import get_permission_manager
from pathlib import Path
get_permission_manager().set_mode('code')
e = FileToolExecutor(Path('.'))
print([d.name for d in e.tool_definitions()])
get_permission_manager().set_mode('architect')
print([d.name for d in e.tool_definitions()])
"

# Run backend
.venv/bin/python -m backend.main serve --port 3001 --no-browser --debug
```

## Gotchas encountered

- `ProviderRegistry.from_config` is called in two places: `websocket.py` (pass `working_dir`) and `backend/main.py` fix-diagram endpoint (no `working_dir` — file tools not needed there). `working_dir` param defaults to None so the fix-diagram path is unaffected.
- `tool_definitions()` is mode-sensitive — write tools simply absent from the list in architect/review, so the LLM can't call them. Execution also re-checks mode as a second guard.
- mertex.md submodule was previously a symlink to a local path (`f43253a`), not a real GitHub ref. Fixed this session — now points to `be09056` at `GTFerguson/mertex.md`.
