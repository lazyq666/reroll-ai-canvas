"""Serve the read-only demo and an isolated asset-library fixture on loopback."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse, json
ROOT = Path(__file__).resolve().parents[3]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        if self.path.startswith('/api/workspace-assets?'):
            items=[dict(id=f'demo-{i}',name=f'{i+1:02}',url=f'/docs/demos/readme-showcase/assets/art-{i%4}.png',can_manage=False) for i in range(8)]
            body=json.dumps(dict(items=items,folders=[],all_count=len(items),next_cursor='',at_capacity=False)).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        return super().do_GET()
if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8795);args=parser.parse_args()
    print(f'http://127.0.0.1:{args.port}/docs/demos/readme-showcase/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
