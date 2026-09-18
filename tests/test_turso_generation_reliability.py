"""Fault injection at the shared Run/Store and batch submission boundaries."""
import asyncio
import tempfile
import subprocess
import unittest
from pathlib import Path

from infinite_canvas.batch_generation import BatchGeneration
from infinite_canvas.canvas_sync import CanvasSyncError
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore, EffectResolution
from infinite_canvas.generation_runs import CanvasGenerationTargetGuard, GenerationRuns, ImageRun, RunTarget
from infinite_canvas.turso_sqlite import TursoError
from tests.test_batch_generation import PendingGenerationRuns
from tests import test_generation_run_lifecycle as fixtures


class InlineStoreExecutor:
    async def call(self, fn, *args, **kwargs):
        return fn(*args, **kwargs)


class TursoGenerationReliabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_terminal_save_recovers_before_and_after_unknown_commit(self):
        for committed in (False, True):
            with self.subTest(committed=committed), tempfile.TemporaryDirectory() as temp:
                class FaultStore(SqliteGenerationRunStore):
                    attempts = 0
                    def save(self, run, *, effect=None):
                        if effect is not None:
                            self.attempts += 1
                            if self.attempts == 1:
                                if committed:
                                    super().save(run, effect=effect)
                                raise TursoError('cloud_storage_outcome_unknown')
                        super().save(run, effect=effect)
                store = FaultStore(Path(temp)/'runs.sqlite3', workspace_id='workspace')
                lifecycle = AsyncGenerationRunLifecycleStore(store=store, store_executor=InlineStoreExecutor())
                runs = GenerationRuns(executor=fixtures.GenerationRunsLifecycleProjectionTests.CompletedExecutor(), effects=fixtures.GenerationRunsLifecycleProjectionTests.PreparedEffects(),
                    lifecycle_store=lifecycle, target_guard=fixtures.GenerationRunsLifecycleProjectionTests.CurrentTargetGuard())
                result = await runs.start(ImageRun(prompt='test', settings={}), owner='owner',
                    target=RunTarget(canvas_id='canvas', node_id='node', operation_id='operation'))
                await asyncio.wait_for(runs.wait_for_lifecycle_projection(), 5)
                self.assertEqual(store.load(result.id).phase, 'finished')
                claim = store.claim_effect('worker', lease_seconds=30)
                self.assertIsNotNone(claim)
                store.settle_effect(claim, EffectResolution.APPLIED)
                self.assertIsNone(store.claim_effect('worker', lease_seconds=30))
                self.assertEqual(store.attempts, 1 if committed else 2)
                # A recovered failure must not poison the next submission's receipt.
                await runs.start(ImageRun(prompt='next', settings={}), owner='owner')
                await runs.wait_for_lifecycle_projection()

    async def test_target_read_failure_is_not_stale_target(self):
        class Canvas:
            failure = None
            def read(self, *args, **kwargs):
                if self.failure: raise self.failure
                return {'kind':'smart', 'nodes':[{'id':'node','generationOperationId':'operation'}]}
        canvas = Canvas()
        guard = CanvasGenerationTargetGuard(canvas_sync=canvas, actor_by_id=lambda _: {'id':'owner'})
        target = RunTarget(canvas_id='canvas', node_id='node', operation_id='operation')
        self.assertTrue(guard.is_current('owner', target))
        for error in (TursoError('cloud_storage_unavailable'), CanvasSyncError(503, 'temporary')):
            canvas.failure = error
            with self.assertRaises(Exception):
                guard.is_current('owner', target)
        canvas.failure = CanvasSyncError(404, 'deleted')
        self.assertFalse(guard.is_current('owner', target))
        canvas.failure = CanvasSyncError(403, 'revoked')
        self.assertFalse(guard.is_current('owner', target))

    async def test_batch_association_failure_keeps_submitted_run(self):
        with tempfile.TemporaryDirectory() as temp:
            runs = PendingGenerationRuns()
            batch = BatchGeneration(Path(temp)/'batch.sqlite3', submit=runs.submit, inspect_run=runs.inspect)
            original = batch._finish_task
            failures = 0
            def finish(*args, **kwargs):
                nonlocal failures
                if kwargs.get('run_id') and failures == 0:
                    failures += 1
                    raise TursoError('cloud_storage_unavailable')
                return original(*args, **kwargs)
            batch._finish_task = finish
            created = await batch.start({'prompt_modules':[{'name':'subject','options':['test']}],
                'models':[{'provider_id':'test','model':'test','name':'test'}], 'ratios':['1:1'],
                'settings':{'outputs_per_run':1}}, owner='owner')
            try:
                await batch._dispatch_available()
            except TursoError:
                pass
            await batch._dispatch_available()
            task = batch.get(created['id'], owner='owner')['tasks'][0]
            self.assertEqual(task['status'], 'running')
            self.assertEqual(task['run_id'], 'pending-1')
            self.assertEqual(len(runs.submissions), 1)

    async def test_completed_run_is_deduplicated_after_restart(self):
        with tempfile.TemporaryDirectory() as temp:
            store = SqliteGenerationRunStore(Path(temp)/'runs.sqlite3', workspace_id='workspace')
            lifecycle = AsyncGenerationRunLifecycleStore(store=store, store_executor=InlineStoreExecutor())
            class Executor(fixtures.GenerationRunsLifecycleProjectionTests.CompletedExecutor):
                calls = 0
                async def execute(self, request):
                    self.calls += 1
                    return await super().execute(request)
            executor = Executor()
            def instance():
                return GenerationRuns(executor=executor, effects=fixtures.GenerationRunsLifecycleProjectionTests.PreparedEffects(), lifecycle_store=lifecycle)
            runs = instance()
            first = await runs.start(ImageRun(prompt='test', settings={}), owner='owner', key='batch:0')
            await runs.wait_for_lifecycle_projection()
            restarted = instance()
            await restarted.restore_lifecycle_authority()
            second = await restarted.start(ImageRun(prompt='test', settings={}), owner='owner', key='batch:0')
            self.assertEqual(second.id, first.id)
            self.assertTrue(second.deduplicated)
            self.assertEqual(executor.calls, 1)

    async def test_provider_waits_for_durable_identity(self):
        entered, release = asyncio.Event(), asyncio.Event()
        class Lifecycle(fixtures.GenerationRunsLifecycleProjectionTests.RecordingLifecycle):
            async def persist(self, value, *, effect=None):
                entered.set()
                await release.wait()
                await super().persist(value, effect=effect)
        class Executor(fixtures.GenerationRunsLifecycleProjectionTests.CompletedExecutor):
            calls = 0
            async def execute(self, request):
                self.calls += 1
                return await super().execute(request)
        executor = Executor()
        runs = GenerationRuns(executor=executor, effects=fixtures.GenerationRunsLifecycleProjectionTests.PreparedEffects(), lifecycle_store=Lifecycle())
        task = asyncio.create_task(runs.start(ImageRun(prompt='test', settings={})))
        await entered.wait()
        self.assertEqual(executor.calls, 0)
        release.set()
        await task
        await runs.wait_for_lifecycle_projection()
        self.assertEqual(executor.calls, 1)

    async def test_unavailable_target_can_resume_prepared_result_without_provider(self):
        class Canvas:
            reads = 0
            def read(self, *args, **kwargs):
                self.reads += 1
                if self.reads == 2: raise TursoError('cloud_storage_unavailable')
                return {'kind':'smart', 'nodes':[{'id':'node','generationOperationId':'operation'}]}
        class Executor(fixtures.GenerationRunsLifecycleProjectionTests.CompletedExecutor):
            calls = 0
            async def execute(self, request):
                self.calls += 1
                return await super().execute(request)
        executor = Executor()
        lifecycle = fixtures.GenerationRunsLifecycleProjectionTests.RecordingLifecycle()
        guard = CanvasGenerationTargetGuard(canvas_sync=Canvas(), actor_by_id=lambda _: {'id':'owner'})
        runs = GenerationRuns(executor=executor, effects=fixtures.GenerationRunsLifecycleProjectionTests.PreparedEffects(), lifecycle_store=lifecycle, target_guard=guard)
        with self.assertRaises(TursoError):
            await runs.start(ImageRun(prompt='test', settings={}), owner='owner',
                target=RunTarget(canvas_id='canvas', node_id='node', operation_id='operation'))
        await runs.wait_for_lifecycle_projection()
        run_id = lifecycle.records[0][0]['id']
        self.assertEqual(runs.get(run_id, owner='owner').status, 'running')
        second = await runs.resume(run_id, owner='owner')
        await runs.wait_for_lifecycle_projection()
        self.assertEqual(second.status, 'succeeded')
        self.assertEqual(executor.calls, 1)

    async def test_close_interrupts_transient_save_retry(self):
        entered = asyncio.Event()
        class Store:
            def save(self, *args, **kwargs):
                entered.set()
                raise TursoError('cloud_storage_reconnecting')
            def persistence_confirmed(self, *args, **kwargs):
                raise TursoError('cloud_storage_reconnecting')
        lifecycle = AsyncGenerationRunLifecycleStore(store=Store(), store_executor=InlineStoreExecutor())
        task = asyncio.create_task(lifecycle.persist({'id':'run','kind':'image'}))
        await entered.wait()
        await asyncio.wait_for(lifecycle.close(), 1)
        self.assertTrue(task.cancelled())

    async def test_uncertain_terminal_commit_can_already_be_delivered(self):
        with tempfile.TemporaryDirectory() as temp:
            class Store(SqliteGenerationRunStore):
                terminal_saves = 0
                def save(self, state, *, effect=None):
                    super().save(state, effect=effect)
                    if effect:
                        self.terminal_saves += 1
                        claim = self.claim_effect("worker", lease_seconds=30)
                        self.settle_effect(claim, EffectResolution.APPLIED)
                        raise TursoError("cloud_storage_outcome_unknown")
            store = Store(Path(temp)/"runs.sqlite3", workspace_id="workspace")
            lifecycle = AsyncGenerationRunLifecycleStore(store=store, store_executor=InlineStoreExecutor())
            runs = GenerationRuns(executor=fixtures.GenerationRunsLifecycleProjectionTests.CompletedExecutor(),
                effects=fixtures.GenerationRunsLifecycleProjectionTests.PreparedEffects(), lifecycle_store=lifecycle,
                target_guard=fixtures.GenerationRunsLifecycleProjectionTests.CurrentTargetGuard())
            await runs.start(ImageRun(prompt="test", settings={}), owner="owner",
                target=RunTarget(canvas_id="canvas", node_id="node", operation_id="operation"))
            await asyncio.wait_for(runs.wait_for_lifecycle_projection(), 3)
            self.assertEqual(store.terminal_saves, 1)
            self.assertIsNone(store.claim_effect("worker", lease_seconds=30))

    async def test_pending_batch_association_is_flushed_before_cancel(self):
        with tempfile.TemporaryDirectory() as temp:
            runs = PendingGenerationRuns()
            batch = BatchGeneration(Path(temp)/"batch.sqlite3", submit=runs.submit,
                inspect_run=runs.inspect, cancel_run=runs.cancel)
            original = batch._finish_task
            attempts = 0
            def finish(*args, **kwargs):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise TursoError("cloud_storage_unavailable")
                return original(*args, **kwargs)
            batch._finish_task = finish
            with self.assertLogs(level="ERROR"):
                created = await batch.start({"prompt_modules":[{"name":"subject","options":["test"]}],
                    "models":[{"provider_id":"test","model":"test","name":"test"}], "ratios":["1:1"],
                    "settings":{"outputs_per_run":1}}, owner="owner")
            cancelled = await batch.cancel(created["id"], owner="owner")
            self.assertEqual(cancelled["tasks"][0]["status"], "cancelled")
            self.assertEqual(runs.cancellations, [("pending-1", "owner")])


class TursoGenerationBrowserRegressionTests(unittest.TestCase):
    def test_browser_failure_recovery(self):
        root = Path(__file__).resolve().parents[1]
        for script, args in (
            ('smart_canvas_text_failure_settlement_regression.cjs', ['ready']),
            ('smart_canvas_text_failure_settlement_regression.cjs', ['error']),
            ('batch_generation_poll_recovery_regression.cjs', []),
            ('generation_long_poll_recovery_regression.cjs', []),
        ):
            with self.subTest(script=script, args=args):
                result = subprocess.run(['node', str(root/'tests'/script), *args], cwd=root,
                    capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
