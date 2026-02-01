#!/usr/bin/env bash
# Setup script for CADE remote backend deployment.
#
# Run on the remote server to install runtime dependencies
# that the CADE backend needs (Python packages, Neovim, etc.).
#
# Usage:
#   ssh your-server "bash -s" < scripts/setup-remote.sh
#   # or copy to server and run directly:
#   scp scripts/setup-remote.sh server:~/
#   ssh server "bash ~/setup-remote.sh"

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "======================================"
echo "CADE Remote Backend - Setup"
echo "======================================"
echo ""

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect package manager
if command_exists apt; then
    PKG_MANAGER="apt"
elif command_exists dnf; then
    PKG_MANAGER="dnf"
elif command_exists yum; then
    PKG_MANAGER="yum"
elif command_exists pacman; then
    PKG_MANAGER="pacman"
else
    echo -e "${RED}No supported package manager found (apt/dnf/yum/pacman)${NC}"
    exit 1
fi

echo "Package manager: $PKG_MANAGER"
echo ""

# ============================================================================
# Install Neovim
# ============================================================================
if command_exists nvim; then
    NVIM_VERSION=$(nvim --version | head -1)
    echo -e "${GREEN}✓${NC} Neovim already installed: $NVIM_VERSION"
else
    echo "Installing Neovim..."
    case $PKG_MANAGER in
        apt)
            sudo apt update -qq
            sudo apt install -y neovim
            ;;
        dnf)
            sudo dnf install -y neovim
            ;;
        yum)
            sudo yum install -y neovim
            ;;
        pacman)
            sudo pacman -S --noconfirm neovim
            ;;
    esac

    if command_exists nvim; then
        echo -e "${GREEN}✓${NC} Neovim installed: $(nvim --version | head -1)"
    else
        echo -e "${YELLOW}⚠${NC} Neovim installation failed — install manually"
    fi
fi

# ============================================================================
# Check Python 3
# ============================================================================
echo ""
if command_exists python3; then
    PY_VERSION=$(python3 --version)
    echo -e "${GREEN}✓${NC} $PY_VERSION"
else
    echo -e "${RED}✗${NC} Python 3 not found — install python3 manually"
    exit 1
fi

# ============================================================================
# Install Python dependencies (if requirements.txt exists nearby)
# ============================================================================
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" 2>/dev/null && pwd )"
REQ_FILE="$SCRIPT_DIR/../backend/requirements.txt"

if [ -f "$REQ_FILE" ]; then
    echo ""
    echo "Installing Python dependencies from requirements.txt..."
    if [ -d "$HOME/venv" ]; then
        source "$HOME/venv/bin/activate"
        echo "Using virtualenv: $HOME/venv"
    fi
    pip3 install -q -r "$REQ_FILE"
    echo -e "${GREEN}✓${NC} Python dependencies installed"
elif [ -f "backend/requirements.txt" ]; then
    echo ""
    echo "Installing Python dependencies from backend/requirements.txt..."
    if [ -d "$HOME/venv" ]; then
        source "$HOME/venv/bin/activate"
        echo "Using virtualenv: $HOME/venv"
    fi
    pip3 install -q -r "backend/requirements.txt"
    echo -e "${GREEN}✓${NC} Python dependencies installed"
else
    echo ""
    echo -e "${YELLOW}⚠${NC} No requirements.txt found — skip pip install"
fi

# ============================================================================
# Generate auth token if not present
# ============================================================================
echo ""
CADE_DIR="${CADE_DIR:-$(pwd)}"
TOKEN_FILE="$CADE_DIR/.token"

if [ -f "$TOKEN_FILE" ]; then
    echo -e "${GREEN}✓${NC} Auth token exists: $TOKEN_FILE"
else
    echo "Generating auth token..."
    python3 -c "import secrets; print(secrets.token_hex(32))" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo -e "${GREEN}✓${NC} Auth token generated: $TOKEN_FILE"
    echo -e "${YELLOW}  Copy this token to your remote profile config${NC}"
    echo "  Token: $(cat "$TOKEN_FILE")"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "======================================"
echo -e "${GREEN}✓ Remote setup complete!${NC}"
echo "======================================"
echo ""
echo "To start the backend:"
echo "  source ~/venv/bin/activate  # if using venv"
echo "  export CADE_AUTH_ENABLED=true"
echo "  export CADE_AUTH_TOKEN=\"\$(cat .token)\""
echo "  python3 -m backend.main serve --no-browser"
echo ""
