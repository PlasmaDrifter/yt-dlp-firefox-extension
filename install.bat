@echo off
setlocal enabledelayedexpansion

echo =====================================================
echo    Download with yt-dlp - Windows Installer
echo =====================================================

:: Check for PowerShell
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: PowerShell is required to run the installer.
    pause
    exit /b 1
)

:: Run PowerShell installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

pause
