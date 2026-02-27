#!/usr/bin/env bash
# Deploy CADE to a remote Ubuntu server.
#
# Builds the frontend locally (requires Node.js and ../mertex.md),
# syncs files to the remote, and runs setup-remote.sh via SSH
# to configure nginx, systemd, auth, etc.
#
# Usage:
#   ./scripts/deploy.sh <ssh-host> [options]
#
# Examples:
#   ./scripts/deploy.sh <host>
#   ./scripts/deploy.sh <host> --skip-build
#   ./scripts/deploy.sh <host> --root-path /cade --port 3000

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Defaults ────────────────────────────────────────────────────────────────

SSH_HOST=""
INSTALL_DIR="~/cade"
ROOT_PATH="/cade"
PORT=3000
WORKING_DIR="\$HOME"
NKRDN_PROJECT=""
SKIP_BUILD=false
SKIP_SETUP=false
SKIP_NGINX=false
SKIP_CLAUDE=false
SKIP_FIREWALL=false

# ── Parse arguments ─────────────────────────────────────────────────────────

usage() {
    echo "Usage: $0 <ssh-host> [options]"
    echo ""
    echo "Options:"
    echo "  --install-dir DIR     Remote install directory (default: ~/cade)"
    echo "  --root-path PATH      URL prefix for nginx (default: /cade)"
    echo "  --port PORT           Backend port (default: 3000)"
    echo "  --working-dir DIR     CADE working directory on remote (default: \$HOME)"
    echo "  --skip-build          Don't rebuild frontend"
    echo "  --skip-setup          Just sync files + restart (don't re-run setup)"
    echo "  --skip-nginx          Pass CADE_SKIP_NGINX to setup-remote.sh"
    echo "  --nkrdn-project DIR   Path to nkrdn project (builds + deploys wheel)"
    echo "  --skip-claude         Pass CADE_SKIP_CLAUDE to setup-remote.sh"
    echo "  --skip-firewall       Pass CADE_SKIP_FIREWALL to setup-remote.sh"
    echo "  -h, --help            Show this help message"
    exit 1
}

if [ $# -lt 1 ]; then
    usage
fi

SSH_HOST="$1"
shift

while [ $# -gt 0 ]; do
    case "$1" in
        --install-dir)   INSTALL_DIR="$2"; shift 2 ;;
        --root-path)     ROOT_PATH="$2"; shift 2 ;;
        --port)          PORT="$2"; shift 2 ;;
        --working-dir)   WORKING_DIR="$2"; shift 2 ;;
        --nkrdn-project) NKRDN_PROJECT="$2"; shift 2 ;;
        --skip-build)    SKIP_BUILD=true; shift ;;
        --skip-setup)    SKIP_SETUP=true; shift ;;
        --skip-nginx)    SKIP_NGINX=true; shift ;;
        --skip-claude)   SKIP_CLAUDE=true; shift ;;
        --skip-firewall) SKIP_FIREWALL=true; shift ;;
        -h|--help)       usage ;;
        *)               echo -e "${RED}Unknown option: $1${NC}"; usage ;;
    esac
done

# ── Resolve project root ───────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Auto-detect nkrdn project if not specified (sibling directory)
if [ -z "$NKRDN_PROJECT" ]; then
    CANDIDATE="$(cd "$PROJECT_ROOT/.." && pwd)/nkrdn"
    if [ -f "$CANDIDATE/pyproject.toml" ]; then
        NKRDN_PROJECT="$CANDIDATE"
    fi
fi

echo -e "${BOLD}══════════════════════════════════════${NC}"
echo -e "${BOLD}  CADE Deploy → ${CYAN}${SSH_HOST}${NC}"
echo -e "${BOLD}══════════════════════════════════════${NC}"
echo ""
echo "  Install dir:  $INSTALL_DIR"
echo "  Root path:    $ROOT_PATH"
echo "  Port:         $PORT"
echo "  Working dir:  $WORKING_DIR"
if [ -n "$NKRDN_PROJECT" ]; then
    echo "  nkrdn:        $NKRDN_PROJECT"
fi
echo ""

# ── Step 1: Build frontend ─────────────────────────────────────────────────

if [ "$SKIP_BUILD" = true ]; then
    echo -e "${YELLOW}⤳${NC} Skipping frontend build (--skip-build)"
