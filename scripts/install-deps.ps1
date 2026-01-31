# CADE Desktop - Install Project Dependencies (Windows)
# Run this after setup-dev.ps1 completes

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "CADE Desktop - Install Dependencies" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

# Step 1: Frontend dependencies
Write-Host "[1/3] Installing frontend dependencies..." -ForegroundColor Cyan
Set-Location "$projectRoot\frontend"
npm install
Write-Host "[OK] Frontend dependencies installed" -ForegroundColor Green
Write-Host ""

# Step 2: Desktop dependencies
Write-Host "[2/3] Installing desktop dependencies..." -ForegroundColor Cyan
Set-Location "$projectRoot\desktop"
npm install
Write-Host "[OK] Desktop dependencies installed" -ForegroundColor Green
Write-Host ""

# Step 3: Python dependencies
Write-Host "[3/3] Installing Python dependencies..." -ForegroundColor Cyan
Set-Location $projectRoot

if (Test-Path "requirements.txt") {
    pip install -r requirements.txt
    Write-Host "[OK] Python dependencies installed" -ForegroundColor Green
} else {
    Write-Host "Note: No requirements.txt found" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "======================================" -ForegroundColor Green
Write-Host "All dependencies installed!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "You're ready to start developing!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Available commands:" -ForegroundColor White
Write-Host "  make dev          - Web development mode (Vite + backend)"
Write-Host "  make dev-desktop  - Desktop development mode (Tauri dev)"
Write-Host "  make build-desktop - Build desktop application"
Write-Host ""
Write-Host "See desktop\QUICKSTART.md for more details." -ForegroundColor Gray
Write-Host ""
