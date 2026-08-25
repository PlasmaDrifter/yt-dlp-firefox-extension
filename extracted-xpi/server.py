#!/usr/bin/env python3
import http.server
import json
import os
import subprocess

PORT = 16800
DOWNLOAD_DIR = os.path.expanduser("~/Downloads")

class YtDlpHandler(http.server.BaseHTTPRequestHandler):
    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_POST(self):
        if self.path != "/download":
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode("utf-8"))
            return

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            data = json.loads(post_data.decode("utf-8"))
            url = data.get("url")

            if not url:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "No URL provided"}).encode("utf-8"))
                return

            print(f"[yt-dlp-server] Triggering download for: {url}")
            os.makedirs(DOWNLOAD_DIR, exist_ok=True)

            # Spawn yt-dlp in background
            subprocess.Popen(["yt-dlp", "-P", DOWNLOAD_DIR, url])

            self._set_headers(200)
            response = {"status": "success", "message": f"Downloading {url}"}
            self.wfile.write(json.dumps(response).encode("utf-8"))

        except Exception as e:
            print(f"[yt-dlp-server] Error: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

def run():
    server_address = ("127.0.0.1", PORT)
    httpd = http.server.HTTPServer(server_address, YtDlpHandler)
    print(f"yt-dlp server listening on http://127.0.0.1:{PORT}")
    print(f"Videos will be saved to: {DOWNLOAD_DIR}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping yt-dlp server.")

if __name__ == "__main__":
    run()
