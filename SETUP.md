# CADE Development Setup

Quick setup guide for CADE development (web and desktop).

## Quick Start (Desktop Development)

```bash
# One command to check everything
make setup
```

This will:
1. Check if all prerequisites are installed
2. Install project dependencies
3. Tell you exactly what's missing (if anything)

Then you can:
```bash
make dev-desktop    # Start desktop app in dev mode
# or
make build-desktop  # Build production desktop app
```

## Quick Start (Web Development)

No special prerequisites needed (just Node.js and Python):

```bash
# Install dependencies
cd frontend && npm install

# Start development
make dev
```

## What `make setup` Does

### 1. Prerequisites Check (`scripts/setup-dev.sh`)

Checks for and provides installation instructions for:

**Core Tools:**
- Node.js 16+ & npm
- Rust & Cargo (for Tauri)
- Python 3.11+
- PyInstaller

**Platform-Specific:**
- **Linux**: webkit2gtk, build-essential, etc.
- **macOS**: Xcode Command Line Tools
- **Windows**: Visual Studio Build Tools, WebView2

### 2. Dependencies Installation (`scripts/install-deps.sh`)

Installs:
- Frontend npm packages (`frontend/package.json`)
- Desktop npm packages (`desktop/package.json`)
- Python packages (`requirements.txt` if exists)

## Manual Setup

If you prefer manual control:

### Step 1: Install Prerequisites

**Node.js & npm:**
- Download from [nodejs.org](https://nodejs.org/) (LTS version)
- Or use package manager (brew, apt, etc.)

**Rust & Cargo:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env  # or restart terminal
```

**Python 3.11+:**
- Linux: `sudo apt install python3.11 python3-pip`
- macOS: `brew install python@3.11`
- Windows: Download from [python.org](https://www.python.org/)

**PyInstaller:**
```bash
pip3 install pyinstaller
```

**Platform-Specific (Linux):**
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

**Platform-Specific (macOS):**
```bash
xcode-select --install
```

### Step 2: Install Project Dependencies

```bash
# Frontend
cd frontend
npm install

# Desktop
cd ../desktop
npm install

# Python (if requirements.txt exists)
cd ..
pip3 install -r requirements.txt
```

## Verification

Check everything is working:

```bash
# Should all return versions
node --version
npm --version
cargo --version
python3 --version
python3 -c "import PyInstaller; print(PyInstaller.__version__)"
```

## What's Next

### Web Development
```bash
make dev         # Start web version with Vite hot reload
make stable      # Build and run production web version
```

### Desktop Development
```bash
make dev-desktop    # Start desktop in dev mode (with hot reload)
make build-desktop  # Build desktop app with installers
```

## Troubleshooting

### "command not found: cargo"

Rust isn't in your PATH. Run:
```bash
source $HOME/.cargo/env
```

Or restart your terminal.

### "PyInstaller not found"

Install it:
```bash
pip3 install pyinstaller
```

### Linux webkit2gtk errors

Install the full set of dependencies:
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Windows Visual Studio Build Tools

Download from: https://visualstudio.microsoft.com/downloads/
Select "Desktop development with C++"

## Documentation

- **Desktop App**: See `desktop/README.md` and `desktop/QUICKSTART.md`
- **Web Development**: See existing development docs
- **Architecture**: See `docs/` directory

## Getting Help

- Run `make help` to see all available commands
- Check `desktop/QUICKSTART.md` for detailed desktop setup
- Review `desktop/VERIFICATION.md` for testing checklist
