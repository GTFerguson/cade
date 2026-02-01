#!/usr/bin/env bash
# Idempotent server setup for CADE on Ubuntu.
#
# Configures everything needed to run CADE: system packages, Python venv,
# Claude Code CLI, nginx reverse proxy, firewall, auth, and systemd service.
#
# All steps are idempotent — safe to re-run anytime.
#
# Usage (standalone on server):
#   CADE_INSTALL_DIR=~/cade CADE_ROOT_PATH=/cade bash scripts/setup-remote.sh
#
# Usage (invoked by deploy.sh via SSH):
#   deploy.sh passes env vars automatically.
#
# Environment variables (all optional, with sensible defaults):
#   CADE_INSTALL_DIR   Where CADE is installed (default: ~/cade)
#   CADE_ROOT_PATH     URL prefix for nginx (default: /cade)
#   CADE_PORT          Backend port (default: 3000)
#   CADE_WORKING_DIR   Terminal working directory (default: $HOME)
#   CADE_SKIP_NGINX    Skip nginx configuration (default: unset)
#   CADE_SKIP_CLAUDE   Skip Claude CLI installation (default: unset)
#   CADE_SKIP_FIREWALL Skip UFW firewall rules (default: unset)

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Config ──────────────────────────────────────────────────────────────────

INSTALL_DIR="${CADE_INSTALL_DIR:-$HOME/cade}"
# Expand ~ if present
INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"

ROOT_PATH="${CADE_ROOT_PATH:-/cade}"
PORT="${CADE_PORT:-3000}"
WORKING_DIR="${CADE_WORKING_DIR:-$HOME}"
WORKING_DIR="${WORKING_DIR/#\~/$HOME}"
CURRENT_USER="$(whoami)"

echo -e "${BOLD}══════════════════════════════════════${NC}"
echo -e "${BOLD}  CADE Remote Setup${NC}"
echo -e "${BOLD}══════════════════════════════════════${NC}"
echo ""
echo "  Install dir:  $INSTALL_DIR"
echo "  Root path:    $ROOT_PATH"
echo "  Port:         $PORT"
echo "  Working dir:  $WORKING_DIR"
echo "  User:         $CURRENT_USER"
echo ""

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# ── Step 1: System packages ────────────────────────────────────────────────

echo -e "${CYAN}[1/8]${NC} System packages..."

PACKAGES_NEEDED=()

if ! command_exists python3; then
    PACKAGES_NEEDED+=(python3)
fi
if ! command_exists python3 || ! python3 -c "import venv" 2>/dev/null; then
    PACKAGES_NEEDED+=(python3-venv)
fi
if ! command_exists nvim; then
    PACKAGES_NEEDED+=(neovim)
fi

