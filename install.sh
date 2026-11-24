#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"

echo "====================================================="
echo "   Download with yt-dlp - Installer & Setup          "
echo "====================================================="

if [[ "$OS" != "Linux" ]]; then
  echo "Detected OS: $OS"
  echo "Automated systemd installation is only supported on Linux."
  echo "You can run the bridge manually with: python3 \"$REPO_DIR/bridge/server.py\""
  exit 0
fi

INSTALL_DIR="$HOME/.local/share/yt-dlp-bridge"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

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
mkdir -p "$INSTALL_DIR" "$SYSTEMD_USER_DIR" "$HOME/.local/bin"

cp "$REPO_DIR/bridge/server.py" "$INSTALL_DIR/server.py"
cp "$REPO_DIR/bridge/yt-dlp-cli.sh" "$INSTALL_DIR/yt-dlp-cli.sh"
chmod +x "$INSTALL_DIR/yt-dlp-cli.sh" "$INSTALL_DIR/server.py"

ln -sf "$INSTALL_DIR/yt-dlp-cli.sh" "$HOME/.local/bin/yt-dlp-cli.sh"

cp "$REPO_DIR/bridge/yt-dlp-server.service" "$SYSTEMD_USER_DIR/yt-dlp-server.service"

if command -v systemctl &>/dev/null && systemctl --user list-units &>/dev/null; then
  systemctl --user daemon-reload
  systemctl --user enable yt-dlp-server.service
  systemctl --user restart yt-dlp-server.service
else
  echo "  ! systemd user session unavailable. Start manually with:"
  echo "    python3 \"$INSTALL_DIR/server.py\""
fi

echo "[3/3] Verifying bridge server status..."
healthy=0
for _ in 1 2 3 4 5; do
  if python3 - <<'PY' &>/dev/null
import json, urllib.request
with urllib.request.urlopen("http://127.0.0.1:16800/health", timeout=1.5) as resp:
    data = json.loads(resp.read().decode("utf-8"))
    assert resp.status == 200 and data.get("status") == "ok" and data.get("service") == "yt-dlp-bridge"
PY
  then
    healthy=1
    break
  fi
  sleep 0.5
done

if (( healthy == 1 )); then
  echo "  [OK] Local bridge server is active on http://127.0.0.1:16800"
else
  echo "  [!] Bridge server did not respond yet. Check: systemctl --user status yt-dlp-server.service"
fi

echo "====================================================="
echo "   Setup Complete!                                   "
echo "====================================================="
echo ""
echo "Next: Install or reload the extension in Firefox / Zen / Floorp / LibreWolf:"
echo "- Install from AMO: https://addons.mozilla.org/en-US/firefox/addon/download-with-yt-dlp-local/"
echo "- Or load unpacked from: $REPO_DIR/extension/manifest.json"
echo ""
echo "Videos will automatically download to your configured yt-dlp path (or ~/Downloads)"
