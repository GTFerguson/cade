---
title: CADE Dependencies
created: 2026-04-24
updated: 2026-04-24
status: active
tags: [architecture, dependencies, infrastructure]
---

# Dependencies

External services, key libraries, and configuration points that CADE depends on.

## External Services

| Service | Protocol | Purpose | Required? |
|---------|----------|---------|-----------|
| Claude Code CLI (`claude`) | subprocess + NDJSON | Primary LLM agent execution | Yes (for ClaudeCodeProvider) |
| Anthropic API | HTTPS via LiteLLM | LLM inference | Yes (for API providers) |
| MCP servers | stdio | Tool extensions (file system, web fetch, etc.) | No (configured per-project) |
| nkrdn | local binary | Code structure + doc knowledge graph | No (optional indexing) |
| Google OAuth | HTTPS | Browser auth for remote deployments | No (auth optional) |
| nginx | TCP | Reverse proxy for remote deployments | No (local dev only needs uvicorn) |
| Remote REST APIs | HTTPS | Dashboard data sources (user-configured) | No |

---

## Python Dependencies

### Core Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | ^0.104 | HTTP + WebSocket server framework |
| `uvicorn[standard]` | ^0.24 | ASGI server with WebSocket support |
| `websockets` | ^12.0 | WebSocket protocol implementation |
| `pydantic` | ^2.0 | Request/response validation |

### LLM & Agent

| Package | Version | Purpose |
|---------|---------|---------|
| `litellm` | ^1.40 | Unified API across 100+ LLM providers |
| `langchain-core` | ^0.2 | Shared LLM abstractions (ChatMessage, etc.) |
| `mcp` | ^1.2 | MCP stdio client — connects to MCP tool servers |
| `anthropic` | (transitive) | Anthropic SDK used via LiteLLM |

### Terminal

| Package | Version | Platform |
|---------|---------|---------|
| `pexpect` | ^4.9 | PTY management on Linux/macOS |
| `pywinpty` | ^2.0 | PTY management on Windows/WSL |

### File System & Config

| Package | Version | Purpose |
|---------|---------|---------|
| `watchfiles` | ^0.21 | Async file change notifications (debounced) |
| `pyyaml` | ^6.0 | Dashboard config + providers TOML parsing |
| `aiofiles` | — | Async file I/O |

### Knowledge Graph

| Package | Version | Purpose |
|---------|---------|---------|
| `nkrdn` | ^1.0 | Code structure + documentation indexing |
| `fastembed` | ^0.4 | Local embedding model for semantic search |

### Editor Integration

| Package | Version | Purpose |
|---------|---------|---------|
| `pynvim` | ^0.5 | Neovim RPC for diff generation |

### Dev / Test

| Package | Version | Purpose |
|---------|---------|---------|
| `pytest` | ^7.4 | Test runner |
| `pytest-asyncio` | ^0.21 | Async test support |
| `ruff` | — | Linter + formatter |
| `mypy` | — | Static type checking |

---

## JavaScript / TypeScript Dependencies

### Terminal

| Package | Version | Purpose |
|---------|---------|---------|
| `@xterm/xterm` | ^5.5 | Terminal emulator (xterm.js) |
| `@xterm/addon-canvas` | ^0.7 | Canvas renderer |
| `@xterm/addon-webgl` | ^0.18 | WebGL renderer (GPU-accelerated) |
| `@xterm/addon-fit` | ^0.10 | Auto-resize terminal to container |
| `@xterm/addon-web-links` | ^0.11 | Clickable URLs in terminal output |

### Markdown

| Package | Version | Purpose |
|---------|---------|---------|
| `@milkdown/core` | ^7.3 | Markdown editor framework |
| `@milkdown/preset-gfm` | ^7.3 | GitHub Flavored Markdown |
| `@milkdown/plugin-math` | ^7.3 | LaTeX math rendering |
| `@milkdown/plugin-diagram` | ^7.3 | Mermaid/PlantUML diagrams |
| `marked` | ^9.0 | Markdown parser (secondary, lightweight) |
| `highlight.js` | ^11.9 | Syntax highlighting in code blocks |

### Desktop