else
    echo -e "${CYAN}[1/5]${NC} Building frontend..."

    # Detect environment: WSL bash sees /mnt/c, Git Bash (MINGW) does not.
    # Under WSL, npm resolves to a broken shim via a stray node_modules in
    # the user's home dir. Use cmd.exe to run in native Windows context.
    if [ -d "/mnt/c" ] && command -v cmd.exe >/dev/null 2>&1; then
        WIN_FRONTEND="$(wslpath -w "$PROJECT_ROOT/frontend")"

        run_npm() {
            cmd.exe /C "cd /d ${WIN_FRONTEND} && npm $*"
        }
        run_npm_env() {
            # Forward env vars to cmd.exe (first arg is the env prefix)
            local env_prefix="$1"; shift
            cmd.exe /C "cd /d ${WIN_FRONTEND} && ${env_prefix} npm $*"
        }
    else
        run_npm() {
            (cd "$PROJECT_ROOT/frontend" && npm "$@")
        }
        run_npm_env() {
            local env_prefix="$1"; shift
            (cd "$PROJECT_ROOT/frontend" && env $env_prefix npm "$@")
        }
    fi

    if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
        echo "  Installing npm dependencies..."
        run_npm install
    fi

    # MSYS_NO_PATHCONV prevents Git Bash from mangling /cade/ to a Windows path.
    # Under WSL it's harmless; under cmd.exe we pass it via 'set'.
    if [ -d "/mnt/c" ] && command -v cmd.exe >/dev/null 2>&1; then
        run_npm_env "set \"VITE_BASE_PATH=${ROOT_PATH}/\" &&" run build
    else
        run_npm_env "MSYS_NO_PATHCONV=1 VITE_BASE_PATH=${ROOT_PATH}/" run build
    fi

    if [ ! -f "$PROJECT_ROOT/frontend/dist/index.html" ]; then
        echo -e "${RED}✗ Frontend build failed — dist/index.html not found${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Frontend built with VITE_BASE_PATH=${ROOT_PATH}/"
fi
echo ""

# ── Step 1b: Build nkrdn wheel ────────────────────────────────────────────

NKRDN_WHEEL=""
if [ -n "$NKRDN_PROJECT" ]; then
    if [ "$SKIP_BUILD" = true ]; then
        # Use existing wheel if available
        NKRDN_WHEEL=$(ls "$NKRDN_PROJECT"/build/nkrdn-*.whl 2>/dev/null | head -1)
        if [ -n "$NKRDN_WHEEL" ]; then
            echo -e "${YELLOW}⤳${NC} Using existing nkrdn wheel (--skip-build)"
        else
            echo -e "${YELLOW}⤳${NC} No nkrdn wheel found, skipping"
        fi
    else
        echo -e "${CYAN}[1b/5]${NC} Building nkrdn wheel..."
        (cd "$NKRDN_PROJECT" && hatch build -t wheel 2>&1 | tail -1)
        NKRDN_WHEEL=$(ls "$NKRDN_PROJECT"/build/nkrdn-*.whl 2>/dev/null | head -1)
        if [ -n "$NKRDN_WHEEL" ]; then
            echo -e "${GREEN}✓${NC} Built $(basename "$NKRDN_WHEEL")"
        else
            echo -e "${YELLOW}⚠${NC} nkrdn wheel build failed, continuing without it"
        fi
    fi
    echo ""
fi

# ── Step 2: Sync files to remote ───────────────────────────────────────────

echo -e "${CYAN}[2/5]${NC} Syncing files to ${SSH_HOST}:${INSTALL_DIR}..."

# Ensure remote directories exist
ssh "$SSH_HOST" "mkdir -p ${INSTALL_DIR}/scripts ${INSTALL_DIR}/frontend ${INSTALL_DIR}/vendor"

if command -v rsync >/dev/null 2>&1; then
    # rsync: fast incremental sync with deletes
    rsync -az --delete \
        --exclude '__pycache__' \
        --exclude '*.pyc' \
        --exclude '.pytest_cache' \
        "$PROJECT_ROOT/backend/" \
        "${SSH_HOST}:${INSTALL_DIR}/backend/"

    rsync -az --delete \
        "$PROJECT_ROOT/frontend/dist/" \
        "${SSH_HOST}:${INSTALL_DIR}/frontend/dist/"

    rsync -az \
        "$PROJECT_ROOT/requirements.txt" \
        "${SSH_HOST}:${INSTALL_DIR}/requirements.txt"

    rsync -az \
        "$PROJECT_ROOT/scripts/setup-remote.sh" \
        "${SSH_HOST}:${INSTALL_DIR}/scripts/setup-remote.sh"

    if [ -n "$NKRDN_WHEEL" ]; then
        rsync -az "$NKRDN_WHEEL" "${SSH_HOST}:${INSTALL_DIR}/vendor/"
    fi
else
    # scp fallback for Windows/Git Bash where rsync isn't available.
    # Clean remote first to approximate rsync --delete behavior.
    echo "  (rsync not found, using scp fallback)"
    ssh "$SSH_HOST" "rm -rf ${INSTALL_DIR}/backend ${INSTALL_DIR}/frontend/dist"
    ssh "$SSH_HOST" "mkdir -p ${INSTALL_DIR}/frontend"

    scp -rq "$PROJECT_ROOT/backend" "${SSH_HOST}:${INSTALL_DIR}/"
    scp -rq "$PROJECT_ROOT/frontend/dist" "${SSH_HOST}:${INSTALL_DIR}/frontend/"
    scp -q "$PROJECT_ROOT/requirements.txt" "${SSH_HOST}:${INSTALL_DIR}/requirements.txt"
    scp -q "$PROJECT_ROOT/scripts/setup-remote.sh" "${SSH_HOST}:${INSTALL_DIR}/scripts/setup-remote.sh"

    # scp copies __pycache__ too — clean it on remote
    ssh "$SSH_HOST" "find ${INSTALL_DIR}/backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true"

    if [ -n "$NKRDN_WHEEL" ]; then
        scp -q "$NKRDN_WHEEL" "${SSH_HOST}:${INSTALL_DIR}/vendor/"
    fi
