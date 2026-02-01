---
title: Development Setup
created: 2026-01-17
updated: 2026-02-01
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

## Desktop App Development

The desktop app uses Tauri (Rust) wrapping the web frontend, with a PyInstaller-bundled Python backend.

### Additional Prerequisites

- Rust toolchain (`rustup`)
- PyInstaller (`pip install pyinstaller`)
- Platform libraries:
  - **Linux:** `libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Visual Studio Build Tools (C++ workload), WebView2

### Desktop Makefile Targets

| Target | Description |
|--------|-------------|
| `make setup` | Check prerequisites and install all dependencies |
| `make dev-desktop` | Start desktop in dev mode (Vite hot reload) |
| `make build-desktop` | Build production desktop app with installers |

### Build Process

`make build-desktop` runs four steps:

1. **Frontend:** `npm run build` in `frontend/`
2. **Backend:** PyInstaller packages Python into `dist/cade-backend.exe`
3. **Copy:** Backend binary copied to `desktop/src-tauri/resources/`
4. **Tauri:** `npm run build` in `desktop/` produces installers

Output: MSI and NSIS installers in `desktop/src-tauri/target/release/bundle/`

### Architecture

```
Tauri App (Rust)
  ├── WebView (frontend)
  └── Python Backend (PyInstaller binary)
      └── PTY sessions (shell / Claude Code)
```

The Tauri app starts the bundled Python backend on a dynamic port, injects the URL into the WebView via `window.__BACKEND_URL__`, and manages the process lifecycle (start on launch, stop on quit).

### Key Design Decisions

- **Tauri over Electron:** 10-15x smaller bundle, 50-100 MB less memory, better subprocess management
- **WebSocket protocol preserved:** Desktop uses the same protocol as the web version
- **Dynamic port allocation:** Multiple instances run simultaneously without conflicts
- **PyInstaller for backend:** Single executable with all Python dependencies bundled

## See Also

- [[frontend-architecture|Frontend Architecture]]
- [[../../user/remote-connections|Remote Connections User Guide]]
- [[../../README|Documentation Hub]]
