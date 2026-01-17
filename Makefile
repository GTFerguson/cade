# ccplus Makefile
# Run stable, dev, or both versions

.PHONY: stable dev dev-dummy both build kill clean help

# Default ports
STABLE_PORT ?= 3000
DEV_PORT ?= 3001
VITE_PORT ?= 5173

# Python command (adjust if needed)
PYTHON ?= python

help:
	@echo "Usage:"
	@echo "  make stable    - Build frontend and run on port $(STABLE_PORT)"
	@echo "  make dev       - Run backend on $(DEV_PORT) + Vite on $(VITE_PORT)"
	@echo "  make dev-dummy - Same as dev, but with fake Claude UI"
	@echo "  make both      - Run stable and dev simultaneously"
	@echo "  make build     - Build frontend only"
	@echo "  make kill      - Stop all ccplus processes"
	@echo ""
	@echo "Custom ports:"
	@echo "  make stable STABLE_PORT=8000"
	@echo "  make dev DEV_PORT=8001 VITE_PORT=5174"

# Build frontend
build:
	cd frontend && npm run build

# Run stable version (built frontend served by backend)
stable: build
	$(PYTHON) -m backend.main --port $(STABLE_PORT)

# Run dev version (Vite hot reload + backend)
dev:
	@echo "Starting dev backend on port $(DEV_PORT)..."
	@echo "Starting Vite on port $(VITE_PORT)..."
	@echo "Access dev at http://localhost:$(VITE_PORT)"
	$(PYTHON) -m backend.main --port $(DEV_PORT) --no-browser &
	cd frontend && BACKEND_PORT=$(DEV_PORT) npm run dev -- --port $(VITE_PORT)

# Run dev version with dummy Claude UI (no real Claude connection)
dev-dummy:
	@echo "Starting dev backend in DUMMY mode on port $(DEV_PORT)..."
	@echo "Starting Vite on port $(VITE_PORT)..."
	@echo "Access dev at http://localhost:$(VITE_PORT)"
	$(PYTHON) -m backend.main --port $(DEV_PORT) --no-browser --dummy &
	cd frontend && BACKEND_PORT=$(DEV_PORT) npm run dev -- --port $(VITE_PORT)

# Run both stable and dev
both: build
	@echo "Starting stable on port $(STABLE_PORT)..."
	@echo "Starting dev backend on port $(DEV_PORT)..."
	@echo "Starting Vite on port $(VITE_PORT)..."
	@echo ""
	@echo "Stable: http://localhost:$(STABLE_PORT)"
	@echo "Dev:    http://localhost:$(VITE_PORT)"
	@echo ""
	$(PYTHON) -m backend.main --port $(STABLE_PORT) --no-browser &
	$(PYTHON) -m backend.main --port $(DEV_PORT) --no-browser &
	cd frontend && BACKEND_PORT=$(DEV_PORT) npm run dev -- --port $(VITE_PORT)

# Stop all ccplus processes
kill:
	-pkill -f "backend.main" 2>/dev/null || true
	-pkill -f "vite" 2>/dev/null || true
	@echo "Stopped ccplus processes"

# Clean build artifacts
clean:
	rm -rf frontend/dist
	@echo "Cleaned build artifacts"
