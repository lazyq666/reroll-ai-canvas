import asyncio
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.generation_effect_dispatcher import (
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
