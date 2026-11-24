import http.client
import io
import json
import threading
from pathlib import Path

import pytest

from bridge import server


@pytest.fixture(autouse=True)
def reset_state():
    with server.jobs_lock:
        server.active_jobs.clear()
    with server._CONFIG_CACHE_LOCK:
        server._CONFIG_CACHE = None
    yield
    with server.jobs_lock:
        server.active_jobs.clear()


def test_validate_url_and_title():
    assert server.validate_url("https://example.com/watch?v=1") == "https://example.com/watch?v=1"
    assert server.validate_url("http://example.com/vid.mp4") == "http://example.com/vid.mp4"
    assert server.validate_url("blob:https://youtube.com/123") is None
    assert server.validate_url("javascript:alert(1)") is None
    assert server.validate_url("file:///etc/passwd") is None
    assert server.validate_url("https://example.com/a\nb") is None
    assert server.validate_url("") is None
    assert server.sanitize_title("Test\nTitle\x00Here", "fallback") == "Test Title Here"
    assert server.sanitize_title("   ", "fallback") == "fallback"


def test_host_and_origin_validation():
    assert server.is_allowed_host("127.0.0.1:16800", 16800)
    assert server.is_allowed_host("localhost:16800", 16800)
    assert not server.is_allowed_host("evil.example:16800", 16800)
    assert not server.is_allowed_host(None, 16800)

    assert server.is_allowed_origin(None)
    assert server.is_allowed_origin("moz-extension://1234-5678")
    assert not server.is_allowed_origin("https://evil.example")
    assert not server.is_allowed_origin("http://127.0.0.1:8080")


def test_config_destination_parsing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    cfg_dir = tmp_path / ".config" / "yt-dlp"
    cfg_dir.mkdir(parents=True)
    cfg_file = cfg_dir / "config"
    cfg_file.write_text(
        "# comment\n"
        "-P temp:/tmp/yt-temp\n"
        '-P "home:' + str(tmp_path / "Videos Space") + '" -f best\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    display, expanded = server.resolve_destination_paths()
    assert expanded == str(tmp_path / "Videos Space")
    assert display == "~/Videos Space"


def test_find_ytdlp_checks_local_bin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    local_bin = tmp_path / ".local" / "bin"
    local_bin.mkdir(parents=True)
    fake_bin = local_bin / "yt-dlp"
    fake_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    fake_bin.chmod(0o755)

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(server.shutil, "which", lambda _name: None)
    monkeypatch.setattr(server.platform, "system", lambda: "Linux")
    monkeypatch.setattr(server.os.path, "isfile", lambda p: p == str(fake_bin))
    monkeypatch.setattr(server.os, "access", lambda p, m: p == str(fake_bin))

    assert server.find_ytdlp() == str(fake_bin)


def test_monitor_download_parses_progress_postproc_and_error():
    lines = [
        "[download] Destination: /tmp/My Video [abc1234].mp4\n",
        "[download]  42.5% of ~ 100.00MiB at  4.50MiB/s ETA 00:12\n",
        "[download] 100% of 100.00MiB in 00:22 at 4.55MiB/s\n",
        "[VideoRemuxer] Not remuxing video\n",
    ]

    class FakeProc:
        stdout = io.StringIO("".join(lines))
        returncode = 0

        def wait(self):
            return 0

    job_id = "dl-test-1"
    with server.jobs_lock:
        server.active_jobs[job_id] = {
            "id": job_id,
            "url": "https://example.com/v",
            "title": "initial",
            "mode": "default",
            "percent": 0.0,
            "speed": "",
            "eta": "",
            "size": "",
            "status": "starting",
            "error": "",
            "filename": "",
            "proc": None,
            "created_at": 0.0,
            "updated_at": 0.0,
            "finished_at": None,
        }

    server.monitor_download(job_id, FakeProc(), "https://example.com/v", False)  # type: ignore[arg-type]
    job = server.active_jobs[job_id]
    assert job["status"] == "completed"
    assert job["percent"] == 100.0
    assert job["title"] == "My Video"
    assert job["size"] == "100.00MiB"

    class FailProc:
        stdout = io.StringIO("ERROR: Video unavailable\n")
        returncode = 1

        def wait(self):
            return 1

    job_id2 = "dl-test-2"
    with server.jobs_lock:
        server.active_jobs[job_id2] = {
            "id": job_id2,
            "url": "https://example.com/v2",
            "title": "initial",
            "mode": "default",
            "percent": 0.0,
            "speed": "",
            "eta": "",
            "size": "",
            "status": "starting",
            "error": "",
            "filename": "",
            "proc": None,
            "created_at": 0.0,
            "updated_at": 0.0,
            "finished_at": None,
        }

    server.monitor_download(job_id2, FailProc(), "https://example.com/v2", False)  # type: ignore[arg-type]
    assert server.active_jobs[job_id2]["status"] == "error"
    assert server.active_jobs[job_id2]["error"] == "Video unavailable"


def test_http_server_security_and_download_flow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    httpd = server.ReusableServer(("127.0.0.1", 0), server.YtDlpHandler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    monkeypatch.setattr(server, "find_ytdlp", lambda: "/usr/bin/yt-dlp")
    monkeypatch.setattr(server, "resolve_destination_paths", lambda: (str(tmp_path), str(tmp_path)))

    launched_cmds: list[list[str]] = []

    class FakePopen:
        def __init__(self, cmd, **_kwargs):
            launched_cmds.append(cmd)
            self.pid = 99999
            self.stdout = io.StringIO("[download] 100% of 10.00MiB in 00:01 at 10.00MiB/s\n")
            self.returncode = 0

        def poll(self):
            return 0

        def wait(self):
            return 0

    monkeypatch.setattr(server.subprocess, "Popen", FakePopen)

    try:
        # 1. Reject bad Host header
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        conn.request("GET", "/health", headers={"Host": "evil.com"})
        assert conn.getresponse().status == 403
        conn.close()

        # 2. Reject web Origin
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        conn.request("GET", "/downloads", headers={"Origin": "https://evil.example"})
        assert conn.getresponse().status == 403
        conn.close()

        # 3. Reject non-JSON POST (CSRF simple request protection)
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        conn.request(
            "POST",
            "/download",
            body='{"url":"https://example.com/video"}',
            headers={"Content-Type": "text/plain", "Origin": "moz-extension://abc"},
        )
        assert conn.getresponse().status == 415
        conn.close()

        # 4. Valid extension download request uses '--' and mode flags
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        body = json.dumps({"url": "https://example.com/video", "title": "Vid", "mode": "single", "notify": False})
        conn.request(
            "POST",
            "/download",
            body=body,
            headers={"Content-Type": "application/json", "Origin": "moz-extension://abc"},
        )
        resp = conn.getresponse()
        assert resp.status == 200
        payload = json.loads(resp.read().decode("utf-8"))
        assert payload["status"] == "success"
        assert payload["job_id"].startswith("dl-")
        assert launched_cmds == [["/usr/bin/yt-dlp", "--newline", "--no-playlist", "--", "https://example.com/video"]]
        conn.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
