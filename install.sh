#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"

echo "====================================================="
echo "   Download with yt-dlp - Installer & Setup          "
echo "====================================================="

# Linux installer
INSTALL_DIR="$HOME/.local/share/yt-dlp-bridge"
echo "[1/3] Checking Linux system dependencies..."
  missing_deps=()
  for cmd in yt-dlp ffmpeg python3; do
    if ! command -v "$cmd" &>/dev/null; then
      missing_deps+=("$cmd")
    fi
  done

  if (( ${#missing_deps[@]} > 0 )); then
    echo "Missing dependencies: ${missing_deps[*]}"
    if command -v pacman &>/dev/null; then
      sudo pacman -S --needed --noconfirm "${missing_deps[@]}"
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y "${missing_deps[@]}"
    elif command -v apt &>/dev/null; then
      sudo apt update && sudo apt install -y "${missing_deps[@]}"
    else
      echo "Please install ${missing_deps[*]} using your package manager."
    fi
  fi

  echo "[2/3] Installing bridge server files..."
  mkdir -p "$INSTALL_DIR" "$HOME/.config/systemd/user" "$HOME/.local/bin"

  cp "$REPO_DIR/bridge/server.py" "$INSTALL_DIR/"
  cp "$REPO_DIR/bridge/server.js" "$INSTALL_DIR/" 2>/dev/null || true
  cp "$REPO_DIR/bridge/package.json" "$INSTALL_DIR/" 2>/dev/null || true
  cp "$REPO_DIR/bridge/yt-dlp-cli.sh" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/yt-dlp-cli.sh" "$INSTALL_DIR/server.py"

  ln -sf "$INSTALL_DIR/yt-dlp-cli.sh" "$HOME/.local/bin/yt-dlp-cli.sh"

  cat <<EOF > "$HOME/.config/systemd/user/yt-dlp-server.service"
[Unit]
Description=Local yt-dlp Firefox Extension Bridge Server
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/.local/share/yt-dlp-bridge
ExecStart=/usr/bin/env python3 %h/.local/share/yt-dlp-bridge/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now yt-dlp-server.service

  echo "[3/3] Verifying bridge server status..."
  sleep 1
  if curl -s http://127.0.0.1:16800/health &>/dev/null || curl -s -X POST http://127.0.0.1:16800/download &>/dev/null; then
    echo "  ✓ Local bridge server is active on http://127.0.0.1:16800"
  else
    echo "  ℹ Starting bridge server with systemctl..."
    systemctl --user restart yt-dlp-server.service
  fi

echo "====================================================="
echo "   Setup Complete!                                   "
echo "====================================================="
echo ""
echo "Next: Install the extension in Firefox / Zen / Floorp / LibreWolf:"
echo "• Install from AMO (Recommended): https://addons.mozilla.org/en-US/firefox/addon/download-with-yt-dlp-local/"
echo "• Or install locally from file: $REPO_DIR/releases/yt-dlp-extension-v1.0.4.zip"
echo ""
echo "Videos will automatically download to ~/Downloads"
