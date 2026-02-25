# CADE

**Claude Agentic Development Environment**

Vim and tmux proved something: keyboard-driven, distraction-free tools create flow states. CADE brings that philosophy to AI-assisted development — a workspace where Claude Code in a terminal is the centerpiece, not a sidebar.

This is not an IDE with AI bolted on. The terminal IS the IDE. Everything else — the file tree, the viewer, the tabs — exists to serve it.

Available as a **web application** and **native desktop app** (Windows, macOS, Linux).

## Philosophy: Power Tools for the AI Age

Traditional IDEs treat AI as an assistant living in a chat panel. CADE inverts this: the AI agent is the primary worker, the human is the supervisor. The interface is built around that reality.

**Agent-first, not agent-assisted.** The terminal gets 50% of the screen by default. The file tree and document viewer flank it. There are no wizards, no settings dialogs, no chrome between you and the work.

**Terminal aesthetic, not web aesthetic.** Monospace typography throughout. Bracket notation (`[ LIKE THIS ]`) instead of rounded buttons. Full-pane screen replacements instead of modal dialogs. Zero `border-radius`, zero `box-shadow`. When in doubt, we ask: *"Would this feel at home in tmux?"*

**Keyboard-first, mouse optional.** Vim navigation (`j`/`k`/`h`/`l`) works across every screen — file tree, viewer, theme selector, remote connection picker, splash screen. One set of keys, learned once, used everywhere.

## Everything is Two Keystrokes Away

The three-pane layout is not just a visual choice — it's an ergonomic one. Every context you need is always visible, and reachable with a single tmux-style prefix chord (`Ctrl+a`):

| Shortcut | Action |
|----------|--------|
| `Ctrl+a` `h` | Focus file tree |
| `Ctrl+a` `l` | Focus viewer |
| `Ctrl+a` `s` | Toggle Claude / shell terminal |
| `Ctrl+a` `f` / `d` | Next / previous tab |
| `Ctrl+a` `1-9` | Jump to tab by number |
| `Ctrl+a` `c` | New local project tab |
| `Ctrl+a` `C` | New remote project tab |
| `Ctrl+a` `v` | Toggle viewer pane |
| `Ctrl+a` `t` | Theme selector |
| `Ctrl+a` `?` | Help |
| `Ctrl+g` | View latest plan *(1 keystroke)* |

Hold the prefix key down to chain multiple shortcuts without re-pressing it. Every binding is configurable via `keybindings.toml`.

## Features

**Three-pane workspace** — File tree (20%), terminal (50%), document viewer (30%). Resizable with keyboard or mouse. Proportions persist across sessions.

**Session persistence** — PTY processes survive browser refreshes and disconnections. Close your laptop, reopen — your Claude session is exactly where you left it, scrollback and all.

**Multi-project tabs** — Each tab is an isolated environment with its own terminal session, file tree, and viewer. Switch with `Ctrl+a` `1-9`.

**Dual terminal** — Every tab has two PTY sessions: one for Claude Code, one for a manual shell. Toggle with `Ctrl+a` `s`. No context switching, no new windows.

**Remote deployment** — Run the backend on any server. Access from a browser with token auth, or from the desktop app via managed SSH tunnels. Same session from your desk, your couch, or your phone.

**Mobile interface** — Touch toolbar with terminal keys (`esc`, `tab`, `^c`), swipe navigation, slideout panels. Connect to a running session from your phone to monitor Claude while you're away from your desk.

**Plan viewer** — A Claude Code hook automatically displays plan files in the viewer as Claude writes them. `Ctrl+g` pulls up the latest plan instantly.

**Neovim integration** — Embedded Neovim pane in the viewer for reviewing and editing files with your own vim config.

**Markdown rendering** — LaTeX math (KaTeX), Mermaid diagrams, syntax highlighting, Obsidian-compatible `[[wiki-links]]` — all rendered in the viewer.

**5 built-in themes** — True Black, Deep Contrast, Ember, Ink, Badwolf. All share the Badwolf accent palette. Live-preview selector at `Ctrl+a` `t`.

**Vim navigation everywhere** — `j`/`k` to move, `l` to select, `h` to go back. Works in the file tree, the viewer, menus, and every TUI screen. Builds one set of muscle memory for the entire application.

**WSL support** — Automatic WSL detection, path translation, and gateway resolution on Windows.

## Quick Start

### Desktop App

```bash
make setup        # install prerequisites and dependencies
make dev-desktop  # start in dev mode
make build-desktop  # build installers
```

See [SETUP.md](SETUP.md) for detailed instructions or [desktop/QUICKSTART.md](desktop/QUICKSTART.md) for desktop-specific docs.

### Web Version

```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && npm run build && cd ..

# Run
python -m backend.main
```

For development with hot reload, see [SETUP.md](SETUP.md).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript, xterm.js (WebGL), Vite |
| Backend | Python 3.11+, FastAPI, uvicorn |
| Desktop | Tauri v2 (Rust) |
| Markdown | mertex.md (marked + KaTeX + Mermaid + DOMPurify) |

## Documentation

| Topic | Location |
|-------|----------|
| Setup and configuration | [SETUP.md](SETUP.md) |
| Technical architecture | [docs/technical/](docs/technical/README.md) |
| Design philosophy | [docs/technical/design/visual-design-philosophy.md](docs/technical/design/visual-design-philosophy.md) |
| User guides | [docs/user/](docs/user/README.md) |
| Roadmap | [docs/future/](docs/future/README.md) |

## License

MIT
