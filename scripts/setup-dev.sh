#!/usr/bin/env bash
# Automated Development Environment Setup for CADE Desktop
# This script installs all prerequisites automatically

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "======================================"
echo "CADE Desktop - Automated Setup"
echo "======================================"
echo ""

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo "Detected OS: Linux (WSL/Native)"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo "Detected OS: macOS"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    OS="windows"
    echo "Detected OS: Windows (Git Bash/MSYS)"
else
    OS="unknown"
    echo "Warning: Unknown OS type: $OSTYPE"
fi
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Ask for confirmation
confirm() {
    local prompt="$1"
    read -p "$prompt [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]]
}

echo "This script will install:"
echo "  • Node.js & npm (if needed)"
echo "  • Rust & Cargo"
echo "  • Python 3.8+"
echo "  • PyInstaller"
echo "  • Platform-specific dependencies"
echo ""

if ! confirm "Continue with installation?"; then
    echo "Setup cancelled."
    exit 1
fi

echo ""
echo "======================================"
echo "Installing Prerequisites"
echo "======================================"
echo ""

# ============================================================================
# LINUX INSTALLATION
# ============================================================================
if [ "$OS" = "linux" ]; then
    echo "Installing for Linux..."
    echo ""

    # Update package lists
    echo "Updating package lists..."
    sudo apt update

    # Install system dependencies
    echo ""
    echo "Installing system dependencies..."

    # Detect which webkit package is available (4.1 for newer, 4.0 for older Ubuntu)
    WEBKIT_PKG="libwebkit2gtk-4.0-dev"
    if apt-cache show libwebkit2gtk-4.1-dev >/dev/null 2>&1; then
        WEBKIT_PKG="libwebkit2gtk-4.1-dev"
    fi
    echo "Using webkit package: $WEBKIT_PKG"

    # Detect which appindicator package is available
    APPINDICATOR_PKG="libappindicator3-dev"
    if apt-cache show libayatana-appindicator3-dev >/dev/null 2>&1; then
        APPINDICATOR_PKG="libayatana-appindicator3-dev"
    fi

    sudo apt install -y \
        build-essential \
        pkg-config \
        libssl-dev \
        $WEBKIT_PKG \
        curl \
        wget \
        file \
        libxdo-dev \
        $APPINDICATOR_PKG \
        librsvg2-dev

    # Install Node.js if needed
    if ! command_exists node; then
        echo ""
        echo "Installing Node.js LTS..."
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo ""
        echo -e "${GREEN}✓${NC} Node.js already installed"
    fi

    # Check Python version (need 3.8+)
    PYTHON_VERSION=$(python3 --version 2>/dev/null | awk '{print $2}' || echo "0.0")
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

    if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 8 ]); then
        echo ""
        echo "Installing Python 3.8+..."

        # Try to install available Python 3 version
        sudo apt install -y python3 python3-venv python3-dev python3-pip
    else
        echo ""
        echo -e "${GREEN}✓${NC} Python $PYTHON_VERSION is installed (need 3.8+)"
    fi

    # Ensure pip is installed
    if ! command_exists pip3; then
        echo "Installing pip3..."
        sudo apt install -y python3-pip
    fi

    # Install Rust if needed
    if ! command_exists rustc; then
        echo ""
        echo "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
    else
        echo ""
        echo -e "${GREEN}✓${NC} Rust already installed"
    fi

    # Install PyInstaller
    echo ""
    echo "Installing PyInstaller..."
    pip3 install pyinstaller

# ============================================================================
# MACOS INSTALLATION
# ============================================================================
elif [ "$OS" = "macos" ]; then
    echo "Installing for macOS..."
    echo ""

    # Check for Homebrew
    if ! command_exists brew; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    else
        echo -e "${GREEN}✓${NC} Homebrew already installed"
    fi

    # Install Xcode Command Line Tools
    if ! xcode-select -p >/dev/null 2>&1; then
        echo ""
        echo "Installing Xcode Command Line Tools..."
        xcode-select --install
        echo "Please complete the Xcode installation and run this script again."
        exit 1
    else
        echo -e "${GREEN}✓${NC} Xcode Command Line Tools already installed"
    fi

    # Install Node.js
    if ! command_exists node; then
        echo ""
        echo "Installing Node.js..."
        brew install node
    else
        echo ""
        echo -e "${GREEN}✓${NC} Node.js already installed"
    fi

    # Check Python version (need 3.8+)
    PYTHON_VERSION=$(python3 --version 2>/dev/null | awk '{print $2}' || echo "0.0")
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

    if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 8 ]); then
        echo ""
        echo "Installing Python 3..."
        brew install python@3
    else
        echo ""
        echo -e "${GREEN}✓${NC} Python $PYTHON_VERSION is installed (need 3.8+)"
    fi

    # Install Rust
    if ! command_exists rustc; then
        echo ""
        echo "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
    else
        echo ""
        echo -e "${GREEN}✓${NC} Rust already installed"
    fi

    # Install PyInstaller
    echo ""
    echo "Installing PyInstaller..."
    pip3 install pyinstaller

