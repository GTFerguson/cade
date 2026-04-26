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

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Frontend build failed (typecheck or bundling errors)" -ForegroundColor Red
    exit 1
}

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

# Helper: find the Python executable for a CLI tool by reading its shebang
function Find-VenvPython {
    param([string]$CliName)
    $binPath = Get-Command $CliName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $binPath) { return $null }
    $firstLine = (Get-Content $binPath -First 1 -ErrorAction SilentlyContinue)
    if ($firstLine -and $firstLine.StartsWith("#!")) {
        $pythonPath = $firstLine.Substring(2).Trim()
        if (Test-Path $pythonPath) { return $pythonPath }
    }
    $pythonCandidate = Join-Path (Split-Path $binPath) "python.exe"
    if (Test-Path $pythonCandidate) { return $pythonCandidate }
    return $null
}

# Helper: copy a built exe to Tauri resources with both plain and triple-suffix names
function Copy-ToTauriResources {
    param([string]$ExePath, [string]$ToolName, [string]$Triple)
    $tauriResources = "$projectRoot\desktop\src-tauri\resources"
    if (-not (Test-Path $tauriResources)) {
        New-Item -ItemType Directory -Path $tauriResources -Force | Out-Null
    }
    Copy-Item $ExePath -Destination "$tauriResources\$ToolName.exe" -Force
    if ($Triple) {
        Copy-Item $ExePath -Destination "$tauriResources\$ToolName-$Triple.exe" -Force
    }
    $size = [math]::Round((Get-Item $ExePath).Length / 1MB, 2)
    Write-Host "[OK] $ToolName copied to Tauri resources ($size MB)" -ForegroundColor Green
}

# Step 3: Package Python backend with PyInstaller
Write-Host "Step 3/7: Packaging Python backend..." -ForegroundColor Cyan
Set-Location $projectRoot

& $pythonCmd -m PyInstaller "$projectRoot\scripts\pyinstaller.spec" --clean --noconfirm

$backendExe = "$projectRoot\dist\cade-backend.exe"
if (-not (Test-Path $backendExe)) {
    Write-Host "Error: Backend packaging failed - $backendExe not found" -ForegroundColor Red
    exit 1
}

$targetTriple = "x86_64-pc-windows-msvc"
Copy-ToTauriResources $backendExe "cade-backend" $targetTriple
Write-Host ""

# Step 4: Package nkrdn with PyInstaller
Write-Host "Step 4/7: Packaging nkrdn..." -ForegroundColor Cyan
Set-Location $projectRoot

$nkrdnPython = Find-VenvPython "nkrdn"
if ($nkrdnPython) {
    Write-Host "Using nkrdn Python: $nkrdnPython" -ForegroundColor Yellow
    & $nkrdnPython -m pip install pyinstaller --quiet
    & $nkrdnPython -m PyInstaller "$projectRoot\scripts\pyinstaller-nkrdn.spec" --noconfirm

    $nkrdnExe = "$projectRoot\dist\nkrdn.exe"
    if (Test-Path $nkrdnExe) {
        Copy-ToTauriResources $nkrdnExe "nkrdn" $targetTriple

        # Copy nkrdn usage-rule.md to resources
        $nkrdnPkgDir = & $nkrdnPython -c "import nkrdn, os; print(os.path.dirname(nkrdn.__file__))" 2>$null
        if ($nkrdnPkgDir) {
            $usageRule = Join-Path $nkrdnPkgDir "usage-rule.md"
            if (Test-Path $usageRule) {
                Copy-Item $usageRule -Destination "$projectRoot\desktop\src-tauri\resources\nkrdn-usage-rule.md" -Force
                Write-Host "[OK] nkrdn usage-rule.md copied" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "Warning: nkrdn packaging failed - skipping" -ForegroundColor Yellow
    }
} else {
    Write-Host "Warning: nkrdn not found on PATH - skipping" -ForegroundColor Yellow
}
Write-Host ""

# Step 5: Package scout-browse with PyInstaller + copy Chromium
Write-Host "Step 5/7: Packaging scout-browse..." -ForegroundColor Cyan
Set-Location $projectRoot

$scoutPython = Find-VenvPython "scout-browse"
if ($scoutPython) {
    Write-Host "Using scout-browse Python: $scoutPython" -ForegroundColor Yellow
    & $scoutPython -m pip install pyinstaller --quiet
    & $scoutPython -m PyInstaller "$projectRoot\scripts\pyinstaller-scout-browse.spec" --noconfirm

    $scoutExe = "$projectRoot\dist\scout-browse.exe"
    if (Test-Path $scoutExe) {
        Copy-ToTauriResources $scoutExe "scout-browse" $targetTriple

        # Copy Chromium to resources/ms-playwright/
        $msPlaywrightCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
        if (-not (Test-Path $msPlaywrightCache)) {
            $msPlaywrightCache = Join-Path $env:USERPROFILE ".cache\ms-playwright"
        }
        if (Test-Path $msPlaywrightCache) {
            $chromiumDirs = Get-ChildItem $msPlaywrightCache -Directory | Where-Object { $_.Name -like "chromium-*" -and $_.Name -notlike "*headless*" }
            foreach ($chromiumDir in $chromiumDirs) {
                $dest = "$projectRoot\desktop\src-tauri\resources\ms-playwright\$($chromiumDir.Name)"
                if (-not (Test-Path $dest)) {
                    Write-Host "Copying $($chromiumDir.Name)..." -ForegroundColor Yellow
                    Copy-Item $chromiumDir.FullName -Destination $dest -Recurse -Force
                    $sizeMB = [math]::Round((Get-ChildItem $dest -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB, 0)
                    Write-Host "[OK] Chromium copied ($sizeMB MB)" -ForegroundColor Green
                } else {
                    Write-Host "[OK] Chromium already in resources: $($chromiumDir.Name)" -ForegroundColor Green
                }
            }
        } else {
            Write-Host "Warning: ms-playwright cache not found - scout-browse will need system Chromium" -ForegroundColor Yellow
            Write-Host "         Run: python -m patchright install chromium" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Warning: scout-browse packaging failed - skipping" -ForegroundColor Yellow
    }
} else {
    Write-Host "Warning: scout-browse not found on PATH - skipping" -ForegroundColor Yellow
}
Write-Host ""

# Step 6: Copy backend to Tauri resources (already done in step 3 via helper)
# (kept for numbering clarity)

# Step 7: Build Tauri app
Write-Host "Step 7/7: Building Tauri desktop app..." -ForegroundColor Cyan
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
