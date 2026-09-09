"""Trace ordinary generation with the real runtime and a synthetic Provider.

Uses a temporary SQLite-backed Turso transport, never the live app or database.
All timed phases drain queued persistence; Provider compute/media download and
the background dispatcher's idle wait are excluded and reported separately.
"""

import argparse
import asyncio
import hashlib
import json
import sqlite3
import sys
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

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
    from tests.test_turso_stores import TursoStoreTests
    from tests.test_turso_sqlite import SqlitePipeline
    from tests.test_canvas_store import ADMIN, sample_canvas
    from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection
    from infinite_canvas.canvas_sync import CanvasSync
    from infinite_canvas.turso_stores import FencedTursoConnection, TursoCanvasStore, TursoGenerationRunStore
    from infinite_canvas.generation_effect_dispatcher import CanvasSyncGenerationEffectTarget
    from infinite_canvas.generation_publication import SqliteGenerationPublication
    from infinite_canvas.generation_sqlite_runtime import GenerationSqliteRuntime
    from infinite_canvas.generation_runs import (
        Background, CanvasGenerationTargetGuard, GenerationOutputPorts,
        GenerationRuns, ImageRun, RunTarget, WorkspaceGenerationEffects,
    )
    from infinite_canvas.providers.core import Completed, Pending
    from infinite_canvas.providers.runtime import ProviderOutput

    fixture = TursoStoreTests()
    fixture.setUp()
    delay_ms = 0
    calls = []
    results = []

    with tempfile.TemporaryDirectory() as temporary, ThreadPoolExecutor(max_workers=1) as canvas_executor:
        database = Path(temporary) / 'synthetic-cloud.sqlite3'
        seed = sqlite3.connect(database)
        fixture.remote.database.backup(seed)
        seed.execute('PRAGMA journal_mode=WAL')
        seed.close()

        def connect():
            # Independent Turso streams share one synthetic database, as they
            # do in production; an in-memory single-stream fake hides races.
            pipeline = SqlitePipeline()
            pipeline.database.close()
            pipeline.database = sqlite3.connect(database, isolation_level=None, check_same_thread=False)
            pipeline.database.execute('PRAGMA foreign_keys=ON')
            fixture.addCleanup(pipeline.database.close)

            def transport(url, payload):
                calls.append(payload)
                time.sleep(delay_ms / 1000)
                return pipeline(url, payload)

            return FencedTursoConnection('https://test.turso.io', 'synthetic-token',
                                        transport=transport, fence=fixture.fence)

        canvases = TursoCanvasStore(connect, workspace_id='workspace')
        store = TursoGenerationRunStore(connect, workspace_id='workspace')
        document = sample_canvas()
        document['nodes'][0]['generationOperationId'] = 'operation-a'
        document['nodes'][0]['running'] = True
        canvases.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='fixture-import'))
        sync = CanvasSync(content=lambda: None, now_ms=lambda: 1000,
                          canvas_store=lambda: canvases, store_executor=canvas_executor)
        runtime = GenerationSqliteRuntime(
            store=store, worker_id='synthetic-worker',
            target=CanvasSyncGenerationEffectTarget(canvas_sync=sync, actor_by_id=lambda _id: ADMIN),
        )

        async def measure(name, operation):
            calls.clear()
            started = time.perf_counter()
            marker = asyncio.get_running_loop().create_future()
            asyncio.get_running_loop().call_later(0.01, lambda: marker.set_result(time.perf_counter()))
            value = await operation()
            elapsed_ms = (time.perf_counter() - started) * 1000
            requests = list(calls)
            lateness = max(0, ((await marker) - started) * 1000 - 10)
            verbs = Counter()
            for payload in requests:
                request = payload['requests'][0]
                sql = request.get('stmt', {}).get('sql', '').strip()
                verbs[sql.split()[0].upper() if sql else request['type']] += 1
            results.append({'operation': name, 'remote_requests': len(requests),
                            'elapsed_ms': round(elapsed_ms, 1), 'request_types': dict(verbs),
                            'server_event_loop_timer_lateness_ms': round(lateness, 1)})
            return value

        async def scenario():
            class Provider:
                def __init__(self):
                    self.started, self.release = asyncio.Event(), asyncio.Event()
                    self.progress = None

                async def execute(self, request, checkpoint=None, progress=None):
                    self.progress = progress
                    checkpoint(Pending('synthetic-remote-task'))
                    self.started.set()
                    await self.release.wait()
                    return Completed(ProviderOutput(
                        raw={'images': ['synthetic-provider-image.png']},
                        legacy=({'type': 'url', 'value': 'synthetic-provider-image.png'}, {}),
                    ))

            async def save_image(value, **options):
                return '/assets/output/synthetic-image.png'

            async def notify(record, **options):
                pass

            provider = Provider()
            runs = GenerationRuns(
                executor=provider, store_path=lambda: None,
                lifecycle_store=runtime.lifecycle_store,
                target_guard=CanvasGenerationTargetGuard(canvas_sync=sync, actor_by_id=lambda _id: ADMIN),
                effects=WorkspaceGenerationEffects(
                    GenerationOutputPorts(save_image=save_image, image_meta=lambda url, _source: {'url': url},
                                          extract_images=lambda raw: list(raw.get('images') or [])),
                    publication=SqliteGenerationPublication(store=store, store_executor=runtime.store_executor,
                                                           notify=notify, worker_id='synthetic-worker'),
                ),
            )
            try:
                async def submit():
                    started = time.perf_counter()
                    snapshot = await runs.start(
                        ImageRun(prompt='Synthetic generation', settings={'provider_id': 'fixture', 'model': 'fixture'},
                                 publication='history'),
                        key='operation-a', owner=ADMIN['id'], delivery=Background(),
                        target=RunTarget(canvas_id=document['id'], node_id='node-a', operation_id='operation-a'),
                    )
                    acceptance_ms = (time.perf_counter() - started) * 1000
                    await asyncio.wait_for(provider.started.wait(), timeout=15)
                    await runs.wait_for_lifecycle_projection()
                    return snapshot, acceptance_ms

                snapshot, acceptance_ms = await measure('submit_and_persist_remote_id', submit)
                results[-1]['submission_response_ms'] = round(acceptance_ms, 1)

                async def poll():
                    current = await runs.query(snapshot.id, owner=ADMIN['id'])
                    if current.status not in {'succeeded', 'failed', 'cancelled', 'discarded'}:
                        current = await runs.resume(snapshot.id, owner=ADMIN['id'], delivery=Background())
                    await runs.wait_for_lifecycle_projection()
                    return current

                await measure('poll_running_generation', poll)

                async def progress():
                    provider.progress({'phase': 'generating', 'progress': 20})
                    await runs.wait_for_lifecycle_projection()

                await measure('persist_new_progress', progress)
                await measure('persist_unchanged_progress', progress)

                async def finish():
                    task = runs._tasks[snapshot.id]
                    provider.release.set()
                    await task
                    await runs.wait_for_lifecycle_projection()

                await measure('complete_and_publish_history', finish)
                delivered = await measure('write_output_to_canvas', runtime.dispatcher.dispatch_once)
                assert delivered.status.value == 'applied', delivered
                final = await runtime.store_executor.call(
                    canvases.read, document['id'], ADMIN, CanvasProjection.public_snapshot())
                assert final.canvas['nodes'][0]['images'][0]['url'] == '/assets/output/synthetic-image.png'
                assert final.canvas['nodes'][0]['running'] is False
                await measure('read_canvas_logs', lambda: runtime.store_executor.call(
                    canvases.read, document['id'], ADMIN, CanvasProjection.log_page()))
                await measure('read_global_history', lambda: runtime.store_executor.call(store.history_page, limit=50))
                await measure('query_completed_generation', lambda: runs.query(snapshot.id, owner=ADMIN['id']))
            finally:
                provider.release.set()
                await runs.wait_for_lifecycle_projection()
                await runtime.close()

        try:
            delay_ms = args.delay_ms
            asyncio.run(scenario())
        finally:
            fixture.doCleanups()

    sources = {}
    for relative in ['main.py', 'infinite_canvas/canvas_store.py', 'infinite_canvas/canvas_sync.py',
                     'infinite_canvas/generation_runs.py', 'infinite_canvas/generation_run_store.py',
                     'infinite_canvas/turso_sqlite.py', 'infinite_canvas/turso_stores.py',
                     'infinite_canvas/generation_run_lifecycle.py', 'infinite_canvas/generation_effect_dispatcher.py',
                     'infinite_canvas/generation_publication.py', 'infinite_canvas/generation_sqlite_runtime.py']:
        sources[f'backend/{relative}'] = hashlib.sha256((source_root / 'backend' / relative).read_bytes()).hexdigest()
    print(json.dumps({'synthetic': True, 'delay_per_request_ms': args.delay_ms,
                      'source_sha256': sources, 'results': results}, indent=2))


if __name__ == '__main__':
    main()
