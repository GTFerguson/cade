---
title: Development Setup
created: 2026-01-17
updated: 2026-01-17
status: active
tags: [technical, development, setup, makefile]
---

# Development Setup

This guide covers running CADE for development and testing.

## Prerequisites

- Python 3.x
- Node.js and npm
- `make` (Unix/macOS) or PowerShell (Windows)

## Makefile Targets

The project includes a Makefile for common development tasks.

| Target | Description |
|--------|-------------|
| `make stable` | Build frontend and run on port 3000 |
| `make dev` | Run backend on 3001 + Vite on 5173 (hot reload) |
| `make dev-dummy` | Same as dev, but with fake Claude UI |
| `make both` | Run stable and dev simultaneously |
| `make build` | Build frontend only |
| `make kill` | Stop all CADE processes |
| `make clean` | Remove build artifacts |

### Port Configuration

| Mode | Backend Port | Access URL |
|------|--------------|------------|
| stable | 3000 | http://localhost:3000 |
| dev / dev-dummy | 3001 | http://localhost:5173 |

Custom ports can be specified:

```bash
make stable STABLE_PORT=8000
make dev DEV_PORT=8001 VITE_PORT=5174
```

### Dummy Mode

The `dev-dummy` target starts the backend with the `--dummy` flag, which provides a fake Claude UI for frontend development without requiring a real Claude connection.

```bash
make dev-dummy
```

This is useful for:
- UI development and styling
- Testing frontend components
- Working without Claude Code installed

## Windows (PowerShell)

Windows users without `make` can use the provided PowerShell scripts:

| Script | Equivalent |
|--------|------------|
| `.\dev-dummy.ps1` | `make dev-dummy` |

Or run commands directly:

```powershell
# Start backend in dummy mode (background)
Start-Process -NoNewWindow python -ArgumentList "-m", "backend.main", "--port", "3001", "--no-browser", "--dummy"

# Start Vite frontend
cd frontend
$env:BACKEND_PORT = "3001"
npm run dev -- --port 5173
```

To install `make` on Windows:
- **Chocolatey:** `choco install make` (requires admin)
- **Scoop:** `scoop install make`
- **WSL:** Use Windows Subsystem for Linux

## See Also

- [[frontend-architecture|Frontend Architecture]]
- [[../../README|Documentation Hub]]
