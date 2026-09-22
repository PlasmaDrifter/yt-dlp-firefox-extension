#!/usr/bin/env python3
import http.server
import json
import os
import platform
import re
import subprocess
import sys
import urllib.parse

PORT = 16800
DOWNLOAD_DIR = os.path.expanduser("~/Downloads")

def get_configured_destination():
    """Detect destination from yt-dlp config, falling back to ~/Downloads."""
    home = os.path.expanduser("~")
    if platform.system() == "Windows":
        appdata = os.environ.get("APPDATA", "")
        userprofile = os.environ.get("USERPROFILE", home)
        config_paths = [
            os.path.join(appdata, "yt-dlp", "config"),
            os.path.join(appdata, "yt-dlp", "config.txt"),
            os.path.join(userprofile, "yt-dlp.conf"),
            os.path.join(userprofile, "yt-dlp.conf.txt"),
        ]
    else:
        config_paths = [
            os.path.join(home, ".config", "yt-dlp", "config"),
            os.path.join(home, ".config", "yt-dlp.conf"),
            os.path.join(home, ".yt-dlp.conf"),
            "/etc/yt-dlp.conf",
        ]

    for p in config_paths:
        if p and os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("#") or not line:
                            continue
                        m = re.match(r'^(?:-P|--paths)\s+(?:(?:home|temp):)?[\"\']?([^\"\']+)[\"\']?', line)
                        if m:
                            return m.group(1).strip()
            except Exception:
                pass

    return "~/Downloads" if platform.system() != "Windows" else os.path.join(os.environ.get("USERPROFILE", "~"), "Downloads")

