#!/usr/bin/env bash
# Install CADE Desktop Project Dependencies
# Run this after setup-dev.sh confirms all prerequisites are installed

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "======================================"
echo "CADE Desktop - Install Dependencies"
echo "======================================"
echo ""

# Step 1: Frontend dependencies
echo -e "${BLUE}[1/3]${NC} Installing frontend dependencies..."
cd "$PROJECT_ROOT/frontend"
npm install
echo -e "${GREEN}✓${NC} Frontend dependencies installed"
echo ""

# Step 2: Desktop dependencies
echo -e "${BLUE}[2/3]${NC} Installing desktop dependencies..."
cd "$PROJECT_ROOT/desktop"
npm install
echo -e "${GREEN}✓${NC} Desktop dependencies installed"
echo ""

# Step 3: Python dependencies
echo -e "${BLUE}[3/3]${NC} Installing Python dependencies..."
cd "$PROJECT_ROOT"
if [ -f "requirements.txt" ]; then
    pip3 install -r requirements.txt
    echo -e "${GREEN}✓${NC} Python dependencies installed"
else
    echo "Note: No requirements.txt found (may need to install manually if needed)"
fi
echo ""

echo "======================================"
echo -e "${GREEN}✓ All dependencies installed!${NC}"
echo "======================================"
echo ""
echo "You're ready to start developing!"
echo ""
echo "Available commands:"
echo "  make dev          - Web development mode (Vite + backend)"
echo "  make dev-desktop  - Desktop development mode (Tauri dev)"
echo "  make build-desktop - Build desktop application"
echo ""
echo "See desktop/QUICKSTART.md for more details."
echo ""
