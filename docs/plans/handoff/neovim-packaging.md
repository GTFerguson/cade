---
title: Bundle Neovim with CADE and maintain a persistent instance for agents
created: 2026-04-23
status: in-flight
---

# Resume: Bundle Neovim into CADE setup and maintain a persistent instance

## Contract — how to use this file

1. **Execute** — read this file first, then resume the Next actions below.
2. **Update as you go** — tick off next-actions, add gotchas, revise file lists.
3. **Graduate on completion** — design decisions → `docs/technical/core/`, then delete this file.
4. **Delete this file** — its existence means work is in the air.

## Where we are

Neovim is installed on Gary's machine but CADE's setup process doesn't include it. The goal is to bundle Neovim so it always comes with CADE, then keep a persistent instance running that agents (and CADE internals) can address via RPC.

The architectural decision already made: Neovim is a **UI layer tool, not an MCP tool**. Agents write files/paths; CADE drives the editor. No MCP server, no agent tool — prompt module describes what the agent can write and CADE handles the Neovim interaction.

## Worktree / branch

- Path: `/home/gary/projects/cade`
- Branch: `main`
- Last commit: `6e5d7d0 feat: wire orchestrator MCP tools into API providers with async tool execution`

## In flight (uncommitted work)

Everything below is in the working tree, not yet committed. **Commit before starting Neovim work.**

### From previous session (prompt composition + mertex error display)
- `backend/prompts/` — new package: `compose_prompt(mode)` assembles from markdown modules
- `backend/prompts/modules/dashboard.md`, `nkrdn.md`, `code.md`, `architect.md`, `review.md`, `orchestrator.md`
- `backend/providers/claude_code_provider.py` — uses `compose_prompt` instead of hardcoded strings
- `backend/orchestrator/prompts.py` — one-liner delegating to `compose_prompt("orchestrator")`
- `backend/providers/registry.py` — APIProvider gets `compose_prompt(mode)` at creation
- `backend/websocket.py` — `MODE_PROMPTS` import replaced with `compose_prompt`
- `docs/technical/core/prompt-composition.md` — new architecture doc
- `docs/technical/README.md` — linked new doc
- `docs/technical/core/agent-orchestration.md` — updated "What Was Built" bullet
- `mertex.md/src/handlers/mermaid-handler.js` — error path renders `.mermaid-error` div
- `mertex.md/dist/` — rebuilt
- `frontend/styles/workspace/chat.css` — `.mermaid-error` styles

### From this session (mermaid self-heal wiring)
- `backend/main.py` — added `POST /api/fix-diagram`: loads adaptive provider via `get_providers_config()` + `ProviderRegistry.from_config()`, streams through the failover stack (mistral → cerebras → groq → gemma), returns fixed diagram code
- `core/frontend/chat/markdown-renderer.ts` — added `selfCorrect` field to `MarkdownRendererOptions`, merged into `MertexMD` constructor options
- `frontend/src/chat/chat-pane.ts` — passes `selfCorrect.fix` that POSTs to `/api/fix-diagram` with `maxRetries: 2`

## Next actions (ordered)

1. **Commit all working tree changes** — two commits is fine:
   - `feat: modular prompt composition + mertex error display`
   - `feat: mermaid self-heal via adaptive provider`
2. **Push mertex.md changes to GitHub** — `GTFerguson/mertex.md`. Local project at `/home/gary/projects/mertex.md` has no `.git` yet. Need `git init`, set remote to `https://github.com/GTFerguson/mertex.md`, push.
3. **Bump mertex.md submodule ref** in CADE after pushing (current gitlink: `f43253afe9ff34de655d98577004307f60adfb53`)
4. **Decide Neovim bundling strategy** — discuss with Gary:
   - Option A: AppImage/binary download at setup time
   - Option B: add `neovim` to setup script prereqs, abort/warn if missing
5. **Update setup script** (`scripts/` — find the exact file) to include Neovim
6. **Implement persistent Neovim instance manager** in `backend/neovim/` — spawn on startup, keep alive, reconnect on crash
7. **Add `neovim.md` prompt module** at `backend/prompts/modules/neovim.md` — tells agents what they can request (open file at line, show diff)

## Key design decisions

- **Neovim is UI, not tool** — agents don't call Neovim directly. They write intent (file path, line number, diff) and CADE handles the RPC. Keeps agent prompts clean.
- **Persistent instance** — single long-lived Neovim process per CADE session, not spawn-per-operation.
- **Prompt module pattern** — same as `dashboard.md` and `nkrdn.md`. No MCP tools needed.
- **Self-heal uses adaptive router** — `POST /api/fix-diagram` goes through `ProviderRegistry.from_config()` so it respects `~/.cade/providers.toml` including failover. No hardcoded model.
- **mertex.md submodule** — `GTFerguson/mertex.md`. Local at `/home/gary/projects/mertex.md` has no `.git` yet (populated by file copy). Submodule in CADE has no `.git/modules/` either.

## Files touched / to touch

Modified (uncommitted):
- `/home/gary/projects/cade/backend/main.py`
- `/home/gary/projects/cade/backend/prompts/` (new package — all files)
- `/home/gary/projects/cade/backend/providers/claude_code_provider.py`
- `/home/gary/projects/cade/backend/orchestrator/prompts.py`
- `/home/gary/projects/cade/backend/providers/registry.py`
- `/home/gary/projects/cade/backend/websocket.py`
- `/home/gary/projects/cade/core/frontend/chat/markdown-renderer.ts`
- `/home/gary/projects/cade/frontend/src/chat/chat-pane.ts`
- `/home/gary/projects/cade/frontend/styles/workspace/chat.css`
- `/home/gary/projects/cade/docs/technical/core/prompt-composition.md` (new)
- `/home/gary/projects/cade/docs/technical/README.md`
- `/home/gary/projects/cade/docs/technical/core/agent-orchestration.md`
- `/home/gary/projects/cade/mertex.md/src/handlers/mermaid-handler.js`
- `/home/gary/projects/cade/mertex.md/dist/`

Pending (Neovim work):
- `/home/gary/projects/cade/scripts/` — setup/install script (find exact file)
- `/home/gary/projects/cade/backend/neovim/` — persistent instance manager (new)
- `/home/gary/projects/cade/backend/prompts/modules/neovim.md` — agent prompt module (new)

## Build & verify

```bash
# Verify prompt composition
python3 -c "from backend.prompts import compose_prompt; print(compose_prompt('code')[:100])"

# Run backend
.venv/bin/python -m backend.main serve --port 3001 --no-browser --debug

# Build frontend
cd frontend && npm run build
```

## Gotchas encountered

- `MODE_PROMPTS` was imported by `backend/websocket.py` — missed import caused startup crash. Fixed.
- mertex.md at `/home/gary/projects/mertex.md` has no `.git` repo — cannot commit there directly. Need `git init` + set remote before pushing.
- CADE's mertex.md submodule has no `.git/modules/` — populated by file copy, not proper `git submodule update`. After pushing to GitHub, bump the submodule ref in CADE.
- `ProviderRegistry.from_config()` wires MCP tools and the orchestrator adapter — this is fine for the fix-diagram endpoint but is slightly heavy for a one-shot call. Acceptable for now.
