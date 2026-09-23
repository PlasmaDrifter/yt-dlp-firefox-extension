#Requires -Version 5.1
$ErrorActionPreference = "Continue"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Download with yt-dlp - Windows Installer & Setup  " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

function Refresh-Path {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:PATH = "$machinePath;$userPath;$env:LOCALAPPDATA\Microsoft\WindowsApps;$env:LOCALAPPDATA\Programs\Python\Python313;$env:LOCALAPPDATA\Programs\Python\Python312;$env:LOCALAPPDATA\Programs\Python\Python311;$env:LOCALAPPDATA\Programs\Python\Python310"
}

function Test-PythonWorks ($exePath) {
    if (-not $exePath) { return $false }
    try {
        $pinfo = New-Object System.Diagnostics.ProcessStartInfo
        $pinfo.FileName = $exePath
        $pinfo.Arguments = "--version"
        $pinfo.RedirectStandardOutput = $true
        $pinfo.RedirectStandardError = $true
        $pinfo.UseShellExecute = $false
        $pinfo.CreateNoWindow = $true
        $proc = [System.Diagnostics.Process]::Start($pinfo)
        $out = $proc.StandardOutput.ReadToEnd() + $proc.StandardError.ReadToEnd()
        $proc.WaitForExit(3000)
        if ($out -like "*Python 3*") { return $true }
    } catch {}
    return $false
}

function Find-PythonExe {
    Refresh-Path

    # 1. Check Registry (Most accurate on Windows)
    $regRoots = @(
        "HKCU:\Software\Python\PythonCore",
        "HKLM:\SOFTWARE\Python\PythonCore",
        "HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore"
    )
    foreach ($root in $regRoots) {
        if (Test-Path $root) {
            $versions = Get-ChildItem $root -ErrorAction SilentlyContinue
            foreach ($v in $versions) {
                $installPathKey = Join-Path $v.PSPath "InstallPath"
                if (Test-Path $installPathKey) {
                    $dir = (Get-ItemProperty -Path $installPathKey -ErrorAction SilentlyContinue).'(default)'
                    if (-not $dir) {
                        $dir = (Get-ItemProperty -Path $installPathKey -ErrorAction SilentlyContinue).ExecutablePath
                    }
                    if ($dir) {
                        if ($dir -like "*.exe" -and (Test-Path $dir) -and (Test-PythonWorks $dir)) {
                            $pw = Join-Path (Split-Path $dir) "pythonw.exe"
                            if (Test-Path $pw) { return $pw }
                            return $dir
                        }
                        $pw = Join-Path $dir "pythonw.exe"
                        $py = Join-Path $dir "python.exe"
                        if ((Test-Path $py) -and (Test-PythonWorks $py)) {
                            if (Test-Path $pw) { return $pw }
                            return $py
                        }
                    }
                }
            }
        }
    }

    # 2. Check common folder paths
    $patterns = @(
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "$env:ProgramFiles\Python3*\python.exe",
        "C:\Python3*\python.exe"
    )
    foreach ($pat in $patterns) {
        $items = Get-Item $pat -ErrorAction SilentlyContinue
        foreach ($item in $items) {
            if ($item -and (Test-Path $item.FullName) -and (Test-PythonWorks $item.FullName)) {
                $pw = Join-Path (Split-Path $item.FullName) "pythonw.exe"
                if (Test-Path $pw) { return $pw }
                return $item.FullName
            }
        }
    }

    # 3. Check Get-Command (ignoring WindowsApps stub unless it actually works)
    foreach ($name in @("pythonw", "python", "pyw", "py")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source) -and (Test-PythonWorks $cmd.Source)) {
            $pw = Join-Path (Split-Path $cmd.Source) "pythonw.exe"
            if (Test-Path $pw) { return $pw }
            return $cmd.Source
        }
    }

    return $null
}

function Test-CommandAvailable ($cmdName) {
    Refresh-Path
    if ($cmdName -eq "python") {
        return [bool](Find-PythonExe)
    }
    return [bool](Get-Command $cmdName -ErrorAction SilentlyContinue)
}

# Step 1: Check dependencies
Write-Host ""
Write-Host "[1/3] Checking dependencies (Python, yt-dlp, ffmpeg)..." -ForegroundColor Yellow

