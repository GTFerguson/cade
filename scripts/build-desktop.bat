@echo off
REM CADE Desktop - Build Script Launcher (Windows)
REM This batch file launches the PowerShell build script

PowerShell -ExecutionPolicy Bypass -File "%~dp0build-desktop.ps1"
