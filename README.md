# Download with yt-dlp (Firefox Extension & Local Bridge)

A lightweight Firefox / Gecko WebExtension and local bridge server that enables seamless one-click video and audio downloading directly from your browser using **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**.

---

## Features

* **Context Menu Integration**: Right-click on any video, link, or media element and select **"Download video with yt-dlp"**.
* **Zero Browser Overhead**: Downloads run in the background via `yt-dlp` without slowing down or locking up your browser.
* **Desktop Notifications**: Real-time native desktop notifications when a download starts and completes.
* **Full yt-dlp Power**: Automatically inherits your custom `~/.config/yt-dlp/config` (cookies, download folders, audio extraction, video quality formats, metadata, and subtitles).
* **Multi-Platform Linux Support**: Works seamlessly on Arch Linux / Omarchy, Fedora, Debian/Ubuntu, and any standard Linux distribution.
* **Gecko Browser Support**: Compatible with Firefox, Zen Browser, Floorp, LibreWolf, and Waterfox.

---

## Architecture Overview

```
+--------------------------------------+
|  Firefox / Zen Browser               |
|  (WebExtension: background.js)       |
+------------------+-------------------+
                   | HTTP POST (http://127.0.0.1:16800/download)
                   v
+--------------------------------------+
|  Local Bridge Server (server.py)     |  <-- Enabled via systemd user service
+------------------+-------------------+
                   | Spawns
                   v
+--------------------------------------+
|  yt-dlp CLI Process                  |  <-- Reads ~/.config/yt-dlp/config
|  + notify-send Desktop Alerts        |  <-- Saves videos to ~/Downloads
+--------------------------------------+
```

---

## Quick Start & Installation

### Option 1: Automated One-Line Install (Recommended)

1. Clone this repository:
   ```bash
   git clone git@github.com:PlasmaDrifter/yt-dlp-firefox-extension.git ~/Source/yt-dlp-firefox-extension
   cd ~/Source/yt-dlp-firefox-extension
   ```

2. Run the installer script:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

3. Install the browser extension in Firefox / Zen:
   * Navigate to `about:addons` in your browser.
   * Click the gear icon at the top right and choose **"Install Add-on From File..."**.
   * Select `releases/yt-dlp-extension-v1.0.2.xpi`.

---

### Option 2: Manual Setup

#### Step 1: Install Dependencies
* **Arch Linux / Omarchy**:
  ```bash
  sudo pacman -S yt-dlp ffmpeg python3
  ```
* **Fedora**:
  ```bash
  sudo dnf install yt-dlp ffmpeg python3
  ```
* **Ubuntu / Debian**:
  ```bash
  sudo apt update && sudo apt install yt-dlp ffmpeg python3
  ```

#### Step 2: Enable the Background Service
Enable the local bridge server as a user-level systemd service so it runs automatically on login/boot:

```bash
mkdir -p ~/.config/systemd/user/
cp bridge/yt-dlp-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now yt-dlp-server.service
```

Verify the service is running:
```bash
systemctl --user status yt-dlp-server.service
```

#### Step 3: Load the Extension
* **Permanent Installation**: Go to `about:addons` -> Gear Icon -> **"Install Add-on From File..."** -> select `releases/yt-dlp-extension-v1.0.2.xpi`.
* **Developer / Temporary Mode**: Go to `about:debugging#/runtime/this-firefox` -> Click **"Load Temporary Add-on..."** -> Select `extension/manifest.json`.

---

## How to Use

1. Navigate to any supported video page (YouTube, Twitch, Twitter/X, Reddit, Vimeo, TikTok, etc.).
2. **Right-click** on the video or video link.
3. Click **"Download video with yt-dlp"** in the context menu.
4. You will see a desktop notification confirming the download has started.
5. The downloaded video will appear directly in your **`~/Downloads`** folder.

---

## Customization & Configuration

Because the extension triggers your local `yt-dlp` binary, all preferences in **[`~/.config/yt-dlp/config`](file:///home/jmc/.config/yt-dlp/config)** are respected automatically.

### Example `~/.config/yt-dlp/config`:
```text
# Save location
-P ~/Downloads/

# Best video and audio merged into MP4
-f "bv*+ba/b"
--merge-output-format mp4

# Embed metadata
--embed-metadata

# (Optional) Cookies file for private or age-restricted videos
--cookies ~/.config/yt-dlp/cookies.txt
```

---

## Repository Structure

```
yt-dlp-firefox-extension/
├── README.md               # Documentation and guide
├── LICENSE                 # MIT License
├── install.sh              # Automated setup and installer script
├── extension/              # WebExtension source code
│   ├── manifest.json       # Extension manifest (v2 / gecko)
│   ├── background.js       # Background context menu handler
│   └── icons/              # Extension icons (16, 32, 48, 64, 128)
├── bridge/                 # Local HTTP bridge servers
│   ├── server.py           # Zero-dependency lightweight Python server
│   ├── server.js           # Express.js Node.js server alternative
│   ├── yt-dlp-cli.sh       # CLI script with native notifications
│   └── yt-dlp-server.service # Systemd user service unit
└── releases/               # Packaged extension releases
    ├── yt-dlp-extension-v1.0.2.xpi  # Firefox add-on file
    └── yt-dlp-extension-v1.0.2.zip  # AMO submission archive
```

---

## Troubleshooting

### 1. "Failed to fetch" or no download starts
* Ensure the local bridge service is active:
  ```bash
  systemctl --user status yt-dlp-server.service
  ```
* Test the health check endpoint:
  ```bash
  curl http://127.0.0.1:16800/health
  ```
  *(Should return `{"status":"ok","service":"yt-dlp-bridge"}`)*

### 2. View Service Logs
To see real-time download logs:
```bash
journalctl --user -u yt-dlp-server.service -f
```

---

## License
This project is licensed under the [MIT License](LICENSE).
