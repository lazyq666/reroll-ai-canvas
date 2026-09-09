"""Measure real store/route code against synthetic SQLite with injected RTT.

No live app, Workspace, credentials, Provider, or network is used. An optional
source root can supply archived backend modules for the before measurement.
"""

import argparse
import ast
import asyncio
import hashlib
import inspect
import json
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--delay-ms', type=float, default=100)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    args = parser.parse_args()
    if args.delay_ms < 0:
        parser.error('--delay-ms must be nonnegative')
    source_root = args.source_root.resolve()
    sys.path[:0] = [str(ROOT), str(ROOT / 'backend')]
    import infinite_canvas
    infinite_canvas.__path__.insert(0, str(source_root / 'backend/infinite_canvas'))

    from starlette.concurrency import run_in_threadpool
    from tests.test_turso_stores import TursoStoreTests
    from tests.test_canvas_store import ADMIN, sample_canvas
    from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection
    from infinite_canvas.canvas_sync import CanvasSync, CanvasSyncError
    from infinite_canvas.turso_stores import (
        FencedTursoConnection, TursoCanvasStore, TursoGenerationRunStore,
    )

    fixture = TursoStoreTests()
    fixture.setUp()
    # One operation at a time; sync HTTP handlers run on a worker thread.
    remote_db = sqlite3.connect(':memory:', isolation_level=None, check_same_thread=False)
    fixture.remote.database.backup(remote_db)
    remote_db.execute('PRAGMA foreign_keys=ON')
    fixture.addCleanup(remote_db.close)
    fixture.remote.database = remote_db
    delay_ms = 0
    results = []

    def transport(url, payload):
        time.sleep(delay_ms / 1000)
        return fixture.remote(url, payload)

    def connect():
        return FencedTursoConnection('https://test.turso.io', 'synthetic-token',
                                    transport=transport, fence=fixture.fence)

    def record(name, started, **extra):
        request_types = Counter()
        for _, payload in fixture.remote.calls:
            for request in payload['requests']:
                sql = request.get('stmt', {}).get('sql', '').strip()
                request_types[sql.split()[0].upper() if sql else request['type']] += 1
        results.append({
            'operation': name, 'remote_requests': len(fixture.remote.calls),
            'elapsed_ms': round((time.perf_counter() - started) * 1000, 1),
            'request_types': dict(request_types), **extra,
        })

    def measure(name, operation):
        fixture.remote.calls.clear()
        started = time.perf_counter()
        result = operation()
        record(name, started)
        return result

    try:
        store = TursoCanvasStore(connect, workspace_id='workspace')
        document = sample_canvas()
        document['nodes'] = [
            {'id': f'node-{i}', 'type': 'smart-prompt', 'x': i * 400, 'y': 0, 'prompt': 'fixture'}
            for i in range(25)
        ]
        document['connections'] = []
        document['revision'] = 0
        store.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='probe-import'))
        run_store = TursoGenerationRunStore(connect, workspace_id='workspace')
        delay_ms = args.delay_ms
        measure('read_canvas', lambda: store.read(document['id'], ADMIN, CanvasProjection.public_snapshot()))
        measure('list_canvases', lambda: store.list_items(ADMIN))
        for revision, (name, count, path, value) in enumerate([
            ('move_one_node', 1, 'x', 42),
            ('move_25_nodes', 25, 'x', 84),
            ('edit_prompt', 1, 'prompt', 'updated fixture'),
        ]):
            result = measure(name, lambda: store.commit(document['id'], ADMIN, CanvasIntent.canvas_mutation({
                'operation_id': name, 'base_revision': revision,
                'changes': {'node_updates': [
                    {'id': f'node-{i}', 'path': [path], 'value': i * 400 + value if path == 'x' else value}
                    for i in range(count)
                ]},
            })))
            assert result.changed and result.revision == revision + 1

        # Compile the endpoint bodies without importing main's live runtime.
        route_names = {'require_smart_canvas_view_access', 'get_smart_canvas_view_state',
                       'update_smart_canvas_view_state'}
        module = ast.parse((source_root / 'backend/main.py').read_text())
        definitions = [item for item in module.body
                       if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name in route_names]
        assert len(definitions) == len(route_names)
        for item in definitions:
            item.decorator_list = []
        route_globals = {
            'Dict': Dict, 'Any': Any, 'CanvasSyncError': CanvasSyncError,
            'SmartCanvasViewStateUpdate': SimpleNamespace,
            'require_current_user': lambda *roles: ADMIN,
            'normalize_canvas_kind': lambda kind: kind,
            'current_workspace_id': lambda: 'workspace',
            'AUTH_SYSTEM': SimpleNamespace(get_canvas_view_state=lambda *a: {},
                                           save_canvas_view_state=lambda *a, **kw: kw),
            'CANVAS_SYNC': CanvasSync(content=lambda: None, now_ms=lambda: 1, canvas_store=lambda: store),
        }
        exec(compile(ast.Module(body=definitions, type_ignores=[]), 'backend/main.py', 'exec'), route_globals)

        async def measure_route(name, handler, *parameters):
            fixture.remote.calls.clear()
            loop = asyncio.get_running_loop()
            started = time.perf_counter()
            marker = loop.create_future()
            loop.call_later(0.01, lambda: marker.set_result(time.perf_counter()))
            if inspect.iscoroutinefunction(handler):
                await handler(*parameters)
            else:
                await run_in_threadpool(handler, *parameters)
            record(name, started)
            lateness = max(0, ((await marker) - started) * 1000 - 10)
            results[-1]['server_event_loop_timer_lateness_ms'] = round(lateness, 1)

        async def routes():
            await measure_route('restore_viewport', route_globals['get_smart_canvas_view_state'], document['id'])
            await measure_route('save_viewport', route_globals['update_smart_canvas_view_state'], document['id'],
                                SimpleNamespace(center_x=0, center_y=0, scale=1))

        asyncio.run(routes())
        assert measure('empty_generation_effect_poll',
                       lambda: run_store.claim_effect('probe-worker', lease_seconds=30)) is None
        delay_ms = 0
        final = store.read(document['id'], ADMIN, CanvasProjection.public_snapshot()).canvas
        assert final['revision'] == 3
        assert [node['x'] for node in final['nodes']] == [i * 400 + 84 for i in range(25)]
        assert final['nodes'][0]['prompt'] == 'updated fixture'
        sources = {}
        for relative in ['main.py', 'infinite_canvas/canvas_store.py', 'infinite_canvas/canvas_sync.py',
                         'infinite_canvas/turso_sqlite.py', 'infinite_canvas/turso_stores.py',
                         'infinite_canvas/generation_run_store.py']:
            source = source_root / 'backend' / relative
            sources[f'backend/{relative}'] = hashlib.sha256(source.read_bytes()).hexdigest()
        print(json.dumps({'synthetic': True, 'nodes': 25, 'delay_per_request_ms': args.delay_ms,
                          'source_sha256': sources, 'results': results}, indent=2))
    finally:
        fixture.doCleanups()


if __name__ == '__main__':
    main()
