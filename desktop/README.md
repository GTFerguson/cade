# CADE Desktop Application

This directory contains the Tauri-based desktop application for CADE.

## Prerequisites

Before building the desktop application, ensure you have:

1. **Node.js & npm** - For frontend and Tauri CLI
2. **Rust & Cargo** - Install from [https://rustup.rs/](https://rustup.rs/)
3. **Python 3.11+** - For the backend
4. **PyInstaller** - Install with `pip install pyinstaller`

### Platform-Specific Requirements

**Windows:**
- Visual Studio Build Tools or Visual Studio with C++ development tools
- WebView2 (usually pre-installed on Windows 10/11)

**macOS:**
- Xcode Command Line Tools: `xcode-select --install`
- macOS SDK

**Linux (Debian/Ubuntu):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

## Quick Start

### Development Mode

Run the desktop app in development mode (uses Vite dev server):

```bash
# Terminal 1: Start Vite dev server
cd frontend
npm run dev

# Terminal 2: Start Tauri dev mode
cd desktop
npm install
npm run dev
```

Or use the Makefile:
```bash
make dev-desktop
```

### Production Build

Build the complete desktop application with installers:

```bash
# From project root
make build-desktop
```

This will:
1. Build the frontend (`frontend/dist`)
2. Package the Python backend with PyInstaller
3. Copy backend executable to `desktop/src-tauri/resources/`
4. Build the Tauri desktop app
5. Generate platform-specific installers in `desktop/src-tauri/target/release/bundle/`

### Manual Build Steps

If you want to build manually:

```bash
# 1. Build frontend
cd frontend
npm run build

# 2. Package Python backend
cd ..
python -m PyInstaller scripts/pyinstaller.spec --clean

# 3. Copy backend to Tauri resources
mkdir -p desktop/src-tauri/resources
cp dist/cade-backend* desktop/src-tauri/resources/

# 4. Build Tauri app
cd desktop
npm install
npm run build
```

## Architecture

### Components

- **Tauri (Rust)**: Desktop app wrapper, process management
  - `src/main.rs`: App initialization, backend lifecycle
  - `src/python.rs`: Python backend subprocess management
  - `src/port.rs`: Dynamic port allocation

- **Python Backend**: FastAPI server (bundled with PyInstaller)
  - Single executable: `cade-backend` / `cade-backend.exe`
  - Serves WebSocket and static files

- **Frontend**: TypeScript/Vite SPA (same as web version)
  - Auto-detects Tauri environment
  - Connects to dynamic backend URL

### Communication Flow

```
┌─────────────────────────────────────────┐
│ Tauri Window (WebView)                  │
│  - Frontend (TypeScript/Vite)           │
│  - Connects via WebSocket               │
└─────────────┬───────────────────────────┘
              │ WebSocket (ws://127.0.0.1:PORT/ws)
              │
┌─────────────▼───────────────────────────┐
│ Python Backend (FastAPI)                │
│  - Bundled as single executable         │
│  - Runs on dynamic port (e.g., 3000)    │
│  - Manages PTY sessions                 │
└─────────────┬───────────────────────────┘
              │
              │ PTY/subprocess
              │
┌─────────────▼───────────────────────────┐
│ Claude Code CLI (via shell)             │
│  - Windows: wsl claude                  │
│  - Unix: claude                         │
└─────────────────────────────────────────┘
```

### Key Design Decisions

1. **WebSocket Protocol Unchanged**: No changes to existing protocol - desktop app uses same WebSocket communication as web version

2. **Dynamic Port Allocation**: Tauri finds available port at startup, avoiding conflicts when running multiple instances

3. **Bundled Backend**: Python backend packaged as single executable with PyInstaller for easy distribution

4. **Process Lifecycle**: Tauri manages backend process - starts on app launch, stops on app close

5. **Frontend Detection**: Frontend detects Tauri environment via `window.__TAURI__` and connects to injected `window.__BACKEND_URL__`

## Configuration

### Tauri Config (`src-tauri/tauri.conf.json`)

Key settings:
- `bundle.identifier`: App identifier (com.cade.app)
- `bundle.externalBin`: Bundled backend executable path
- `app.windows`: Default window size (1400x900)

### PyInstaller Spec (`scripts/pyinstaller.spec`)

Bundling configuration:
- Hidden imports for dependencies
- Frontend dist files included as data
- Single-file executable mode
- No console window

## Troubleshooting

### Backend Not Starting

Check logs in the terminal where you ran `npm run dev` or look for error messages in the app console.

Common issues:
- Backend executable not found: Ensure PyInstaller build completed successfully
- Port already in use: Close other CADE instances
- Missing dependencies: Reinstall Python dependencies and rebuild

### WebSocket Connection Failed

- Verify backend is running (check Tauri console logs)
- Check that `window.__BACKEND_URL__` is set correctly
- Ensure no firewall blocking localhost connections

### WSL Issues (Windows)

- Verify WSL is installed and working: `wsl --version`
- Check Claude Code is installed in WSL: `wsl claude --version`
- Review backend logs for PTY spawn errors

## Distribution

### Generated Installers

After running `make build-desktop`, installers are in:
```
desktop/src-tauri/target/release/bundle/
```

**Windows:**
- `msi/` - Windows Installer (.msi)
- `nsis/` - NSIS Installer (.exe)

**macOS:**
- `dmg/` - Disk Image (.dmg)

**Linux:**
- `deb/` - Debian Package (.deb)
- `appimage/` - AppImage (.AppImage)

### Code Signing (Future)

For production distribution:
- **Windows**: Sign with code signing certificate
- **macOS**: Sign with Apple Developer ID and notarize
- **Linux**: No signing required

## Testing

### Unit Tests

Run Rust tests:
```bash
cd desktop/src-tauri
cargo test
```

### Integration Testing

1. **Backend Bundling**:
   ```bash
   python -m PyInstaller scripts/pyinstaller.spec
   ./dist/cade-backend serve --port 3000
   # Verify at http://127.0.0.1:3000
   ```

2. **Desktop App**:
   - Build and install package
   - Launch app
   - Verify terminal connects
   - Test file operations
   - Test multiple instances (different projects)

### Platform Testing

Test on each target platform:
- Windows 10/11 with WSL2
- macOS (arm64 and x64)
- Linux (Ubuntu, Debian)

## Development Tips

### Faster Development Iteration

Use dev mode to avoid full rebuilds:
```bash
make dev-desktop
```

This runs Tauri with Vite's hot reload - changes to frontend reflect immediately.

### Debugging

**Rust Backend (Tauri):**
```bash
cd desktop/src-tauri
RUST_LOG=debug cargo run
```

**Python Backend:**
```bash
python -m backend.main serve --port 3000 --debug
```

**Frontend:**
Open DevTools in the Tauri window (right-click → Inspect).

### Adding Icons

Replace placeholder icons in `src-tauri/icons/`:
- `32x32.png`, `128x128.png`, `128x128@2x.png` - PNG icons
- `icon.icns` - macOS icon
- `icon.ico` - Windows icon

Generate from SVG/PNG using tools like:
- [tauri-icon](https://github.com/tauri-apps/tauri/tree/dev/tooling/cli/node#tauri-icon)
- [png2icons](https://github.com/idesis-gmbh/png2icons)

## References

- [Tauri Documentation](https://tauri.app/)
- [PyInstaller Manual](https://pyinstaller.org/en/stable/)
- [Rust Book](https://doc.rust-lang.org/book/)
