"""ComfyUI progress is part of the existing durable Generation Run."""
import asyncio
import json
import tempfile
import threading
import unittest
from pathlib import Path

from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.generation_runs import (
    Background, GenerationRuns, ProviderGenerationExecutor, WorkflowRun,
)
from infinite_canvas.providers.core import Pending, ProviderRegistry
from infinite_canvas.providers.runtime import (
    ProviderRuntime, WorkflowExecutors, build_workflow_registry,
)


class Effects:
    async def publish(self, run_id, request, output):
        return output.legacy


def executor(submit, recover=None):
    async def unused(*args, **kwargs):
        raise AssertionError("Unrelated provider invoked")

    workflows = WorkflowExecutors(
        comfyui=submit, comfyui_saved=submit, comfyui_recovery=recover or submit,
        modelscope=unused, modelscope_cloud=unused, modelscope_angle=unused,
        modelscope_angle_recovery=unused, runninghub_submit=unused,
        runninghub_query=unused, runninghub_app_submit=unused,
        runninghub_upload_asset=unused,
    )
    return ProviderGenerationExecutor(ProviderRuntime(
        provider_lookup=lambda _: {}, image_registry=ProviderRegistry(),
        workflow_registry=build_workflow_registry(workflows),
    ))


class ComfyWorkflowProgressTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_checkpoints_sqlite_before_poll_and_progress_survives_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SqliteGenerationRunStore(Path(temporary) / "runs.sqlite3", workspace_id="progress")
            pool = GenerationRunStoreExecutor()
            lifecycle = AsyncGenerationRunLifecycleStore(store=store, store_executor=pool)
            started = asyncio.Event()
            release = threading.Event()
            observed = []
            remote = {
                "backend": "machine-a:8188", "prompt_id": "original-prompt",
                "client_id": "original-client", "output_node_ids": ["21"],
                "workflow_classes": {"21": "VHS_VideoCombine"},
                "adapter": "h3", "duration": 5,
            }
            run_ids = []

            async def submit(payload, on_remote=None, on_progress=None):
                def work():
                    on_remote(Pending("original-prompt", raw=remote))
                    # The callback must not merely schedule SQLite persistence.
                    persisted = store.load(run_ids[0])
                    observed.append(persisted.result)
                    on_progress({"stage": "comfy-sampling-first", "progress_current": 3,
                                 "progress_total": 8, "progress_percent": 37.5})
                    release.wait(3)
                    return {"status": "pending", **remote}
                started.set()
                return await asyncio.to_thread(work)

            runs = GenerationRuns(executor=executor(submit), effects=Effects(), lifecycle_store=lifecycle)
            try:
                initial = await runs.start(WorkflowRun("comfyui", {}), owner="designer", delivery=Background())
                run_ids.append(initial.id)
                await asyncio.wait_for(started.wait(), 1)
                for _ in range(100):
                    if runs.get(initial.id, owner="designer").public_metadata.get("progress_percent") == 37.5:
                        break
                    await asyncio.sleep(.01)
                await runs.wait_for_lifecycle_projection()
                self.assertEqual([remote], observed)
                self.assertEqual(37.5, store.load(initial.id).public_metadata["progress_percent"])
                self.assertEqual(3, store.load(initial.id).public_metadata["progress_current"])
                release.set()
                await asyncio.sleep(.05)
                await runs.pause_active()
                await runs.wait_for_lifecycle_projection()

                restored_requests = []
                async def recover(payload, on_progress=None):
                    restored_requests.append(payload)
                    on_progress({"stage": "comfy-encoding"})
                    return {"videos": ["final.mp4"], "prompt_id": "original-prompt"}
                restarted = GenerationRuns(executor=executor(submit, recover), effects=Effects(), lifecycle_store=lifecycle)
                await restarted.restore_lifecycle_authority()
                completed = await restarted.resume(initial.id, owner="designer")
                await restarted.wait_for_lifecycle_projection()
                self.assertEqual("succeeded", completed.status)
                self.assertEqual([{**remote, "status": "pending"}], restored_requests)
                self.assertIsNone(completed.public_metadata["progress_percent"])
                self.assertIsNone(completed.public_metadata["progress_current"])
            finally:
                release.set()
                await runs.pause_active()
                await lifecycle.close()
                await pool.close()

    async def test_stage_changes_clear_numbers_duplicates_and_late_events_are_ignored(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runs.json"
            callbacks = []
            gate = asyncio.Event()
            ready = asyncio.Event()
            async def submit(payload, on_remote=None, on_progress=None):
                callbacks.append(on_progress)
                on_remote(Pending("p", raw={"backend": "a:8188", "prompt_id": "p"}))
                on_progress({"stage": "comfy-queued", "queue_position": 2})
                ready.set()
                await gate.wait()
                return {"videos": ["final.mp4"]}
            runs = GenerationRuns(executor=executor(submit), effects=Effects(), store_path=lambda: path)
            run = await runs.start(WorkflowRun("comfyui", {}), delivery=Background())
            await ready.wait()
            self.assertEqual("queued", runs.get(run.id).status)
            callback = callbacks[0]
            callback({"stage": "comfy-sampling-first", "progress_current": 8, "progress_total": 8, "progress_percent": 100})
            self.assertEqual("running", runs.get(run.id).status)
            self.assertIsNone(runs.get(run.id).public_metadata["queue_position"])
            callback({"stage": "comfy-upscaling"})
            current = runs.get(run.id)
            self.assertIsNone(current.public_metadata["progress_percent"])
            self.assertIsNone(current.public_metadata["progress"])
            self.assertIsNone(current.public_metadata["progress_total"])
            before = path.read_bytes()
            callback({"stage": "comfy-upscaling"})
            self.assertEqual(before, path.read_bytes())
            callback({"progress_percent": float("nan"), "progress_total": "invalid"})
            self.assertEqual(before, path.read_bytes())
            gate.set()
            for _ in range(100):
                if runs.get(run.id).status == "succeeded": break
                await asyncio.sleep(.01)
            before = path.read_bytes()
            callback({"stage": "comfy-queued", "queue_position": 20})
            self.assertEqual(before, path.read_bytes())
            self.assertEqual("succeeded", runs.get(run.id).status)
            self.assertEqual("comfy-upscaling", json.loads(before)["runs"][0]["public_metadata"]["stage"])

    async def test_paused_execution_cannot_publish_late_progress_into_resumed_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            callbacks = []
            ready = asyncio.Event()
            async def submit(payload, on_remote=None, on_progress=None):
                callbacks.append((on_remote, on_progress))
                on_remote(Pending("original", raw={"backend": "a:8188"}))
                on_progress({"stage": "comfy-sampling-first", "progress_percent": 10})
                ready.set()
                await asyncio.Event().wait()
            async def recover(payload, on_progress=None):
                callbacks.append((None, on_progress))
                on_progress({"stage": "comfy-encoding"})
                ready.set()
                await asyncio.Event().wait()
            runs = GenerationRuns(executor=executor(submit, recover), effects=Effects(),
                                  store_path=lambda: Path(temporary) / "runs.json")
            initial = await runs.start(WorkflowRun("comfyui", {}), delivery=Background())
            await ready.wait()
            await runs.pause_active()
            ready.clear()
            await runs.resume(initial.id, delivery=Background())
            await ready.wait()
            old_remote, old_progress = callbacks[0]
            old_progress({"stage": "comfy-sampling-first", "progress_percent": 99})
            old_remote(Pending("wrong-prompt", raw={"backend": "wrong:8188"}))
            current = runs.get(initial.id)
            self.assertEqual("comfy-encoding", current.public_metadata["stage"])
            self.assertEqual(("original",), current.remote_refs)
            self.assertIsNone(current.public_metadata["progress_percent"])
            await runs.pause_active()

    async def test_legacy_workflow_executor_remains_compatible_without_progress_argument(self):
        async def legacy(payload, on_remote=None):
            return {"images": ["legacy.png"]}
        runtime = executor(legacy)._runtime
        progress = []
        completed = await runtime.execute_workflow("comfyui", {}, progress=progress.append)
        self.assertEqual("succeeded", completed.status)
        self.assertEqual([], progress)
