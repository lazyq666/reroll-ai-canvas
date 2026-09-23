"""Run the real-page continue-editing acceptance fixture without paid providers.

SMART_CANVAS_PORT=8796 python3 tests/continue_editing_manual_server.py
Open /static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer
The acceptance report is rendered on the page.
"""
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse

import smart_canvas_manual_server as manual

manual.MANUAL_BOOTSTRAP = manual.MANUAL_BOOTSTRAP.replace(
    "  const manualCanvas = {",
    "  localStorage.removeItem('infiniteCanvasRealtimePending:v1:issue-47-text-composer');\n  const manualCanvas = {",
)
manual.MANUAL_BOOTSTRAP += '<script defer src="/tests/continue_editing_browser_checks.js"></script>'

class Handler(manual.ManualHandler):
    def do_GET(self):
        if urlparse(self.path).path == '/api/local-generation-submissions':
            self.send_json({'enabled': False})
            return
        super().do_GET()

if __name__ == "__main__":
    server = ThreadingHTTPServer((manual.HOST, manual.PORT), Handler)
    print(f"Continue editing fixture: http://{manual.HOST}:{manual.PORT}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
