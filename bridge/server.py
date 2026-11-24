#!/usr/bin/env python3
import atexit
import contextlib
import glob
import http.server
import json
import os
import platform
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from pathlib import Path
from typing import Any

BRIDGE_VERSION = "1.1.0"
PORT = int(os.environ.get("YTDLP_BRIDGE_PORT", "16800"))
HOST = "127.0.0.1"
MAX_BODY_BYTES = 64 * 1024
FINISHED_JOB_RETENTION_SECONDS = 3600
MAX_FINISHED_JOBS = 100
CREATE_NO_WINDOW = 0x08000000

MODE_FLAGS: dict[str, list[str]] = {
    "default": [],
    "audio": ["-x"],
    "single": ["--no-playlist"],
    "playlist": ["--yes-playlist"],
}

_CONFIG_CACHE_LOCK = threading.Lock()
_CONFIG_CACHE: tuple[tuple[tuple[str, float], ...], tuple[str, str]] | None = None
_STDIO_LOG_STREAM: Any = None


def configure_stdio() -> None:
    """Configure line buffering on stdio and redirect None streams on Windows pythonw."""
    global _STDIO_LOG_STREAM
    log_path = Path(__file__).resolve().parent / "server.log"
    if sys.stdout is None or sys.stderr is None:
        try:
            _STDIO_LOG_STREAM = log_path.open("a", encoding="utf-8", buffering=1)
            atexit.register(_STDIO_LOG_STREAM.close)
            if sys.stdout is None:
                sys.stdout = _STDIO_LOG_STREAM
            if sys.stderr is None:
                sys.stderr = _STDIO_LOG_STREAM
        except OSError:
            pass
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            with contextlib.suppress(OSError, ValueError):
                stream.reconfigure(line_buffering=True)


def _collapse_home(path: str, home: str) -> str:
    if platform.system() != "Windows" and home and (path == home or path.startswith(home + os.sep)):
        return "~" + path[len(home) :]
    return path


def _default_download_dir() -> str:
    home = os.path.expanduser("~")
    if platform.system() == "Windows":
        base = os.environ.get("USERPROFILE", home)
        return os.path.join(base, "Downloads")
    return os.path.join(home, "Downloads")


def _ytdlp_config_candidates() -> list[str]:
    home = os.path.expanduser("~")
    if platform.system() == "Windows":
        appdata = os.environ.get("APPDATA", "")
        userprofile = os.environ.get("USERPROFILE", home)
        return [
            os.path.join(appdata, "yt-dlp", "config"),
            os.path.join(appdata, "yt-dlp", "config.txt"),
            os.path.join(userprofile, "yt-dlp.conf"),
            os.path.join(userprofile, "yt-dlp.conf.txt"),
        ]
    xdg_config = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
    return [
        os.path.join(xdg_config, "yt-dlp", "config"),
        os.path.join(xdg_config, "yt-dlp.conf"),
        os.path.join(home, ".yt-dlp.conf"),
        "/etc/yt-dlp.conf",
    ]


def _extract_path_from_config_line(line: str) -> str | None:
    try:
        tokens = shlex.split(line, comments=True, posix=(platform.system() != "Windows"))
    except ValueError:
        tokens = line.split()
    if not tokens:
        return None

    chosen: str | None = None
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        raw_val: str | None = None
        if tok in ("-P", "--paths"):
            if i + 1 < len(tokens):
                raw_val = tokens[i + 1]
                i += 2
            else:
                i += 1
        elif tok.startswith("--paths="):
            raw_val = tok.split("=", 1)[1]
            i += 1
        elif tok.startswith("-P") and len(tok) > 2:
            raw_val = tok[2:]
            i += 1
        else:
            i += 1
            continue

        if not raw_val:
            continue

        # Support yt-dlp TYPE:PATH syntax (prefer home: or unprefixed path; ignore temp:, etc.)
        if ":" in raw_val and not (len(raw_val) >= 2 and raw_val[1] == ":" and raw_val[0].isalpha()):
            prefix, rest = raw_val.split(":", 1)
            if prefix.lower() == "home":
                chosen = rest.strip("\"'")
            elif prefix.lower() in (
                "temp",
                "subtitle",
                "thumbnail",
                "description",
                "annotation",
                "infojson",
            ):
                continue
            else:
                chosen = raw_val.strip("\"'")
        else:
            chosen = raw_val.strip("\"'")

    return chosen


