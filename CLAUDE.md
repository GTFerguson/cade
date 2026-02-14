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
│   └── user/                # End-user documentation
├── plans/                   # Active development notes (no approval needed)
├── .roo/rules/              # Project-specific conventions
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

## Development Workflow

### `plans/` - Working documents
- Create, modify, delete freely during development
- For active planning, brainstorming, and work-in-progress
- Delete or migrate when complete

### `docs/` - Curated documentation
- **Requires user approval** for content changes
- Minor fixes (typos, broken links) allowed without approval
- Prompt user at milestones: "Would you like me to update the documentation?"

### Lifecycle

```
plans/ (active) --> docs/technical/ (complete)
                --> docs/future/ (deferred)
```

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