fi

# Fix Windows CRLF line endings if the file was written on Windows
ssh "$SSH_HOST" "sed -i 's/\r$//' ${INSTALL_DIR}/scripts/setup-remote.sh && chmod +x ${INSTALL_DIR}/scripts/setup-remote.sh"

echo -e "${GREEN}✓${NC} Files synced"
echo ""

# ── Step 3: Run setup on remote ────────────────────────────────────────────

if [ "$SKIP_SETUP" = true ]; then
    echo -e "${YELLOW}⤳${NC} Skipping setup (--skip-setup), restarting service..."
    ssh "$SSH_HOST" "sudo systemctl restart cade 2>/dev/null || true"
    echo -e "${GREEN}✓${NC} Restart requested"
else
    echo -e "${CYAN}[3/5]${NC} Running setup on remote..."

    # Build env var exports for setup-remote.sh
    SETUP_ENV="CADE_INSTALL_DIR=${INSTALL_DIR}"
    SETUP_ENV="$SETUP_ENV CADE_ROOT_PATH=${ROOT_PATH}"
    SETUP_ENV="$SETUP_ENV CADE_PORT=${PORT}"
    SETUP_ENV="$SETUP_ENV CADE_WORKING_DIR=${WORKING_DIR}"

    if [ "$SKIP_NGINX" = true ]; then
        SETUP_ENV="$SETUP_ENV CADE_SKIP_NGINX=1"
    fi
    if [ "$SKIP_CLAUDE" = true ]; then
        SETUP_ENV="$SETUP_ENV CADE_SKIP_CLAUDE=1"
    fi
    if [ "$SKIP_FIREWALL" = true ]; then
        SETUP_ENV="$SETUP_ENV CADE_SKIP_FIREWALL=1"
    fi

    ssh -tt "$SSH_HOST" "${SETUP_ENV} bash ${INSTALL_DIR}/scripts/setup-remote.sh"
    echo ""
    echo -e "${GREEN}✓${NC} Remote setup complete"
fi
echo ""

# ── Step 4: Verify ─────────────────────────────────────────────────────────

echo -e "${CYAN}[4/5]${NC} Verifying deployment..."

# Read the auth token from the remote
TOKEN=$(ssh "$SSH_HOST" "cat ${INSTALL_DIR}/.token 2>/dev/null || echo 'unknown'")

# Health check via the backend port directly
HEALTH=$(ssh "$SSH_HOST" "curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/login 2>/dev/null || echo 'failed'")

if [ "$HEALTH" = "200" ] || [ "$HEALTH" = "307" ]; then
    echo -e "${GREEN}✓${NC} Backend responding (HTTP ${HEALTH})"
else
    echo -e "${YELLOW}⚠${NC} Health check returned: ${HEALTH}"
    echo "  Check logs: ssh ${SSH_HOST} \"journalctl -u cade -n 50 --no-pager\""
fi

# ── Step 5: Verify nkrdn ──────────────────────────────────────────────────

if [ -n "$NKRDN_WHEEL" ]; then
    echo -e "${CYAN}[5/5]${NC} Verifying nkrdn..."
    if ssh "$SSH_HOST" "${INSTALL_DIR}/venv/bin/nkrdn stats --help >/dev/null 2>&1"; then
        echo -e "${GREEN}✓${NC} nkrdn available on remote"
    else
        echo -e "${YELLOW}⚠${NC} nkrdn not working on remote"
    fi
    echo ""
fi

# ── Summary ─────────────────────────────────────────────────────────────────

# Resolve the actual hostname/IP from SSH config (handles aliases like "glann" → "52.30.205.70")
# Falls back to the SSH host if resolution fails
REMOTE_HOST=$(ssh -G "$SSH_HOST" 2>/dev/null | awk '/^hostname / {print $2}' || echo "$SSH_HOST")

echo ""
echo -e "${BOLD}══════════════════════════════════════${NC}"
echo -e "${GREEN}  Deployment complete!${NC}"
echo -e "${BOLD}══════════════════════════════════════${NC}"
echo ""
echo -e "  Access:  ${CYAN}http://${REMOTE_HOST}${ROOT_PATH}/${NC}"
echo -e "  Token:   ${TOKEN}"
echo -e "  Logs:    ssh ${SSH_HOST} \"journalctl -u cade -f\""
echo -e "  Status:  ssh ${SSH_HOST} \"systemctl status cade\""
echo ""