if [ ${#PACKAGES_NEEDED[@]} -gt 0 ]; then
    echo "  Installing: ${PACKAGES_NEEDED[*]}"
    sudo apt-get update -qq
    # Allow apt to exit non-zero from unrelated broken packages (e.g. DKMS/kernel)
    # and verify our specific packages installed afterward
    sudo apt-get install -y "${PACKAGES_NEEDED[@]}" || true

    INSTALL_OK=true
    command_exists python3 || INSTALL_OK=false
    command_exists nvim    || INSTALL_OK=false

    if [ "$INSTALL_OK" = true ]; then
        echo -e "  ${GREEN}✓${NC} Packages installed"
    else
        echo -e "  ${RED}✗${NC} Required packages missing after install attempt"
        exit 1
    fi
else
    echo -e "  ${GREEN}✓${NC} All packages present (python3, python3-venv, neovim)"
fi

# ── Step 2: Python venv + dependencies ─────────────────────────────────────

echo -e "${CYAN}[2/8]${NC} Python venv..."

VENV_DIR="$INSTALL_DIR/venv"

if [ ! -d "$VENV_DIR" ] || ! "$VENV_DIR/bin/python3" -m pip --version >/dev/null 2>&1; then
    if [ -d "$VENV_DIR" ]; then
        echo "  Venv broken (pip missing), recreating..."
        rm -rf "$VENV_DIR"
    fi
    echo "  Creating venv at $VENV_DIR"
    python3 -m venv "$VENV_DIR"
    echo -e "  ${GREEN}✓${NC} Venv created"
else
    echo -e "  ${GREEN}✓${NC} Venv exists"
fi

REQ_FILE="$INSTALL_DIR/requirements.txt"
if [ -f "$REQ_FILE" ]; then
    echo "  Installing Python dependencies..."
    "$VENV_DIR/bin/python3" -m pip install -q -r "$REQ_FILE"
    echo -e "  ${GREEN}✓${NC} Dependencies installed"
else
    echo -e "  ${YELLOW}⚠${NC} No requirements.txt found at $REQ_FILE"
fi

# ── Step 3: Claude Code CLI ────────────────────────────────────────────────

echo -e "${CYAN}[3/8]${NC} Claude Code CLI..."

if [ -n "${CADE_SKIP_CLAUDE:-}" ]; then
    echo -e "  ${YELLOW}⤳${NC} Skipped (CADE_SKIP_CLAUDE set)"
elif command_exists claude; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    echo -e "  ${GREEN}✓${NC} Already installed: $CLAUDE_VERSION"
else
    echo "  Installing Claude Code CLI..."
    curl -fsSL https://claude.ai/install.sh | bash
    if command_exists claude; then
        echo -e "  ${GREEN}✓${NC} Installed: $(claude --version 2>/dev/null)"
    else
        echo -e "  ${YELLOW}⚠${NC} Installation completed but 'claude' not on PATH"
        echo "  You may need to restart your shell or add it to PATH"
    fi
fi

# ── Step 4: nginx reverse proxy ────────────────────────────────────────────

echo -e "${CYAN}[4/8]${NC} nginx reverse proxy..."

if [ -n "${CADE_SKIP_NGINX:-}" ]; then
    echo -e "  ${YELLOW}⤳${NC} Skipped (CADE_SKIP_NGINX set)"
else
    # Install nginx if not present
    if ! command_exists nginx; then
        echo "  Installing nginx..."
        sudo apt-get update -qq
        sudo apt-get install -y nginx
    fi

    # Strip leading slash for location block matching
    LOCATION_PATH="${ROOT_PATH#/}"

    NGINX_CONF="/etc/nginx/sites-available/cade"
    echo "  Writing nginx config to $NGINX_CONF"

    sudo tee "$NGINX_CONF" > /dev/null << NGINX_EOF
server {
    listen 80;
    server_name _;

    location /${LOCATION_PATH}/ {
        proxy_pass http://localhost:${PORT}/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        # Long-lived connections for terminals
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
NGINX_EOF

    # Enable the site
    sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/cade

    # Disable default site to avoid port 80 conflicts
    if [ -L /etc/nginx/sites-enabled/default ]; then
        sudo rm /etc/nginx/sites-enabled/default
        echo "  Disabled default nginx site"
    fi

    # Test and reload
    if sudo nginx -t 2>/dev/null; then
        sudo systemctl reload nginx
        echo -e "  ${GREEN}✓${NC} nginx configured at /${LOCATION_PATH}/"
    else
        echo -e "  ${RED}✗${NC} nginx config test failed!"
        sudo nginx -t
        exit 1
    fi
fi

# ── Step 5: UFW firewall ───────────────────────────────────────────────────

echo -e "${CYAN}[5/8]${NC} UFW firewall..."

if [ -n "${CADE_SKIP_FIREWALL:-}" ]; then
    echo -e "  ${YELLOW}⤳${NC} Skipped (CADE_SKIP_FIREWALL set)"
elif ! command_exists ufw; then
    echo -e "  ${YELLOW}⤳${NC} UFW not installed, skipping"
elif ! sudo ufw status | grep -q "Status: active"; then
    echo -e "  ${YELLOW}⤳${NC} UFW inactive, skipping"
else
    sudo ufw allow 22/tcp > /dev/null 2>&1 || true
    sudo ufw allow 80/tcp > /dev/null 2>&1 || true
    echo -e "  ${GREEN}✓${NC} Allowed 22/tcp (SSH) and 80/tcp (HTTP)"
fi

# ── Step 6: Auth token ─────────────────────────────────────────────────────

echo -e "${CYAN}[6/8]${NC} Auth token..."

TOKEN_FILE="$INSTALL_DIR/.token"

if [ -f "$TOKEN_FILE" ]; then
    echo -e "  ${GREEN}✓${NC} Token exists"
else
    python3 -c "import secrets; print(secrets.token_hex(32))" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo -e "  ${GREEN}✓${NC} Token generated"
fi

TOKEN=$(cat "$TOKEN_FILE")

# ── Step 7: systemd service ────────────────────────────────────────────────

echo -e "${CYAN}[7/8]${NC} systemd service..."

SERVICE_FILE="/etc/systemd/system/cade.service"

sudo tee "$SERVICE_FILE" > /dev/null << SERVICE_EOF
[Unit]
Description=CADE Backend
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=CADE_AUTH_ENABLED=true
Environment=CADE_AUTH_TOKEN=${TOKEN}
Environment=CADE_HOST=0.0.0.0
Environment=CADE_PORT=${PORT}
Environment=CADE_ROOT_PATH=${ROOT_PATH}
Environment=CADE_WORKING_DIR=${WORKING_DIR}
Environment=CADE_AUTO_START_CLAUDE=false
Environment=CADE_AUTO_OPEN_BROWSER=false
Environment=CADE_SHELL_COMMAND=bash
Environment=PYTHONPATH=${INSTALL_DIR}
ExecStart=${VENV_DIR}/bin/python3 -m backend.main serve --no-browser
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE_EOF

sudo systemctl daemon-reload
sudo systemctl enable cade > /dev/null 2>&1
echo -e "  ${GREEN}✓${NC} Service installed and enabled"

# ── Step 8: Start/restart backend ──────────────────────────────────────────

echo -e "${CYAN}[8/8]${NC} Starting backend..."

sudo systemctl restart cade

# Wait for the service to come up
sleep 2

HEALTH=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/login" 2>/dev/null || echo "failed")

if [ "$HEALTH" = "200" ] || [ "$HEALTH" = "307" ]; then
    echo -e "  ${GREEN}✓${NC} Backend running (HTTP ${HEALTH})"
else
    echo -e "  ${YELLOW}⚠${NC} Health check: ${HEALTH}"
    echo "  Check logs: journalctl -u cade -n 30 --no-pager"
fi

# ── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}══════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${BOLD}══════════════════════════════════════${NC}"
echo ""
echo "  Token:   ${TOKEN}"
echo "  Logs:    journalctl -u cade -f"
echo "  Status:  systemctl status cade"
echo "  Restart: sudo systemctl restart cade"
echo ""
