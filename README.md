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

## Installation & Setup

### Step 1: Install System Dependencies
Ensure `yt-dlp`, `ffmpeg`, and `python3` are installed on your system:

* **Arch Linux**:
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

---

### Step 2: Set Up the Local Bridge Server
The bridge server listens on `http://127.0.0.1:16800` and executes `yt-dlp` when requested by the extension.

#### Option A: Automatic Installer
Run the provided installer script to set up and enable the background service:
```bash
git clone git@github.com:PlasmaDrifter/yt-dlp-firefox-extension.git ~/Source/yt-dlp-firefox-extension
cd ~/Source/yt-dlp-firefox-extension
chmod +x install.sh
./install.sh
```

#### Option B: Manual Service Setup
```bash
mkdir -p ~/.config/systemd/user/
cp bridge/yt-dlp-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now yt-dlp-server.service
```

Verify that the service is active:
```bash
systemctl --user status yt-dlp-server.service
curl http://127.0.0.1:16800/health
```

---

### Step 3: Install the Extension in Firefox / Zen

Choose one of the following methods to install the extension in your browser:

#### Method 1: Install from Firefox Add-ons (Recommended)
Install the official signed version directly from Mozilla Add-ons:
**[Download with yt-dlp on Firefox Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/download-with-yt-dlp-local/)**

> [!TIP]
> Using the official AMO link is the easiest and most permanent method for standard Firefox, as it is signed by Mozilla and updates automatically.

---

#### Method 2: Install from Local XPI File
If you prefer installing directly from a local file without using AMO:
1. Open your browser and navigate to `about:addons`.
2. Click the **gear icon** at the top right of the page.
3. Select **"Install Add-on From File..."** and choose `releases/yt-dlp-extension-v1.0.2.xpi`.

> [!IMPORTANT]
> **Signature Requirement:** Standard Firefox releases enforce mandatory add-on signing. If you install an unsigned local `.xpi` file directly on standard Firefox, you will see a signature verification error. To use unsigned `.xpi` files permanently, use **Firefox Developer Edition**, **Firefox Nightly**, **Firefox ESR**, or **LibreWolf** and disable signature checking:
> 1. Open `about:config`.
> 2. Set `xpinstall.signatures.required` to `false`.

---

#### Method 3: Load Temporarily in Developer Mode
1. Open your browser and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select the `manifest.json` file inside `extension/manifest.json`.
4. The extension will load immediately for your current browser session.

---

## How to Use

1. Navigate to any supported video page (YouTube, Twitch, Twitter/X, Reddit, Vimeo, TikTok, etc.).
2. **Right-click** on the video or video link.
3. Click **"Download video with yt-dlp"** in the context menu.
4. A desktop notification will confirm that the download has started.
5. The downloaded video will be saved directly into your **`~/Downloads`** folder.

---

## Customization & Configuration

The extension triggers your system's `yt-dlp` binary, which automatically reads all settings from **[`~/.config/yt-dlp/config`](file:///home/jmc/.config/yt-dlp/config)**.

### Example `~/.config/yt-dlp/config`:
```text
# Default download directory
-P ~/Downloads/

# Best quality video and audio merged into MP4
-f "bv*+ba/b"
--merge-output-format mp4

# Embed metadata and subtitles
--embed-metadata

# (Optional) Cookies file for private or age-restricted videos
--cookies ~/.config/yt-dlp/cookies.txt
```

---

## Repository Structure

```
yt-dlp-firefox-extension/
├── README.md               # Complete documentation and setup guide
├── LICENSE                 # MIT License
├── install.sh              # Automated systemd installer script
├── extracted-xpi/          # Extracted contents of the .xpi archive
│   ├── manifest.json       # Extension manifest
│   ├── background.js       # Background service script
│   ├── server.py           # Python bridge server
│   ├── yt-dlp-server.service # Systemd unit file
│   └── icons/              # Extension icons (16, 32, 48, 64, 128)
├── extension/              # WebExtension source code
│   ├── manifest.json
│   ├── background.js
│   └── icons/
├── bridge/                 # Local bridge servers and CLI wrappers
│   ├── server.py           # Lightweight Python HTTP bridge
│   ├── server.js           # Node.js Express bridge alternative
│   ├── yt-dlp-cli.sh       # CLI execution script with notifications
│   └── yt-dlp-server.service # Systemd user service definition
└── releases/               # Prebuilt extension packages
    ├── yt-dlp-extension-v1.0.2.xpi  # Packaged add-on for Firefox/Zen
    └── yt-dlp-extension-v1.0.2.zip  # Add-on archive
```

---

## Troubleshooting

### 1. "Failed to fetch" error or downloads not triggering
* Verify that the local bridge server is running:
  ```bash
  systemctl --user status yt-dlp-server.service
  ```
* Test the health check endpoint:
  ```bash
  curl http://127.0.0.1:16800/health
  ```
  *(Expected output: `{"status":"ok","service":"yt-dlp-bridge"}`)*

### 2. Check Service Logs
To inspect live download output and errors:
```bash
journalctl --user -u yt-dlp-server.service -f
```

---

## License
This project is licensed under the [MIT License](LICENSE).
