import asyncio
import tempfile
import threading
import unittest
from pathlib import Path

from infinite_canvas.generation_run_lifecycle import (
    AsyncGenerationRunLifecycleStore,
    GenerationRunEffectIntent,
    map_generation_run_lifecycle,
)
from infinite_canvas.generation_effect_dispatcher import (
    GenerationRunStoreExecutor,
)
from infinite_canvas.generation_run_store import (
    GenerationRunAttempt,
    GenerationRunEffect,
    GenerationRunState,
    SqliteGenerationRunStore,
)
from infinite_canvas.generation_runs import (
    GenerationRunLifecycleProjectionError,
    GenerationRuns,
    ImageRun,
    PreparedGenerationOutput,
    RunTarget,
)
from infinite_canvas.providers.core import Completed, Failed, Pending
from infinite_canvas.providers.runtime import ProviderOutput


class GenerationRunLifecycleMappingTests(unittest.TestCase):
    def test_maps_legacy_run_request_attempts_refs_and_outputs(self):
        mapped = map_generation_run_lifecycle(
            {
                "id": "run-1",
                "kind": "image",
                "status": "pending",
                "phase": "output_prepared",
                "owner": "designer-1",
                "key": "canvas-1:node-1:operation-1:0",
                "request_hash": "request-hash-1",
                "request": {"prompt": "draw a lighthouse", "count": 2},
                "effect_context": {"journey": "canvas-image"},
                "provider_id": "provider-a",
                "created_at": 900.0,
                "updated_at": 1000.0,
                "result": {"status": "pending"},
                "error": "",
                "status_code": 0,
                "remote_refs": ["remote-parent"],
                "target": {
                    "canvas_id": "canvas-1",
                    "node_id": "node-1",
                    "operation_id": "operation-1",
                    "request_index": 0,
                },
                "public_metadata": {"model": "image-v1"},
                "recoverable": True,
                "provider_output": {"images": ["/assets/provider.png"]},
                "prepared_output": {
                    "result": {"images": ["/assets/output.png"]},
                    "canvas": {"images": ["/assets/output.png"]},
                },
                "child_attempts": [
                    {
                        "index": 0,
                        "status": "succeeded",
                        "remote_ref": "remote-child-0",
                        "provider_output": {
                            "images": ["/assets/child-0.png"]
                        },
                    },
                    {
                        "index": 1,
                        "status": "pending",
                        "remote_ref": "remote-child-1",
                        "raw": {"queue": 4},
                    },
                ],
            }
        )

        self.assertEqual(
            mapped.state,
            GenerationRunState(
                run_id="run-1",
                kind="image",
                status="pending",
                phase="output_prepared",
                owner="designer-1",
                key="canvas-1:node-1:operation-1:0",
                request_hash="request-hash-1",
                provider_id="provider-a",
                created_at=900.0,
                updated_at=1000.0,
                request={"prompt": "draw a lighthouse", "count": 2},
                effect_context={"journey": "canvas-image"},
                target={
                    "canvas_id": "canvas-1",
                    "node_id": "node-1",
                    "operation_id": "operation-1",
                    "request_index": 0,
                },
                public_metadata={"model": "image-v1"},
                recoverable=True,
                attempts=(
                    GenerationRunAttempt(
                        attempt_index=0,
                        status="succeeded",
                        provider_id="provider-a",
                        remote_ref="remote-child-0",
                        provider_output={
                            "images": ["/assets/child-0.png"]
                        },
                        updated_at=1000.0,
                    ),
                    GenerationRunAttempt(
                        attempt_index=1,
                        status="pending",
                        provider_id="provider-a",
                        remote_ref="remote-child-1",
                        payload={"raw": {"queue": 4}},
                        updated_at=1000.0,
                    ),
                ),
                remote_refs=(
                    ("provider-a", "remote-parent"),
                    ("provider-a", "remote-child-0"),
                    ("provider-a", "remote-child-1"),
                ),
                provider_output={"images": ["/assets/provider.png"]},
                prepared_output={
                    "result": {"images": ["/assets/output.png"]},
                    "canvas": {"images": ["/assets/output.png"]},
                },
                result={"status": "pending"},
            ),
        )
        self.assertIsNone(mapped.effect)

    def test_maps_explicit_canvas_intent_to_one_stable_effect(self):
        mapped = map_generation_run_lifecycle(
            {
                "id": "run-1",
                "kind": "image",
                "status": "succeeded",
                "phase": "output_prepared",
                "owner": "designer-1",
                "key": "operation-1",
                "request_hash": "request-hash-1",
                "request": {"prompt": "draw a lighthouse"},
                "provider_id": "provider-a",
                "created_at": 900.0,
                "updated_at": 1000.0,
                "target": {
                    "canvas_id": "canvas-1",
                    "node_id": "node-1",
                    "operation_id": "operation-1",
                    "request_index": 0,
                },
            },
            effect=GenerationRunEffectIntent(
                terminal_status="succeeded",
                node_changes={
                    "images": [{"url": "/assets/output.png"}],
                    "pending": 0,
                    "running": False,
                },
                final_log={
                    "id": "log-1",
                    "status": "success",
                    "outputs": [{"url": "/assets/output.png"}],
                },
            ),
        )

        self.assertEqual(
            mapped.effect,
            GenerationRunEffect(
                effect_id=(
                    "generation:"
                    "34dfa03044c0bc7d5feac1d38a718afa97bbe3ae0e702b19da257439a7cf123e"
                ),
                run_id="run-1",
                canvas_id="canvas-1",
                payload={
                    "node_id": "node-1",
                    "generation_operation_id": "operation-1",
                    "request_index": 0,
                    "node_changes": {
                        "images": [{"url": "/assets/output.png"}],
                        "pending": 0,
                        "running": False,
                    },
                    "final_log": {
                        "id": "log-1",
                        "status": "success",
                        "outputs": [{"url": "/assets/output.png"}],
                    },
                },
                created_at=1000.0,
                terminal_status="succeeded",
            ),
        )

    def test_effect_identity_fails_closed_without_a_run_id(self):
        with self.assertRaisesRegex(ValueError, "run ID"):
            map_generation_run_lifecycle(
                {
                    "id": "",
                    "target": {
                        "canvas_id": "canvas-1",
                        "node_id": "node-1",
                        "operation_id": "operation-1",
                    },
                },
                effect=GenerationRunEffectIntent(
                    terminal_status="failed",
                    node_changes={},
                    final_log={"status": "failed"},
                ),
            )

    def test_effect_payload_fails_closed_before_it_can_enter_outbox(self):
        source = {
            "id": "run-1",
            "target": {
                "canvas_id": "canvas-1",
                "node_id": "node-1",
                "operation_id": "operation-1",
            },
        }

        with self.assertRaisesRegex(ValueError, "node changes"):
            map_generation_run_lifecycle(
                source,
                effect=GenerationRunEffectIntent(
                    terminal_status="succeeded",
                    node_changes=[],
                ),
            )
        with self.assertRaisesRegex(ValueError, "final log"):
            map_generation_run_lifecycle(
                source,
                effect=GenerationRunEffectIntent(
                    terminal_status="failed",
                    node_changes={},
                    final_log=[],
                ),
            )


class AsyncGenerationRunLifecycleStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_persist_and_reads_use_the_bounded_store_executor(self):
        class ThreadTrackingMapping(dict):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.read_threads = set()

            def get(self, key, default=None):
                self.read_threads.add(threading.get_ident())
                return super().get(key, default)

        class RecordingStore:
            def __init__(self):
                self.calls = []
                self.saved = None

            def save(self, state, *, effect=None):
                self.calls.append(("save", threading.get_ident()))
                self.saved = (state, effect)

            def load(self, run_id):
                self.calls.append(("load", threading.get_ident()))
                return self.saved[0] if run_id == "run-1" else None

            def load_unfinished(self, *, limit=1000):
                self.calls.append(("load_unfinished", threading.get_ident()))
                return (self.saved[0],)[:limit]

            def integrity(self):
                self.calls.append(("integrity", threading.get_ident()))
                return {"ok": True}

        loop_thread = threading.get_ident()
        store = RecordingStore()
        executor = GenerationRunStoreExecutor()
        lifecycle = AsyncGenerationRunLifecycleStore(
            store=store,
            store_executor=executor,
        )
        source = ThreadTrackingMapping(
            {
                "id": "run-1",
                "kind": "image",
                "status": "running",
                "phase": "submitted",
                "owner": "designer-1",
                "key": "operation-1",
                "request_hash": "request-hash-1",
                "request": {"prompt": "draw a lighthouse"},
                "provider_id": "provider-a",
                "created_at": 900.0,
                "updated_at": 1000.0,
            }
        )
        try:
            await lifecycle.persist(source)
            loaded = await lifecycle.load("run-1")
            unfinished = await lifecycle.load_unfinished(limit=1)
            report = await lifecycle.integrity()
        finally:
            await executor.close()

        self.assertEqual(loaded.run_id, "run-1")
        self.assertEqual(unfinished, (loaded,))
        self.assertEqual(report, {"ok": True})
        self.assertEqual(
            [name for name, _thread in store.calls],
            ["save", "load", "load_unfinished", "integrity"],
        )
        self.assertTrue(
            all(thread != loop_thread for _name, thread in store.calls)
        )
        self.assertTrue(source.read_threads)
        self.assertNotIn(loop_thread, source.read_threads)
        await asyncio.sleep(0)


