# Download with yt-dlp (Firefox Extension & Local Bridge)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Browser Support](https://img.shields.io/badge/Browser-Firefox%20%7C%20Zen%20%7C%20LibreWolf%20%7C%20Floorp%20%7C%20Waterfox-FF7139?style=flat-square&logo=firefox-browser&logoColor=white)](https://mozilla.org)
[![OS Support](https://img.shields.io/badge/OS-Linux%20%7C%20Windows-blue?style=flat-square)](https://github.com/PlasmaDrifter/yt-dlp-firefox-extension)
[![yt-dlp](https://img.shields.io/badge/CLI-yt--dlp-red?style=flat-square&logo=youtube&logoColor=white)](https://github.com/yt-dlp/yt-dlp)

A lightweight Firefox / Gecko WebExtension and local bridge server that enables seamless one-click video and audio downloading directly from your browser using **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**.

> [!NOTE]
> **Questions, custom configs, or ideas?** Join us on Reddit at <nobr>[**r/PlasmaDrifterProjects**](https://reddit.com/r/PlasmaDrifterProjects)</nobr>!

---

## Features

* **Context Menu Integration**: Right-click on any video, link, or media element and select **"Download video with yt-dlp"**.
* **Zero Browser Overhead**: Downloads run asynchronously in the background via `yt-dlp` without slowing down or locking up your browser.
* **Instant Notifications & Feedback**: Real-time native alerts across **Linux** (`notify-send`) and **Windows** (Native Toast / Balloon), plus browser notifications and a toolbar badge.
* **Full yt-dlp Power**: Automatically inherits your custom yt-dlp configuration file (cookies, download folders, audio extraction, video quality formats, metadata, and subtitles).
* **Background Autostart**:
  * **Linux**: `systemd --user` service
  * **Windows**: Silent background service (`shell:startup` via `pythonw.exe`)
* **Toolbar Status Popup**: Real-time server health check with one-click refresh and OS-specific troubleshooting tips.
* **Gecko Browser Support**: Compatible with Firefox, Zen Browser, Floorp, LibreWolf, and Waterfox.

---

## Architecture Overview

```
+-------------------------------------------------+
|  Firefox / Zen / LibreWolf Browser              |
|  (WebExtension: background.js + toolbar popup)  |
+------------------------+------------------------+
                         | HTTP POST (http://127.0.0.1:16800/download)
                         v
+-------------------------------------------------+
|  Local Bridge Server (server.py)                |  <-- Autostart: systemd / Startup
+------------------------+------------------------+
                         | Spawns
                         v
+-------------------------------------------------+
|  yt-dlp CLI Process                             |  <-- Reads yt-dlp config
|  + Native Desktop Notifications                 |  <-- Saves videos to ~/Downloads
+-------------------------------------------------+
```

---

## Installation & Setup

### Step 1: Set Up the Local Bridge Server

Choose the installer for your operating system:

#### 🐧 Linux
Run the automated installer to check dependencies and enable the `systemd` user service:
```bash
git clone https://github.com/PlasmaDrifter/yt-dlp-firefox-extension.git
cd yt-dlp-firefox-extension
chmod +x install.sh
./install.sh
```

#### 🪟 Windows
1. Clone the repository or download the ZIP from GitHub:
```cmd
git clone https://github.com/PlasmaDrifter/yt-dlp-firefox-extension.git
cd yt-dlp-firefox-extension
install.bat
```
2. Simply double-click **`install.bat`**.

> [!IMPORTANT]
> **Python on Windows:**
> - The installer will attempt to install Python 3, `yt-dlp`, and `ffmpeg` automatically using `winget`.
> - If you install Python manually from [python.org](https://www.python.org/downloads/), **make sure to check the box: ☑️ "Add python.exe to PATH"** at the bottom of the Python installer window. Without this checkbox, Windows redirects Python commands to the Microsoft Store.

To stop and remove the bridge server at any time, double-click **`uninstall.bat`**.

---

### Step 2: Install the Extension in Firefox / Zen / Floorp / LibreWolf

#### Method 1: Install from Firefox Add-ons (Recommended)
Install the official signed version directly from Mozilla Add-ons:
**[Download with yt-dlp on Firefox Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/download-with-yt-dlp-local/)**

> [!TIP]
> Using the official AMO link is the easiest method for standard Firefox, as it is signed by Mozilla and updates automatically.

---

#### Method 2: Install from Local XPI File
If you prefer installing directly from a local file without using AMO:
1. Open your browser and navigate to `about:addons`.
2. Click the **gear icon** at the top right of the page.
3. Select **"Install Add-on From File..."** and choose `releases/yt-dlp-extension-v1.0.3.zip`.

> [!IMPORTANT]
> **Signature Requirement:** Standard Firefox releases enforce mandatory add-on signing. If you install an unsigned local `.zip`/`.xpi` file directly on standard Firefox, you will see a signature verification error. To use unsigned files permanently, use **Firefox Developer Edition**, **Firefox Nightly**, **Firefox ESR**, or **LibreWolf** and disable signature checking:
1. Open `about:config`.
2. Set `xpinstall.signatures.required` to `false`.

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

The extension triggers your system's `yt-dlp` binary, which automatically reads all settings from **`~/.config/yt-dlp/config`**.

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
├── install.sh              # Automated Linux installer script
├── install.bat             # Windows one-click installer batch script
├── install.ps1             # Windows installer PowerShell script
├── uninstall.bat           # Windows uninstaller batch script
├── uninstall.ps1           # Windows uninstaller PowerShell script
├── extension/              # WebExtension source code
│   ├── manifest.json       # Manifest V2 definition
│   ├── background.js       # Background context menu & download trigger
│   ├── popup/              # Toolbar status popup UI
│   └── icons/              # Extension icons (16, 32, 48, 64, 128)
├── bridge/                 # Local bridge servers and CLI wrappers
│   ├── server.py           # Lightweight Python HTTP bridge
│   ├── yt-dlp-cli.sh       # CLI execution script with notifications
│   └── yt-dlp-server.service # Systemd user service definition
└── releases/               # Prebuilt extension packages
    └── yt-dlp-extension-v1.0.5.zip  # Current WebExtension release package
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

---

## 💬 Community & Discussions

Got questions, setup ideas, or feedback?

* 🌐 Join our subreddit at [**r/PlasmaDrifterProjects**](https://reddit.com/r/PlasmaDrifterProjects) to discuss updates, get support, and share configurations.
