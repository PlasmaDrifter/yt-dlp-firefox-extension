#!/usr/bin/env bash
set -euo pipefail

echo "====================================================="
echo "   Download with yt-dlp - Linux Uninstaller          "
echo "====================================================="
echo ""

# 1. Stop and disable systemd user service
echo "[1/3] Stopping background bridge service..."
if systemctl --user is-active --quiet yt-dlp-server.service 2>/dev/null; then
  systemctl --user stop yt-dlp-server.service 2>/dev/null || true
  echo "  [OK] Service stopped."
else
  echo "  [i] Service was not running."
fi

if systemctl --user is-enabled --quiet yt-dlp-server.service 2>/dev/null; then
  systemctl --user disable yt-dlp-server.service 2>/dev/null || true
  echo "  [OK] Service disabled."
fi

# Fallback: kill any orphaned python process running server.py on port 16800
if command -v fuser &>/dev/null; then
  fuser -k 16800/tcp 2>/dev/null || true
elif command -v lsof &>/dev/null; then
  lsof -ti:16800 | xargs kill -9 2>/dev/null || true
fi

# 2. Remove systemd service unit file
echo ""
echo "[2/3] Removing systemd service unit..."
SERVICE_FILE="$HOME/.config/systemd/user/yt-dlp-server.service"
if [ -f "$SERVICE_FILE" ]; then
  rm -f "$SERVICE_FILE"
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user reset-failed 2>/dev/null || true
  echo "  [OK] Removed $SERVICE_FILE"
else
  echo "  [i] No systemd unit file found."
fi

# 3. Remove installed bridge files and symlinks
echo ""
echo "[3/3] Removing bridge files and CLI wrappers..."
INSTALL_DIR="$HOME/.local/share/yt-dlp-bridge"
CLI_SYMLINK="$HOME/.local/bin/yt-dlp-cli.sh"

if [ -L "$CLI_SYMLINK" ] || [ -f "$CLI_SYMLINK" ]; then
  rm -f "$CLI_SYMLINK"
  echo "  [OK] Removed $CLI_SYMLINK"
fi

if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "  [OK] Removed $INSTALL_DIR"
else
  echo "  [i] Directory $INSTALL_DIR not found."
fi

echo ""
echo "====================================================="
echo "   Uninstall Complete!                               "
echo "====================================================="
echo ""
echo "The local bridge server and systemd service have been removed."
echo "Note: System packages (yt-dlp, ffmpeg, python3) remain installed."
echo ""
