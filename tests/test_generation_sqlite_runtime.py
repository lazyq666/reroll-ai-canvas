import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.generation_effect_dispatcher import (
    CanvasSyncGenerationEffectTarget,
    GenerationEffectDelivery,
    GenerationRunStoreExecutorClosed,
)
from infinite_canvas.generation_run_store import (
    EffectResolution,
    GenerationRunEffect,
    GenerationRunState,
    SqliteGenerationRunStore,
)
from infinite_canvas.generation_sqlite_runtime import GenerationSqliteRuntime
from infinite_canvas.generation_run_lifecycle import GenerationRunEffectIntent


class BlockingTarget:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def commit_effect(self, claim):
        self.started.set()
        await self.release.wait()
        return GenerationEffectDelivery(
            resolution=EffectResolution.APPLIED,
            detail="canvas accepted effect",
        )


class GenerationSqliteRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_generation_lifecycle_delivers_to_canvas_after_idle_without_manual_dispatch(self):
        from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection, SqliteCanvasStore
        from infinite_canvas.canvas_sync import CanvasSync
        from infinite_canvas.generation_runs import CanvasGenerationTargetGuard, GenerationRuns, ImageRun, RunTarget
        from tests import test_generation_runs as generation_fixtures
        from tests.test_canvas_store import ADMIN, sample_canvas

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            canvases = SqliteCanvasStore(root / 'canvases.sqlite3', workspace_id='workspace-a')
            document = sample_canvas()
            document['nodes'][0]['generationOperationId'] = 'operation-a'
            document['nodes'][0]['running'] = True
            canvases.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='auto-delivery'))
            sync = CanvasSync(content=lambda: None, now_ms=lambda: 1000, canvas_store=lambda: canvases)
            store = SqliteGenerationRunStore(root / 'runs.sqlite3', workspace_id='workspace-a')
            runtime = GenerationSqliteRuntime(
                store=store, worker_id='auto-delivery', idle_delay_seconds=60,
                target=CanvasSyncGenerationEffectTarget(canvas_sync=sync, actor_by_id=lambda _owner: ADMIN),
            )
            runs = GenerationRuns(
                executor=generation_fixtures.FakeGenerationAdapter(),
                effects=generation_fixtures.FakeGenerationEffects(),
                lifecycle_store=runtime.lifecycle_store,
                target_guard=CanvasGenerationTargetGuard(canvas_sync=sync, actor_by_id=lambda _owner: ADMIN),
            )
            idle, settled = asyncio.Event(), asyncio.Event()
            loop = asyncio.get_running_loop()
            claim, settle = store.claim_effect, store.settle_effect

            def observe_idle(*args, **kwargs):
                result = claim(*args, **kwargs)
                if result is None:
                    loop.call_soon_threadsafe(idle.set)
                return result

            def observe_settled(*args, **kwargs):
                result = settle(*args, **kwargs)
                if result:
                    loop.call_soon_threadsafe(settled.set)
                return result

            with patch.object(store, 'claim_effect', side_effect=observe_idle), \
                 patch.object(store, 'settle_effect', side_effect=observe_settled):
                try:
                    await runtime.start()
                    await asyncio.wait_for(idle.wait(), timeout=1)
                    await runs.start(
                        ImageRun(prompt='Synthetic automatic delivery', settings={}), owner=ADMIN['id'],
                        target=RunTarget(canvas_id=document['id'], node_id='node-a', operation_id='operation-a'),
                    )
                    await runs.wait_for_lifecycle_projection()
                    await asyncio.wait_for(settled.wait(), timeout=0.5)
                    final = canvases.read(document['id'], ADMIN, CanvasProjection.public_snapshot()).canvas
                    refs = [item.get('url') if isinstance(item, dict) else item for item in final['nodes'][0]['images']]
                    self.assertEqual(refs, ['generated.png'])
                    self.assertFalse(final['nodes'][0]['running'])
                    self.assertEqual(store.integrity()['counts']['pending_effects'], 0)
                finally:
                    await runtime.close()

    async def test_committed_canvas_result_wakes_an_idle_dispatcher(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SqliteGenerationRunStore(Path(temporary) / 'runs.sqlite3', workspace_id='workspace-a')
            target = BlockingTarget()
            runtime = GenerationSqliteRuntime(
                store=store, target=target, worker_id='wake-worker', idle_delay_seconds=60,
            )
            idle = asyncio.Event()
            loop = asyncio.get_running_loop()
            claim = store.claim_effect

            def observe_idle(*args, **kwargs):
                result = claim(*args, **kwargs)
                if result is None:
                    loop.call_soon_threadsafe(idle.set)
                return result

            with patch.object(store, 'claim_effect', side_effect=observe_idle):
                try:
                    await runtime.start()
                    await asyncio.wait_for(idle.wait(), timeout=1)
                    await runtime.lifecycle_store.persist({
                        'id': 'wake-run', 'kind': 'image', 'status': 'succeeded',
                        'owner': 'designer-1', 'created_at': 1, 'updated_at': 2,
                        'target': {'canvas_id': 'canvas-1', 'node_id': 'node-1',
                                   'operation_id': 'operation-1', 'request_index': 0},
                    }, effect=GenerationRunEffectIntent(
                        terminal_status='succeeded', node_changes={'running': False},
                    ))
                    await asyncio.wait_for(target.started.wait(), timeout=0.5)
                finally:
                    target.release.set()
                    await runtime.close()

    async def test_close_drains_dispatcher_before_closing_shared_store_executor(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SqliteGenerationRunStore(
                Path(temporary) / "generation-runs.sqlite3",
                workspace_id="workspace-a",
            )
            store.save(
                GenerationRunState(
                    run_id="run-1",
                    kind="image",
                    status="succeeded",
                    phase="completed",
                    owner="designer-1",
                    key="run-1:operation-a:0",
                    request_hash="request-hash-1",
                    provider_id="provider-a",
                    created_at=1,
                    updated_at=2,
                    prepared_output={"canvas": {"images": ["/one.png"]}},
                ),
                effect=GenerationRunEffect(
                    effect_id="effect:run-1",
                    run_id="run-1",
                    canvas_id="canvas-1",
                    payload={
                        "node_id": "node-1",
                        "generation_operation_id": "operation-a",
                        "request_index": 0,
                        "node_changes": {"running": False},
                    },
                    created_at=2,
                ),
            )
            target = BlockingTarget()
            runtime = GenerationSqliteRuntime(
                store=store,
                target=target,
                worker_id="workspace-a:process-1",
                idle_delay_seconds=0.001,
            )

            self.assertIs(
                runtime.lifecycle_store.store_executor,
                runtime.store_executor,
            )
            await runtime.start()
            await asyncio.wait_for(target.started.wait(), timeout=1)

            closing = asyncio.create_task(runtime.close())
            await asyncio.sleep(0)
            self.assertFalse(closing.done())
            target.release.set()
            await asyncio.wait_for(closing, timeout=1)

            self.assertFalse(runtime.running)
            self.assertTrue(runtime.closed)
            self.assertEqual(
                0,
                store.integrity()["counts"]["pending_effects"],
            )
            with self.assertRaises(GenerationRunStoreExecutorClosed):
                await runtime.lifecycle_store.integrity()


if __name__ == "__main__":
    unittest.main()
