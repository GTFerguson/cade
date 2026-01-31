# CADE Desktop - Windows Setup Script
# Run this in PowerShell as Administrator

#Requires -RunAsAdministrator

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "CADE Desktop - Windows Setup" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Function to check if a command exists
function Test-Command {
    param($Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Function to check version
function Get-CommandVersion {
    param($Command, $VersionArg = "--version")
    try {
        $output = & $Command $VersionArg 2>&1 | Select-Object -First 1
        return $output
    } catch {
        return $null
    }
}

Write-Host "This script will install:" -ForegroundColor Yellow
Write-Host "  * Node.js & npm (if needed)"
Write-Host "  * Rust & Cargo"
Write-Host "  * Python 3.8+"
Write-Host "  * PyInstaller"
Write-Host "  * Visual Studio Build Tools (required for Rust)"
Write-Host ""

$response = Read-Host "Continue with installation? (y/N)"
if ($response -notmatch '^[Yy]$') {
    Write-Host "Setup cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Checking Prerequisites" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

$needsInstall = @()

# Check for winget
if (-not (Test-Command "winget")) {
    Write-Host "Warning: winget not found. Some installations may require manual download." -ForegroundColor Yellow
    Write-Host "Install winget from: https://aka.ms/getwinget" -ForegroundColor Yellow
    Write-Host ""
}

# Check Node.js
Write-Host "Checking Node.js... " -NoNewline
if (Test-Command "node") {
    $nodeVersion = node --version
    Write-Host "[OK] $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "[MISSING]" -ForegroundColor Red
    $needsInstall += "nodejs"
}

# Check npm
Write-Host "Checking npm... " -NoNewline
if (Test-Command "npm") {
    $npmVersion = npm --version
    Write-Host "[OK] v$npmVersion" -ForegroundColor Green
} else {
    Write-Host "[MISSING]" -ForegroundColor Red
    $needsInstall += "npm"
}

# Check Rust
Write-Host "Checking Rust... " -NoNewline
if (Test-Command "rustc") {
    $rustVersion = rustc --version
    Write-Host "[OK] $rustVersion" -ForegroundColor Green
} else {
    Write-Host "[MISSING]" -ForegroundColor Red
    $needsInstall += "rust"
}

# Check Cargo
Write-Host "Checking Cargo... " -NoNewline
if (Test-Command "cargo") {
    $cargoVersion = cargo --version
    Write-Host "[OK] $cargoVersion" -ForegroundColor Green
} else {
    Write-Host "[MISSING]" -ForegroundColor Red
}

# Check Python
Write-Host "Checking Python... " -NoNewline
$pythonCmd = $null
if (Test-Command "python") {
    $pythonCmd = "python"
} elseif (Test-Command "python3") {
    $pythonCmd = "python3"
}

if ($pythonCmd) {
    $pythonVersion = & $pythonCmd --version 2>&1
    Write-Host "[OK] $pythonVersion" -ForegroundColor Green
} else {
    Write-Host "[MISSING]" -ForegroundColor Red
    $needsInstall += "python"
}

# Check pip
Write-Host "Checking pip... " -NoNewline
if (Test-Command "pip") {
    $pipVersion = pip --version 2>&1 | Select-Object -First 1
    Write-Host "[OK] $pipVersion" -ForegroundColor Green
} else {
    Write-Host "[MISSING]" -ForegroundColor Red
}

# Check PyInstaller
Write-Host "Checking PyInstaller... " -NoNewline
try {
    if ($pythonCmd) {
        & $pythonCmd -c "import PyInstaller; print(PyInstaller.__version__)" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $pyinstallerVersion = & $pythonCmd -c "import PyInstaller; print(PyInstaller.__version__)"
            Write-Host "[OK] v$pyinstallerVersion" -ForegroundColor Green
        } else {
            Write-Host "[MISSING]" -ForegroundColor Red
            $needsInstall += "pyinstaller"
        }
    } else {
        Write-Host "[MISSING]" -ForegroundColor Red
        $needsInstall += "pyinstaller"
    }
} catch {
    Write-Host "[MISSING]" -ForegroundColor Red
    $needsInstall += "pyinstaller"
}

Write-Host ""

if ($needsInstall.Count -eq 0) {
    Write-Host "All prerequisites are already installed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Installing project dependencies..."
    & "$PSScriptRoot\install-deps.ps1"
    exit 0
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Installing Missing Prerequisites" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Install Node.js
if ($needsInstall -contains "nodejs") {
    Write-Host "Installing Node.js..." -ForegroundColor Yellow
    if (Test-Command "winget") {
        winget install OpenJS.NodeJS.LTS --silent
    } else {
        Write-Host "Please download Node.js from: https://nodejs.org/" -ForegroundColor Red
        Start-Process "https://nodejs.org/"
        Read-Host "Press Enter after installing Node.js"
    }
}

# Install Python
if ($needsInstall -contains "python") {
    Write-Host "Installing Python..." -ForegroundColor Yellow
    if (Test-Command "winget") {
        winget install Python.Python.3.12 --silent
    } else {
        Write-Host "Please download Python from: https://www.python.org/downloads/" -ForegroundColor Red
        Start-Process "https://www.python.org/downloads/"
        Read-Host "Press Enter after installing Python"
    }
}

# Install Rust
if ($needsInstall -contains "rust") {
    Write-Host "Installing Rust..." -ForegroundColor Yellow
    Write-Host "Downloading rustup-init.exe..." -ForegroundColor Cyan

    $rustupUrl = "https://win.rustup.rs/x86_64"
    $rustupPath = "$env:TEMP\rustup-init.exe"

    try {
        Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupPath -UseBasicParsing
        Write-Host "Running Rust installer..." -ForegroundColor Cyan
        & $rustupPath -y --default-toolchain stable

        # Add Rust to PATH for current session
        $env:Path += ";$env:USERPROFILE\.cargo\bin"

        Remove-Item $rustupPath -ErrorAction SilentlyContinue
    } catch {
        Write-Host "Failed to download Rust installer. Please install manually from: https://rustup.rs/" -ForegroundColor Red
        Start-Process "https://rustup.rs/"
        Read-Host "Press Enter after installing Rust"
    }
}

# Install PyInstaller
if ($needsInstall -contains "pyinstaller") {
    Write-Host "Installing PyInstaller..." -ForegroundColor Yellow
    if ($pythonCmd) {
        & $pythonCmd -m pip install pyinstaller --upgrade
    } else {
        pip install pyinstaller --upgrade
    }
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Checking Visual Studio Build Tools" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check for Visual Studio Build Tools
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasBuildTools = $false

if (Test-Path $vswhere) {
    $vsInstalls = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsInstalls) {
        Write-Host "[OK] Visual Studio Build Tools found" -ForegroundColor Green
        $hasBuildTools = $true
    }
}

if (-not $hasBuildTools) {
    Write-Host "[MISSING] Visual Studio Build Tools not found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Visual Studio Build Tools are REQUIRED for Rust development on Windows." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please install Visual Studio Build Tools:" -ForegroundColor Cyan
    Write-Host "1. Download from: https://visualstudio.microsoft.com/downloads/" -ForegroundColor White
    Write-Host "2. Run the installer" -ForegroundColor White
    Write-Host "3. Select 'Desktop development with C++'" -ForegroundColor White
    Write-Host "4. Install (this may take 15-30 minutes)" -ForegroundColor White
    Write-Host ""

    $response = Read-Host "Open download page now? (y/N)"
    if ($response -match '^[Yy]$') {
        Start-Process "https://visualstudio.microsoft.com/downloads/"
    }

    Write-Host ""
    Write-Host "After installing Build Tools, restart PowerShell and run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Verifying Installation" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

$allGood = $true

# Verify Node.js
if (Test-Command "node") {
    Write-Host "[OK] Node.js: $(node --version)" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Node.js not found" -ForegroundColor Red
    $allGood = $false
}

# Verify npm
if (Test-Command "npm") {
    Write-Host "[OK] npm: v$(npm --version)" -ForegroundColor Green
} else {
    Write-Host "[FAIL] npm not found" -ForegroundColor Red
    $allGood = $false
}

# Verify Rust
if (Test-Command "rustc") {
    Write-Host "[OK] $(rustc --version)" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Rust not found" -ForegroundColor Red
    $allGood = $false
}

# Verify Cargo
if (Test-Command "cargo") {
    Write-Host "[OK] $(cargo --version)" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Cargo not found" -ForegroundColor Red
    $allGood = $false
}

# Verify Python
if ($pythonCmd) {
    Write-Host "[OK] $(& $pythonCmd --version)" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Python not found" -ForegroundColor Red
    $allGood = $false
}

# Verify PyInstaller
try {
    if ($pythonCmd) {
        $pyinstallerVersion = & $pythonCmd -c "import PyInstaller; print(PyInstaller.__version__)" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] PyInstaller: v$pyinstallerVersion" -ForegroundColor Green
        } else {
            Write-Host "[FAIL] PyInstaller not found" -ForegroundColor Red
            $allGood = $false
        }
    }
} catch {
    Write-Host "[FAIL] PyInstaller not found" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

if ($allGood) {
    Write-Host "======================================" -ForegroundColor Green
    Write-Host "Setup Complete!" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANT: Restart PowerShell to ensure all PATH changes take effect." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "After restarting, install project dependencies:" -ForegroundColor Cyan
    Write-Host "  cd $PSScriptRoot\.."
    Write-Host "  .\scripts\install-deps.ps1"
    Write-Host ""
    Write-Host "Then you can build:" -ForegroundColor Cyan
    Write-Host "  make build-desktop"
    Write-Host ""
} else {
    Write-Host "======================================" -ForegroundColor Yellow
    Write-Host "Setup Incomplete" -ForegroundColor Yellow
    Write-Host "======================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Some prerequisites are missing. Please:" -ForegroundColor Red
    Write-Host "1. Restart PowerShell as Administrator" -ForegroundColor White
    Write-Host "2. Run this script again" -ForegroundColor White
    Write-Host ""
    exit 1
}