| Package | Version | Purpose |
|---------|---------|---------|
| `@tauri-apps/api` | ^2.0 | Tauri IPC — file dialogs, window control |
| `@tauri-apps/plugin-dialog` | ^2.0 | Native file open/save dialogs |

### Build

| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | ^5.0 | Frontend bundler (dev server + production build) |
| `typescript` | ^5.3 | Type system |
| `vitest` | ^2.0 | Frontend unit test runner |
| `puppeteer` | — | E2E browser tests |

---

## Infrastructure

### Runtime Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | Async generator syntax, `tomllib` stdlib |
| Node.js | 18+ | Vite dev server, npm scripts |
| Rust / Cargo | 1.70+ | Tauri desktop build only |
| Claude Code CLI | latest | Must be installed and authenticated |

### PTY Platform Matrix

| Platform | Library | Notes |
|----------|---------|-------|
| Linux / macOS | pexpect | Native PTY via `os.fork` + `os.openpty` |
| Windows (native) | pywinpty | ConPTY API |
| WSL | pywinpty + path translation | Hook must translate WSL paths to Windows UNC |

### Network Ports

| Port | Service | Default |
|------|---------|---------|
| 3000 | CADE backend (HTTP + WS) | Configurable via `CADE_PORT` |
| Written to `~/.cade/port` | Used by hook script to POST file views | — |

---

## Environment Variables

All variables are optional unless marked Required.

| Variable | Default | Purpose |
|----------|---------|---------|
| `CADE_PORT` | `3000` | HTTP/WebSocket server port |
| `CADE_HOST` | `0.0.0.0` | Bind address |
| `CADE_WORKING_DIR` | cwd at startup | Default project directory |
| `CADE_SHELL_COMMAND` | auto-detect | Shell command for manual terminal (`bash`, `wsl`, etc.) |
| `CADE_AUTO_START_CLAUDE` | `true` | Auto-launch Claude Code in primary terminal |
| `CADE_AUTO_OPEN_BROWSER` | `true` | Open browser on server start |
| `CADE_DEBUG` | `false` | Enable verbose logging |
| `CADE_AUTH_ENABLED` | `false` | Require auth token on all connections |
| `CADE_AUTH_TOKEN` | — | Auth token (required if auth enabled) |
| `CADE_CORS_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `CADE_ROOT_PATH` | `` | URL prefix for reverse proxy (`/cade`) |
| `ANTHROPIC_API_KEY` | — | Required for Anthropic API providers |

Provider-specific API keys are configured in `~/.cade/providers.toml` with `${ENV_VAR}` interpolation:

```toml
[provider.my-provider]
api_key = "${MY_API_KEY}"
```

---

## Configuration Files

| File | Format | Purpose |
|------|--------|---------|
| `~/.cade/providers.toml` | TOML | Global provider registry (type, model, api_key, system_prompt) |
| `.cade/dashboard.yml` | YAML | Live dashboard configuration (hot-reloaded) |
| `.cade/session.json` | JSON | Frontend UI state persistence (tabs, scroll) |
| `.cade/hook-filters.json` | JSON | Per-project hook viewer filter rules |
| `~/.cade/port` | plaintext | Server port (written on startup, read by hook script) |
| `~/.cade/host` | plaintext | Server host (written on startup, read by hook script on WSL) |
| `~/.claude/settings.json` | JSON | Claude Code hooks registration (updated by `setup-hook`) |
| `launch.yml` | YAML | Project-local provider override (beats global registry) |

---

## MCP Tool Servers

CADE passes MCP servers through to Claude Code via its own `--mcp-server` flags. Common servers:

| Server | Transport | Purpose |
|--------|-----------|---------|
| Filesystem MCP | stdio | Read/write files beyond project scope |
| Web fetch MCP | stdio | HTTP requests from within Claude Code |
| nkrdn MCP | stdio | Knowledge graph queries inside agent context |
| Custom servers | stdio | Project-specific tools (configured in `.claude/settings.json`) |

CADE does not manage MCP servers directly — it delegates that entirely to the Claude Code CLI, which handles MCP lifecycle, tool routing, and schema negotiation.

## See Also

- [[overview|Architecture Overview]]
- [[components|Component Inventory]]
- [[data-flow|Data Flow]]
- [[../technical/core/development-setup|Development Setup]]