class GenerationRunsLifecycleProjectionTests(
    unittest.IsolatedAsyncioTestCase
):
    class RecordingLifecycle:
        def __init__(self):
            self.records = []

        async def persist(self, value, *, effect=None):
            await asyncio.sleep(0)
            self.records.append((value, effect))

    class CurrentTargetGuard:
        def validate(self, owner, target):
            del owner, target

        def is_current(self, owner, target):
            del owner, target
            return True

        async def apply_if_current(self, run_id, owner, target, result):
            del run_id, owner, target, result
            return True

    class CompletedExecutor:
        async def execute(self, request):
            del request
            return Completed(
                ProviderOutput(
                    media=("/assets/output.png",),
                    legacy={"images": ["/assets/output.png"]},
                )
            )

    class PreparedEffects:
        async def prepare(self, run_id, request, output):
            del run_id, request, output
            return PreparedGenerationOutput(
                result={"images": ["/assets/output.png"]},
                canvas={"images": ["/assets/output.png"]},
            )

        async def publish_prepared(self, run_id, request, prepared):
            del run_id, request
            return prepared.result

    async def test_projects_every_json_lifecycle_transition_in_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            lifecycle = self.RecordingLifecycle()
            runs = GenerationRuns(
                executor=self.CompletedExecutor(),
                effects=self.PreparedEffects(),
                store_path=lambda: Path(temporary) / "generation-runs.json",
                lifecycle_store=lifecycle,
            )

            completed = await runs.start(
                ImageRun(prompt="lighthouse", settings={}),
                owner="designer-1",
            )
            await runs.wait_for_lifecycle_projection()

        self.assertEqual(completed.status, "succeeded")
        self.assertEqual(
            [
                (value["status"], value["phase"])
                for value, _effect in lifecycle.records
            ],
            [
                ("queued", "submitted"),
                ("running", "submitted"),
                ("running", "provider_completed"),
                ("running", "output_prepared"),
                ("succeeded", "finished"),
            ],
        )
        self.assertTrue(
            all(effect is None for _value, effect in lifecycle.records)
        )

    async def test_success_projects_one_explicit_canvas_effect_and_log(self):
        with tempfile.TemporaryDirectory() as temporary:
            lifecycle = self.RecordingLifecycle()
            runs = GenerationRuns(
                executor=self.CompletedExecutor(),
                effects=self.PreparedEffects(),
                store_path=lambda: Path(temporary) / "generation-runs.json",
                lifecycle_store=lifecycle,
                target_guard=self.CurrentTargetGuard(),
                now=lambda: 12.5,
            )

            completed = await runs.start(
                ImageRun(
                    prompt="draw a lighthouse",
                    settings={
                        "provider_id": "provider-a",
                        "model": "image-v1",
                        "size": "1024x1024",
                    },
                    references=(
                        {"url": "/assets/input.png", "role": "reference"},
                    ),
                ),
                owner="designer-1",
                target=RunTarget(
                    canvas_id="canvas-1",
                    node_id="node-1",
                    operation_id="operation-1",
                ),
            )
            await runs.wait_for_lifecycle_projection()

        terminal = [
            (value, effect)
            for value, effect in lifecycle.records
            if effect is not None
        ]
        self.assertEqual(len(terminal), 1)
        value, effect = terminal[0]
        self.assertEqual(value["status"], "succeeded")
        self.assertEqual(effect.terminal_status, "succeeded")
        self.assertEqual(
            effect.node_changes,
            {
                "images": [
                    {"url": "/assets/output.png", "kind": "image"}
                ],
                "pending": 0,
                "running": False,
            },
        )
        self.assertEqual(
            effect.final_log,
            {
                "runId": completed.id,
                "nodeId": "node-1",
                "status": "success",
                "createdAt": 12500,
                "durationMs": 0,
                "platform": "provider-a",
                "model": "image-v1",
                "prompt": "draw a lighthouse",
                "request": {
                    "provider_id": "provider-a",
                    "model": "image-v1",
                    "size": "1024x1024",
                    "count": 1,
                    "submission_count": 1,
                },
                "refs": [
                    {"url": "/assets/input.png", "role": "reference"}
                ],
                "outputs": [{"url": "/assets/output.png", "kind": "image"}],
                "tasks": [],
                "diagnostics": {
                    "request_fingerprint": completed.request_hash,
                    "recoverable": True,
                    "provider_id": "provider-a",
                    "status_code": 0,
                    "upstream_task_ids": [],
                },
            },
        )

    async def test_failed_and_cancelled_runs_project_final_logs(self):
        class FailedExecutor:
            async def execute(self, request):
                del request
                return Failed(error="provider rejected prompt")

        class PendingExecutor:
            async def execute(self, request):
                del request
                return Pending("remote-1")

        async def project(executor, *, cancel=False):
            temporary = tempfile.TemporaryDirectory()
            self.addCleanup(temporary.cleanup)
            lifecycle = self.RecordingLifecycle()
            runs = GenerationRuns(
                executor=executor,
                effects=self.PreparedEffects(),
                store_path=lambda: Path(temporary.name) / "generation-runs.json",
                lifecycle_store=lifecycle,
                target_guard=self.CurrentTargetGuard(),
                now=lambda: 20.0,
            )
            snapshot = await runs.start(
                ImageRun(
                    prompt="draw a lighthouse",
                    settings={"provider_id": "provider-a", "model": "image-v1"},
                ),
                owner="designer-1",
                target=RunTarget(
                    canvas_id="canvas-1",
                    node_id="node-1",
                    operation_id="operation-1",
                ),
            )
            if cancel:
                snapshot = await runs.cancel(snapshot.id, owner="designer-1")
            await runs.wait_for_lifecycle_projection()
            return snapshot, lifecycle.records

        failed, failed_records = await project(FailedExecutor())
        cancelled, cancelled_records = await project(
            PendingExecutor(),
            cancel=True,
        )

        for snapshot, records, status, log_status in (
            (failed, failed_records, "failed", "failed"),
            (cancelled, cancelled_records, "cancelled", "cancelled"),
        ):
            terminal = [effect for _value, effect in records if effect is not None]
            self.assertEqual(len(terminal), 1)
            self.assertEqual(terminal[0].terminal_status, status)
            self.assertEqual(
                terminal[0].node_changes,
                {"images": [], "pending": 0, "running": False},
            )
            self.assertEqual(terminal[0].final_log["status"], log_status)
            self.assertEqual(terminal[0].final_log["runId"], snapshot.id)
        self.assertEqual(
            failed_records[-1][1].final_log["error"],
            "provider rejected prompt",
        )

    async def test_terminal_projection_reaches_sqlite_outbox(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SqliteGenerationRunStore(
                Path(temporary) / "generation-runs.sqlite3",
                workspace_id="workspace-1",
                now=lambda: 30.0,
            )
            executor = GenerationRunStoreExecutor()
            lifecycle = AsyncGenerationRunLifecycleStore(
                store=store,
                store_executor=executor,
            )
            runs = GenerationRuns(
                executor=self.CompletedExecutor(),
                effects=self.PreparedEffects(),
                store_path=lambda: Path(temporary) / "generation-runs.json",
                lifecycle_store=lifecycle,
                target_guard=self.CurrentTargetGuard(),
                now=lambda: 30.0,
            )
            try:
                completed = await runs.start(
                    ImageRun(
                        prompt="draw a lighthouse",
                        settings={
                            "provider_id": "provider-a",
                            "model": "image-v1",
                        },
                    ),
                    owner="designer-1",
                    target=RunTarget(
                        canvas_id="canvas-1",
                        node_id="node-1",
                        operation_id="operation-1",
                    ),
                )
                await runs.wait_for_lifecycle_projection()
                claim = await executor.call(
                    store.claim_effect,
                    "worker-1",
                    lease_seconds=30,
                )
            finally:
                await executor.close()

        self.assertIsNotNone(claim)
        self.assertEqual(claim.run_id, completed.id)
        self.assertEqual(claim.canvas_id, "canvas-1")
        self.assertEqual(
            claim.payload["node_changes"]["images"],
            [{"url": "/assets/output.png", "kind": "image"}],
        )
        self.assertEqual(claim.payload["final_log"]["status"], "success")

    async def test_sqlite_lifecycle_defers_target_apply_to_outbox(self):
        class OutboxOwnedTargetGuard(self.CurrentTargetGuard):
            def __init__(self):
                self.direct_apply_calls = 0

            async def apply_if_current(self, run_id, owner, target, result):
                del run_id, owner, target, result
                self.direct_apply_calls += 1
                return True

        with tempfile.TemporaryDirectory() as temporary:
            store = SqliteGenerationRunStore(
                Path(temporary) / "generation-runs.sqlite3",
                workspace_id="workspace-1",
                now=lambda: 30.0,
            )
            executor = GenerationRunStoreExecutor()
            lifecycle = AsyncGenerationRunLifecycleStore(
                store=store,
                store_executor=executor,
            )
            guard = OutboxOwnedTargetGuard()
            runs = GenerationRuns(
                executor=self.CompletedExecutor(),
                effects=self.PreparedEffects(),
                store_path=None,
                lifecycle_store=lifecycle,
                target_guard=guard,
                now=lambda: 30.0,
            )
            try:
                completed = await runs.start(
                    ImageRun(
                        prompt="draw a lighthouse",
                        settings={"provider_id": "provider-a"},
                    ),
                    owner="designer-1",
                    target=RunTarget(
                        canvas_id="canvas-1",
                        node_id="node-1",
                        operation_id="operation-1",
                    ),
                )
                await runs.wait_for_lifecycle_projection()
                claim = await executor.call(
                    store.claim_effect,
                    "worker-1",
                    lease_seconds=30,
                )
            finally:
                await executor.close()

        self.assertEqual(completed.status, "succeeded")
        self.assertEqual(guard.direct_apply_calls, 0)
        self.assertIsNotNone(claim)
        self.assertEqual(claim.payload["final_log"]["status"], "success")

    async def test_discarded_target_does_not_create_a_log_effect(self):
        class ReplacedTargetGuard(self.CurrentTargetGuard):
            def is_current(self, owner, target):
                del owner, target
                return False

        with tempfile.TemporaryDirectory() as temporary:
            lifecycle = self.RecordingLifecycle()
            runs = GenerationRuns(
                executor=self.CompletedExecutor(),
                effects=self.PreparedEffects(),
                store_path=lambda: Path(temporary) / "generation-runs.json",
                lifecycle_store=lifecycle,
                target_guard=ReplacedTargetGuard(),
            )
            discarded = await runs.start(
                ImageRun(prompt="obsolete", settings={}),
                owner="designer-1",
                target=RunTarget(
                    canvas_id="canvas-1",
                    node_id="node-1",
                    operation_id="operation-1",
                ),
            )
            await runs.wait_for_lifecycle_projection()

        self.assertEqual(discarded.status, "discarded")
        self.assertTrue(
            all(effect is None for _value, effect in lifecycle.records)
        )

    async def test_projection_failure_does_not_replace_json_authority(self):
        class FailingLifecycle:
            async def persist(self, value, *, effect=None):
                del value, effect
                raise RuntimeError("sqlite projection unavailable")

        with tempfile.TemporaryDirectory() as temporary:
            json_path = Path(temporary) / "generation-runs.json"
            runs = GenerationRuns(
                executor=self.CompletedExecutor(),
                effects=self.PreparedEffects(),
                store_path=lambda: json_path,
                lifecycle_store=FailingLifecycle(),
            )

            completed = await runs.start(
                ImageRun(prompt="lighthouse", settings={}),
                owner="designer-1",
            )
            with self.assertRaisesRegex(
                GenerationRunLifecycleProjectionError,
                "sqlite projection unavailable",
            ):
                await runs.wait_for_lifecycle_projection()

            restarted = GenerationRuns(
                executor=self.CompletedExecutor(),
                effects=self.PreparedEffects(),
                store_path=lambda: json_path,
            )
            restored = restarted.get(completed.id, owner="designer-1")

        self.assertEqual(completed.status, "succeeded")
        self.assertEqual(restored.status, "succeeded")


if __name__ == "__main__":
    unittest.main()
