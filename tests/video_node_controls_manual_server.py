"""Serve the real canvas with disposable video-player acceptance fixtures."""
from http.server import ThreadingHTTPServer
import smart_canvas_manual_server as manual

manual.MANUAL_BOOTSTRAP += '<script defer src="/tests/video_node_controls_browser_checks.js"></script>'
if __name__ == "__main__":
    server = ThreadingHTTPServer((manual.HOST, manual.PORT), manual.ManualHandler)
    print(f"Video controls fixture: http://{manual.HOST}:{server.server_port}/static/smart-canvas.html?componentReview=nodes&manual=1", flush=True)
    server.serve_forever()
