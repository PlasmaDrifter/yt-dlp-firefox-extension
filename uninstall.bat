@echo off
setlocal enabledelayedexpansion

echo =====================================================
echo   Download with yt-dlp - Windows Uninstaller
echo =====================================================
echo.

where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: PowerShell is required to run the uninstaller.
    pause
    exit /b 1
)

:: Terminate any process on port 16800 directly via cmd netstat
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :16800') do (
    if not "%%a"=="" if not "%%a"=="0" (
        taskkill /F /PID %%a >nul 2>&1
    )
)

if exist "%~dp0uninstall.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& { try { Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}; $v = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\yt-dlp-server.vbs'; if (Test-Path $v) { Remove-Item -Path $v -Force }; $d = Join-Path $env:LOCALAPPDATA 'yt-dlp-bridge'; if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force }; Write-Host 'Uninstall complete.' -ForegroundColor Green }"
)

pause
