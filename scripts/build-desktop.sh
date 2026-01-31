#!/usr/bin/env bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "==================================="
echo "Building CADE Desktop Application"
echo "==================================="

# Check prerequisites
echo ""
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "Error: Rust/Cargo is not installed. Install from https://rustup.rs/"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed"
    exit 1
fi

if ! python3 -c "import pyinstaller" 2> /dev/null; then
    echo "Error: PyInstaller is not installed. Run: pip install pyinstaller"
    exit 1
fi

echo "✓ All prerequisites found"

# Step 1: Build frontend
echo ""
echo "Step 1/4: Building frontend..."
cd "$PROJECT_ROOT/frontend"
npm install
npm run build

if [ ! -d "$PROJECT_ROOT/frontend/dist" ]; then
    echo "Error: Frontend build failed - dist directory not found"
    exit 1
fi
echo "✓ Frontend built successfully"

# Step 2: Package Python backend with PyInstaller
echo ""
echo "Step 2/4: Packaging Python backend..."
cd "$PROJECT_ROOT"
python3 -m PyInstaller scripts/pyinstaller.spec --clean --noconfirm

# Check for the backend executable
if [ "$OSTYPE" == "msys" ] || [ "$OSTYPE" == "win32" ]; then
    BACKEND_EXE="dist/cade-backend.exe"
else
    BACKEND_EXE="dist/cade-backend"
fi

if [ ! -f "$BACKEND_EXE" ]; then
    echo "Error: Backend packaging failed - $BACKEND_EXE not found"
    exit 1
fi
echo "✓ Backend packaged successfully: $BACKEND_EXE"

# Step 3: Copy backend to Tauri resources
echo ""
echo "Step 3/4: Copying backend to Tauri resources..."
mkdir -p "$PROJECT_ROOT/desktop/src-tauri/resources"
cp "$BACKEND_EXE" "$PROJECT_ROOT/desktop/src-tauri/resources/"
chmod +x "$PROJECT_ROOT/desktop/src-tauri/resources/$(basename $BACKEND_EXE)"
echo "✓ Backend copied to Tauri resources"

# Step 4: Build Tauri app
echo ""
echo "Step 4/4: Building Tauri desktop app..."
cd "$PROJECT_ROOT/desktop"
npm install
npm run build

echo ""
echo "==================================="
echo "✓ Build complete!"
echo "==================================="
echo ""
echo "Installers are located in:"
echo "  $PROJECT_ROOT/desktop/src-tauri/target/release/bundle/"
echo ""

# List the generated bundles
if [ -d "$PROJECT_ROOT/desktop/src-tauri/target/release/bundle" ]; then
    echo "Generated bundles:"
    find "$PROJECT_ROOT/desktop/src-tauri/target/release/bundle" -type f \( -name "*.msi" -o -name "*.exe" -o -name "*.dmg" -o -name "*.deb" -o -name "*.AppImage" \) -exec basename {} \;
fi