# ============================================================================
# WINDOWS (Git Bash/MSYS)
# ============================================================================
elif [ "$OS" = "windows" ]; then
    echo -e "${YELLOW}Note: On Windows, some tools need manual installation${NC}"
    echo ""

    echo "Please install these tools manually if not already installed:"
    echo ""
    echo "1. Node.js LTS:"
    echo "   Download from: https://nodejs.org/"
    echo ""
    echo "2. Rust:"
    echo "   Download from: https://rustup.rs/"
    echo "   Or run: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo ""
    echo "3. Python 3.8+:"
    echo "   Download from: https://www.python.org/downloads/"
    echo ""
    echo "4. Visual Studio Build Tools:"
    echo "   Download from: https://visualstudio.microsoft.com/downloads/"
    echo "   Select 'Desktop development with C++'"
    echo ""

    # Try to install PyInstaller if Python is available
    if command_exists python3 || command_exists python; then
        PYTHON_CMD=$(command_exists python3 && echo "python3" || echo "python")
        echo "Installing PyInstaller..."
        $PYTHON_CMD -m pip install pyinstaller
    fi

    echo ""
    echo "After installing the above, run this script again to verify."
    exit 1
fi

# ============================================================================
# VERIFY INSTALLATION
# ============================================================================
echo ""
echo "======================================"
echo "Verifying Installation"
echo "======================================"
echo ""

# Reload environment
if [ "$OS" = "linux" ] || [ "$OS" = "macos" ]; then
    [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
fi

ALL_GOOD=true

# Check Node.js
if command_exists node; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓${NC} Node.js: $NODE_VERSION"
else
    echo -e "${RED}✗${NC} Node.js not found"
    ALL_GOOD=false
fi

# Check npm
if command_exists npm; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓${NC} npm: v$NPM_VERSION"
else
    echo -e "${RED}✗${NC} npm not found"
    ALL_GOOD=false
fi

# Check Rust
if command_exists rustc; then
    RUST_VERSION=$(rustc --version)
    echo -e "${GREEN}✓${NC} $RUST_VERSION"
else
    echo -e "${RED}✗${NC} Rust not found"
    ALL_GOOD=false
fi

# Check Cargo
if command_exists cargo; then
    CARGO_VERSION=$(cargo --version)
    echo -e "${GREEN}✓${NC} $CARGO_VERSION"
else
    echo -e "${RED}✗${NC} Cargo not found"
    ALL_GOOD=false
fi

# Check Python
if command_exists python3; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✓${NC} $PYTHON_VERSION"
else
    echo -e "${RED}✗${NC} Python 3 not found"
    ALL_GOOD=false
fi

# Check PyInstaller
if python3 -c "import PyInstaller" 2>/dev/null; then
    PYINSTALLER_VERSION=$(python3 -c "import PyInstaller; print(PyInstaller.__version__)")
    echo -e "${GREEN}✓${NC} PyInstaller: v$PYINSTALLER_VERSION"
else
    echo -e "${RED}✗${NC} PyInstaller not found"
    ALL_GOOD=false
fi

echo ""

if $ALL_GOOD; then
    echo "======================================"
    echo -e "${GREEN}✓ Setup Complete!${NC}"
    echo "======================================"
    echo ""
    echo "Installing project dependencies..."
    bash "$SCRIPT_DIR/install-deps.sh"
    echo ""
    echo "You can now run:"
    echo "  make dev-desktop    - Start desktop in dev mode"
    echo "  make build-desktop  - Build desktop application"
    echo ""
else
    echo "======================================"
    echo -e "${YELLOW}⚠ Setup Incomplete${NC}"
    echo "======================================"
    echo ""
    echo "Some tools are still missing. Please install them manually"
    echo "and run this script again."
    echo ""
    exit 1
fi
