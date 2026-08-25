#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "====================================================="
echo "   Download with yt-dlp - Installer & Setup          "
echo "====================================================="

# Check dependencies
echo "[1/3] Checking system dependencies..."
missing_deps=()
for cmd in yt-dlp ffmpeg; do
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

# Set up local bridge script
echo "[2/3] Installing bridge server and background service..."
mkdir -p "$HOME/Scripts/yt-dlp-extension-bridge" "$HOME/.config/systemd/user"

cp "$REPO_DIR/bridge/server.js" "$HOME/Scripts/yt-dlp-extension-bridge/" 2>/dev/null || true
cp "$REPO_DIR/bridge/package.json" "$HOME/Scripts/yt-dlp-extension-bridge/" 2>/dev/null || true
cp "$REPO_DIR/bridge/yt-dlp-cli.sh" "$HOME/Scripts/"
chmod +x "$HOME/Scripts/yt-dlp-cli.sh"

# Install systemd service
cat <<EOF > "$HOME/.config/systemd/user/yt-dlp-server.service"
[Unit]
Description=Local yt-dlp Firefox Extension Bridge Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR/bridge
ExecStart=$(which python3) $REPO_DIR/bridge/server.py
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
echo "Next: Install the extension in Firefox / Zen:"
echo "1. Open 'about:addons' in your browser."
echo "2. Click the gear icon and select 'Install Add-on From File...'."
echo "3. Choose: $REPO_DIR/releases/yt-dlp-extension-v1.0.2.xpi"
echo ""
echo "Videos will automatically download to ~/Downloads"
