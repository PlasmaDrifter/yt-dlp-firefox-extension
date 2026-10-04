#!/usr/bin/env python3
import http.server
import json
import os
import platform
import re
import subprocess
import sys
import threading
import time
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
                            raw_path = m.group(1).strip()
                            expanded = os.path.expanduser(os.path.expandvars(raw_path))
                            if expanded.startswith(home):
                                return "~" + expanded[len(home):]
                            return expanded
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

active_jobs = {}
jobs_lock = threading.Lock()

def cleanup_old_jobs():
    """Remove finished jobs older than 60 seconds."""
    now = time.time()
    with jobs_lock:
        to_del = [jid for jid, j in active_jobs.items() if j.get("finished_at") and now - j["finished_at"] > 60]
        for jid in to_del:
            del active_jobs[jid]

def monitor_download(job_id, proc, valid_url, should_notify):
    pat_prog = re.compile(r'\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([\d\.]+\w+)(?:\s+at\s+([^\s]+)\s+ETA\s+([^\s]+))?')
    pat_merge = re.compile(r'\[(?:Merger|ExtractAudio)\]')
    pat_dest = re.compile(r'\[download\] Destination:\s*(.+)')
    pat_already = re.compile(r'\[download\]\s+(.+?)\s+has already been downloaded')
    pat_merger_dest = re.compile(r'\[Merger\]\s+Merging formats into\s+"?([^"\n]+)"?')

    try:
        if proc.stdout is not None:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue

                with jobs_lock:
                    if job_id not in active_jobs:
                        break
                    job = active_jobs[job_id]

                    m_prog = pat_prog.search(line)
                    if m_prog:
                        job["percent"] = float(m_prog.group(1))
                        job["size"] = m_prog.group(2)
                        if m_prog.group(3):
                            job["speed"] = m_prog.group(3)
                        if m_prog.group(4):
                            job["eta"] = m_prog.group(4)
                        job["status"] = "downloading"
                        job["updated_at"] = time.time()
                        continue

                    if pat_merge.search(line):
                        job["status"] = "merging"
                        job["percent"] = 100.0
                        job["updated_at"] = time.time()
                        continue

                    raw_fname = None
                    m_dest = pat_dest.search(line)
                    if m_dest:
                        raw_fname = m_dest.group(1).strip()
                    else:
                        m_already = pat_already.search(line)
                        if m_already:
                            raw_fname = m_already.group(1).strip()
                        else:
                            m_mrg = pat_merger_dest.search(line)
                            if m_mrg:
                                raw_fname = m_mrg.group(1).strip()

                    if raw_fname:
                        fname = os.path.basename(raw_fname)
                        job["filename"] = fname
                        clean_t = os.path.splitext(fname)[0]
                        clean_t = re.sub(r'\s*\[[a-zA-Z0-9_-]{6,15}\]$', '', clean_t).strip()
                        if clean_t:
                            job["title"] = clean_t
                        job["updated_at"] = time.time()

        proc.wait()
        with jobs_lock:
            if job_id in active_jobs:
                job = active_jobs[job_id]
                if job.get("status") == "cancelled":
                    job["finished_at"] = time.time()
                elif proc.returncode == 0:
                    job["status"] = "completed"
                    job["percent"] = 100.0
                    job["finished_at"] = time.time()
                    if should_notify:
                        clean_name = job.get("title") or job.get("filename") or valid_url
                        send_notification("yt-dlp", f"Download finished:\n{clean_name}")
                else:
                    job["status"] = "error"
                    job["finished_at"] = time.time()
    except Exception as e:
        print(f"[yt-dlp-server] Monitor error for {job_id}: {e}")
        with jobs_lock:
            if job_id in active_jobs:
                active_jobs[job_id]["status"] = "error"
                active_jobs[job_id]["finished_at"] = time.time()

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
        elif self.path == "/downloads":
            cleanup_old_jobs()
            with jobs_lock:
                downloads_list = [
                    {
                        "id": j["id"],
                        "url": j["url"],
                        "title": j["title"],
                        "percent": j["percent"],
                        "speed": j["speed"],
                        "eta": j["eta"],
                        "size": j["size"],
                        "status": j["status"],
                        "filename": j.get("filename", ""),
                        "finished_at": j.get("finished_at"),
                        "elapsed_since_finished": round(time.time() - j["finished_at"], 1) if j.get("finished_at") else None
                    }
                    for j in active_jobs.values()
                ]
            payload = json.dumps({"downloads": downloads_list}).encode("utf-8")
            self._set_headers(200, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()
        else:
            payload = json.dumps({"error": "Endpoint not found"}).encode("utf-8")
            self._set_headers(404, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()

    def do_POST(self):
        if self.path == "/download":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode("utf-8"))
                url = data.get("url")
                title = data.get("title", "")
                should_notify = data.get("notify", True)

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

                job_id = f"dl-{int(time.time() * 1000)}"
                quoted_url = f'"{valid_url}"' if platform.system() == "Windows" else valid_url
                cmd = [ytdlp_bin, "--newline", quoted_url]
                print(f"[yt-dlp-server] Running ({job_id}): {' '.join(cmd)}")

                popen_kwargs = {
                    "cwd": DOWNLOAD_DIR,
                    "stdout": subprocess.PIPE,
                    "stderr": subprocess.STDOUT,
                    "text": True,
                    "bufsize": 1
                }
                if platform.system() == "Windows":
                    popen_kwargs["shell"] = True

                proc = subprocess.Popen(cmd, **popen_kwargs)

                with jobs_lock:
                    active_jobs[job_id] = {
                        "id": job_id,
                        "url": valid_url,
                        "title": title or valid_url,
                        "percent": 0.0,
                        "speed": "",
                        "eta": "",
                        "size": "",
                        "status": "starting",
                        "filename": "",
                        "proc": proc,
                        "updated_at": time.time(),
                        "finished_at": None
                    }

                t = threading.Thread(target=monitor_download, args=(job_id, proc, valid_url, should_notify), daemon=True)
                t.start()

                # Send desktop notification if enabled
                if should_notify:
                    send_notification("yt-dlp", f"Starting download: {title or valid_url}")

                response = {
                    "status": "success",
                    "message": f"Downloading {valid_url}",
                    "job_id": job_id
                }
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

        elif self.path == "/cancel":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                job_id = data.get("job_id")
                cancelled = False
                with jobs_lock:
                    if job_id in active_jobs:
                        job = active_jobs[job_id]
                        proc = job.get("proc")
                        if proc and proc.poll() is None:
                            try:
                                proc.terminate()
                            except Exception:
                                pass
                        job["status"] = "cancelled"
                        job["finished_at"] = time.time()
                        cancelled = True
                payload = json.dumps({"status": "cancelled" if cancelled else "not_found", "job_id": job_id}).encode("utf-8")
                self._set_headers(200, len(payload))
                self.wfile.write(payload)
                self.wfile.flush()
            except Exception as e:
                payload = json.dumps({"error": str(e)}).encode("utf-8")
                self._set_headers(500, len(payload))
                self.wfile.write(payload)
                self.wfile.flush()
        elif self.path == "/clear":
            with jobs_lock:
                to_del = [jid for jid, j in active_jobs.items() if j.get("status") in ("completed", "cancelled", "error")]
                for jid in to_del:
                    del active_jobs[jid]
            payload = json.dumps({"status": "cleared", "cleared_count": len(to_del)}).encode("utf-8")
            self._set_headers(200, len(payload))
            self.wfile.write(payload)
            self.wfile.flush()
        else:
            payload = json.dumps({"error": "Endpoint not found"}).encode("utf-8")
            self._set_headers(404, len(payload))
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
