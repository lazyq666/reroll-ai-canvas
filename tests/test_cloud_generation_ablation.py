"""Budgets across real generation/lifecycle/publication/Canvas composition."""

import asyncio
import copy
import json
import sqlite3
import subprocess
import sys
import threading
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from infinite_canvas.canvas_store import CanvasIntent
from infinite_canvas.canvas_sync import CanvasSync
from infinite_canvas.generation_runs import CanvasGenerationTargetGuard, GenerationRunConflict, GenerationRunError, RunTarget
from infinite_canvas.turso_stores import TursoCanvasStore, TursoGenerationRunStore
from tests import test_generation_run_store as run_fixtures
from tests import test_turso_stores as cloud_fixtures
from tests.test_canvas_store import ADMIN, DESIGNER, sample_canvas

ROOT = Path(__file__).resolve().parents[1]


class CloudGenerationRoundTripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        process = subprocess.run(
            [sys.executable, 'scripts/performance/run_cloud_generation_ablation.py', '--delay-ms', '0'],
            cwd=ROOT, capture_output=True, text=True, timeout=25, check=True,
        )
        report = json.loads(process.stdout)
        cls.operations = {item['operation']: item for item in report['results']}

    def test_polling_an_active_generation_does_not_write_unchanged_state(self):
        result = self.operations['poll_running_generation']
        self.assertLessEqual(result['remote_requests'], 2)
        self.assertNotIn('BEGIN', result['request_types'])

    def test_repeated_identical_provider_progress_does_not_persist(self):
        self.assertEqual(self.operations['persist_unchanged_progress']['remote_requests'], 0)

    def test_generation_checkpoints_batch_related_writes(self):
        self.assertLessEqual(self.operations['submit_and_persist_remote_id']['remote_requests'], 20)
        self.assertLessEqual(self.operations['persist_new_progress']['remote_requests'], 6)

    def test_output_delivery_and_history_do_not_wait_for_each_sql_write(self):
        self.assertLessEqual(self.operations['complete_and_publish_history']['remote_requests'], 50)
        self.assertLessEqual(self.operations['write_output_to_canvas']['remote_requests'], 30)


class CloudGenerationRollbackTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cloud_fixtures.TursoStoreTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.store = TursoGenerationRunStore(self.fixture.connect, workspace_id='workspace')
        self.run = run_fixtures.SqliteGenerationRunStoreContractTests().sample_run()
        self.store.save(self.run)

    def test_partial_run_write_cannot_replace_saved_recovery_details(self):
        execute = self.fixture.remote.execute

        def fail_output(statement):
            if 'INSERT INTO generation_run_outputs' in statement['sql']:
                error = sqlite3.IntegrityError('Synthetic output constraint')
                error.sqlite_errorname = 'SQLITE_CONSTRAINT_CHECK'
                raise error
            return execute(statement)

        changed = replace(self.run, status='succeeded', request={'prompt': 'changed'},
                          attempts=(), remote_refs=(('provider-b', 'other-task'),))
        with patch.object(self.fixture.remote, 'execute', side_effect=fail_output):
            with self.assertRaises(sqlite3.IntegrityError):
                self.store.save(changed)
        self.assertEqual(self.store.load(self.run.run_id), self.run)
        self.store.save(changed)
        self.assertEqual(self.store.load(self.run.run_id), changed)

    def test_target_read_is_small_and_still_rejects_replacement_deletion_and_private_access(self):
        canvases = TursoCanvasStore(self.fixture.connect, workspace_id='workspace')
        document = sample_canvas()
        document['nodes'][0]['generationOperationId'] = 'operation-a'
        document['nodes'][1]['prompt'] = 'Unrelated node content' * 10000
        canvases.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='target-fixture'))
        sync = CanvasSync(content=lambda: None, now_ms=lambda: 1000, canvas_store=lambda: canvases)
        target = RunTarget(canvas_id=document['id'], node_id='node-a', operation_id='operation-a')
        guard = CanvasGenerationTargetGuard(canvas_sync=sync, actor_by_id=lambda _owner: DESIGNER)
        self.fixture.remote.calls.clear()
        guard.validate(DESIGNER['id'], target)
        self.assertEqual(len(self.fixture.remote.calls), 1)
        result = sync.read(document['id'], DESIGNER, generation_node_id='node-a')
        self.assertEqual(result['nodes'], [document['nodes'][0]])
        self.assertNotIn('connections', result)
        self.fixture.remote.database.execute("UPDATE canvases SET visibility='private'")
        with self.assertRaises(GenerationRunError):
            guard.validate(DESIGNER['id'], target)
        self.fixture.remote.database.execute("UPDATE canvases SET visibility='shared'")
        self.fixture.remote.database.execute("""UPDATE canvas_nodes
            SET payload_json=json_set(payload_json, '$.generationOperationId', 'replacement')
            WHERE node_id='node-a'""")
        with self.assertRaises(GenerationRunConflict):
            guard.validate(DESIGNER['id'], target)
        self.fixture.remote.database.execute("DELETE FROM canvas_nodes WHERE node_id='node-a'")
        with self.assertRaises(GenerationRunConflict):
            guard.validate(DESIGNER['id'], target)


class CloudGenerationEventLoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_late_negative_target_check_cannot_discard_a_newer_completed_run(self):
        from infinite_canvas.generation_runs import Background, GenerationRuns, ImageRun
        from tests import test_generation_runs as generation_fixtures

        provider = generation_fixtures.FakeGenerationAdapter()
        provider.release = asyncio.Event()
        entered, release = threading.Event(), threading.Event()
        guard = generation_fixtures.FakeTargetGuard()

        def stale_check(owner, target):
            entered.set()
            release.wait(timeout=2)
            return False

        guard.is_current = stale_check
        runs = GenerationRuns(executor=provider, effects=generation_fixtures.FakeGenerationEffects(), target_guard=guard)
        snapshot = await runs.start(
            ImageRun(prompt='Synthetic completion race', settings={}), owner=ADMIN['id'], delivery=Background(),
            target=RunTarget(canvas_id='canvas-1', node_id='node-a', operation_id='operation-a'),
        )
        task = runs._tasks[snapshot.id]
        query = asyncio.create_task(runs.query(snapshot.id, owner=ADMIN['id']))
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 1))
            provider.release.set()
            completed = await asyncio.wait_for(asyncio.shield(task), timeout=1)
            self.assertEqual(completed.status, 'succeeded')
            release.set()
            observed = await query
            self.assertEqual(observed.status, 'succeeded')
            self.assertEqual(observed.result, {'images': ['generated.png']})
        finally:
            release.set()
            provider.release.set()
            await asyncio.gather(query, task, return_exceptions=True)

    async def test_slow_target_check_does_not_block_submit_poll_or_completion(self):
        from infinite_canvas.generation_runs import (
            Background, CanvasGenerationTargetGuard, GenerationRuns,
            ImageRun, PreparedGenerationOutput, RunTarget,
        )
        from infinite_canvas.providers.core import Completed
        from infinite_canvas.providers.runtime import ProviderOutput

        document = sample_canvas()
        document['nodes'][0]['generationOperationId'] = 'guard-operation'
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()

        def slow_read(*args, **kwargs):
            entered.set()
            release.wait(timeout=1)
            finished.set()
            return copy.deepcopy(document)

        async def persist(*args, **kwargs):
            pass

        class Provider:
            def __init__(self):
                self.started, self.release = asyncio.Event(), asyncio.Event()

            async def execute(self, request):
                self.started.set()
                await self.release.wait()
                return Completed(ProviderOutput(raw={}, legacy={'images': []}))

        class Effects:
            async def prepare(self, run_id, request, output):
                return PreparedGenerationOutput(result={'images': []}, canvas={'images': []})

            async def publish_prepared(self, run_id, request, prepared):
                return prepared.result

        provider = Provider()
        runs = GenerationRuns(
            executor=provider, effects=Effects(), lifecycle_store=SimpleNamespace(persist=persist),
            target_guard=CanvasGenerationTargetGuard(
                canvas_sync=SimpleNamespace(read=slow_read), actor_by_id=lambda _owner: ADMIN),
        )

        async def measure_progress(operation):
            entered.clear()
            release.clear()
            finished.clear()

            async def observe():
                while not entered.is_set():
                    await asyncio.sleep(0.001)
                progressed = not finished.is_set()
                release.set()
                return progressed

            observer = asyncio.create_task(observe())
            try:
                result = await operation()
                return result, await asyncio.wait_for(observer, timeout=2)
            finally:
                release.set()
                if not observer.done():
                    observer.cancel()
                    await asyncio.gather(observer, return_exceptions=True)

        try:
            snapshot, progressed = await measure_progress(lambda: runs.start(
                ImageRun(prompt='Synthetic event-loop test', settings={'provider_id': 'fixture'}),
                owner=ADMIN['id'], delivery=Background(),
                target=RunTarget(canvas_id=document['id'], node_id='node-a', operation_id='guard-operation'),
            ))
            with self.subTest(phase='submit'):
                self.assertTrue(progressed, 'Target validation blocked the event loop during submission')
            await provider.started.wait()
            _, progressed = await measure_progress(lambda: runs.query(snapshot.id, owner=ADMIN['id']))
            with self.subTest(phase='poll'):
                self.assertTrue(progressed, 'Target validation blocked the event loop during polling')

            async def finish():
                task = runs._tasks[snapshot.id]
                provider.release.set()
                return await task

            _, progressed = await measure_progress(finish)
            with self.subTest(phase='completion'):
                self.assertTrue(progressed, 'Target validation blocked the event loop during completion')
        finally:
            release.set()
            provider.release.set()
            await runs.wait_for_lifecycle_projection()


if __name__ == '__main__':
    unittest.main()