# In pythonw.exe on Windows, stdout and stderr are None. Redirect to server.log to prevent crashes in BaseHTTPRequestHandler.log_message.
log_dir = os.path.dirname(os.path.abspath(__file__))
if sys.stdout is None or sys.stderr is None:
    try:
        _log_fp = open(os.path.join(log_dir, "server.log"), "a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = _log_fp
        if sys.stderr is None:
            sys.stderr = _log_fp
    except Exception:
        pass

def send_notification(title, message, is_error=False):
    """Send a native desktop notification across Linux and Windows."""
    try:
        system = platform.system()
        if system == "Linux":
            icon = "dialog-error" if is_error else "download"
            urgency = "critical" if is_error else "normal"
            subprocess.Popen(
                ["notify-send", title, message, "-i", icon, "-u", urgency],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        elif system == "Windows":
            escaped_msg = message.replace('"', '`"').replace("'", "''")
            escaped_title = title.replace('"', '`"').replace("'", "''")
            ps_script = f"""
            try {{
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
                $xml = @"
                <toast>
                    <visual>
                        <binding template="ToastGeneric">
                            <text>{escaped_title}</text>
                            <text>{escaped_msg}</text>
                        </binding>
                    </visual>
                </toast>
"@
                $toastXml = New-Object Windows.Data.Xml.Dom.XmlDocument
                $toastXml.LoadXml($xml)
                $toast = [Windows.UI.Notifications.ToastNotification]::new($toastXml)
                $appId = '{{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}}\\WindowsPowerShell\\v1.0\\powershell.exe'
                [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
            }} catch {{
                Add-Type -AssemblyName System.Windows.Forms
                $notify = New-Object System.Windows.Forms.NotifyIcon
                $notify.Icon = [System.Drawing.SystemIcons]::Information
                $notify.BalloonTipTitle = '{escaped_title}'
                $notify.BalloonTipText = '{escaped_msg}'
                $notify.Visible = $True
                $notify.ShowBalloonTip(4000)
                Start-Sleep -Seconds 4
                $notify.Dispose()
            }}
            """
            flags = 0x08000000  # CREATE_NO_WINDOW
            subprocess.Popen(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
                creationflags=flags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
    except Exception as e:
        print(f"[yt-dlp-server] Notification warning: {e}")

import shutil
import glob

def find_ytdlp():
    cmd = shutil.which("yt-dlp") or shutil.which("yt-dlp.exe")
    if cmd:
        return cmd
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    local_bin = os.path.join(script_dir, "yt-dlp.exe" if platform.system() == "Windows" else "yt-dlp")
    if os.path.exists(local_bin):
        return local_bin

    py_dir = os.path.dirname(sys.executable)
    py_scripts = os.path.join(py_dir, "Scripts", "yt-dlp.exe")
    if os.path.exists(py_scripts):
        return py_scripts

    if platform.system() == "Windows":
        candidates = [
            os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps\yt-dlp.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\*\yt-dlp.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\yt-dlp\yt-dlp.exe"),
            os.path.expandvars(r"%ProgramFiles%\yt-dlp\yt-dlp.exe"),
            os.path.expandvars(r"C:\yt-dlp\yt-dlp.exe"),
        ]
        for pat in candidates:
            matches = glob.glob(pat)
            if matches and os.path.exists(matches[0]):
                return matches[0]

    return "yt-dlp"

class YtDlpHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        if sys.stderr is not None:
            try:
                sys.stderr.write("%s - - [%s] %s\n" %
                                 (self.address_string(),
                                  self.log_date_time_string(),
                                  format % args))
            except Exception:
                pass

    def _set_headers(self, status=200, length=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Connection", "close")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200, 0)
        self.wfile.flush()

    def do_GET(self):
        if self.path == "/health":
            payload = json.dumps({
                "status": "ok",
                "service": "yt-dlp-bridge",
                "platform": sys.platform,
                "destination": get_configured_destination()
            }).encode("utf-8")
            self._set_headers(200, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()
        else:
            payload = json.dumps({"error": "Endpoint not found"}).encode("utf-8")
            self._set_headers(404, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()

    def do_POST(self):
        if self.path != "/download":
            payload = json.dumps({"error": "Endpoint not found"}).encode("utf-8")
            self._set_headers(404, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            data = json.loads(post_data.decode("utf-8"))
            url = data.get("url")

            if not url or not isinstance(url, str):
                payload = json.dumps({"error": "No URL provided"}).encode("utf-8")
                self._set_headers(400, len(payload))
                self.wfile.write(payload)
                self.wfile.flush()
                return

            # Validate URL scheme to prevent argument/command injection
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                payload = json.dumps({"error": "Invalid URL protocol. Only HTTP and HTTPS are supported."}).encode("utf-8")
                self._set_headers(400, len(payload))
                self.wfile.write(payload)
                self.wfile.flush()
                return

            valid_url = parsed.geturl()
            print(f"[yt-dlp-server] Triggering download for: {valid_url}")
            os.makedirs(DOWNLOAD_DIR, exist_ok=True)

            ytdlp_bin = find_ytdlp()
            print(f"[yt-dlp-server] Using yt-dlp binary: {ytdlp_bin}")

            # Spawn yt-dlp with visible output for verification
            popen_kwargs = {"cwd": DOWNLOAD_DIR}
            if platform.system() == "Windows":
                popen_kwargs["shell"] = True

            quoted_url = f'"{valid_url}"' if platform.system() == "Windows" else valid_url
            cmd = [ytdlp_bin, quoted_url]
            print(f"[yt-dlp-server] Running: {' '.join(cmd)}")
            proc = subprocess.Popen(cmd, **popen_kwargs)

            # Send desktop notification
            send_notification("yt-dlp", f"Starting download: {valid_url}")

            response = {"status": "success", "message": f"Downloading {valid_url}"}
            payload = json.dumps(response).encode("utf-8")
            self._set_headers(200, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()

        except Exception as e:
            print(f"[yt-dlp-server] Error during download: {e}")
            payload = json.dumps({"error": str(e)}).encode("utf-8")
            self._set_headers(500, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()

class ReusableServer(http.server.ThreadingHTTPServer if hasattr(http.server, "ThreadingHTTPServer") else http.server.HTTPServer):
    allow_reuse_address = True

def run():
    server_address = ("0.0.0.0", PORT)
    httpd = ReusableServer(server_address, YtDlpHandler)
    print(f"yt-dlp server listening on port {PORT} (http://127.0.0.1:{PORT})")
    print(f"Videos will be saved to: {DOWNLOAD_DIR}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping yt-dlp server.")

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        log_dir = os.path.dirname(os.path.abspath(__file__))
        log_file = os.path.join(log_dir, "server_error.log")
        with open(log_file, "a", encoding="utf-8") as f:
            import traceback
            traceback.print_exc(file=f)
        print(f"Server startup error: {e}")
        import sys
        sys.exit(1)
