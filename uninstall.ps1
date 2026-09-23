#Requires -Version 5.1
$ErrorActionPreference = "Continue"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Download with yt-dlp - Windows Uninstaller        " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Terminate running bridge server process
Write-Host "[1/3] Stopping background bridge server..." -ForegroundColor Yellow

# Method A: Kill by server.py in CommandLine via WMI/CIM
try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*server.py*"
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {}

# Method B: Kill any process listening on port 16800 via netstat
try {
    $lines = netstat -ano | Select-String ":16800 "
    foreach ($line in $lines) {
        $parts = ($line.ToString().Trim() -split "\s+")
        $targetPid = $parts[-1]
        if ($targetPid -match "^\d+$" -and [int]$targetPid -gt 0) {
            Stop-Process -Id [int]$targetPid -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}

Write-Host "  [OK] Background process terminated." -ForegroundColor Green

# 2. Remove Startup shortcut / script
Write-Host ""
Write-Host "[2/3] Removing autostart entry..." -ForegroundColor Yellow
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$VbsPath = Join-Path $StartupDir "yt-dlp-server.vbs"

if (Test-Path $VbsPath) {
    Remove-Item -Path $VbsPath -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Removed $VbsPath" -ForegroundColor Green
} else {
    Write-Host "  [i] No autostart entry found in Startup folder." -ForegroundColor Gray
}

# 3. Remove installed bridge files
Write-Host ""
Write-Host "[3/3] Removing bridge server files..." -ForegroundColor Yellow
$InstallDir = Join-Path $env:LOCALAPPDATA "yt-dlp-bridge"

if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Removed $InstallDir" -ForegroundColor Green
} else {
    Write-Host "  [i] Bridge directory not found at $InstallDir." -ForegroundColor Gray
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Uninstall Complete!                               " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "The local bridge server and its startup launcher have been removed."
Write-Host "Note: yt-dlp, ffmpeg, and Python remain installed on your system."
Write-Host ""
