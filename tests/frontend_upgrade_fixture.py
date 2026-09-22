"""Isolated old/new HTTP releases with real static caching and Canvas mutations.

Only model task results and account/config APIs are fixtures. Browser requests,
WebSockets, production generation settlement and mutation rules remain real.
"""
from __future__ import annotations

import contextlib
import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'scripts')]

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
import uvicorn

from infinite_canvas.frontend_assets import FrontendStaticFiles
from infinite_canvas.canvas_realtime import apply_operation, enable_realtime, public_snapshot
from sync_frontend_assets import AssetGraph


def build_release(destination, *, old):
    shutil.copytree(ROOT / 'static', destination / 'static')
    (destination / 'scripts').mkdir()
    shutil.copy(ROOT / 'scripts/frontend-assets-policy.json', destination / 'scripts')
    policy_path = destination / 'scripts/frontend-assets-policy.json'
    policy = json.loads(policy_path.read_text())
    policy['embedded_sources'] = []
    policy_path.write_text(json.dumps(policy))
    if old:
        module = destination / 'static/js/smart-canvas/generation-output.js'
        source = module.read_text()
        needle = '? generationOutputDefaultName(source, url, itemKind, ordinal)'
        assert source.count(needle) == 1
        module.write_text(source.replace(needle, '? source.name || generationOutputDefaultName(source, url, itemKind, ordinal)'))
    # Exercise module, lazy import, Worker and CSS dependency loading in the
    # same real page. Only the leaves vary across releases.
    probe = destination / 'static/upgrade-probe'
    probe.mkdir()
    value = 'old' if old else 'new'
    (probe / 'leaf.js').write_text(f"export const value = '{value}';")
    (probe / 'worker.js').write_text("import {value} from './leaf.js'; postMessage(value);")
    (probe / 'entry.js').write_text("""import {value} from './leaf.js';
window.upgradeProbe = {direct:value};
import('./leaf.js').then(m => window.upgradeProbe.lazy = m.value);
new Worker(new URL('./worker.js', import.meta.url), {type:'module'}).onmessage = e => window.upgradeProbe.worker = e.data;
""")
    (probe / 'leaf.css').write_text(f':root {{ --upgrade-probe: {value}; }}')
    (probe / 'entry.css').write_text("@import url('./leaf.css');")
    page = destination / 'static/smart-canvas.html'
    page.write_text(page.read_text().replace('</head>', '<script type="module" src="/static/upgrade-probe/entry.js"></script><link rel="stylesheet" href="/static/upgrade-probe/entry.css"></head>'))
    with contextlib.redirect_stdout(sys.stderr):
        assert AssetGraph(destination).run() == 0
        assert AssetGraph(destination).run(check=True) == 0


def create_fixture(directory):
    old, new = directory / 'old', directory / 'new'
    build_release(old, old=True)
    build_release(new, old=False)
    static = FrontendStaticFiles(directory=old / 'static')
    state = {'phase': 'old', 'broken': False, 'canvas': None, 'mutations': [], 'tasks': [], 'requests': []}
    sockets = set()
    disk = directory / 'canvas.json'
    app = FastAPI()

    def persist():
        disk.write_text(json.dumps(state['canvas']))

    def reset():
        state.update(phase='old', broken=False, mutations=[], tasks=[], requests=[])
        state['canvas'] = {
            'id': 'upgrade-fixture', 'title': 'Cache upgrade fixture', 'type': 'smart', 'project': 'default',
            'nodes': [{'id': 'target', 'type': 'smart-image', 'title': 'Fixture', 'x': 200, 'y': 100,
                       'w': 260, 'h': 220, 'images': [], 'referenceGenerationKind': 'image'}],
            'connections': [], 'settings': {}, 'logs': [],
        }
        enable_realtime(state['canvas'])
        static.all_directories = [str(old / 'static')]
        persist()

    reset()

    @app.middleware('http')
    async def record(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/static/'):
            state['requests'].append({'url': str(request.url), 'phase': state['phase'], 'status': response.status_code})
        return response

    @app.post('/fixture/reset')
    async def reset_route():
        reset()
        return {'ok': True}

    @app.post('/fixture/upgrade')
    async def upgrade(request: Request):
        state.update(phase='new', broken=(await request.json()).get('broken', False))
        static.all_directories = [str(new / 'static')]
        return {'ok': True}

    @app.get('/fixture/state')
    async def get_state():
        return {**state, 'persisted': public_snapshot(json.loads(disk.read_text()))}

    @app.get('/static/smart-canvas.html')
    async def page():
        release = old if state['phase'] == 'old' or state['broken'] else new
        return FileResponse(release / 'static/smart-canvas.html', headers={'Cache-Control': 'no-cache'})

    @app.get('/fixture/provider-result.png')
    async def image():
        import base64
        return Response(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+byzvAAAAAElFTkSuQmCC'), media_type='image/png')

    @app.websocket('/ws/canvases/{canvas_id}')
    async def canvas_socket(socket: WebSocket, canvas_id: str):
        await socket.accept()
        sockets.add(socket)
        await socket.send_json({'type': 'canvas_snapshot', 'canvas_id': canvas_id,
                                'revision': public_snapshot(state['canvas'])['revision'],
                                'canvas': public_snapshot(state['canvas'])})
        try:
            while True:
                message = await socket.receive_json()
                if message['type'] == 'ping':
                    await socket.send_json({'type': 'pong', 'revision': public_snapshot(state['canvas'])['revision']})
                elif message['type'] == 'canvas_mutation':
                    result = apply_operation(state['canvas'], message['operation'], actor_id='fixture-admin')
                    state['mutations'].append(copy.deepcopy(message['operation']))
                    persist()
                    event = {**result.message(), 'canvas_id': canvas_id}
                    for client in list(sockets):
                        with contextlib.suppress(Exception):
                            await client.send_json(event)
        except WebSocketDisconnect:
            pass
        finally:
            sockets.discard(socket)

    @app.api_route('/api/{path:path}', methods=['GET', 'POST', 'PATCH'])
    async def api(path: str, request: Request):
        if path == 'canvases/upgrade-fixture':
            return {'canvas': public_snapshot(json.loads(disk.read_text()))}
        if path == 'auth/me':
            return {'user': {'id': 'fixture-admin', 'username': 'fixture', 'role': 'admin'}}
        if path.startswith('canvas-image-tasks/'):
            state['tasks'].append(path)
            return {'id': path.split('/')[-1], 'status': 'succeeded', 'actor_id': 'fixture-admin',
                    'created_at': 1, 'updated_at': 2, 'result': {'image_items': [
                        {'url': '/fixture/provider-result.png', 'name': 'provider-opaque-very-long-file-name.png', 'kind': 'image', 'width': 1, 'height': 1}]}}
        if path == 'config':
            return {'api_providers': [], 'available_models': {'image': []}, 'comfy_instances': []}
        if path == 'workflows':
            return {'workflows': []}
        if path == 'prompt-libraries':
            return {'library': {'libraries': []}}
        if path == 'smart-canvas/prompt-templates':
            return {'templates': []}
        if path.endswith('/view-state'):
            return {'view_state': None}
        return {}

    app.mount('/static', static)
    return app


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='frontend-upgrade-') as tmp:
        app = create_fixture(Path(tmp))
        uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[1]), log_level='warning')
