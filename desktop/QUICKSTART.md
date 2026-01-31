# CADE Desktop - Quick Start Guide

This guide will help you get started with building and running the CADE desktop application.

## Automated Setup (Recommended)

The easiest way to get started:

```bash
# 1. Check prerequisites (installs nothing, just checks)
bash scripts/setup-dev.sh

# 2. Install project dependencies (after prerequisites are met)
bash scripts/install-deps.sh

# 3. Start developing!
make dev-desktop
```

The setup script will tell you exactly what's missing and how to install it.

## Manual Prerequisites Check

If you prefer to check manually, run these commands:

```bash
# Node.js and npm
node --version   # Should be 16+
npm --version

# Rust and Cargo
rustc --version
cargo --version

# Python
python3 --version  # Should be 3.11+

# PyInstaller
python3 -c "import PyInstaller; print(PyInstaller.__version__)"
```

If anything is missing, see the [Prerequisites](#prerequisites) section below.

## Quick Build (Production)

From the project root:

```bash
make build-desktop
```

This will:
1. Build the frontend
2. Package the Python backend
3. Build the Tauri desktop app
4. Generate installers

**Output**: Installers in `desktop/src-tauri/target/release/bundle/`

## Quick Start (Development)

For development with hot reload:

```bash
# Terminal 1: Start Vite dev server
cd frontend
npm install
npm run dev

# Terminal 2: Start Tauri in dev mode
cd desktop
npm install
npm run dev
```

Or use the Makefile:
```bash
make dev-desktop
```

## Platform-Specific Notes

### Windows

1. Install prerequisites:
   - Visual Studio Build Tools: [Download](https://visualstudio.microsoft.com/downloads/)
   - WebView2 (pre-installed on Win10/11)

2. Ensure WSL2 is set up:
   ```powershell
   wsl --version
   wsl --install  # if not installed
   ```

3. Build:
   ```bash
   make build-desktop
   ```

4. Install:
   - MSI: `desktop/src-tauri/target/release/bundle/msi/CADE_0.1.0_x64_en-US.msi`
   - NSIS: `desktop/src-tauri/target/release/bundle/nsis/CADE_0.1.0_x64-setup.exe`

### macOS

1. Install Xcode Command Line Tools:
   ```bash
   xcode-select --install
   ```

2. Install Rust:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. Build:
   ```bash
   make build-desktop
   ```

4. Install:
   - Open `desktop/src-tauri/target/release/bundle/dmg/CADE_0.1.0_x64.dmg`
   - Drag CADE to Applications

### Linux (Debian/Ubuntu)

1. Install system dependencies:
   ```bash
   sudo apt update
   sudo apt install -y \
       libwebkit2gtk-4.1-dev \
       build-essential \
       curl \
       wget \
       file \
       libxdo-dev \
       libssl-dev \
       libayatana-appindicator3-dev \
       librsvg2-dev
   ```

2. Install Rust:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

3. Build:
   ```bash
   make build-desktop
   ```

4. Install:
   - DEB: `sudo dpkg -i desktop/src-tauri/target/release/bundle/deb/cade_0.1.0_amd64.deb`
   - AppImage: `chmod +x desktop/src-tauri/target/release/bundle/appimage/cade_0.1.0_amd64.AppImage && ./desktop/src-tauri/target/release/bundle/appimage/cade_0.1.0_amd64.AppImage`

## Prerequisites

### Node.js & npm

**Windows/macOS:**
Download from [nodejs.org](https://nodejs.org/) (LTS version)

**Linux:**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Rust & Cargo

**All platforms:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

After installation:
```bash
source $HOME/.cargo/env  # Linux/macOS
# or restart terminal on Windows
```

### Python 3.11+

**Windows:**
Download from [python.org](https://www.python.org/downloads/)

**macOS:**
```bash
brew install python@3.11
```

**Linux:**
```bash
sudo apt install python3.11 python3.11-venv python3-pip
```

### PyInstaller

**All platforms:**
```bash
pip install pyinstaller
# or
pip3 install pyinstaller
```

## Troubleshooting

### "Backend executable not found"

The backend wasn't bundled. Run:
```bash
python3 -m PyInstaller scripts/pyinstaller.spec --clean
cp dist/cade-backend* desktop/src-tauri/resources/
```

### "WebSocket connection failed"

Check backend is running:
- Look for error messages in the Tauri console
- Verify port is available: `netstat -an | grep 3000`

### "WSL not found" (Windows)

Install WSL:
```powershell
wsl --install
```

Then install Claude Code in WSL:
```bash
wsl
# Inside WSL:
# Install Claude Code following official instructions
```

### Build errors on Linux

Make sure all system dependencies are installed:
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### "npm run dev" fails in desktop/

Install dependencies:
```bash
cd desktop
npm install
```

## Testing Your Build

After installation, verify:

1. **App launches**: Desktop window opens
2. **Terminal connects**: You see Claude Code prompt
3. **File tree loads**: Left sidebar shows project files
4. **Input works**: Type in terminal, see responses
5. **File operations work**: Click files to view, edit in markdown viewer

## Next Steps

- Read the full [desktop/README.md](README.md) for architecture details
- Check [DESKTOP_IMPLEMENTATION.md](../DESKTOP_IMPLEMENTATION.md) for technical overview
- Report issues on GitHub

## Development Tips

### Faster Iteration

Use dev mode to avoid full rebuilds:
```bash
make dev-desktop
```

Changes to frontend reflect immediately with hot reload.

### Debugging

**Frontend DevTools:**
Right-click in app window → Inspect Element

**Backend Logs:**
Run backend standalone:
```bash
./dist/cade-backend serve --port 3000 --debug
```

**Tauri Logs:**
```bash
cd desktop/src-tauri
RUST_LOG=debug cargo run
```

### Clean Build

If things get weird:
```bash
# Clean everything
make clean
rm -rf dist/
rm -rf desktop/src-tauri/target/
rm -rf desktop/src-tauri/resources/

# Rebuild
make build-desktop
```

## Getting Help

- **Desktop README**: `desktop/README.md`
- **Architecture docs**: `DESKTOP_IMPLEMENTATION.md`
- **Tauri docs**: [tauri.app](https://tauri.app/)
- **PyInstaller docs**: [pyinstaller.org](https://pyinstaller.org/)
