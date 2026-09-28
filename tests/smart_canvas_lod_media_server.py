#!/usr/bin/env python3
"""Serve the real Smart Canvas LOD regression; no persistent backend is used.

Run: python3 tests/smart_canvas_lod_media_server.py
Open: http://127.0.0.1:8797/static/smart-canvas.html?id=lod-media&manual=1
The page runs assertions automatically and publishes JSON at /__lod-test-results.
"""
import json
import os
import time
from urllib.parse import parse_qs, urlparse
from smart_canvas_manual_server import ManualHandler, MANUAL_BOOTSTRAP, ROOT, ThreadingHTTPServer

FIXTURE = {
    'id': 'lod-media', 'kind': 'smart', 'title': 'LOD media regression',
    'project': 'manual', 'revision': 0, 'connections': [], 'logs': [], 'settings': {},
    'nodes': [dict(
        id=f'lod-{i}', type='smart-image', x=40+(i % 4)*470,
        y=180+(i // 4)*420, w=400, h=300,
        images=[dict(url='/static/images/test/fixture.svg', name='fixture.svg',
                     kind='image', natural_w=1076, natural_h=1448)
                for _ in range(2 if i == 0 else 1)],
    ) for i in range(8)],
}
BOOTSTRAP = MANUAL_BOOTSTRAP.replace(
    '  class ManualWebSocket {',
    f'  Object.assign(manualCanvas, {json.dumps(FIXTURE)});\n  class ManualWebSocket {{',
)


class LodHandler(ManualHandler):
    results = {'status': 'not-run'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def manual_canvas(self, canvas_id):
        return {**FIXTURE, 'id': canvas_id}

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/__lod-test-results':
            self.send_json(type(self).results)
            return
        if path == '/static/smart-canvas.html':
            source = (ROOT / 'static/smart-canvas.html').read_text()
            source = source.replace('<head>', '<head>'+BOOTSTRAP, 1)
            script = ('/tests/smart_canvas_far_frame_resize_browser_test.js'
                      if parse_qs(urlparse(self.path).query).get('test') == ['far-frame-resize']
                      else '/tests/smart_canvas_lod_media_browser_test.js')
            source = source.replace('</body>', f'<script src="{script}"></script></body>')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(source.encode())
            return
        if path == '/api/local-generation-submissions':
            self.send_json({'submissions': []})
            return
        if path.endswith('/open'):
            self.send_json({}, 404)
            return
        if path == '/__lod-slow-image.svg':
            time.sleep(.25)
            payload = (ROOT / 'static/images/test/fixture.svg').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.end_headers()
            self.wfile.write(payload)
            return
        if path == '/api/media-preview':
            query = parse_qs(urlparse(self.path).query)
            size = int(query.get('w', ['512'])[0])
            if size > 512:
                time.sleep(.25)
            if size == 2048:
                self.send_json({'error': 'Intentional preview failure'}, 503)
                return
            payload = (ROOT / 'static/images/test/fixture.svg').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path == '/__lod-test-results':
            type(self).results = self.read_json()
            print(json.dumps(type(self).results), flush=True)
            self.send_json({'ok': True})
            return
        super().do_POST()


if __name__ == '__main__':
    port = int(os.environ.get('SMART_CANVAS_PORT', '8797'))
    server = ThreadingHTTPServer(('127.0.0.1', port), LodHandler)
    print(f'LOD regression: http://127.0.0.1:{port}/static/smart-canvas.html?id=lod-media&manual=1', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
