"""Isolated real-page Image Studio loading acceptance (no persistent workspace).

Run this file, then open http://127.0.0.1:8798/static/smart-canvas.html?id=hit-priority-manual.
Read /__image-studio-results for the automatic browser assertions.
Add &hold=1 for a loading-state visual review; &theme=dark uses Dark mode.
"""
import json
import time
from urllib.parse import parse_qs, urlparse

from smart_canvas_manual_server import ManualHandler, MANUAL_BOOTSTRAP, ROOT, ThreadingHTTPServer


class LoadingHandler(ManualHandler):
    results = {"status": "not-run"}

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.endswith('/open'):
            self.send_json({}, 404)
            return
        if parsed.path == '/api/local-generation-submissions':
            self.send_json({'submissions': []})
            return
        if parsed.path == '/static/smart-canvas.html':
            html = (ROOT / 'static/smart-canvas.html').read_text()
            html = html.replace('<head>', '<head>' + MANUAL_BOOTSTRAP, 1)
            html = html.replace('</body>', '<script src="/tests/image_studio_loading_browser_test.js"></script></body>')
            raw = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if parsed.path == '/__image-studio-source.svg':
            query = parse_qs(parsed.query)
            time.sleep(min(60, max(0, float(query.get('delay', ['0'])[0]))))
            if query.get('fail') == ['1']:
                self.send_json({'error': 'Intentional image failure'}, 404)
                return
            raw = b'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#7894a6"/></svg>'
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Closing or switching the preview intentionally cancels loads.
            return
        if parsed.path == '/__image-studio-results':
            self.send_json(type(self).results)
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path == '/__image-studio-results':
            type(self).results = self.read_json()
            print(json.dumps(type(self).results), flush=True)
            self.send_json({'ok': True})
            return
        super().do_POST()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8798), LoadingHandler)
    print('Image Studio acceptance: http://127.0.0.1:8798/static/smart-canvas.html', flush=True)
    server.serve_forever()
