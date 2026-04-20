# CADE Makefile
# Run stable, dev, or both versions

.PHONY: stable dev dev-dummy both build kill clean help build-desktop dev-desktop setup setup-remote check

# Default ports
STABLE_PORT ?= 3000
DEV_PORT ?= 3001
VITE_PORT ?= 5173

# Python command (adjust if needed).
# Prefer the project's .venv if it exists (has pinned deps from
# scripts/setup-dev.sh), then python3, then python. Without this,
# `make dev` silently started nothing on systems where `python` wasn't
# on PATH — the Makefile's "Backend ready" check would still pass if a
# stale backend was already listening on the port.
PYTHON ?= $(shell \
    if [ -x .venv/bin/python ]; then echo .venv/bin/python; \
    elif command -v python3 >/dev/null 2>&1; then command -v python3; \
    else echo python; fi)

# OS detection for cross-platform commands
ifeq ($(OS),Windows_NT)
    # Windows: use 'cmd /c start /b' for background processes
    BG = cmd /c start /b
    KILL_BACKEND = cmd /c "taskkill /f /im python.exe 2>nul || echo."
    KILL_VITE = cmd /c "taskkill /f /im node.exe 2>nul || echo."
    RM_RF = cmd /c "if exist frontend\dist rmdir /s /q frontend\dist"
    SET_CLEAR_SESSION = set VITE_CLEAR_SESSION=true &&
    SET_BACKEND_PORT = set BACKEND_PORT=$(DEV_PORT) &&
    define run_bg
    $(BG) $(1)
    endef
else
    # Unix: use '&' for background processes
    KILL_BACKEND = pkill -f "backend.main" 2>/dev/null || true
    KILL_VITE = pkill -f "vite" 2>/dev/null || true
    RM_RF = rm -rf frontend/dist
    SET_CLEAR_SESSION = VITE_CLEAR_SESSION=true
    SET_BACKEND_PORT = BACKEND_PORT=$(DEV_PORT)
    define run_bg
    $(1) &
    endef
endif

help:
	@echo "Usage:"
	@echo "  make setup        - Check prerequisites for desktop development"
	@echo "  make stable       - Build frontend and run on port $(STABLE_PORT)"
	@echo "  make dev          - Run backend on $(DEV_PORT) + Vite on $(VITE_PORT)"
	@echo "  make dev-dummy    - Same as dev, but with fake Claude UI"
	@echo "  make both         - Run stable and dev simultaneously"
	@echo "  make check        - Run typecheck and tests (quick validation)"
	@echo "  make build        - Build frontend only"
	@echo "  make kill         - Stop all CADE processes"
	@echo "  make build-desktop - Build desktop application (full build)"
	@echo "  make dev-desktop  - Run desktop app in dev mode (Tauri dev)"
	@echo "  make setup-remote HOST=<ssh-host> - Set up a remote server for CADE"
	@echo ""
	@echo "Custom ports:"
	@echo "  make stable STABLE_PORT=8000"
	@echo "  make dev DEV_PORT=8001 VITE_PORT=5174"

# Build frontend
build:
	cd frontend && npm run build

# Run typecheck and tests (quick local validation)
check:
	cd frontend && npm run typecheck && npx vitest run

# Run stable version (built frontend served by backend)
stable: build
	$(PYTHON) -m backend.main serve --port $(STABLE_PORT)

# Wait for backend to be ready (polls /api/auth/check until 200)
define wait_for_backend
	@echo "Waiting for backend on port $(1)..."; \
	for i in $$(seq 1 30); do \
		if curl -sf http://localhost:$(1)/api/auth/check > /dev/null 2>&1; then \
			echo "Backend ready."; break; \
		fi; \
		sleep 0.5; \
	done
endef

# Run dev version (Vite hot reload + backend)
dev:
	@echo "Starting dev backend on port $(DEV_PORT)..."
	$(call run_bg,$(PYTHON) -m backend.main serve --port $(DEV_PORT) --no-browser --debug)
	$(call wait_for_backend,$(DEV_PORT))
	@echo "Starting Vite on port $(VITE_PORT)..."
	@echo "Access dev at http://localhost:$(VITE_PORT)"
	@echo "To view files: cade view -p $(DEV_PORT) <path>"
	cd frontend && $(SET_BACKEND_PORT) npm run dev -- --port $(VITE_PORT)

# Run dev version with dummy Claude UI (no real Claude connection)
# Clears session state on each restart for clean testing
dev-dummy:
	@echo "Starting dev backend in DUMMY mode on port $(DEV_PORT)..."
	$(call run_bg,$(PYTHON) -m backend.main serve --port $(DEV_PORT) --no-browser --debug --dummy)
	$(call wait_for_backend,$(DEV_PORT))
	@echo "Starting Vite on port $(VITE_PORT) (sessions will be cleared)..."
	@echo "Access dev at http://localhost:$(VITE_PORT)"
	@echo "To view files: cade view -p $(DEV_PORT) <path>"
	cd frontend && $(SET_BACKEND_PORT) $(SET_CLEAR_SESSION) npm run dev -- --port $(VITE_PORT)

# Run both stable and dev
both: build
	@echo "Starting stable on port $(STABLE_PORT)..."
	$(call run_bg,$(PYTHON) -m backend.main serve --port $(STABLE_PORT) --no-browser)
	$(call wait_for_backend,$(STABLE_PORT))
	@echo "Starting dev backend on port $(DEV_PORT)..."
	$(call run_bg,$(PYTHON) -m backend.main serve --port $(DEV_PORT) --no-browser)
	$(call wait_for_backend,$(DEV_PORT))
	@echo ""
	@echo "Stable: http://localhost:$(STABLE_PORT)"
	@echo "Dev:    http://localhost:$(VITE_PORT)"
	@echo ""
	cd frontend && $(SET_BACKEND_PORT) npm run dev -- --port $(VITE_PORT)

# Stop all CADE processes
kill:
	-$(KILL_BACKEND)
	-$(KILL_VITE)
	@echo "Stopped CADE processes"

# Clean build artifacts
clean:
	$(RM_RF)
	@echo "Cleaned build artifacts"

# Check prerequisites for desktop development
setup:
	@bash scripts/setup-dev.sh && bash scripts/install-deps.sh

# Build desktop application (full build with PyInstaller + Tauri)
build-desktop:
	@echo "Building desktop application..."
ifeq ($(OS),Windows_NT)
	@PowerShell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
else
	@bash scripts/build-desktop.sh
endif

# Run desktop application in development mode
dev-desktop:
	@echo "Starting desktop app in dev mode..."
	@echo "Make sure Vite dev server is running (make dev in another terminal)"
	cd desktop && npm run dev

# Set up a remote server for CADE backend deployment
# Usage: make setup-remote HOST=<ssh-host>
HOST ?=
setup-remote:
ifndef HOST
	$(error HOST is required. Usage: make setup-remote HOST=<ssh-host>)
endif
	@echo "Setting up remote server: $(HOST)"
	@scp scripts/setup-remote.sh $(HOST):/tmp/cade-setup-remote.sh
	@ssh $(HOST) "tr -d '\r' < /tmp/cade-setup-remote.sh > /tmp/cade-setup.sh && chmod +x /tmp/cade-setup.sh"
	ssh -tt $(HOST) "bash /tmp/cade-setup.sh"
