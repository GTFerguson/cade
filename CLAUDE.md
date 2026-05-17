# Agent Onboarding Guide

Quick orientation for AI agents working on CADE. This is a signpost document - detailed information lives in the referenced docs.

## Project Identity

**CADE** (Claude Agentic Development Environment) is an agent-first development environment with Claude Code in a terminal shell as its centerpiece. The interface provides a unified workspace where AI-assisted development is the primary workflow, not an afterthought.

## Codebase Orientation

```
cade/
├── docs/                    # Maintained documentation (approval required)
│   ├── README.md            # Navigation hub
│   ├── technical/           # Implemented systems
│   │   ├── core/            # Architecture, getting started
│   │   ├── reference/       # API documentation
│   │   └── design/          # Design rationale
│   ├── future/              # Roadmap & planned features
│   ├── plans/               # Active development notes (no approval needed)
│   └── user/                # End-user documentation
├── .claude/rules/           # Project-specific conventions
└── CLAUDE.md                # This file
```

## Documentation Navigation

| Need to understand... | Read |
|-----------------------|------|
| Documentation structure | `docs/README.md` |
| Technical architecture | `docs/technical/README.md` |
| Future plans/roadmap | `docs/future/README.md` |
| User-facing guides | `docs/user/README.md` |

## Key Files

| What | Where |
|------|-------|
| Design bible | `docs/technical/design/visual-design-philosophy.md` |
| CSS directory | `frontend/styles/` (see `main.css` index for layout) |
| Theme definitions | `frontend/src/config/themes.ts` |

## Conventions

Rules are defined in `.claude/rules/` - read these files for full details:

- **documentation-organization.md** - Doc structure and approval workflow

Global rules (apply to all projects) are in `~/.claude/rules/`:

- **markdown-formatting.md** - Obsidian.md compatibility standards
- **code-comments.md** - Comment quality guidelines (WHY not WHAT)

## Padarax-owned files in frontend/src/padarax/

`frontend/src/padarax/` is a mirror of content owned by the Padarax repo. **Do not edit these files directly in CADE.** Changes must originate in `~/projects/padarax/client/core/frontend/src/padarax/` and flow in via subtree cherry-pick.

Generic platform utilities extracted from this layer live in `frontend/src/platform/refs.ts`. Dashboard components (`entity-detail.ts`, `claims.ts`) should import from there, not from `padarax/`.

## Demo Mode

When asked to "show something in demo" or "use demo mode":

1. Add a scenario to `frontend/src/demo.ts` that injects the relevant synthetic WS events (`file-content`, `view-file`, `connected`, `chat-history`, `dashboard-data`, etc.) via `ws.injectEvent()`
2. Start the Vite dev server: `cd frontend && npm run dev -- --port 5175`
3. Open in the user's browser: `xdg-open "http://localhost:5175/?demo=<scenario-name>"` (Linux). Use `open` on macOS, `start` on Windows.

**Never start or kill the production backend for demo purposes.** Demo mode is entirely frontend — the dev server connects to nothing, all data is injected client-side. Only works when `import.meta.env.DEV` is true (Vite dev server).

Existing scenarios: `mobile-npc`, `mobile-explore`, `mobile-walk`, `mobile-noexits`, `viewer`. Add new ones as needed. Clean up temporary scenarios after use if they're one-off.

## Development Workflow

### `docs/plans/` - Working documents
- Create, modify, delete freely during development
- For active planning, brainstorming, and work-in-progress
- Delete or migrate when complete

### `docs/` - Curated documentation
- **Requires user approval** for content changes
- Minor fixes (typos, broken links) allowed without approval
- Prompt user at milestones: "Would you like me to update the documentation?"

### Lifecycle

```
docs/plans/ (active) --> docs/technical/ (complete)
                     --> docs/future/ (deferred)
```

## Provider Architecture

CADE runs LLM sessions through **LiteLLM API providers** (`type = "api"`). The
config also accepts `cli`, `failover`, `subprocess`, and `websocket` provider
types, but `api` is the path that serves chat. **Check `~/.cade/providers.toml`
before touching provider code** — the active provider determines where a fix
belongs.

### LiteLLM API providers (`type = "api"`)

All providers are LiteLLM-backed (Mistral, Cerebras, Groq, Minimax, etc.).

| Concern | Where it lives |
|---------|---------------|
| Tool definitions | `ToolRegistry` → passed explicitly to LiteLLM |
| Tool execution | `tool_executor.py` + `registry.py` |
| Mode-aware tool filtering | `APIProvider.set_mode()` filters defs before each LiteLLM call |
| Permission enforcement | `PermissionManager` (checked in file tools + `prompt-and-wait` endpoint) |
| Orchestrator tools | `_create_tool_registry()` wires the orchestrator MCP adapter; hidden from non-orchestrator sessions via `_ORCHESTRATOR_ONLY_TOOLS` filter |

Orchestrator subagents are spawned through `_make_worker_provider()`, which
always builds an `APIProvider` — orchestration does not depend on any external
agent runtime.

### Shared state

`PermissionManager` is the single source of truth for current mode and
permission flags. The frontend permissions panel writes to it via
`/api/permissions/set`.

## Building the Desktop App

The desktop app has **two binaries** built by separate systems:

| Binary | Build system | Source |
|--------|-------------|--------|
| `cade.exe` | Tauri (Rust/Cargo) | `desktop/src-tauri/src/` |
| `cade-backend.exe` | PyInstaller (Python) | `backend/` |

### How to build

```bash
# 1. Build frontend first
cd frontend && npm run build

# 2. Build desktop (this auto-rebuilds the Python backend via beforeBuildCommand)
cd desktop && npm run tauri build
```

The `beforeBuildCommand` in `tauri.conf.json` automatically runs `scripts/build-backend-sidecar.py`, which rebuilds the PyInstaller binary and copies it to `desktop/src-tauri/resources/`. A single `npm run tauri build` always produces a fully up-to-date app.

For a full build including Neovim bundling: `scripts/build-desktop.ps1`

### IMPORTANT: Never run PyInstaller manually

Do NOT run PyInstaller with a custom `--distpath` — it bypasses the copy to `resources/` and Tauri will bundle a stale binary. Always use `npm run tauri build` or `scripts/build-desktop.ps1`.

## Git Commits

- **Do NOT include `Co-Authored-By` lines** in commit messages
- Write clear, concise commit messages describing what changed and why
- Follow existing commit style (see `git log --oneline`)