def resolve_destination_paths() -> tuple[str, str]:
    """Return (display_path, expanded_filesystem_path) from yt-dlp config or default Downloads."""
    global _CONFIG_CACHE
    candidates = [p for p in _ytdlp_config_candidates() if p and os.path.isfile(p)]
    signature = tuple((p, os.path.getmtime(p)) for p in candidates)

    with _CONFIG_CACHE_LOCK:
        if _CONFIG_CACHE is not None and _CONFIG_CACHE[0] == signature:
            return _CONFIG_CACHE[1]

    home = os.path.expanduser("~")
    detected: str | None = None
    for cfg_path in candidates:
        try:
            with open(cfg_path, encoding="utf-8", errors="ignore") as f:
                for raw_line in f:
                    stripped = raw_line.strip()
                    if not stripped or stripped.startswith("#"):
                        continue
                    extracted = _extract_path_from_config_line(stripped)
                    if extracted:
                        detected = extracted
            if detected:
                break
        except OSError:
            continue

    if detected:
        expanded = os.path.normpath(os.path.expanduser(os.path.expandvars(detected)))
    else:
        expanded = os.path.normpath(_default_download_dir())

    display = _collapse_home(expanded, home)
    result = (display, expanded)
    with _CONFIG_CACHE_LOCK:
        _CONFIG_CACHE = (signature, result)
    return result


def get_configured_destination() -> str:
    """Detect user-friendly destination string from yt-dlp config, falling back to ~/Downloads."""
    display, _ = resolve_destination_paths()
    return display


