# CADE Desktop - Build Script (Windows)
# Builds the complete desktop application with installers

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSScriptRoot
$projectRoot = $scriptDir

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "Building CADE Desktop Application" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-Command {
    param($Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Cyan
Write-Host ""

$missingTools = @()

if (-not (Test-Command "node")) {
    Write-Host "[X] Node.js is not installed" -ForegroundColor Red
    $missingTools += "Node.js"
} else {
    Write-Host "[OK] Node.js: $(node --version)" -ForegroundColor Green
}

if (-not (Test-Command "npm")) {
    Write-Host "[X] npm is not installed" -ForegroundColor Red
    $missingTools += "npm"
} else {
    Write-Host "[OK] npm: v$(npm --version)" -ForegroundColor Green
}

if (-not (Test-Command "cargo")) {
    Write-Host "[X] Rust/Cargo is not installed" -ForegroundColor Red
    $missingTools += "Rust"
} else {
    Write-Host "[OK] Rust: $(rustc --version)" -ForegroundColor Green
}

$pythonCmd = if (Test-Command "python") { "python" } elseif (Test-Command "py") { "py" } else { $null }
if (-not $pythonCmd) {
    Write-Host "[X] Python is not installed" -ForegroundColor Red
    $missingTools += "Python"
} else {
    Write-Host "[OK] Python: $(& $pythonCmd --version)" -ForegroundColor Green
}

# Check PyInstaller
$hasPyInstaller = $false
if ($pythonCmd) {
    try {
        & $pythonCmd -c "import PyInstaller" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $pyinstallerVersion = & $pythonCmd -c "import PyInstaller; print(PyInstaller.__version__)"
            Write-Host "[OK] PyInstaller: v$pyinstallerVersion" -ForegroundColor Green
            $hasPyInstaller = $true
        }
    } catch {}
}

if (-not $hasPyInstaller) {
    Write-Host "[X] PyInstaller is not installed" -ForegroundColor Red
    $missingTools += "PyInstaller"
}

if ($missingTools.Count -gt 0) {
    Write-Host ""
    Write-Host "Error: Missing prerequisites: $($missingTools -join ', ')" -ForegroundColor Red
    Write-Host ""
    Write-Host "Run the setup script first:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup-dev.ps1"
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "[OK] All prerequisites found" -ForegroundColor Green
Write-Host ""

# Step 1: Build frontend
Write-Host "Step 1/5: Building frontend..." -ForegroundColor Cyan
Set-Location "$projectRoot\frontend"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}

# Desktop builds serve from root /, not a subpath like /cade/
$env:VITE_BASE_PATH = "/"
npm run build

if (-not (Test-Path "dist")) {
    Write-Host "Error: Frontend build failed - dist directory not found" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Frontend built successfully" -ForegroundColor Green
Write-Host ""

# Step 2: Download Neovim portable
Write-Host "Step 2/5: Downloading Neovim portable..." -ForegroundColor Cyan
Set-Location $projectRoot

$nvimVersion = "v0.11.0"
$nvimZipUrl = "https://github.com/neovim/neovim/releases/download/$nvimVersion/nvim-win64.zip"
$nvimZipPath = "$projectRoot\dist\nvim-win64.zip"
$nvimDir = "$projectRoot\dist\nvim"

# Ensure dist/ directory exists
if (-not (Test-Path "$projectRoot\dist")) {
    New-Item -ItemType Directory -Path "$projectRoot\dist" -Force | Out-Null
}

# Download only if not cached
if (-not (Test-Path $nvimZipPath)) {
    Write-Host "Downloading Neovim $nvimVersion portable..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $nvimZipUrl -OutFile $nvimZipPath
} else {
    Write-Host "Using cached Neovim download: $nvimZipPath" -ForegroundColor Yellow
}

# Extract (the zip contains nvim-win64/ as root)
Write-Host "Extracting Neovim..." -ForegroundColor Yellow
Expand-Archive -Path $nvimZipPath -DestinationPath "$projectRoot\dist" -Force
if (Test-Path $nvimDir) { Remove-Item -Recurse -Force $nvimDir }
Rename-Item "$projectRoot\dist\nvim-win64" $nvimDir

Write-Host "[OK] Neovim $nvimVersion extracted to $nvimDir" -ForegroundColor Green
Write-Host ""

# Step 3: Package Python backend with PyInstaller
Write-Host "Step 3/5: Packaging Python backend..." -ForegroundColor Cyan
Set-Location $projectRoot

& $pythonCmd -m PyInstaller "$projectRoot\scripts\pyinstaller.spec" --clean --noconfirm

# Check for the backend executable
$backendExe = "$projectRoot\dist\cade-backend.exe"
if (-not (Test-Path $backendExe)) {
    Write-Host "Error: Backend packaging failed - $backendExe not found" -ForegroundColor Red
    exit 1
}

$backendSize = [math]::Round((Get-Item $backendExe).Length / 1MB, 2)
Write-Host "[OK] Backend packaged successfully: $backendExe ($backendSize MB)" -ForegroundColor Green
Write-Host ""

# Step 4: Copy backend to Tauri resources
Write-Host "Step 4/5: Copying backend to Tauri resources..." -ForegroundColor Cyan
$tauriResources = "$projectRoot\desktop\src-tauri\resources"

if (-not (Test-Path $tauriResources)) {
    New-Item -ItemType Directory -Path $tauriResources -Force | Out-Null
}

# Tauri expects the binary to be named with the target triple
$targetTriple = "x86_64-pc-windows-msvc"
$tauriBackendName = "cade-backend-$targetTriple.exe"
Copy-Item $backendExe -Destination "$tauriResources\$tauriBackendName" -Force
# Also copy with the plain name so the dev-path lookup in python.rs finds the fresh build
Copy-Item $backendExe -Destination "$tauriResources\cade-backend.exe" -Force
Write-Host "[OK] Backend copied to Tauri resources as $tauriBackendName + cade-backend.exe" -ForegroundColor Green
Write-Host ""

# Step 5: Build Tauri app
Write-Host "Step 5/5: Building Tauri desktop app..." -ForegroundColor Cyan
Set-Location "$projectRoot\desktop"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing desktop dependencies..." -ForegroundColor Yellow
    npm install
}

npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Error: Tauri build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "===================================" -ForegroundColor Green
Write-Host "[OK] Build complete!" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Green
Write-Host ""
Write-Host "Installers are located in:" -ForegroundColor Cyan
Write-Host "  $projectRoot\desktop\src-tauri\target\release\bundle\" -ForegroundColor White
Write-Host ""

# List the generated bundles
$bundleDir = "$projectRoot\desktop\src-tauri\target\release\bundle"
if (Test-Path $bundleDir) {
    Write-Host "Generated bundles:" -ForegroundColor Cyan
    Get-ChildItem -Path $bundleDir -Recurse -Include "*.msi", "*.exe" | ForEach-Object {
        $size = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name) ($size MB)" -ForegroundColor White
    }
    Write-Host ""
}
