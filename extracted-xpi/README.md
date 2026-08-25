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
python3 /home/jmc/Source/yt-dlp@localhost/server.py
```
*(By default, videos are downloaded to `~/Downloads`)*

---

### Option B: Run Automatically in Background (Systemd User Service)

To have the server run automatically when you log into Linux, configure it as a `systemd` user service:

1. Create the user systemd service directory (if it doesn't exist):
   ```bash
   mkdir -p ~/.config/systemd/user/
   ```

2. Copy the service unit file:
   ```bash
   cp /home/jmc/Source/yt-dlp@localhost/yt-dlp-server.service ~/.config/systemd/user/
   ```

3. Enable and start the service:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now yt-dlp-server
   ```

4. Check the service status:
   ```bash
   systemctl --user status yt-dlp-server
   ```

---

## 3. Installing the Extension in Firefox

### Loading as Temporary Add-on (for testing):
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select [/home/jmc/Source/yt-dlp@localhost/manifest.json](file:///home/jmc/Source/yt-dlp@localhost/manifest.json).

### Installing the Signed Release Package (.xpi / .zip):
1. Go to `about:addons` in Firefox.
2. Click the gear icon ⚙️ and select **Install Add-on From File...**
3. Select [yt-dlp-extension-v1.0.2.xpi](file:///home/jmc/Source/yt-dlp@localhost/yt-dlp-extension-v1.0.2.xpi) or upload [yt-dlp-extension-v1.0.2.zip](file:///home/jmc/Source/yt-dlp@localhost/yt-dlp-extension-v1.0.2.zip) to the Mozilla Developer Hub (AMO).

---

## 4. Usage

1. Right-click any video or video link on YouTube or supported websites.
2. Select **"Download video with yt-dlp"** from the context menu.
3. The server receives the URL and runs `yt-dlp` in the background, saving the video to `~/Downloads`.
