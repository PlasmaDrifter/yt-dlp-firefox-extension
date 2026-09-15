# Download with yt-dlp - Linux Setup Guide

This guide explains how to set up the local backend server on Linux and install the browser extension.

---

## 1. Prerequisites

Make sure Python 3, `yt-dlp`, and `ffmpeg` are installed on your Linux system.

### Fedora / RHEL:
```bash
sudo dnf install yt-dlp ffmpeg python3
```

### Ubuntu / Debian:
```bash
sudo apt update
sudo apt install yt-dlp ffmpeg python3
```

### Arch Linux:
```bash
sudo pacman -S yt-dlp ffmpeg python3
```

Alternatively, install `yt-dlp` via pip or download the binary:
```bash
pip install --user -U yt-dlp
```

---

## 2. Setting Up the Local Server

The extension communicates with a local HTTP server listening on `http://127.0.0.1:16800/download`.

### Option A: Run Manually in Terminal
To test the server immediately, run:
```bash
python3 bridge/server.py
```
*(By default, videos are downloaded to `~/Downloads`)*

---

### Option B: Run Automatically in Background (Systemd User Service)

To have the server run automatically when you log into Linux, run the installer:
```bash
./install.sh
```

Or configure manually:
```bash
mkdir -p ~/.config/systemd/user/
cp bridge/yt-dlp-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now yt-dlp-server
```

---

## 3. Installing the Extension in Firefox

### Loading as Temporary Add-on (for testing):
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select `extension/manifest.json`.

### Installing the Signed Release Package (.zip):
1. Go to `about:addons` in Firefox.
2. Click the gear icon ⚙️ and select **Install Add-on From File...**
3. Select `releases/yt-dlp-extension-v1.0.3.zip` or install directly from Mozilla Add-ons (AMO).

---

## 4. Usage

1. Right-click any video or video link on YouTube or supported websites.
2. Select **"Download video with yt-dlp"** from the context menu.
3. The server receives the URL and runs `yt-dlp` in the background, saving the video to `~/Downloads`.