$missing = @()
if (-not (Test-CommandAvailable "python")) { $missing += "Python" }
if (-not (Test-CommandAvailable "yt-dlp")) { $missing += "yt-dlp" }
if (-not (Test-CommandAvailable "ffmpeg")) { $missing += "ffmpeg" }

if ($missing.Count -gt 0) {
    Write-Host "Missing required tools: $($missing -join ', ')" -ForegroundColor Yellow
    if (Test-CommandAvailable "winget") {
        Write-Host "Attempting automatic installation via winget..." -ForegroundColor Yellow
        if ($missing -contains "Python") { winget install --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements }
        if ($missing -contains "yt-dlp") { winget install --id yt-dlp.yt-dlp --silent --accept-package-agreements --accept-source-agreements }
        if ($missing -contains "ffmpeg") { winget install --id Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements }
        Refresh-Path
    } else {
        Write-Host "Please install Python 3, yt-dlp, and ffmpeg manually." -ForegroundColor Red
    }
} else {
    Write-Host "  [OK] All dependencies found." -ForegroundColor Green
}

# Locate Python executable
$pythonExe = Find-PythonExe
if (-not $pythonExe) {
    Write-Host "  [!] Python not found. Please install Python from https://www.python.org/downloads/ (check 'Add to PATH')" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "  [OK] Python located: $pythonExe" -ForegroundColor Green

# Step 2: Install bridge files
Write-Host ""
Write-Host "[2/3] Installing bridge server to %LOCALAPPDATA%\yt-dlp-bridge..." -ForegroundColor Yellow
$InstallDir = Join-Path $env:LOCALAPPDATA "yt-dlp-bridge"
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) {
    $ScriptDir = (Get-Location).Path
}

$SourceServerPy = Join-Path $ScriptDir "bridge\server.py"
if (-not (Test-Path $SourceServerPy)) {
    $SourceServerPy = Join-Path $ScriptDir "server.py"
}

Copy-Item $SourceServerPy -Destination (Join-Path $InstallDir "server.py") -Force

# Create silent startup launcher VBScript
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$VbsPath = Join-Path $StartupDir "yt-dlp-server.vbs"
$TargetServer = Join-Path $InstallDir "server.py"

$VbsContent = "Set WshShell = CreateObject(`"WScript.Shell`")`r`nWshShell.Run chr(34) & `"$pythonExe`" & chr(34) & `" `" & chr(34) & `"$TargetServer`" & chr(34), 0, False"
Set-Content -Path $VbsPath -Value $VbsContent -Encoding ASCII
Write-Host "  [OK] Startup shortcut created: $VbsPath" -ForegroundColor Green

# Step 3: Start server and verify
Write-Host ""
Write-Host "[3/3] Starting bridge server in background..." -ForegroundColor Yellow

# Stop any running old instance
Get-Process pythonw, python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*yt-dlp-bridge\server.py*" } | Stop-Process -Force -ErrorAction SilentlyContinue
try {
    $conns = Get-NetTCPConnection -LocalPort 16800 -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
} catch {}

# Launch silent background process directly with full path
Start-Process -FilePath $pythonExe -ArgumentList "`"$TargetServer`"" -WorkingDirectory $InstallDir -WindowStyle Hidden

Start-Sleep -Seconds 2

try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:16800/health" -Method Get -TimeoutSec 3 -ErrorAction Stop
    if ($res.status -eq "ok") {
        Write-Host "  [OK] Local bridge server is active on http://127.0.0.1:16800" -ForegroundColor Green
    }
} catch {
    Write-Host "  [i] Bridge server started. It will launch automatically on login." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Setup Complete!                                   " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next: Install the extension in Firefox / Zen / LibreWolf / Waterfox:"
Write-Host "- Install from AMO (Recommended): https://addons.mozilla.org/en-US/firefox/addon/download-with-yt-dlp-local/"
Write-Host "- Or install locally from file: $ScriptDir\releases\yt-dlp-extension-v1.0.4.zip"
Write-Host ""
Write-Host "Videos will automatically download to $env:USERPROFILE\Downloads"

