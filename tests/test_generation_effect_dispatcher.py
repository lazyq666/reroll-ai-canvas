import asyncio
import tempfile
import threading
import unittest
from pathlib import Path

from infinite_canvas.generation_effect_dispatcher import (
    CanvasSyncGenerationEffectTarget,
    GenerationEffectDelivery,
    GenerationEffectDispatchStatus,
    GenerationEffectDispatcher,
    GenerationRunStoreExecutor,
    GenerationRunStoreExecutorClosed,
)
from infinite_canvas.canvas_sync import CanvasGenerationApplyResult
from infinite_canvas.generation_run_store import (
    EffectResolution,
    GenerationRunEffect,
    GenerationRunState,
    SqliteGenerationRunStore,
)


class GenerationRunStoreExecutorTests(unittest.IsolatedAsyncioTestCase):
    async def test_blocking_store_work_stays_off_loop_and_pending_work_is_bounded(self):
        release = threading.Event()
        first_started = threading.Event()
        second_started = threading.Event()
        executor = GenerationRunStoreExecutor(
            max_workers=2,
            max_pending=1,
        )

        def first():
            first_started.set()
            release.wait(timeout=2)
            return "first"

        def second():
            second_started.set()
            return "second"

        first_task = asyncio.create_task(executor.call(first))
        for _ in range(100):
            if first_started.is_set():
                break
            await asyncio.sleep(0.001)
        self.assertTrue(first_started.is_set())

        second_task = asyncio.create_task(executor.call(second))
        loop_progress = []
        await asyncio.sleep(0)
        loop_progress.append("tick")

        self.assertEqual(loop_progress, ["tick"])
        self.assertFalse(second_started.is_set())
        release.set()
        self.assertEqual(
            await asyncio.gather(first_task, second_task),
            ["first", "second"],
        )
        self.assertTrue(second_started.is_set())
        await executor.close()

    async def test_close_drains_running_work_and_rejects_queued_admission(self):
        release = threading.Event()
        started = threading.Event()
        executor = GenerationRunStoreExecutor(max_pending=1)

        def blocking():
            started.set()
            release.wait(timeout=2)
            return "done"

        running = asyncio.create_task(executor.call(blocking))
        for _ in range(100):
            if started.is_set():
                break
            await asyncio.sleep(0.001)
        queued = asyncio.create_task(executor.call(lambda: "must-not-run"))
        await asyncio.sleep(0)
        closing = asyncio.create_task(executor.close())
        await asyncio.sleep(0)
        release.set()

        self.assertEqual(await running, "done")
        with self.assertRaises(GenerationRunStoreExecutorClosed):
            await queued
        await closing
        with self.assertRaises(GenerationRunStoreExecutorClosed):
            await executor.call(lambda: "must-not-run")


class RecordingEffectTarget:
    def __init__(self, delivery):
        self.delivery = delivery
        self.claims = []

    async def commit_effect(self, claim):
        self.claims.append(claim)
        if isinstance(self.delivery, Exception):
            raise self.delivery
        return self.delivery


class RecordingCanvasSync:
    def __init__(self, *, applied=True, reason=""):
        self.applied = applied
        self.reason = reason
        self.calls = []

    async def apply_generation_result_if_current(self, **values):
        self.calls.append(values)
        return CanvasGenerationApplyResult(
            applied=self.applied,
            reason=self.reason,
            revision=7,
        )


class ExpiringEffectTarget:
    def __init__(self, expire):
        self.expire = expire
        self.claims = []

    async def commit_effect(self, claim):
        self.claims.append(claim)
        self.expire()
        return GenerationEffectDelivery(
            resolution=EffectResolution.APPLIED,
            detail="canvas committed after lease expiry",
        )


class BlockingEffectTarget:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.claims = []

    async def commit_effect(self, claim):
        self.claims.append(claim)
        self.started.set()
        await self.release.wait()
        return GenerationEffectDelivery(
            resolution=EffectResolution.APPLIED,
            detail="canvas accepted effect",
        )


class FailFirstClaimStore:
    def __init__(self, store):
        self.store = store
        self.failed = False

    def claim_effect(self, *args, **kwargs):
        if not self.failed:
            self.failed = True
            raise RuntimeError("temporary store outage")
        return self.store.claim_effect(*args, **kwargs)

    def settle_effect(self, *args, **kwargs):
        return self.store.settle_effect(*args, **kwargs)


class GenerationEffectDispatcherTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "generation-runs.sqlite3"
        self.clock = 1000.0
        self.store = SqliteGenerationRunStore(
            self.database,
            workspace_id="workspace-a",
            now=lambda: self.clock,
        )
        self.executor = GenerationRunStoreExecutor()

    async def asyncTearDown(self):
        await self.executor.close()
        self.temporary.cleanup()

    def seed_effect(self, run_id="run-1"):
        run = GenerationRunState(
            run_id=run_id,
            kind="image",
            status="running",
            phase="output_prepared",
            owner="designer-1",
            key=f"{run_id}:operation-a:0",
            request_hash="request-hash-1",
            provider_id="provider-a",
            created_at=900.0,
            updated_at=1000.0,
            request={"prompt": "draw a lighthouse"},
            prepared_output={
                "canvas": {"images": ["/assets/output/one.png"]}
            },
        )
        effect = GenerationRunEffect(
            effect_id=f"effect:{run_id}",
            run_id=run_id,
            canvas_id="canvas-1",
            payload={
                "node_id": "node-a",
                "generation_operation_id": "operation-a",
                "request_index": 0,
                "node_changes": {
                    "images": [{"url": "/assets/output/one.png"}]
                },
                "final_log": {"id": "log-1", "status": "success"},
            },
            created_at=1000.0,
        )
        self.store.save(run, effect=effect)

    async def test_background_lifecycle_consumes_until_stopped(self):
        self.seed_effect()
        target = RecordingEffectTarget(
            GenerationEffectDelivery(
                resolution=EffectResolution.APPLIED,
                detail="canvas accepted effect",
            )
        )
        dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=target,
            worker_id="dispatcher-a",
            idle_delay_seconds=0.001,
            failure_delay_seconds=0.001,
        )

        await dispatcher.start()
        for _ in range(100):
            if self.store.integrity()["counts"]["pending_effects"] == 0:
                break
            await asyncio.sleep(0.001)
        await dispatcher.stop()

        self.assertFalse(dispatcher.running)
        self.assertEqual(
            ["effect:run-1"],
            [claim.effect_id for claim in target.claims],
        )
        self.seed_effect("run-2")
        await asyncio.sleep(0.01)
        self.assertEqual(
            1,
            self.store.integrity()["counts"]["pending_effects"],
        )
        self.assertEqual(1, len(target.claims))

    async def test_stop_drains_the_claim_already_being_delivered(self):
        self.seed_effect()
        target = BlockingEffectTarget()
        dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=target,
            worker_id="dispatcher-a",
            idle_delay_seconds=0.001,
        )
        await dispatcher.start()
        await asyncio.wait_for(target.started.wait(), timeout=1)

        stopping = asyncio.create_task(dispatcher.stop())
        await asyncio.sleep(0)

        self.assertFalse(stopping.done())
        self.assertEqual(
            1,
            self.store.integrity()["counts"]["pending_effects"],
        )
        target.release.set()
        await asyncio.wait_for(stopping, timeout=1)
        self.assertEqual(
            0,
            self.store.integrity()["counts"]["pending_effects"],
        )
        self.assertEqual("succeeded", self.store.load("run-1").status)

    async def test_background_lifecycle_recovers_after_store_claim_failure(self):
        self.seed_effect()
        target = RecordingEffectTarget(
            GenerationEffectDelivery(
                resolution=EffectResolution.APPLIED,
                detail="canvas accepted effect",
            )
        )
        dispatcher = GenerationEffectDispatcher(
            store=FailFirstClaimStore(self.store),
            store_executor=self.executor,
            target=target,
            worker_id="dispatcher-a",
            idle_delay_seconds=0.001,
            failure_delay_seconds=0.001,
        )

        await dispatcher.start()
        for _ in range(100):
            if target.claims:
                break
            await asyncio.sleep(0.001)
        await dispatcher.stop()

        self.assertEqual(1, len(target.claims))
        self.assertIsInstance(dispatcher.last_error, RuntimeError)
        self.assertEqual(
            "temporary store outage",
            str(dispatcher.last_error),
        )
        self.assertEqual(
            0,
            self.store.integrity()["counts"]["pending_effects"],
        )

    async def test_applied_canvas_effect_settles_claim_and_cleans_run_details(self):
        self.seed_effect()
        target = RecordingEffectTarget(
            GenerationEffectDelivery(
                resolution=EffectResolution.APPLIED,
                detail="canvas accepted effect",
            )
        )
        dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=target,
            worker_id="dispatcher-a",
            lease_seconds=30,
            retry_delay_seconds=5,
        )

        result = await dispatcher.dispatch_once()

        self.assertEqual(result.status, GenerationEffectDispatchStatus.APPLIED)
        self.assertEqual(result.effect_id, "effect:run-1")
        self.assertEqual(len(target.claims), 1)
        self.assertEqual(target.claims[0].effect_id, "effect:run-1")
        self.assertEqual(target.claims[0].owner, "designer-1")
        completed = self.store.load("run-1")
        self.assertEqual(completed.status, "succeeded")
        self.assertEqual(self.store.integrity()["counts"]["outputs"], 0)
        self.assertEqual(
            self.store.integrity()["counts"]["pending_effects"],
            0,
        )

    async def test_canvas_sync_target_receives_stable_effect_id_and_full_intent(self):
        self.seed_effect()
        canvas_sync = RecordingCanvasSync()
        target = CanvasSyncGenerationEffectTarget(
            canvas_sync=canvas_sync,
            actor_by_id=lambda owner: {
                "id": owner,
                "username": "designer",
                "role": "designer",
                "status": "active",
            },
        )
        dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=target,
            worker_id="dispatcher-a",
        )

        result = await dispatcher.dispatch_once()

        self.assertEqual(result.status, GenerationEffectDispatchStatus.APPLIED)
        self.assertEqual(len(canvas_sync.calls), 1)
        call = canvas_sync.calls[0]
        self.assertEqual(call["effect_id"], "effect:run-1")
        self.assertEqual(call["canvas_id"], "canvas-1")
        self.assertEqual(call["actor"]["id"], "designer-1")
        self.assertEqual(call["node_id"], "node-a")
        self.assertEqual(call["operation_id"], "operation-a")
        self.assertEqual(call["request_index"], 0)
        self.assertEqual(call["run_id"], "run-1")
        self.assertEqual(
            call["node_changes"],
            {"images": [{"url": "/assets/output/one.png"}]},
        )
        self.assertEqual(
            call["log"],
            {"id": "log-1", "status": "success"},
        )

    async def test_target_guard_discard_completes_outbox_without_retry(self):
        self.seed_effect()
        canvas_sync = RecordingCanvasSync(
            applied=False,
            reason="operation_replaced",
        )
        dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=CanvasSyncGenerationEffectTarget(
                canvas_sync=canvas_sync,
                actor_by_id=lambda owner: {"id": owner},
            ),
            worker_id="dispatcher-a",
        )

        result = await dispatcher.dispatch_once()

        self.assertEqual(
            result.status,
            GenerationEffectDispatchStatus.DISCARDED,
        )
        self.assertEqual(result.detail, "operation_replaced")
        self.assertEqual(self.store.load("run-1").status, "discarded")
        self.assertEqual(
            self.store.integrity()["counts"]["pending_effects"],
            0,
        )

    async def test_target_failure_retries_same_effect_after_durable_delay(self):
        self.seed_effect()
        target = RecordingEffectTarget(RuntimeError("canvas is busy"))
        dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=target,
            worker_id="dispatcher-a",
            retry_delay_seconds=5,
        )

        failed = await dispatcher.dispatch_once()

        self.assertEqual(failed.status, GenerationEffectDispatchStatus.RETRY)
        self.assertEqual(failed.effect_id, "effect:run-1")
        self.assertEqual(failed.detail, "canvas is busy")
        self.assertEqual(self.store.integrity()["counts"]["outputs"], 1)
        self.assertEqual(
            (await dispatcher.dispatch_once()).status,
            GenerationEffectDispatchStatus.IDLE,
        )

        self.clock = 1005.0
        target.delivery = GenerationEffectDelivery(
            resolution=EffectResolution.APPLIED,
            detail="replayed idempotently",
        )
        replayed = await dispatcher.dispatch_once()

        self.assertEqual(
            replayed.status,
            GenerationEffectDispatchStatus.APPLIED,
        )
        self.assertEqual(replayed.effect_id, "effect:run-1")
        self.assertEqual(replayed.attempt_count, 2)
        self.assertEqual(
            [claim.effect_id for claim in target.claims],
            ["effect:run-1", "effect:run-1"],
        )

    async def test_lost_lease_replays_same_effect_for_canvas_idempotency(self):
        self.seed_effect()
        expiring = ExpiringEffectTarget(
            lambda: setattr(self, "clock", 1031.0)
        )
        first_dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=expiring,
            worker_id="dispatcher-a",
            lease_seconds=30,
        )

        lost = await first_dispatcher.dispatch_once()

        self.assertEqual(
            lost.status,
            GenerationEffectDispatchStatus.LOST_LEASE,
        )
        self.assertEqual(self.store.integrity()["counts"]["outputs"], 1)
        replay_target = RecordingEffectTarget(
            GenerationEffectDelivery(
                resolution=EffectResolution.APPLIED,
                detail="CanvasStore returned already_applied",
            )
        )
        replay_dispatcher = GenerationEffectDispatcher(
            store=self.store,
            store_executor=self.executor,
            target=replay_target,
            worker_id="dispatcher-b",
        )

        replayed = await replay_dispatcher.dispatch_once()

        self.assertEqual(
            replayed.status,
            GenerationEffectDispatchStatus.APPLIED,
        )
        self.assertEqual(replayed.attempt_count, 2)
        self.assertEqual(
            expiring.claims[0].effect_id,
            replay_target.claims[0].effect_id,
        )
        self.assertEqual(self.store.integrity()["counts"]["outputs"], 0)


if __name__ == "__main__":
    unittest.main()