def send_notification(title: str, message: str, is_error: bool = False) -> None:
    """Send a native desktop notification safely across Linux, macOS, and Windows."""
    try:
        system = platform.system()
        if system == "Linux":
            notify_bin = shutil.which("notify-send")
            if not notify_bin:
                return
            icon = "dialog-error" if is_error else "download"
            urgency = "critical" if is_error else "normal"
            subprocess.Popen(
                [notify_bin, "--", title, message, "-i", icon, "-u", urgency],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        elif system == "Darwin":
            osascript_bin = shutil.which("osascript")
            if not osascript_bin:
                return
            env = os.environ.copy()
            env["YTDLP_NOTIFY_TITLE"] = title
            env["YTDLP_NOTIFY_MSG"] = message
            script = (
                'display notification (system attribute "YTDLP_NOTIFY_MSG") '
                'with title (system attribute "YTDLP_NOTIFY_TITLE")'
            )
            subprocess.Popen(
                [osascript_bin, "-e", script],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        elif system == "Windows":
            # Pass title and message via environment variables to prevent PowerShell/XML injection.
            env = os.environ.copy()
            env["YTDLP_NOTIFY_TITLE"] = title
            env["YTDLP_NOTIFY_MSG"] = message
            ps_script = """
            $t = [string]$env:YTDLP_NOTIFY_TITLE
            $m = [string]$env:YTDLP_NOTIFY_MSG
            try {
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
                $escT = [System.Security.SecurityElement]::Escape($t)
                $escM = [System.Security.SecurityElement]::Escape($m)
                $xml = "<toast><visual><binding template='ToastGeneric'><text>$escT</text><text>$escM</text></binding></visual></toast>"
                $toastXml = New-Object Windows.Data.Xml.Dom.XmlDocument
                $toastXml.LoadXml($xml)
                $toast = [Windows.UI.Notifications.ToastNotification]::new($toastXml)
                $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
                [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
            } catch {
                Add-Type -AssemblyName System.Windows.Forms
                $notify = New-Object System.Windows.Forms.NotifyIcon
                $notify.Icon = [System.Drawing.SystemIcons]::Information
                $notify.BalloonTipTitle = $t
                $notify.BalloonTipText = $m
                $notify.Visible = $true
                $notify.ShowBalloonTip(4000)
                Start-Sleep -Seconds 4
                $notify.Dispose()
            }
            """
            subprocess.Popen(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
                env=env,
                creationflags=CREATE_NO_WINDOW,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except (OSError, subprocess.SubprocessError) as e:
        print(f"[yt-dlp-server] Notification warning: {e}", file=sys.stderr)


def find_ytdlp() -> str | None:
    """Locate the yt-dlp binary across PATH, local user directories, and OS install paths."""
    cmd = shutil.which("yt-dlp") or shutil.which("yt-dlp.exe")
    if cmd:
        return cmd

    script_dir = os.path.dirname(os.path.abspath(__file__))
    is_win = platform.system() == "Windows"
    local_bin = os.path.join(script_dir, "yt-dlp.exe" if is_win else "yt-dlp")
    if os.path.isfile(local_bin):
        return local_bin

    py_dir = os.path.dirname(sys.executable)
    if is_win:
        py_scripts = os.path.join(py_dir, "Scripts", "yt-dlp.exe")
        if os.path.isfile(py_scripts):
            return py_scripts
        candidates = [
            os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps\yt-dlp.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\*\yt-dlp.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\yt-dlp\yt-dlp.exe"),
            os.path.expandvars(r"%ProgramFiles%\yt-dlp\yt-dlp.exe"),
            r"C:\yt-dlp\yt-dlp.exe",
        ]
        for pat in candidates:
            matches = glob.glob(pat)
            if matches and os.path.isfile(matches[0]):
                return matches[0]
    else:
        home = os.path.expanduser("~")
        posix_candidates = [
            os.path.join(home, ".local", "bin", "yt-dlp"),
            os.path.join(py_dir, "yt-dlp"),
            "/opt/homebrew/bin/yt-dlp",
            "/usr/local/bin/yt-dlp",
            "/usr/bin/yt-dlp",
        ]
        for cand in posix_candidates:
            if os.path.isfile(cand) and os.access(cand, os.X_OK):
                return cand

    return None


def is_allowed_host(host_header: str | None, port: int) -> bool:
    if not host_header:
        return False
    normalized = host_header.strip().lower()
    allowed = {
        f"127.0.0.1:{port}",
        f"localhost:{port}",
        f"[::1]:{port}",
        "127.0.0.1",
        "localhost",
        "[::1]",
    }
    return normalized in allowed


def is_allowed_origin(origin_header: str | None) -> bool:
    if origin_header is None:
        return True
    return origin_header.strip().lower().startswith("moz-extension://")


def validate_url(raw_url: Any) -> str | None:
    if not raw_url or not isinstance(raw_url, str):
        return None
    cleaned = raw_url.strip()
    if not cleaned or any(ch in cleaned for ch in ("\r", "\n", "\x00")):
        return None
    try:
        parsed = urllib.parse.urlparse(cleaned)
    except ValueError:
        return None
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        return None
    return parsed.geturl()


def sanitize_title(raw_title: Any, fallback: str) -> str:
    if not isinstance(raw_title, str):
        return fallback
    cleaned = re.sub(r"[\r\n\x00]+", " ", raw_title).strip()
    if not cleaned:
        return fallback
    return cleaned[:300]


active_jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()


def cleanup_old_jobs() -> None:
    """Remove finished jobs older than retention window and enforce cap."""
    now = time.time()
    with jobs_lock:
        expired = [
            jid
            for jid, j in active_jobs.items()
            if j.get("finished_at") is not None
            and now - float(j["finished_at"]) > FINISHED_JOB_RETENTION_SECONDS
        ]
        for jid in expired:
            del active_jobs[jid]

        finished = [
            (jid, float(j["finished_at"]))
            for jid, j in active_jobs.items()
            if j.get("finished_at") is not None
        ]
        if len(finished) > MAX_FINISHED_JOBS:
            finished.sort(key=lambda item: item[1])
            for jid, _ in finished[: len(finished) - MAX_FINISHED_JOBS]:
                active_jobs.pop(jid, None)


def terminate_process_tree(proc: subprocess.Popen[str]) -> None:
    """Terminate a yt-dlp process and its child processes safely."""
    if proc.poll() is not None:
        return
    if platform.system() == "Windows":
        try:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                check=False,
                creationflags=CREATE_NO_WINDOW,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
            return
        except (OSError, subprocess.SubprocessError):
            with contextlib.suppress(OSError):
                proc.terminate()
            return

    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        with contextlib.suppress(OSError):
            proc.terminate()
        return

    def _force_kill_later() -> None:
        time.sleep(2.0)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                with contextlib.suppress(OSError):
                    proc.kill()

    threading.Thread(target=_force_kill_later, daemon=True).start()


def monitor_download(
    job_id: str, proc: subprocess.Popen[str], valid_url: str, should_notify: bool
) -> None:
    pat_prog = re.compile(
        r"\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([^\s]+)"
        r"(?:\s+in\s+[^\s]+)?(?:\s+at\s+([^\s]+(?:\s+[^\s/]+/s)?))?(?:\s+ETA\s+([^\s]+))?"
    )
    pat_indet = re.compile(
        r"\[download\]\s+([\d\.]+\w+)\s+at\s+([^\s]+(?:\s+[^\s/]+/s)?)\s+\(([^\)]+)\)"
    )
    pat_merge = re.compile(
        r"\[(?:Merger|ExtractAudio|VideoRemuxer|VideoConvertor|EmbedSubtitle|Metadata|"
        r"ModifyChapters|ThumbnailsConvertor|Fixup\w+|SponsorBlock)\]"
    )
    pat_dest = re.compile(r"\[download\] Destination:\s*(.+)")
    pat_already = re.compile(r"\[download\]\s+(.+?)\s+has already been downloaded")
    pat_merger_dest = re.compile(r'\[Merger\]\s+Merging formats into\s+"?([^"\n]+)"?')
    pat_extract_dest = re.compile(r"\[ExtractAudio\]\s+Destination:\s*(.+)")
    pat_remux_dest = re.compile(r"\[VideoRemuxer\].*?Destination:\s*(.+)")
    pat_error = re.compile(r"^ERROR:\s*(.+)")

    try:
        if proc.stdout is not None:
            for raw_line in proc.stdout:
                line = raw_line.strip()
                if not line:
                    continue

                with jobs_lock:
                    if job_id not in active_jobs:
                        continue
                    job = active_jobs[job_id]

                    m_err = pat_error.match(line)
                    if m_err:
                        job["error"] = m_err.group(1).strip()[:240]
                        job["updated_at"] = time.time()
                        continue

                    m_prog = pat_prog.search(line)
                    if m_prog:
                        job["percent"] = min(100.0, max(0.0, float(m_prog.group(1))))
                        size_val = m_prog.group(2)
                        if size_val and size_val.upper() not in ("N/A", "UNKNOWN"):
                            job["size"] = size_val
                        if m_prog.group(3):
                            job["speed"] = m_prog.group(3)
                        if m_prog.group(4):
                            job["eta"] = m_prog.group(4)
                        if job.get("status") != "cancelled":
                            job["status"] = "downloading"
                        job["updated_at"] = time.time()
                        continue

                    m_indet = pat_indet.search(line)
                    if m_indet:
                        job["size"] = m_indet.group(1)
                        job["speed"] = m_indet.group(2)
                        job["eta"] = m_indet.group(3)
                        if job.get("status") != "cancelled":
                            job["status"] = "downloading"
                        job["updated_at"] = time.time()
                        continue

                    if pat_merge.search(line):
                        if job.get("status") != "cancelled":
                            job["status"] = "merging"
                            job["percent"] = 100.0
                        job["updated_at"] = time.time()

                    raw_fname: str | None = None
                    for pattern in (
                        pat_dest,
                        pat_already,
                        pat_merger_dest,
                        pat_extract_dest,
                        pat_remux_dest,
                    ):
                        match = pattern.search(line)
                        if match:
                            raw_fname = match.group(1).strip()
                            break

                    if raw_fname:
                        fname = os.path.basename(raw_fname)
                        job["filename"] = fname
                        clean_t = os.path.splitext(fname)[0]
                        clean_t = re.sub(r"\s*\[[a-zA-Z0-9_-]{6,15}\]$", "", clean_t).strip()
                        if clean_t:
                            job["title"] = clean_t
                        job["updated_at"] = time.time()

        proc.wait()
        with jobs_lock:
            if job_id in active_jobs:
                job = active_jobs[job_id]
                if job.get("status") == "cancelled":
                    job["finished_at"] = job.get("finished_at") or time.time()
                elif proc.returncode == 0:
                    job["status"] = "completed"
                    job["percent"] = 100.0
                    job["finished_at"] = time.time()
                    if should_notify:
                        clean_name = job.get("title") or job.get("filename") or valid_url
                        send_notification("yt-dlp", f"Download finished:\n{clean_name}")
                else:
                    job["status"] = "error"
                    if not job.get("error"):
                        job["error"] = f"yt-dlp exited with code {proc.returncode}"
                    job["finished_at"] = time.time()
                    if should_notify:
                        clean_name = job.get("title") or valid_url
                        send_notification(
                            "yt-dlp Error",
                            f"Failed: {clean_name}\n{job['error']}",
                            is_error=True,
                        )
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print(f"[yt-dlp-server] Monitor error for {job_id}: {e}", file=sys.stderr)
        with jobs_lock:
            if job_id in active_jobs:
                active_jobs[job_id]["status"] = "error"
                active_jobs[job_id]["error"] = str(e)[:240]
                active_jobs[job_id]["finished_at"] = time.time()


def open_folder_in_os(folder_path: str) -> tuple[bool, str]:
    target = os.path.abspath(folder_path)
    if not os.path.isdir(target):
        os.makedirs(target, exist_ok=True)
    try:
        system = platform.system()
        if system == "Windows":
            os.startfile(target)  # type: ignore[attr-defined]
        elif system == "Darwin":
            subprocess.Popen(["open", target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            opener = shutil.which("xdg-open")
            if not opener:
                return False, "xdg-open not found"
            subprocess.Popen([opener, target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True, target
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)


class YtDlpHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        # Suppress noisy 200 polling logs from /downloads and /health
        if str(code) == "200" and self.command == "GET" and self.path in ("/downloads", "/health"):
            return
        super().log_request(code, size)

    def log_message(self, format: str, *args: Any) -> None:
        if sys.stderr is not None:
            with contextlib.suppress(OSError, ValueError):
                rendered = format % args
                sys.stderr.write(
                    f"{self.address_string()} - - [{self.log_date_time_string()}] {rendered}\n"
                )

    def _allowed_cors_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin and is_allowed_origin(origin):
            return origin.strip()
        return None

    def _set_headers(self, status: int = 200, length: int | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        cors_origin = self._allowed_cors_origin()
        if cors_origin:
            self.send_header("Access-Control-Allow-Origin", cors_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Connection", "close")
        self.end_headers()

    def _send_json(self, status: int, data: dict[str, Any]) -> None:
        payload = json.dumps(data).encode("utf-8")
        self._set_headers(status, len(payload))
        self.wfile.write(payload)
        self.wfile.flush()

    def _check_security(self) -> bool:
        addr = self.server.server_address
        server_port = int(addr[1]) if isinstance(addr, tuple) and len(addr) >= 2 else PORT
        if not is_allowed_host(self.headers.get("Host"), server_port):
            self._send_json(403, {"error": "Forbidden host header"})
            return False
        if not is_allowed_origin(self.headers.get("Origin")):
            self._send_json(403, {"error": "Forbidden origin"})
            return False
        return True

    def _read_json_body(self) -> tuple[dict[str, Any] | None, int, str]:
        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return None, 415, "Content-Type must be application/json"

        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return None, 411, "Content-Length header required"
        try:
            content_length = int(raw_len)
        except ValueError:
            return None, 400, "Invalid Content-Length header"
        if content_length < 0:
            return None, 400, "Invalid Content-Length header"
        if content_length > MAX_BODY_BYTES:
            return None, 413, "Request payload too large"

        if content_length == 0:
            return {}, 200, ""

        post_data = self.rfile.read(content_length)
        try:
            parsed = json.loads(post_data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, 400, "Malformed JSON payload"
        if not isinstance(parsed, dict):
            return None, 400, "JSON payload must be an object"
        return parsed, 200, ""

    def do_OPTIONS(self) -> None:
        if not self._check_security():
            return
        self._set_headers(200, 0)
        self.wfile.flush()

    def do_GET(self) -> None:
        if not self._check_security():
            return

        if self.path == "/health":
            ytdlp_bin = find_ytdlp()
            self._send_json(
                200,
                {
                    "status": "ok",
                    "service": "yt-dlp-bridge",
                    "version": BRIDGE_VERSION,
                    "platform": sys.platform,
                    "ytdlp_found": ytdlp_bin is not None,
                    "destination": get_configured_destination(),
                },
            )
        elif self.path == "/downloads":
            cleanup_old_jobs()
            now = time.time()
            with jobs_lock:
                downloads_list = [
                    {
                        "id": j["id"],
                        "url": j["url"],
                        "title": j["title"],
                        "mode": j.get("mode", "default"),
                        "percent": j["percent"],
                        "speed": j["speed"],
                        "eta": j["eta"],
                        "size": j["size"],
                        "status": j["status"],
                        "error": j.get("error", ""),
                        "filename": j.get("filename", ""),
                        "created_at": j.get("created_at"),
                        "finished_at": j.get("finished_at"),
                        "elapsed_since_finished": round(now - float(j["finished_at"]), 1)
                        if j.get("finished_at") is not None
                        else None,
                    }
                    for j in active_jobs.values()
                ]
            self._send_json(200, {"downloads": downloads_list})
        else:
            self._send_json(404, {"error": "Endpoint not found"})

    def do_POST(self) -> None:
        if not self._check_security():
            return

        data, status_code, err_msg = self._read_json_body()
        if data is None:
            self._send_json(status_code, {"error": err_msg})
            return

        if self.path == "/download":
            valid_url = validate_url(data.get("url"))
            if not valid_url:
                self._send_json(
                    400,
                    {"error": "Invalid or missing URL. Only HTTP and HTTPS URLs are supported."},
                )
                return

            mode = str(data.get("mode", "default")).strip().lower()
            if mode not in MODE_FLAGS:
                self._send_json(400, {"error": f"Invalid download mode: {mode}"})
                return

            ytdlp_bin = find_ytdlp()
            if not ytdlp_bin:
                self._send_json(
                    503,
                    {"error": "yt-dlp binary not found on this system. Please install yt-dlp."},
                )
                return

            video_title = sanitize_title(data.get("title"), valid_url)
            should_notify = bool(data.get("notify", True))

            _, dest_fs_path = resolve_destination_paths()
            if os.path.isdir(dest_fs_path):
                work_dir = dest_fs_path
            else:
                work_dir = _default_download_dir()
                os.makedirs(work_dir, exist_ok=True)

            job_id = f"dl-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
            cmd = [ytdlp_bin, "--newline", *MODE_FLAGS[mode], "--", valid_url]
            print(f"[yt-dlp-server] Starting ({job_id}, mode={mode}): {valid_url}")

            popen_kwargs: dict[str, Any] = {
                "cwd": work_dir,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.STDOUT,
                "text": True,
                "encoding": "utf-8",
                "errors": "replace",
                "bufsize": 1,
            }
            if platform.system() == "Windows":
                popen_kwargs["creationflags"] = CREATE_NO_WINDOW
            else:
                popen_kwargs["start_new_session"] = True

            try:
                proc = subprocess.Popen(cmd, **popen_kwargs)
            except (OSError, subprocess.SubprocessError) as e:
                self._send_json(500, {"error": f"Failed to launch yt-dlp: {e}"})
                return

            now = time.time()
            with jobs_lock:
                active_jobs[job_id] = {
                    "id": job_id,
                    "url": valid_url,
                    "title": video_title,
                    "mode": mode,
                    "percent": 0.0,
                    "speed": "",
                    "eta": "",
                    "size": "",
                    "status": "starting",
                    "error": "",
                    "filename": "",
                    "proc": proc,
                    "created_at": now,
                    "updated_at": now,
                    "finished_at": None,
                }

            t = threading.Thread(
                target=monitor_download,
                args=(job_id, proc, valid_url, should_notify),
                daemon=True,
            )
            t.start()

            if should_notify:
                send_notification("yt-dlp", f"Starting download: {video_title}")

            self._send_json(
                200,
                {
                    "status": "success",
                    "message": f"Downloading {valid_url}",
                    "job_id": job_id,
                },
            )

        elif self.path == "/cancel":
            raw_job_id = data.get("job_id")
            if not raw_job_id or not isinstance(raw_job_id, str):
                self._send_json(400, {"error": "Missing job_id"})
                return
            cancel_job_id: str = raw_job_id

            proc_to_kill: subprocess.Popen[str] | None = None
            cancelled = False
            with jobs_lock:
                job = active_jobs.get(cancel_job_id)
                if job is not None:
                    proc_to_kill = job.get("proc")
                    if job.get("status") in ("starting", "downloading", "merging"):
                        job["status"] = "cancelled"
                        job["finished_at"] = time.time()
                    cancelled = True

            if proc_to_kill is not None:
                terminate_process_tree(proc_to_kill)

            self._send_json(
                200,
                {"status": "cancelled" if cancelled else "not_found", "job_id": cancel_job_id},
            )

        elif self.path == "/clear":
            target_id = data.get("job_id")
            terminal_statuses = ("completed", "cancelled", "error")
            cleared_count = 0
            with jobs_lock:
                if isinstance(target_id, str) and target_id:
                    job = active_jobs.get(target_id)
                    if job and job.get("status") in terminal_statuses:
                        del active_jobs[target_id]
                        cleared_count = 1
                else:
                    to_del = [
                        jid
                        for jid, j in active_jobs.items()
                        if j.get("status") in terminal_statuses
                    ]
                    for jid in to_del:
                        del active_jobs[jid]
                    cleared_count = len(to_del)

            self._send_json(200, {"status": "cleared", "cleared_count": cleared_count})

        elif self.path == "/open-folder":
            _, dest_fs_path = resolve_destination_paths()
            ok, detail = open_folder_in_os(dest_fs_path)
            if ok:
                self._send_json(200, {"status": "opened", "path": detail})
            else:
                self._send_json(500, {"error": f"Could not open folder: {detail}"})

        else:
            self._send_json(404, {"error": "Endpoint not found"})


class ReusableServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def run() -> None:
    configure_stdio()
    server_address = (HOST, PORT)
    httpd = ReusableServer(server_address, YtDlpHandler)
    print(f"yt-dlp server v{BRIDGE_VERSION} listening on http://{HOST}:{PORT}")
    print(f"Configured destination: {get_configured_destination()}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping yt-dlp server.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    try:
        run()
    except OSError as e:
        log_path = Path(__file__).resolve().parent / "server_error.log"
        with log_path.open("a", encoding="utf-8") as f:
            import traceback

            traceback.print_exc(file=f)
        print(f"Server startup error: {e}", file=sys.stderr)
        sys.exit(1)
