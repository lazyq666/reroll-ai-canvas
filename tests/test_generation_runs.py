import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from infinite_canvas.generation_runs import (
    Background,
    GenerationEffectPorts,
    GenerationRunConflict,
    GenerationRuns,
    ImageRun,
    Inline,
    PreparedGenerationOutput,
    ProviderGenerationExecutor,
    RecoveryRun,
    RunTarget,
    TextRun,
    VideoRun,
    WorkflowRun,
    WorkspaceGenerationEffects,
)
from infinite_canvas.providers.core import Completed, Pending, Queued
from infinite_canvas.providers.runtime import (
    ProviderOutput,
    TextStreamEvent,
    TextStreamEventKind,
    TextStreamOutput,
)
from infinite_canvas.connection_manager import ConnectionManager


class FakeGenerationAdapter:
    def __init__(self):
        self.calls = []
        self.release = None

    async def execute(self, request):
        self.calls.append(request)
        if self.release is not None:
            await self.release.wait()
        if isinstance(request, RecoveryRun):
            return Completed(
                ProviderOutput(
                    media=("recovered.png",),
                    legacy={"status": "succeeded", "images": ["recovered.png"]},
                )
            )
        return Completed(
            ProviderOutput(
                media=("generated.png",),
                legacy={"images": ["generated.png"]},
            )
        )

class PendingGenerationAdapter(FakeGenerationAdapter):
    async def execute(self, request):
        if isinstance(request, RecoveryRun):
            return await super().execute(request)
        self.calls.append(request)
        return Pending("remote-task-1", status="running")


class ProgressRecoverableAdapter(FakeGenerationAdapter):
    def __init__(self, *, block=False):
        super().__init__()
        self.block = block
        self.started = asyncio.Event()

    def is_restart_recoverable(self, request):
        return (
            isinstance(request, ImageRun)
            and request.settings.get("processor_id")
            == "depth-anything-v2-small"
        )

    async def execute(self, request, *, progress=None):
        self.calls.append(request)
        if progress:
            progress(
                {
                    "phase": "downloading-model",
                    "progress": 42,
                    "message": "正在下载模型 42%",
                }
            )
        self.started.set()
        if self.block:
            await asyncio.Event().wait()
        return Completed(
            ProviderOutput(
                media=("depth.png",),
                legacy={"images": ["depth.png"]},
            )
        )


class FakeGenerationEffects:
    def __init__(self):
        self.publications = []

    async def publish(self, run_id, request, output):
        self.publications.append((run_id, request, output))
        return output.legacy


class FailOnceGenerationEffects(FakeGenerationEffects):
    def __init__(self):
        super().__init__()
        self.failed = False

    async def publish(self, run_id, request, output):
        self.publications.append((run_id, request, output))
        if not self.failed:
            self.failed = True
            raise RuntimeError("publication interrupted")
        return output.legacy


class FakeTargetGuard:
    def __init__(self, current=True):
        self.current = current
        self.applied = []

    def validate(self, owner, target):
        del owner, target

    def is_current(self, owner, target):
        del owner, target
        return self.current

    async def apply_if_current(self, run_id, owner, target, result):
        if not self.current:
            return False
        self.applied.append((run_id, owner, target, result))
        return True


class GenerationRunsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = Path(self.temporary.name) / "generation-runs.json"

    def tearDown(self):
        self.temporary.cleanup()

    def runs(self, adapter, guard=None, effects=None):
        self.effects = effects or FakeGenerationEffects()
        return GenerationRuns(
            executor=adapter,
            effects=self.effects,
            store_path=lambda: self.store,
            target_guard=guard,
        )

    async def test_batch_recovery_materializes_string_image_urls(self):
        saved = []

        async def save_image(value, **_options):
            saved.append(value)
            return "/assets/output/recovered.png"

        root = Path(self.temporary.name)
        effects = WorkspaceGenerationEffects(GenerationEffectPorts(
            history_path=lambda: root / "history.json",
            journal_path=lambda: root / "effects.json",
            history_lock=__import__("threading").RLock(),
            save_image=save_image,
            image_meta=lambda url, source: {"url": url, "source": source},
            extract_images=lambda raw: list(raw.get("urls") or []),
            notify=lambda _record: None,
        ))
        remote_url = "https://provider.test/recovered.png"

        prepared = await effects.prepare(
            "run-recovered",
            ImageRun(
                prompt="recovered",
                settings={"provider_id": "jimeng", "model": "5.0"},
                publication="batch-generation",
            ),
            ProviderOutput(
                media=(remote_url,),
                raw={"status": "succeeded", "urls": [remote_url]},
                legacy={"status": "succeeded", "urls": [remote_url]},
            ),
        )

        self.assertEqual(
            [{"type": "url", "value": remote_url}], saved
        )
        self.assertEqual(
            ["/assets/output/recovered.png"], prepared.result["images"]
        )

    async def test_image_output_uses_materialized_file_and_retains_provider_source(self):
        saved = []
        materialized = []

        async def save_image(value, **_options):
            saved.append(value)
            return "/assets/output/provider-source.png"

        async def materialize(source_url, *, target_aspect_ratio, stable_id):
            materialized.append((source_url, target_aspect_ratio, stable_id))
            return "/assets/output/materialized.png"

        root = Path(self.temporary.name)
        effects = WorkspaceGenerationEffects(GenerationEffectPorts(
            history_path=lambda: root / "history.json",
            journal_path=lambda: root / "effects.json",
            history_lock=__import__("threading").RLock(),
            save_image=save_image,
            image_meta=lambda url, source: {"url": url, "source": source},
            extract_images=lambda raw: list(raw.get("urls") or []),
            notify=lambda _record: None,
            materialize_image=materialize,
        ))
        prepared = await effects.prepare(
            "run-cover",
            ImageRun(
                prompt="wide",
                settings={
                    "provider_id": "fake",
                    "model": "fake",
                    "target_aspect_ratio": "16:9",
                    "reference_aspect_ratio": "405:240",
                },
                publication="online-image",
            ),
            ProviderOutput(
                media=("https://provider.test/source.png",),
                raw={"urls": ["https://provider.test/source.png"]},
                legacy={"images": ["https://provider.test/source.png"]},
            ),
        )

        self.assertEqual(
            ["/assets/output/materialized.png"], prepared.canvas["images"]
        )
        self.assertEqual(
            ["/assets/output/provider-source.png"],
            prepared.result["provider_source_images"],
        )
        self.assertEqual(
            [("/assets/output/provider-source.png", "405:240", "run-cover_0")],
            materialized,
        )

    async def test_repair_batch_publication_materializes_legacy_success_once(self):
        class LegacyBatchAdapter:
            async def execute(self, request):
                del request
                return Completed(ProviderOutput(
                    media=({
                        "type": "url",
                        "value": "https://provider.test/legacy.png",
                    },),
                    legacy=(
                        {
                            "type": "url",
                            "value": "https://provider.test/legacy.png",
                        },
                        {"usage": {"images": 1}},
                    ),
                ))

        first = self.runs(LegacyBatchAdapter())
        legacy = await first.start(
            ImageRun(
                prompt="legacy batch",
                settings={"provider_id": "fake", "model": "fake"},
                publication="batch-generation",
            ),
            owner="designer-1",
            delivery=Inline(),
        )
        saved = []

        async def save_image(value, prefix="", stable_id=""):
            del prefix
            saved.append(value["value"])
            return f"/assets/output/{stable_id}.png"

        root = Path(self.temporary.name)
        effects = WorkspaceGenerationEffects(GenerationEffectPorts(
            history_path=lambda: root / "history.json",
            journal_path=lambda: root / "effects.json",
            history_lock=__import__("threading").RLock(),
            save_image=save_image,
            image_meta=lambda url, _source: {"url": url, "kind": "image"},
            extract_images=lambda raw: raw.get("images") or [],
            notify=lambda _record: None,
        ))
        restarted = GenerationRuns(
            executor=LegacyBatchAdapter(),
            effects=effects,
            store_path=lambda: self.store,
        )

        repaired = await restarted.repair_publication_outputs(
            "batch-generation"
        )
        repeated = await restarted.repair_publication_outputs(
            "batch-generation"
        )
        result = restarted.get(legacy.id, owner="designer-1").result

        self.assertEqual({"repaired": 1, "failed": {}}, repaired)
        self.assertEqual({"repaired": 0, "failed": {}}, repeated)
        self.assertEqual(
            [f"/assets/output/{legacy.id}_0.png"], result["images"]
        )
        self.assertEqual(
            ["https://provider.test/legacy.png"], saved
        )

    async def test_same_operation_and_request_submits_once(self):
        adapter = FakeGenerationAdapter()
        runs = self.runs(adapter)
        request = ImageRun(
            prompt="same",
            settings={"provider_id": "fake", "model": "fake"},
        )

        first = await runs.start(
            request,
            key="canvas:node:operation:0",
            owner="designer-1",
            delivery=Inline(),
        )
        duplicate = await runs.start(
            request,
            key="canvas:node:operation:0",
            owner="designer-1",
            delivery=Inline(),
        )

        self.assertEqual(first.id, duplicate.id)
        self.assertEqual(1, len(adapter.calls))
        self.assertEqual(1, len(self.effects.publications))
        self.assertEqual({"images": ["generated.png"]}, duplicate.result)

    async def test_same_operation_with_different_request_conflicts(self):
        adapter = FakeGenerationAdapter()
        runs = self.runs(adapter)
        await runs.start(
            ImageRun(prompt="first", settings={"provider_id": "fake"}),
            key="operation-1",
            owner="designer-1",
        )

        with self.assertRaises(GenerationRunConflict):
            await runs.start(
                ImageRun(prompt="changed", settings={"provider_id": "fake"}),
                key="operation-1",
                owner="designer-1",
            )

    async def test_two_intentional_runs_each_submit(self):
        adapter = FakeGenerationAdapter()
        runs = self.runs(adapter)
        request = ImageRun(prompt="same", settings={"provider_id": "fake"})

        first = await runs.start(request, key="operation-1", owner="designer-1")
        second = await runs.start(request, key="operation-2", owner="designer-1")

        self.assertNotEqual(first.id, second.id)
        self.assertEqual(2, len(adapter.calls))

    async def test_refresh_reads_persisted_run(self):
        adapter = FakeGenerationAdapter()
        first_process = self.runs(adapter)
        started = await first_process.start(
            ImageRun(prompt="persist", settings={"provider_id": "fake"}),
            key="operation-1",
            owner="designer-1",
        )

        refreshed = self.runs(FakeGenerationAdapter())
        loaded = refreshed.get(started.id, owner="designer-1")

        self.assertEqual("succeeded", loaded.status)
        self.assertEqual({"images": ["generated.png"]}, loaded.result)

    async def test_restart_resumes_by_query_without_resubmitting(self):
        first_adapter = PendingGenerationAdapter()
        first_process = self.runs(first_adapter)
        started = await first_process.start(
            ImageRun(
                prompt="paid submission",
                settings={"provider_id": "fake"},
                publication="history",
                effect_context={"journey": "canvas-image"},
            ),
            key="operation-1",
            owner="designer-1",
        )
        self.assertEqual("running", started.status)

        restarted_adapter = PendingGenerationAdapter()
        restarted = self.runs(restarted_adapter)
        self.assertEqual(1, restarted.active_count())
        linked = restarted.find_by_remote_ref(
            "remote-task-1",
            provider_id="fake",
            owner="designer-1",
        )
        self.assertEqual(started.id, linked.id)
        recovered = await restarted.resume(
            started.id,
            owner="designer-1",
        )

        self.assertEqual("succeeded", recovered.status)
        self.assertEqual(1, len(restarted_adapter.calls))
        self.assertIsInstance(restarted_adapter.calls[0], RecoveryRun)
        self.assertEqual("remote-task-1", restarted_adapter.calls[0].remote_ref)
        self.assertEqual(
            {"journey": "canvas-image"},
            dict(restarted_adapter.calls[0].effect_context),
        )
        published_request = self.effects.publications[0][1]
        self.assertIsInstance(published_request, ImageRun)
        self.assertEqual("history", published_request.publication)
        self.assertEqual(
            {"journey": "canvas-image"},
            dict(published_request.effect_context),
        )
        self.assertEqual(0, restarted.active_count())
        self.assertEqual(
            "succeeded",
            restarted.find_by_remote_ref(
                "remote-task-1",
                provider_id="fake",
                owner="designer-1",
            ).status,
        )

    async def test_jimeng_recovery_fails_when_remote_history_is_missing_for_too_long(self):
        now = [100.0]

        class MissingRemoteHistory:
            def __init__(self):
                self.recoveries = 0

            async def execute(self, request):
                if isinstance(request, RecoveryRun):
                    self.recoveries += 1
                    return Pending(
                        request.remote_ref,
                        status="pending",
                        raw=ProviderOutput(
                            legacy={
                                "status": "pending",
                                "submit_id": request.remote_ref,
                                "remote_history_missing": True,
                                "raw": {
                                    "submit_id": request.remote_ref,
                                    "gen_status": "querying",
                                },
                            }
                        ),
                    )
                return Pending("jimeng-orphan-1", status="running")

        adapter = MissingRemoteHistory()
        runs = GenerationRuns(
            executor=adapter,
            effects=FakeGenerationEffects(),
            store_path=lambda: self.store,
            now=lambda: now[0],
        )
        started = await runs.start(
            ImageRun(
                prompt="镜" * 1601,
                settings={"provider_id": "jimeng", "model": "5.0"},
            ),
            owner="designer-1",
        )
        self.assertEqual("running", started.status)

        now[0] += 1799
        waiting = await runs.resume(
            started.id,
            owner="designer-1",
        )
        self.assertEqual("pending", waiting.status)
        self.assertEqual(1, runs.active_count())

        now[0] += 2
        expired = await runs.resume(
            started.id,
            owner="designer-1",
        )

        self.assertEqual("failed", expired.status)
        self.assertIn("远端历史记录", expired.error)
        self.assertEqual(("jimeng-orphan-1",), expired.remote_refs)
        self.assertEqual(2, adapter.recoveries)
        self.assertEqual(0, runs.active_count())

    async def test_jimeng_batch_child_expires_when_remote_history_is_missing(self):
        now = [100.0]

        class MissingRemoteHistory:
            async def execute(self, request):
                remote_ref = (
                    request.remote_ref
                    if isinstance(request, RecoveryRun)
                    else "jimeng-batch-orphan-1"
                )
                return Pending(
                    remote_ref,
                    status="pending",
                    raw=ProviderOutput(
                        legacy={
                            "status": "pending",
                            "submit_id": remote_ref,
                            "remote_history_missing": True,
                            "raw": {
                                "submit_id": remote_ref,
                                "gen_status": "querying",
                            },
                        }
                    ),
                )

        runs = GenerationRuns(
            executor=MissingRemoteHistory(),
            effects=FakeGenerationEffects(),
            store_path=lambda: self.store,
            now=lambda: now[0],
        )
        started = await runs.start(
            ImageRun(
                prompt="batch pro image",
                settings={"provider_id": "jimeng", "model": "5.0Pro"},
                submission_count=2,
                publication="batch-generation",
            ),
            owner="designer-1",
        )
        self.assertEqual("pending", started.status)

        now[0] += 1801
        expired = await runs.resume(
            started.id,
            owner="designer-1",
        )

        self.assertEqual("failed", expired.status)
        self.assertIn("远端历史记录", expired.error)
        self.assertIn("5.0Pro", expired.error)
        self.assertEqual(("jimeng-batch-orphan-1",), expired.remote_refs)
        self.assertEqual(0, runs.active_count())

    async def test_remote_checkpoint_is_durable_before_poll_and_restart(self):
        class CrashAfterCheckpoint:
            def __init__(self, store):
                self.store = store
                self.submits = 0

            async def execute(self, request, checkpoint=None):
                self.submits += 1
                checkpoint(
                    Pending(
                        "paid-task-1",
                        raw={
                            "task_id": "paid-task-1",
                            "backend": "worker-1",
                        },
                    )
                )
                stored = json.loads(
                    self.store.read_text(encoding="utf-8")
                )["runs"][0]
                self.assert_durable = (
                    stored["remote_refs"] == ["paid-task-1"]
                    and stored["recoverable"] is True
                )
                raise RuntimeError("process died before first poll")

        crashing = CrashAfterCheckpoint(self.store)
        first = self.runs(crashing)
        with self.assertRaisesRegex(RuntimeError, "before first poll"):
            await first.start(
                ImageRun(
                    prompt="paid",
                    settings={"provider_id": "fake"},
                ),
                owner="designer-1",
            )
        self.assertTrue(crashing.assert_durable)

        recovered = self.runs(PendingGenerationAdapter())
        snapshot = next(
            item
            for item in json.loads(
                self.store.read_text(encoding="utf-8")
            )["runs"]
        )
        completed = await recovered.resume(
            snapshot["id"], owner="designer-1"
        )

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(1, crashing.submits)

    async def test_background_checkpoint_failure_starts_recovery_monitor(self):
        class ServiceUnavailable(Exception):
            status_code = 502
            detail = "provider query process exited"

        class CheckpointThenRecover:
            def __init__(self):
                self.submits = 0
                self.recoveries = 0

            async def execute(self, request, checkpoint=None):
                if isinstance(request, RecoveryRun):
                    self.recoveries += 1
                    return Completed(
                        ProviderOutput(
                            media=("recovered.png",),
                            legacy={"images": ["recovered.png"]},
                        )
                    )
                self.submits += 1
                checkpoint(Pending("paid-task-1", status="running"))
                raise ServiceUnavailable()

        adapter = CheckpointThenRecover()
        runs = self.runs(adapter)
        started = await runs.start(
            ImageRun(prompt="paid", settings={"provider_id": "fake"}),
            owner="designer-1",
            delivery=Background(),
        )

        for _ in range(30):
            completed = runs.get(started.id, owner="designer-1")
            if completed.status == "succeeded":
                break
            await asyncio.sleep(0)

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(1, adapter.submits)
        self.assertEqual(1, adapter.recoveries)

    async def test_background_resume_is_immediate_and_coalesced(self):
        first = self.runs(PendingGenerationAdapter())
        started = await first.start(
            ImageRun(prompt="x", settings={"provider_id": "fake"}),
            owner="designer-1",
        )
        recovery = PendingGenerationAdapter()
        recovery.release = asyncio.Event()
        restarted = self.runs(recovery)

        one = await restarted.resume(
            started.id,
            owner="designer-1",
            delivery=Background(),
        )
        two = await restarted.resume(
            started.id,
            owner="designer-1",
            delivery=Background(),
        )

        self.assertEqual("running", one.status)
        self.assertEqual("running", two.status)
        await asyncio.sleep(0)
        self.assertEqual(1, len(recovery.calls))
        recovery.release.set()
        await asyncio.sleep(0.01)
        self.assertEqual(
            "succeeded",
            restarted.get(started.id, owner="designer-1").status,
        )

    async def test_active_for_canvas_returns_only_targeted_active_runs(self):
        adapter = FakeGenerationAdapter()
        adapter.release = asyncio.Event()
        runs = self.runs(adapter)
        first = await runs.start(
            VideoRun(payload=SimpleNamespace(provider_id="jimeng")),
            owner="designer-1",
            delivery=Background(),
            target=RunTarget(
                canvas_id="canvas-1",
                node_id="node-1",
                operation_id="operation-1",
            ),
        )
        await runs.start(
            VideoRun(payload=SimpleNamespace(provider_id="jimeng")),
            owner="designer-1",
            delivery=Background(),
            target=RunTarget(
                canvas_id="canvas-2",
                node_id="node-2",
                operation_id="operation-2",
            ),
        )
        await asyncio.sleep(0)

        active = runs.active_for_canvas("canvas-1")

        self.assertEqual([first.id], [run.id for run in active])
        self.assertEqual("node-1", active[0].target.node_id)
        self.assertEqual("operation-1", active[0].target.operation_id)
        adapter.release.set()
        await asyncio.sleep(0.01)
        self.assertEqual((), runs.active_for_canvas("canvas-1"))

    async def test_restart_never_recovers_child_without_remote_ref(self):
        class ProcessEnded(BaseException):
            pass

        class CrashDuringChildSubmit:
            def requires_child_attempts(self, _request):
                return True

            async def execute(self, _request, checkpoint=None):
                del checkpoint
                raise ProcessEnded("crash before provider checkpoint")

        crashing = self.runs(CrashDuringChildSubmit())
        with self.assertRaises(ProcessEnded):
            await crashing.start(
                ImageRun(
                    prompt="batch",
                    settings={"provider_id": "fake"},
                    count=2,
                ),
                owner="designer-1",
            )
        stored = json.loads(
            self.store.read_text(encoding="utf-8")
        )["runs"][0]
        self.assertEqual(
            {
                "index": 0,
                "status": "submitting",
                "remote_ref": "",
            },
            stored["child_attempts"][0],
        )

        adapter = FakeGenerationAdapter()
        restarted = self.runs(adapter)
        failed = restarted.get(
            stored["id"], owner="designer-1"
        )
        resumed = await restarted.resume_active()

        self.assertEqual("failed", failed.status)
        self.assertIn("不会自动重提", failed.error)
        self.assertEqual((), resumed)
        self.assertEqual([], adapter.calls)

    async def test_child_checkpoint_crash_recovers_paid_ref_without_resubmit(self):
        class ProcessEnded(BaseException):
            pass

        class CrashAfterChildCheckpoint:
            def __init__(self):
                self.submits = 0

            def requires_child_attempts(self, _request):
                return True

            async def execute(self, request, checkpoint=None):
                self.submits += 1
                checkpoint(
                    Pending("paid-child-1", status="pending")
                )
                raise ProcessEnded(
                    f"crash after checkpoint for {request.prompt}"
                )

        initial = CrashAfterChildCheckpoint()
        first = self.runs(initial)
        with self.assertRaises(ProcessEnded):
            await first.start(
                ImageRun(
                    prompt="first",
                    prompts=("first", "second"),
                    settings={"provider_id": "fake"},
                    count=2,
                ),
                owner="designer-1",
            )
        stored = json.loads(
            self.store.read_text(encoding="utf-8")
        )["runs"][0]
        self.assertEqual("pending", stored["child_attempts"][0]["status"])
        self.assertEqual(
            "paid-child-1",
            stored["child_attempts"][0]["remote_ref"],
        )

        class RecoveryThenSecond:
            def __init__(self):
                self.recoveries = []
                self.submits = []

            def requires_child_attempts(self, _request):
                return True

            async def execute(self, request, checkpoint=None):
                del checkpoint
                if isinstance(request, RecoveryRun):
                    self.recoveries.append(request.remote_ref)
                    return Completed(
                        ProviderOutput(
                            media=("first.png",),
                            legacy={"images": ["first.png"]},
                        )
                    )
                self.submits.append(request.prompt)
                return Completed(
                    ProviderOutput(
                        media=("second.png",),
                        legacy={"images": ["second.png"]},
                    )
                )

        adapter = RecoveryThenSecond()
        restarted = self.runs(adapter)
        completed = await restarted.resume(
            stored["id"], owner="designer-1"
        )

        self.assertEqual(1, initial.submits)
        self.assertEqual(["paid-child-1"], adapter.recoveries)
        self.assertEqual(["second"], adapter.submits)
        self.assertEqual("succeeded", completed.status)
        self.assertEqual(
            (
                {"images": ["first.png"]},
                {"images": ["second.png"]},
            ),
            completed.result,
        )

    async def test_startup_monitor_requeries_pending_remote_until_terminal(self):
        first = self.runs(PendingGenerationAdapter())
        started = await first.start(
            ImageRun(prompt="x", settings={"provider_id": "fake"}),
            owner="designer-1",
        )

        class TwoPollRecovery(FakeGenerationAdapter):
            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                if len(self.calls) == 1:
                    return Pending(
                        request.remote_ref,
                        status="pending",
                    )
                return Completed(
                    ProviderOutput(
                        media=("recovered.png",),
                        legacy={"images": ["recovered.png"]},
                    )
                )

        recovery = TwoPollRecovery()
        restarted = self.runs(recovery)
        original_sleep = asyncio.sleep

        async def no_delay(_seconds):
            await original_sleep(0)

        with mock.patch(
            "infinite_canvas.generation_runs.asyncio.sleep",
            new=no_delay,
        ):
            resumed = await restarted.resume_active()
            for _ in range(20):
                if restarted.get(
                    started.id, owner="designer-1"
                ).status == "succeeded":
                    break
                await original_sleep(0)

        self.assertEqual("running", resumed[0].status)
        self.assertEqual(2, len(recovery.calls))
        self.assertEqual(
            "succeeded",
            restarted.get(started.id, owner="designer-1").status,
        )

    async def test_graceful_shutdown_pauses_then_startup_resumes_without_resubmit(self):
        class SubmittedThenBlocked:
            def __init__(self):
                self.submits = 0
                self.checkpointed = asyncio.Event()

            async def execute(self, _request, checkpoint=None):
                self.submits += 1
                checkpoint(
                    Pending("paid-task-1", status="pending")
                )
                self.checkpointed.set()
                await asyncio.Event().wait()

        submitting = SubmittedThenBlocked()
        first = self.runs(submitting)
        started = await first.start(
            ImageRun(prompt="paid", settings={"provider_id": "fake"}),
            owner="designer-1",
            delivery=Background(),
        )
        await submitting.checkpointed.wait()
        await first.pause_active()

        paused = json.loads(
            self.store.read_text(encoding="utf-8")
        )["runs"][0]
        self.assertIn(paused["status"], {"running", "pending"})
        self.assertNotEqual("cancelled", paused["status"])
        self.assertEqual(["paid-task-1"], paused["remote_refs"])

        recovery = PendingGenerationAdapter()
        restarted = self.runs(recovery)
        await restarted.resume_active()
        for _ in range(20):
            terminal = restarted.get(
                started.id, owner="designer-1"
            )
            if terminal.status == "succeeded":
                break
            await asyncio.sleep(0)

        self.assertEqual(1, submitting.submits)
        self.assertEqual(1, len(recovery.calls))
        self.assertIsInstance(recovery.calls[0], RecoveryRun)
        self.assertEqual("paid-task-1", recovery.calls[0].remote_ref)
        self.assertEqual("succeeded", terminal.status)

    async def test_startup_credential_failure_does_not_block_other_runs(self):
        class Initial:
            async def execute(self, request, checkpoint=None):
                del checkpoint
                return Pending(
                    f"task-{request.payload['name']}",
                    status="pending",
                )

        first = self.runs(Initial())
        bad = await first.start(
            WorkflowRun(
                "modelscope-angle",
                {"name": "bad", "api_key": "one-time"},
                provider_id="modelscope",
            ),
            owner="designer-1",
        )
        good = await first.start(
            WorkflowRun(
                "modelscope-angle",
                {"name": "good", "api_key": "configured-later"},
                provider_id="modelscope",
            ),
            owner="designer-1",
        )

        class MissingCredential(Exception):
            status_code = 400
            detail = "未提供 ModelScope API Key"

        class Recovery:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                if request.payload.task_id == "task-bad":
                    raise MissingCredential()
                return Completed(
                    ProviderOutput(
                        media=("good.png",),
                        legacy={"images": ["good.png"]},
                    )
                )

        recovery = Recovery()
        restarted = self.runs(recovery)
        await restarted.resume_active()
        for _ in range(20):
            bad_state = restarted.get(bad.id, owner="designer-1")
            good_state = restarted.get(good.id, owner="designer-1")
            if (
                bad_state.status == "failed"
                and good_state.status == "succeeded"
            ):
                break
            await asyncio.sleep(0)

        self.assertEqual("failed", bad_state.status)
        self.assertIn("恢复任务缺少", bad_state.error)
        self.assertEqual("succeeded", good_state.status)
        self.assertEqual(2, len(recovery.calls))

    async def test_startup_permanent_404_fails_without_blocking_other_runs(self):
        class Initial:
            def __init__(self):
                self.submits = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.submits.append(request.prompt)
                return Pending(
                    f"task-{request.prompt}", status="pending"
                )

        initial = Initial()
        first = self.runs(initial)
        missing = await first.start(
            ImageRun(
                prompt="missing",
                settings={"provider_id": "fake"},
            ),
            owner="designer-1",
        )
        healthy = await first.start(
            ImageRun(
                prompt="healthy",
                settings={"provider_id": "fake"},
            ),
            owner="designer-1",
        )

        class TaskNotFound(Exception):
            status_code = 404
            detail = "remote task not found"

        class Recovery:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                if request.remote_ref == "task-missing":
                    raise TaskNotFound()
                return Completed(
                    ProviderOutput(
                        media=("healthy.png",),
                        legacy={"images": ["healthy.png"]},
                    )
                )

        recovery = Recovery()
        restarted = self.runs(recovery)
        await restarted.resume_active()
        for _ in range(20):
            missing_state = restarted.get(
                missing.id, owner="designer-1"
            )
            healthy_state = restarted.get(
                healthy.id, owner="designer-1"
            )
            if (
                missing_state.status == "failed"
                and healthy_state.status == "succeeded"
            ):
                break
            await asyncio.sleep(0)

        self.assertEqual("failed", missing_state.status)
        self.assertEqual(404, missing_state.status_code)
        self.assertEqual("remote task not found", missing_state.error)
        self.assertFalse(missing_state.recoverable)
        self.assertEqual("succeeded", healthy_state.status)
        self.assertEqual(0, restarted.active_count())
        self.assertEqual(["missing", "healthy"], initial.submits)
        self.assertEqual(2, len(recovery.calls))
        self.assertTrue(
            all(
                isinstance(request, RecoveryRun)
                for request in recovery.calls
            )
        )

    async def test_startup_transient_recovery_error_retries_then_succeeds(self):
        initial = self.runs(PendingGenerationAdapter())
        pending = await initial.start(
            ImageRun(prompt="x", settings={"provider_id": "fake"}),
            owner="designer-1",
        )

        class ServiceUnavailable(Exception):
            status_code = 503
            detail = "provider temporarily unavailable"

        class Recovery:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                if len(self.calls) == 1:
                    raise ServiceUnavailable()
                return Completed(
                    ProviderOutput(
                        media=("recovered.png",),
                        legacy={"images": ["recovered.png"]},
                    )
                )

        recovery = Recovery()
        restarted = self.runs(recovery)
        original_sleep = asyncio.sleep

        async def no_delay(_seconds):
            await original_sleep(0)

        with mock.patch(
            "infinite_canvas.generation_runs.asyncio.sleep",
            new=no_delay,
        ):
            await restarted.resume_active()
            for _ in range(20):
                completed = restarted.get(
                    pending.id, owner="designer-1"
                )
                if completed.status == "succeeded":
                    break
                await original_sleep(0)

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(2, len(recovery.calls))
        self.assertTrue(
            all(
                isinstance(request, RecoveryRun)
                and request.remote_ref == "remote-task-1"
                for request in recovery.calls
            )
        )

    async def test_recovery_contract_error_is_terminal(self):
        initial = self.runs(PendingGenerationAdapter())
        pending = await initial.start(
            ImageRun(prompt="x", settings={"provider_id": "fake"}),
            owner="designer-1",
        )

        class InvalidRecovery:
            async def execute(self, request, checkpoint=None):
                del request, checkpoint
                raise RuntimeError("invalid recovery response")

        restarted = self.runs(InvalidRecovery())
        with self.assertRaisesRegex(
            RuntimeError, "invalid recovery response"
        ):
            await restarted.resume(
                pending.id, owner="designer-1"
            )
        failed = restarted.get(
            pending.id, owner="designer-1"
        )

        self.assertEqual("failed", failed.status)
        self.assertEqual("invalid recovery response", failed.error)
        self.assertFalse(failed.recoverable)
        self.assertEqual(0, restarted.active_count())

    async def test_fresh_recovery_run_retries_transient_with_same_run(self):
        class ServiceUnavailable(Exception):
            status_code = 503
            detail = "temporarily unavailable"

        class Adapter:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                if len(self.calls) == 1:
                    raise ServiceUnavailable()
                return Completed(
                    ProviderOutput(
                        media=("done.png",),
                        legacy={"images": ["done.png"]},
                    )
                )

        adapter = Adapter()
        runs = self.runs(adapter)
        request = RecoveryRun("fake", "fresh-task-1")
        with self.assertRaises(ServiceUnavailable):
            await runs.start(
                request,
                key="fresh-recovery:fresh-task-1",
                owner="designer-1",
            )
        linked = runs.find_by_remote_ref(
            "fresh-task-1",
            provider_id="fake",
            owner="designer-1",
        )
        completed = await runs.resume(
            linked.id, owner="designer-1"
        )

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(2, len(adapter.calls))
        self.assertEqual(
            [request, request],
            adapter.calls,
        )
        self.assertEqual(
            linked.id,
            runs.find_by_remote_ref(
                "fresh-task-1",
                provider_id="fake",
                owner="designer-1",
            ).id,
        )

    async def test_fresh_workflow_recovery_retries_transient_with_same_run(self):
        class ServiceUnavailable(Exception):
            status_code = 503
            detail = "temporarily unavailable"

        class Adapter:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                if len(self.calls) == 1:
                    raise ServiceUnavailable()
                return Completed(
                    ProviderOutput(
                        media=("done.png",),
                        legacy={
                            "status": "SUCCESS",
                            "taskId": "runninghub-fresh-1",
                            "urls": ["done.png"],
                        },
                    )
                )

        adapter = Adapter()
        runs = self.runs(adapter)
        request = WorkflowRun(
            "runninghub-query",
            {"taskId": "runninghub-fresh-1", "useWallet": True},
            provider_id="runninghub",
        )
        with self.assertRaises(ServiceUnavailable):
            await runs.start(
                request,
                key="runninghub-recovery:runninghub-fresh-1",
                owner="designer-1",
            )
        linked = runs.find_by_remote_ref(
            "runninghub-fresh-1",
            provider_id="runninghub",
            owner="designer-1",
        )
        completed = await runs.resume(
            linked.id, owner="designer-1"
        )

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(2, len(adapter.calls))
        self.assertTrue(
            all(
                isinstance(call, WorkflowRun)
                and call.operation == "runninghub-query"
                for call in adapter.calls
            )
        )
        self.assertEqual(
            {
                "taskId": "runninghub-fresh-1",
                "useWallet": True,
            },
            adapter.calls[1].payload,
        )

    async def test_fresh_recovery_404_is_terminal_and_sticky(self):
        class TaskNotFound(Exception):
            status_code = 404
            detail = "remote task not found"

        class Adapter:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                raise TaskNotFound()

        adapter = Adapter()
        runs = self.runs(adapter)
        request = RecoveryRun("fake", "missing-fresh-task")
        with self.assertRaises(TaskNotFound):
            await runs.start(
                request,
                key="fresh-recovery:missing-fresh-task",
                owner="designer-1",
            )
        linked = runs.find_by_remote_ref(
            "missing-fresh-task",
            provider_id="fake",
            owner="designer-1",
        )
        repeated_resume = await runs.resume(
            linked.id, owner="designer-1"
        )
        repeated_start = await runs.start(
            request,
            key="fresh-recovery:missing-fresh-task",
            owner="designer-1",
        )

        self.assertEqual("failed", linked.status)
        self.assertFalse(linked.recoverable)
        self.assertEqual("failed", repeated_resume.status)
        self.assertEqual("failed", repeated_start.status)
        self.assertTrue(repeated_start.deduplicated)
        self.assertEqual(1, len(adapter.calls))

    async def test_stream_is_not_succeeded_until_complete_event_is_consumed(self):
        class StreamAdapter:
            async def execute(self, _request, checkpoint=None):
                del checkpoint

                async def events():
                    yield TextStreamEvent(
                        TextStreamEventKind.DELTA, delta="hello"
                    )
                    yield TextStreamEvent(
                        TextStreamEventKind.COMPLETE
                    )

                return Completed(
                    TextStreamOutput(model="fake", events=events())
                )

        class StreamEffects(FakeGenerationEffects):
            async def publish_typed(self, _run_id, _request, output):
                return output

        runs = self.runs(StreamAdapter(), effects=StreamEffects())
        started = await runs.start(
            TextRun(payload={}, stream=True),
            owner="designer-1",
        )
        self.assertEqual("running", started.status)

        events = [event async for event in started.result.events]

        self.assertEqual(2, len(events))
        self.assertEqual(
            "succeeded",
            runs.get(started.id, owner="designer-1").status,
        )

    async def test_stream_error_and_missing_complete_are_failed(self):
        class StreamEffects(FakeGenerationEffects):
            async def publish_typed(self, _run_id, _request, output):
                return output

        for events, expected in (
            (
                [
                    TextStreamEvent(
                        TextStreamEventKind.ERROR, detail="upstream broke"
                    )
                ],
                "upstream broke",
            ),
            (
                [
                    TextStreamEvent(
                        TextStreamEventKind.DELTA, delta="partial"
                    )
                ],
                "完成事件前中断",
            ),
        ):
            with self.subTest(expected=expected):
                class Adapter:
                    async def execute(self, _request, checkpoint=None):
                        del checkpoint

                        async def source():
                            for event in events:
                                yield event

                        return Completed(
                            TextStreamOutput(
                                model="fake", events=source()
                            )
                        )

                runs = self.runs(Adapter(), effects=StreamEffects())
                started = await runs.start(
                    TextRun(payload={}, stream=True),
                    owner="designer-1",
                )
                _ = [event async for event in started.result.events]
                failed = runs.get(
                    started.id, owner="designer-1"
                )
                self.assertEqual("failed", failed.status)
                self.assertIn(expected, failed.error)

    async def test_stream_route_early_return_closes_tracked_iterator(self):
        class StreamAdapter:
            async def execute(self, _request, checkpoint=None):
                del checkpoint

                async def source():
                    yield TextStreamEvent(
                        TextStreamEventKind.ERROR,
                        detail="upstream rejected request",
                    )
                    await asyncio.Event().wait()

                return Completed(
                    TextStreamOutput(model="fake", events=source())
                )

        class StreamEffects(FakeGenerationEffects):
            async def publish_typed(self, _run_id, _request, output):
                return output

        runs = self.runs(StreamAdapter(), effects=StreamEffects())
        started = await runs.start(
            TextRun(payload={}, stream=True),
            owner="designer-1",
        )
        iterator = started.result.events

        async def consume_like_route():
            try:
                async for event in iterator:
                    if event.kind is TextStreamEventKind.ERROR:
                        return
            finally:
                await iterator.aclose()

        await consume_like_route()
        failed = runs.get(started.id, owner="designer-1")

        self.assertEqual("failed", failed.status)
        self.assertIn("upstream rejected request", failed.error)
        self.assertNotIn(started.id, runs._owners)

    async def test_stream_disconnect_and_restart_never_project_success(self):
        class StreamAdapter:
            async def execute(self, _request, checkpoint=None):
                del checkpoint

                async def source():
                    yield TextStreamEvent(
                        TextStreamEventKind.DELTA, delta="partial"
                    )
                    await asyncio.Event().wait()

                return Completed(
                    TextStreamOutput(model="fake", events=source())
                )

        class StreamEffects(FakeGenerationEffects):
            async def publish_typed(self, _run_id, _request, output):
                return output

        runs = self.runs(StreamAdapter(), effects=StreamEffects())
        started = await runs.start(
            TextRun(payload={}, stream=True),
            owner="designer-1",
        )
        iterator = started.result.events
        await anext(iterator)
        await iterator.aclose()
        disconnected = runs.get(
            started.id, owner="designer-1"
        )
        self.assertNotEqual("succeeded", disconnected.status)

        another = self.runs(StreamAdapter(), effects=StreamEffects())
        open_stream = await another.start(
            TextRun(payload={}, stream=True),
            owner="designer-1",
        )
        restarted = self.runs(
            StreamAdapter(), effects=StreamEffects()
        )
        interrupted = restarted.get(
            open_stream.id, owner="designer-1"
        )
        self.assertEqual("failed", interrupted.status)
        self.assertIn("流式生成", interrupted.error)

    async def test_runninghub_remote_query_finishes_original_run_once(self):
        class Adapter:
            def __init__(self, pending=True):
                self.pending = pending
                self.calls = []

            async def execute(self, request):
                self.calls.append(request)
                if self.pending:
                    return Pending("runninghub-task-1", status="running")
                return Completed(
                    ProviderOutput(
                        media=("result.png",),
                        legacy={
                            "status": "SUCCESS",
                            "taskId": "runninghub-task-1",
                            "urls": ["result.png"],
                        },
                    )
                )

        first = self.runs(Adapter())
        started = await first.start(
            WorkflowRun(
                "runninghub-submit",
                {"useWallet": True},
                provider_id="runninghub",
                publication="history",
            ),
            owner="designer-1",
        )

        recovery_adapter = Adapter(pending=False)
        restarted = self.runs(recovery_adapter)
        linked = restarted.find_by_remote_ref(
            "runninghub-task-1",
            provider_id="runninghub",
            owner="designer-1",
        )
        completed = await restarted.resume(
            linked.id,
            owner="designer-1",
        )
        terminal = restarted.find_by_remote_ref(
            "runninghub-task-1",
            provider_id="runninghub",
            owner="designer-1",
        )
        repeated = await restarted.resume(
            terminal.id,
            owner="designer-1",
        )

        self.assertEqual(started.id, linked.id)
        self.assertEqual("succeeded", completed.status)
        self.assertEqual("succeeded", repeated.status)
        self.assertEqual(0, restarted.active_count())
        self.assertEqual(1, len(recovery_adapter.calls))
        recovery = recovery_adapter.calls[0]
        self.assertIsInstance(recovery, WorkflowRun)
        self.assertEqual("runninghub-query", recovery.operation)
        self.assertEqual(
            {"taskId": "runninghub-task-1", "useWallet": True},
            recovery.payload,
        )
        self.assertEqual(1, len(self.effects.publications))
        published = self.effects.publications[0][1]
        self.assertEqual("runninghub-submit", published.operation)

    async def test_angle_remote_poll_finishes_original_run_once(self):
        class Adapter:
            def __init__(self, pending=True):
                self.pending = pending
                self.calls = []

            async def execute(self, request):
                self.calls.append(request)
                if self.pending:
                    return Pending("angle-task-1", status="pending")
                return Completed(
                    ProviderOutput(
                        media=("angle.png",),
                        legacy={"url": "angle.png"},
                    )
                )

        first = self.runs(Adapter())
        started = await first.start(
            WorkflowRun(
                "modelscope-angle",
                {
                    "api_key": "test-key",
                    "client_id": "client-1",
                },
                publication="history",
            ),
            owner="designer-1",
        )

        recovery_adapter = Adapter(pending=False)
        restarted = self.runs(recovery_adapter)
        linked = restarted.find_by_remote_ref(
            "angle-task-1",
            owner="designer-1",
        )
        completed = await restarted.resume(
            linked.id,
            owner="designer-1",
        )

        self.assertEqual(started.id, linked.id)
        self.assertEqual("succeeded", completed.status)
        self.assertEqual(0, restarted.active_count())
        self.assertEqual(1, len(recovery_adapter.calls))
        recovery = recovery_adapter.calls[0]
        self.assertIsInstance(recovery, WorkflowRun)
        self.assertEqual("modelscope-angle-recovery", recovery.operation)
        self.assertEqual("angle-task-1", recovery.payload.task_id)
        self.assertEqual("", recovery.payload.api_key)
        stored_text = self.store.read_text(encoding="utf-8")
        self.assertNotIn("test-key", stored_text)
        self.assertIn("[redacted]", stored_text)
        self.assertEqual(1, len(self.effects.publications))
        published = self.effects.publications[0][1]
        self.assertEqual("modelscope-angle", published.operation)

    async def test_persistent_store_redacts_nested_credentials(self):
        class PendingWorkflow:
            async def execute(self, request, checkpoint=None):
                self.request = request
                checkpoint(
                    Pending(
                        "secret-task-1",
                        status="pending",
                        raw={"authorization": "Bearer provider-secret"},
                    )
                )
                return Pending(
                    "secret-task-1",
                    status="pending",
                    raw={"accessToken": "provider-access-token"},
                )

        payload = SimpleNamespace(
            api_key="one-time-api-key",
            nested={
                "clientSecret": "client-secret",
                "items": [
                    {"password": "password-value"},
                    {"Authorization": "Bearer nested-secret"},
                ],
            },
        )
        adapter = PendingWorkflow()
        runs = self.runs(adapter)
        started = await runs.start(
            WorkflowRun("modelscope-angle", payload),
            owner="designer-1",
        )

        stored = self.store.read_text(encoding="utf-8")
        self.assertEqual("pending", started.status)
        for secret in (
            "one-time-api-key",
            "provider-secret",
            "provider-access-token",
            "client-secret",
            "password-value",
            "nested-secret",
        ):
            self.assertNotIn(secret, stored)
        self.assertGreaterEqual(stored.count("[redacted]"), 5)
        self.assertEqual("one-time-api-key", adapter.request.payload.api_key)

    async def test_jimeng_video_recovery_preserves_media_kind(self):
        class Adapter:
            def __init__(self, pending=True):
                self.pending = pending
                self.calls = []

            async def execute(self, request):
                self.calls.append(request)
                if self.pending:
                    return Queued(
                        "jimeng-video-1",
                        status="jimeng_pending",
                    )
                return Completed(
                    ProviderOutput(
                        media=("video.mp4",),
                        metadata={"media_kind": "video"},
                        legacy={
                            "status": "succeeded",
                            "submit_id": "jimeng-video-1",
                            "kind": "video",
                            "urls": ["video.mp4"],
                        },
                    )
                )

        target = RunTarget(
            canvas_id="canvas-1",
            node_id="node-1",
            operation_id="operation-1",
        )
        first = self.runs(Adapter())
        started = await first.start(
            VideoRun(payload=SimpleNamespace(provider_id="jimeng")),
            owner="designer-1",
            target=target,
        )

        guard = FakeTargetGuard()
        recovery_adapter = Adapter(pending=False)
        restarted = self.runs(recovery_adapter, guard=guard)
        linked = restarted.find_by_remote_ref(
            "jimeng-video-1",
            provider_id="jimeng",
            owner="designer-1",
        )
        completed = await restarted.resume(
            linked.id,
            owner="designer-1",
        )

        self.assertEqual(started.id, linked.id)
        self.assertEqual("succeeded", completed.status)
        recovery = recovery_adapter.calls[0]
        self.assertIsInstance(recovery, RecoveryRun)
        self.assertEqual("video", recovery.media_kind)
        self.assertEqual(
            {"videos": ["video.mp4"]},
            guard.applied[0][3],
        )

    async def test_remote_reference_lookup_is_scoped_by_provider(self):
        class Adapter:
            async def execute(self, _request):
                return Pending("shared-task-id", status="running")

        runs = self.runs(Adapter())
        jimeng = await runs.start(
            ImageRun(
                prompt="jimeng",
                settings={"provider_id": "jimeng"},
            ),
            owner="designer-1",
        )
        modelscope = await runs.start(
            WorkflowRun(
                "modelscope-angle",
                {},
                provider_id="modelscope",
            ),
            owner="designer-1",
        )

        self.assertEqual(
            jimeng.id,
            runs.find_by_remote_ref(
                "shared-task-id",
                provider_id="jimeng",
                owner="designer-1",
            ).id,
        )
        self.assertEqual(
            modelscope.id,
            runs.find_by_remote_ref(
                "shared-task-id",
                provider_id="modelscope",
                owner="designer-1",
            ).id,
        )

    async def test_concurrent_resume_waits_for_the_same_recovery(self):
        first_process = self.runs(PendingGenerationAdapter())
        started = await first_process.start(
            ImageRun(
                prompt="paid submission",
                settings={"provider_id": "fake"},
            ),
            owner="designer-1",
        )
        restarted_adapter = PendingGenerationAdapter()
        restarted_adapter.release = asyncio.Event()
        restarted = self.runs(restarted_adapter)

        first = asyncio.create_task(
            restarted.resume(started.id, owner="designer-1")
        )
        while not restarted_adapter.calls:
            await asyncio.sleep(0)
        second = asyncio.create_task(
            restarted.resume(started.id, owner="designer-1")
        )
        await asyncio.sleep(0)
        restarted_adapter.release.set()
        recovered = await asyncio.wait_for(
            asyncio.gather(first, second),
            timeout=1,
        )

        self.assertEqual(["succeeded", "succeeded"], [
            item.status for item in recovered
        ])
        self.assertEqual(1, len(restarted_adapter.calls))

    async def test_provider_output_is_durable_before_effects_and_replayed(self):
        effects = FailOnceGenerationEffects()
        first_adapter = FakeGenerationAdapter()
        first_process = self.runs(first_adapter, effects=effects)

        with self.assertRaisesRegex(
            RuntimeError,
            "publication interrupted",
        ):
            await first_process.start(
                ImageRun(
                    prompt="paid output",
                    settings={"provider_id": "fake"},
                    publication="history",
                ),
                key="operation-1",
                owner="designer-1",
            )

        stored = json.loads(self.store.read_text(encoding="utf-8"))["runs"][0]
        self.assertEqual("output_prepared", stored["phase"])
        self.assertEqual(
            {"images": ["generated.png"]},
            stored["provider_output"]["legacy"],
        )
        self.assertEqual(
            {"images": ["generated.png"]},
            stored["prepared_output"]["result"],
        )

        restarted_adapter = FakeGenerationAdapter()
        restarted = self.runs(
            restarted_adapter,
            effects=FakeGenerationEffects(),
        )
        recovered = await restarted.resume(
            stored["id"],
            owner="designer-1",
        )

        self.assertEqual("succeeded", recovered.status)
        self.assertEqual({"images": ["generated.png"]}, recovered.result)
        self.assertEqual([], restarted_adapter.calls)

    async def test_recovery_output_replays_effect_failure_without_requery(self):
        initial = self.runs(PendingGenerationAdapter())
        pending = await initial.start(
            ImageRun(
                prompt="recover once",
                settings={
                    "provider_id": "fake",
                    "target_aspect_ratio": "16:9",
                    "reference_aspect_ratio": "405:240",
                },
                publication="history",
            ),
            owner="designer-1",
        )
        class FailOncePreparedEffects:
            def __init__(self):
                self.publications = []

            async def prepare(self, _run_id, _request, output):
                return PreparedGenerationOutput(result=output.legacy)

            async def publish_prepared(
                self, run_id, request, prepared
            ):
                self.publications.append((run_id, request, prepared))
                if len(self.publications) == 1:
                    raise RuntimeError("publication interrupted")
                return prepared.result

        effects = FailOncePreparedEffects()
        recovery = PendingGenerationAdapter()
        restarted = self.runs(recovery, effects=effects)

        with self.assertRaisesRegex(
            RuntimeError, "publication interrupted"
        ):
            await restarted.resume(
                pending.id, owner="designer-1"
            )

        interrupted = restarted.get(
            pending.id, owner="designer-1"
        )
        self.assertEqual("running", interrupted.status)
        self.assertTrue(interrupted.recoverable)
        self.assertEqual(1, len(recovery.calls))
        self.assertIsInstance(recovery.calls[0], RecoveryRun)
        stored = json.loads(
            self.store.read_text(encoding="utf-8")
        )["runs"][0]
        self.assertEqual("output_prepared", stored["phase"])

        class NoSecondQuery:
            async def execute(self, _request, checkpoint=None):
                del checkpoint
                raise AssertionError("durable output must be replayed")

        replayed = self.runs(NoSecondQuery(), effects=effects)
        completed = await replayed.resume(
            pending.id, owner="designer-1"
        )

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(
            {"status": "succeeded", "images": ["recovered.png"]},
            completed.result,
        )
        self.assertEqual(2, len(effects.publications))
        replayed_request = effects.publications[1][1]
        self.assertEqual(
            "16:9", replayed_request.settings["target_aspect_ratio"]
        )
        self.assertEqual(
            "405:240",
            replayed_request.settings["reference_aspect_ratio"],
        )

    async def test_prepared_local_output_replays_without_saving_again(self):
        order = []
        save_calls = []
        history = Path(self.temporary.name) / "history.json"
        journal = Path(self.temporary.name) / "effects.json"

        async def save_image(value, prefix="", stable_id=""):
            save_calls.append((value, prefix, stable_id))
            order.append("output")
            return "/assets/output/final.png"

        async def notify(record):
            del record
            order.append("notify")

        effects = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                history_path=lambda: history,
                journal_path=lambda: journal,
                history_lock=__import__("threading").RLock(),
                save_image=save_image,
                image_meta=lambda url, _source: {
                    "url": url,
                    "kind": "image",
                },
                extract_images=lambda _raw: [],
                notify=notify,
            )
        )
        publish_history = effects._publication.publish_history

        async def ordered_history(run_id, record):
            order.append("history")
            await publish_history(run_id, record)

        effects._publication.publish_history = ordered_history

        class InterruptingGuard(FakeTargetGuard):
            def __init__(self):
                super().__init__()
                self.interrupted = False

            async def apply_if_current(
                self, run_id, owner, target, result
            ):
                order.append("canvas")
                self.applied.append((run_id, owner, target, result))
                if not self.interrupted:
                    self.interrupted = True
                    raise RuntimeError("canvas interrupted")
                return True

        guard = InterruptingGuard()
        first_adapter = FakeGenerationAdapter()
        first = self.runs(first_adapter, guard=guard, effects=effects)
        target = RunTarget(
            canvas_id="canvas-1",
            node_id="node-1",
            operation_id="operation-1",
        )
        with self.assertRaisesRegex(RuntimeError, "canvas interrupted"):
            await first.start(
                ImageRun(
                    prompt="local first",
                    settings={"provider_id": "fake"},
                    publication="history",
                ),
                owner="designer-1",
                target=target,
            )
        stored = json.loads(self.store.read_text(encoding="utf-8"))["runs"][0]
        self.assertEqual("output_prepared", stored["phase"])
        self.assertEqual(1, len(save_calls))

        restarted_adapter = FakeGenerationAdapter()
        restarted = self.runs(
            restarted_adapter,
            guard=guard,
            effects=effects,
        )
        completed = await restarted.resume(
            stored["id"],
            owner="designer-1",
        )

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(1, len(save_calls))
        self.assertEqual([], restarted_adapter.calls)
        self.assertEqual(
            ["/assets/output/final.png"],
            guard.applied[-1][3]["images"],
        )
        self.assertEqual(
            ["output", "canvas", "canvas", "history", "notify"],
            order,
        )

    async def test_target_receives_normalized_generation_output(self):
        class TupleImageAdapter:
            async def execute(self, request):
                del request
                return Completed(
                    ProviderOutput(
                        media=("generated.png",),
                        legacy=(
                            {"type": "url", "value": "generated.png"},
                            {"usage": {}},
                        ),
                    )
                )

        guard = FakeTargetGuard()
        runs = self.runs(TupleImageAdapter(), guard=guard)
        target = RunTarget(
            canvas_id="canvas-1",
            node_id="node-1",
            operation_id="operation-1",
        )
        await runs.start(
            ImageRun(prompt="image", settings={"provider_id": "fake"}),
            owner="designer-1",
            target=target,
        )

        self.assertEqual(
            {
                "images": ["generated.png"],
            },
            guard.applied[0][3],
        )

    async def test_owned_run_rejects_missing_or_wrong_owner(self):
        runs = self.runs(FakeGenerationAdapter())
        started = await runs.start(
            ImageRun(prompt="private", settings={"provider_id": "fake"}),
            owner="designer-1",
        )

        for owner in ("", "designer-2"):
            with self.subTest(owner=owner or "missing"):
                with self.assertRaises(Exception) as rejected:
                    runs.get(started.id, owner=owner)
                self.assertEqual(404, rejected.exception.status_code)
                with self.assertRaises(Exception) as rejected:
                    await runs.resume(started.id, owner=owner)
                self.assertEqual(404, rejected.exception.status_code)
                with self.assertRaises(Exception) as rejected:
                    await runs.cancel(started.id, owner=owner)
                self.assertEqual(404, rejected.exception.status_code)

    async def test_restart_can_cancel_persisted_pending_run(self):
        first_process = self.runs(PendingGenerationAdapter())
        started = await first_process.start(
            ImageRun(
                prompt="pending",
                settings={"provider_id": "fake"},
            ),
            owner="designer-1",
        )

        restarted = self.runs(PendingGenerationAdapter())
        self.assertEqual(1, restarted.active_count())
        await restarted.cancel_active()

        self.assertEqual(0, restarted.active_count())
        self.assertEqual(
            "cancelled",
            restarted.get(started.id, owner="designer-1").status,
        )

    async def test_deleted_or_replaced_target_discards_late_result(self):
        adapter = FakeGenerationAdapter()
        adapter.release = asyncio.Event()
        guard = FakeTargetGuard(current=False)
        runs = self.runs(adapter, guard)
        target = RunTarget(
            canvas_id="canvas-1",
            node_id="node-1",
            operation_id="operation-1",
            request_index=0,
        )

        started = await runs.start(
            ImageRun(prompt="late", settings={"provider_id": "fake"}),
            key="operation-1",
            owner="designer-1",
            delivery=Background(),
            target=target,
        )
        adapter.release.set()
        while runs.active_count():
            await asyncio.sleep(0)
        completed = runs.get(started.id, owner="designer-1")

        self.assertEqual("discarded", completed.status)
        self.assertIsNone(completed.result)
        self.assertEqual([], self.effects.publications)

    async def test_history_notification_publication_happens_once(self):
        adapter = FakeGenerationAdapter()
        runs = self.runs(adapter)
        request = ImageRun(prompt="once", settings={"provider_id": "fake"})

        started = await runs.start(
            request,
            key="operation-1",
            owner="designer-1",
        )
        await runs.resume(started.id, owner="designer-1")
        await runs.start(
            request,
            key="operation-1",
            owner="designer-1",
        )

        self.assertEqual(1, len(self.effects.publications))

    async def test_shutdown_counts_and_cancels_background_runs(self):
        adapter = FakeGenerationAdapter()
        adapter.release = asyncio.Event()
        runs = self.runs(adapter)
        started = await runs.start(
            ImageRun(prompt="long", settings={"provider_id": "fake"}),
            owner="designer-1",
            delivery=Background(),
        )

        self.assertEqual(1, runs.active_count())
        await runs.cancel_active()

        self.assertEqual(0, runs.active_count())
        self.assertEqual(
            "cancelled",
            runs.get(started.id, owner="designer-1").status,
        )

    async def test_store_is_atomic_json(self):
        adapter = FakeGenerationAdapter()
        runs = self.runs(adapter)
        await runs.start(
            ImageRun(prompt="atomic", settings={"provider_id": "fake"}),
            owner="designer-1",
        )

        payload = json.loads(self.store.read_text(encoding="utf-8"))
        self.assertEqual(1, payload["version"])
        self.assertEqual(1, len(payload["runs"]))
        self.assertEqual([], list(self.store.parent.glob("*.tmp")))

    async def test_public_metadata_survives_restart(self):
        adapter = FakeGenerationAdapter()
        runs = self.runs(adapter)
        started = await runs.start(
            ImageRun(
                prompt="metadata",
                settings={"provider_id": "provider-a"},
            ),
            owner="designer-1",
            public_metadata={
                "type": "online-image",
                "provider_id": "provider-a",
                "model": "model-a",
            },
        )

        restarted = self.runs(FakeGenerationAdapter())
        restored = restarted.get(started.id, owner="designer-1")

        self.assertEqual(
            {
                "type": "online-image",
                "provider_id": "provider-a",
                "model": "model-a",
            },
            restored.public_metadata,
        )

    async def test_progress_is_persisted_in_public_metadata(self):
        runs = self.runs(ProgressRecoverableAdapter())

        completed = await runs.start(
            ImageRun(
                prompt="",
                settings={"processor_id": "depth-anything-v2-small"},
                publication="image-processor",
            ),
            key="depth:progress",
            owner="designer-1",
            public_metadata={"type": "image-processor"},
        )

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(
            {
                "type": "image-processor",
                "phase": "downloading-model",
                "progress": 42,
                "message": "正在下载模型 42%",
            },
            completed.public_metadata,
        )

    async def test_restart_reexecutes_deterministic_local_run_without_remote_ref(self):
        first_adapter = ProgressRecoverableAdapter(block=True)
        runs = self.runs(first_adapter)
        started = await runs.start(
            ImageRun(
                prompt="",
                settings={"processor_id": "depth-anything-v2-small"},
                publication="image-processor",
            ),
            key="depth:restart",
            owner="designer-1",
            delivery=Background(),
        )
        await asyncio.wait_for(first_adapter.started.wait(), timeout=1)
        await runs.pause_active()

        restarted_adapter = ProgressRecoverableAdapter()
        restarted = self.runs(restarted_adapter)
        resumed = await restarted.resume(started.id, owner="designer-1")

        self.assertEqual("succeeded", resumed.status)
        self.assertEqual(1, len(restarted_adapter.calls))


class ProviderGenerationExecutorTests(unittest.IsolatedAsyncioTestCase):
    async def test_video_and_workflow_requests_use_typed_provider_seams(self):
        class Runtime:
            def __init__(self):
                self.calls = []

            async def execute_video(self, payload):
                self.calls.append(("video", payload))
                return Completed(
                    ProviderOutput(legacy={"videos": ["video.mp4"]})
                )

            async def execute_workflow(
                self, operation, payload, provider_id=""
            ):
                self.calls.append(
                    ("workflow", operation, payload, provider_id)
                )
                return Completed(
                    ProviderOutput(legacy={"images": ["workflow.png"]})
                )

        runtime = Runtime()
        executor = ProviderGenerationExecutor(runtime)

        video = await executor.execute(VideoRun(payload={"prompt": "move"}))
        workflow = await executor.execute(
            WorkflowRun(
                "comfyui",
                {"workflow": "portrait"},
                provider_id="local",
            )
        )

        self.assertIsInstance(video, Completed)
        self.assertIsInstance(workflow, Completed)
        self.assertEqual(
            [
                ("video", {"prompt": "move"}),
                (
                    "workflow",
                    "comfyui",
                    {"workflow": "portrait"},
                    "local",
                ),
            ],
            runtime.calls,
        )

    async def test_image_count_is_one_provider_submission(self):
        class Runtime:
            def __init__(self):
                self.calls = []

            async def execute_image(self, *args, count=1):
                self.calls.append((args, count))
                return Completed(
                    ProviderOutput(
                        media=("one.png", "two.png", "three.png"),
                        legacy={
                            "images": ["one.png", "two.png", "three.png"]
                        },
                    )
                )

        runtime = Runtime()
        result = await ProviderGenerationExecutor(runtime).execute(
            ImageRun(
                prompt="three",
                settings={"provider_id": "fake"},
                count=3,
            )
        )

        self.assertIsInstance(result, Completed)
        self.assertEqual(1, len(runtime.calls))
        self.assertEqual(3, runtime.calls[0][1])

    async def test_batch_output_count_uses_independent_provider_attempts(self):
        class Effects:
            async def publish(self, run_id, request, output):
                del run_id, request
                return {"images": list(output.media)}

        class Runtime:
            def __init__(self):
                self.calls = []

            def image_native_count(self, provider_id, settings):
                del provider_id, settings
                return True

            async def execute_image(self, *args, count=1):
                self.calls.append((args, count))
                name = f"output-{len(self.calls)}.png"
                return Completed(
                    ProviderOutput(
                        media=(name,),
                        legacy={"images": [name]},
                    )
                )

        with tempfile.TemporaryDirectory() as directory:
            runtime = Runtime()
            runs = GenerationRuns(
                executor=ProviderGenerationExecutor(runtime),
                effects=Effects(),
                store_path=lambda: Path(directory) / "batch.json",
            )

            completed = await runs.start(
                ImageRun(
                    prompt="two variants",
                    settings={"provider_id": "http"},
                    count=1,
                    submission_count=2,
                    publication="batch-generation",
                )
            )

            self.assertEqual(
                ["output-1.png", "output-2.png"],
                completed.result["images"],
            )
            self.assertEqual(2, len(runtime.calls))
            self.assertEqual([1, 1], [count for _args, count in runtime.calls])

    async def test_image_count_matrix_keeps_http_and_child_results(self):
        class Effects:
            async def publish(self, run_id, request, output):
                del run_id, request
                return {"images": list(output.media)}

        class Runtime:
            def __init__(self, native):
                self.native = native
                self.image_calls = []
                self.recovery_calls = []
                self.non_http_result = 0

            def image_native_count(self, provider_id, settings):
                del provider_id, settings
                return self.native

            async def execute_image(self, *args, count=1):
                self.image_calls.append((args, count))
                if self.native:
                    return Completed(
                        ProviderOutput(
                            media=("one.png", "two.png", "three.png"),
                            legacy={
                                "images": [
                                    "one.png",
                                    "two.png",
                                    "three.png",
                                ]
                            },
                        )
                    )
                self.non_http_result += 1
                if self.non_http_result == 2:
                    return Pending("paid-child-2", status="running")
                name = (
                    "one.png"
                    if self.non_http_result == 1
                    else "three.png"
                )
                return Completed(
                    ProviderOutput(media=(name,), legacy={"images": [name]})
                )

            async def execute_recovery(self, provider_id, remote_ref):
                self.recovery_calls.append((provider_id, remote_ref))
                return Completed(
                    ProviderOutput(
                        media=("two.png",),
                        legacy={"images": ["two.png"]},
                    )
                )

        with tempfile.TemporaryDirectory() as directory:
            native_runtime = Runtime(native=True)
            native_runs = GenerationRuns(
                executor=ProviderGenerationExecutor(native_runtime),
                effects=Effects(),
                store_path=lambda: Path(directory) / "native.json",
            )
            native = await native_runs.start(
                ImageRun(
                    prompt="three",
                    settings={"provider_id": "http"},
                    count=3,
                )
            )
            self.assertEqual(
                ["one.png", "two.png", "three.png"],
                native.result["images"],
            )
            self.assertEqual(1, len(native_runtime.image_calls))
            self.assertEqual(3, native_runtime.image_calls[0][1])

            child_runtime = Runtime(native=False)
            child_store = Path(directory) / "children.json"
            child_runs = GenerationRuns(
                executor=ProviderGenerationExecutor(child_runtime),
                effects=Effects(),
                store_path=lambda: child_store,
            )
            pending = await child_runs.start(
                ImageRun(
                    prompt="three",
                    settings={"provider_id": "cli"},
                    count=3,
                ),
                owner="designer-1",
            )
            stored = json.loads(
                child_store.read_text(encoding="utf-8")
            )["runs"][0]
            self.assertEqual("running", pending.status)
            self.assertEqual(
                ["succeeded", "running"],
                [item["status"] for item in stored["child_attempts"]],
            )
            self.assertEqual(["paid-child-2"], stored["remote_refs"])

            restarted_child_runs = GenerationRuns(
                executor=ProviderGenerationExecutor(child_runtime),
                effects=Effects(),
                store_path=lambda: child_store,
            )
            completed = await restarted_child_runs.resume(
                pending.id,
                owner="designer-1",
            )
            self.assertEqual(
                ["one.png", "two.png", "three.png"],
                completed.result["images"],
            )
            self.assertEqual(
                [("cli", "paid-child-2")],
                child_runtime.recovery_calls,
            )
            self.assertEqual(3, len(child_runtime.image_calls))


class WorkspaceGenerationEffectsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.history = self.root / "generation-history.json"
        self.journal = self.root / "generation-effects.json"
        self.notifications = []
        self.effects = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                history_path=lambda: self.history,
                journal_path=lambda: self.journal,
                history_lock=__import__("threading").RLock(),
                save_image=self.save_image,
                image_meta=lambda url, _source: {
                    "url": url,
                    "kind": "image",
                },
                extract_images=lambda raw: raw.get("images") or [],
                notify=self.notify,
                now=lambda: 123.0,
                now_ms=lambda: 123000,
            )
        )

    def tearDown(self):
        self.temporary.cleanup()

    async def save_image(self, value, prefix=""):
        del prefix
        return f"/assets/output/{value['value']}"

    async def notify(self, record):
        self.notifications.append(record)

    async def test_history_and_notification_have_separate_idempotency(self):
        request = ImageRun(
            prompt="once",
            settings={
                "provider_id": "fake",
                "provider_name": "Fake",
                "model": "fake-model",
                "size": "1024x1024",
            },
            publication="online-image",
        )
        output = ProviderOutput(
            legacy=({"type": "url", "value": "one.png"}, {"usage": {}})
        )

        first = await self.effects.publish("run-1", request, output)
        second = await self.effects.publish("run-1", request, output)

        stored = json.loads(self.history.read_text(encoding="utf-8"))
        journal = json.loads(self.journal.read_text(encoding="utf-8"))
        self.assertEqual(first, second)
        self.assertEqual(1, len(stored))
        self.assertEqual(1, len(self.notifications))
        self.assertEqual(
            {"history", "notification"},
            set(journal["effects"]["run-1"]),
        )

    async def test_image_processor_metadata_is_published(self):
        metadata = {
            "processor_id": "depth-anything-v2-small",
            "polarity": "near_white",
            "output_size": [64, 48],
        }

        published = await self.effects.publish(
            "run-depth-1",
            ImageRun(
                prompt="",
                settings={
                    "processor_id": "depth-anything-v2-small",
                    "model": "Depth Anything V2 Small",
                },
                publication="image-processor",
            ),
            ProviderOutput(
                media=("depth-cache.png",),
                model="depth-anything-v2-small",
                metadata={"image_processor": metadata},
                legacy=(
                    {"type": "url", "value": "depth-cache.png"},
                    {"image_processor": metadata},
                ),
            ),
        )

        self.assertEqual(
            ["/assets/output/depth-cache.png"],
            published["images"],
        )
        self.assertEqual(metadata, published["image_processor"])
        self.assertEqual(
            metadata,
            published["image_items"][0]["image_processor"],
        )
        self.assertEqual("depth-map", published["type"])
        self.assertEqual(1, len(self.notifications))
        self.assertTrue(self.history.exists())

    async def test_corrupt_legacy_receipt_journal_is_reported_and_retained(self):
        corrupt = b'{"version":2,"pending":'
        self.journal.write_bytes(corrupt)

        with self.assertRaisesRegex(
            GenerationRunConflict,
            "旧 effect receipt journal 损坏",
        ):
            self.effects.legacy_pending_receipts()

        self.assertEqual(corrupt, self.journal.read_bytes())

    async def test_batch_image_publication_materializes_workspace_output(self):
        published = await self.effects.publish(
            "run-batch-image",
            ImageRun(
                prompt="batch",
                settings={
                    "provider_id": "fake",
                    "model": "fake-image",
                    "size": "1024x1024",
                },
                publication="batch-generation",
            ),
            ProviderOutput(
                legacy=(
                    {"type": "url", "value": "batch.png"},
                    {"usage": {"images": 1}},
                )
            ),
        )

        self.assertEqual(
            ["/assets/output/batch.png"], published["images"]
        )
        self.assertFalse(self.history.exists())
        self.assertEqual([], self.notifications)

    async def test_batch_recovery_uses_normalized_media_when_raw_has_only_urls(self):
        recovered = {
            "status": "succeeded",
            "submit_id": "jimeng-recovered-1",
            "kind": "image",
            "urls": ["recovered.png"],
            "raw": {
                "gen_status": "success",
                "result_json": {
                    "images": [
                        {
                            "image_url": "recovered.png",
                            "width": 2560,
                            "height": 1440,
                        }
                    ]
                },
            },
        }

        published = await self.effects.publish(
            "run-batch-recovery",
            ImageRun(
                prompt="recovered batch image",
                settings={"provider_id": "jimeng", "model": "5.0"},
                publication="batch-generation",
            ),
            ProviderOutput(
                media=("recovered.png",),
                raw=recovered,
                legacy=recovered,
            ),
        )

        self.assertEqual(
            ["/assets/output/recovered.png"], published["images"]
        )
        self.assertFalse(self.history.exists())
        self.assertEqual([], self.notifications)

    async def test_batch_image_publication_passes_task_model_and_prompt_prefix(self):
        save_calls = []

        async def save_image(value, **options):
            save_calls.append((value, options))
            return "/assets/output/角色探索/红狐.png"

        effects = WorkspaceGenerationEffects(GenerationEffectPorts(
            history_path=lambda: self.history,
            journal_path=lambda: self.journal,
            history_lock=__import__("threading").RLock(),
            save_image=save_image,
            image_meta=lambda url, _source: {"url": url, "kind": "image"},
            extract_images=lambda raw: raw.get("images") or [],
            notify=self.notify,
        ))
        prompt = "一只红狐站在森林中央，电影感，柔和光线"

        await effects.publish(
            "run-batch-folder",
            ImageRun(
                prompt=prompt,
                settings={"provider_id": "fake", "model": "fake-image"},
                publication="batch-generation",
                effect_context={
                    "batch_id": "batch-1",
                    "batch_name": "角色探索",
                    "task_index": 6,
                    "model_name": "Seedream 4.0",
                },
            ),
            ProviderOutput(
                legacy=(
                    {"type": "url", "value": "batch.png"},
                    {"usage": {"images": 1}},
                )
            ),
        )

        self.assertEqual(1, len(save_calls))
        self.assertEqual("角色探索", save_calls[0][1]["folder"])
        self.assertEqual(
            f"7_Seedream 4.0_{prompt[:15]}",
            save_calls[0][1]["name_prefix"],
        )

    async def test_history_read_and_delete_keep_legacy_contract(self):
        self.history.write_text(
            json.dumps(
                [
                    {
                        "timestamp": 10.0,
                        "type": "angle",
                        "images": ["ten.png"],
                        "_effect_id": "generation-run:ten",
                    },
                    {
                        "timestamp": 20.0,
                        "type": "angle",
                        "images": ["twenty.png"],
                        "_effect_id": "generation-run:twenty",
                    },
                    {
                        "timestamp": 30.0,
                        "type": "text",
                        "images": [],
                    },
                ]
            ),
            encoding="utf-8",
        )

        listed = await self.effects.history("angle")
        deleted = await self.effects.delete_history(20.0)
        missing = await self.effects.delete_history(999.0)

        self.assertEqual([20.0, 10.0], [
            item["timestamp"] for item in listed
        ])
        self.assertNotIn("_effect_id", listed[0])
        self.assertEqual({"success": True}, deleted)
        self.assertEqual(
            {"success": False, "message": "Record not found"},
            missing,
        )

    async def test_notification_pending_retries_after_fault_and_restart(self):
        attempts = []

        async def fail_after_send(record):
            attempts.append(("first", record))
            raise RuntimeError("notification transport interrupted")

        async def should_not_repeat(record):
            attempts.append(("restart", record))

        ports = self.effects._ports
        first = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                **{
                    **ports.__dict__,
                    "notify": fail_after_send,
                }
            )
        )
        prepared = PreparedGenerationOutput(
            result={"ok": True},
            effects={"notification": {"images": ["one.png"]}},
        )
        with self.assertRaisesRegex(
            RuntimeError,
            "notification transport interrupted",
        ):
            await first.publish_prepared(
                "run-notify-fault",
                ImageRun(prompt="x", settings={}),
                prepared,
            )

        restarted = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                **{
                    **ports.__dict__,
                    "notify": should_not_repeat,
                }
            )
        )
        result = await restarted.publish_prepared(
            "run-notify-fault",
            ImageRun(prompt="x", settings={}),
            prepared,
        )

        self.assertEqual({"ok": True}, result)
        self.assertEqual(
            [
                ("first", {"images": ["one.png"]}),
                ("restart", {"images": ["one.png"]}),
            ],
            attempts,
        )

    async def test_terminal_run_recovers_pending_legacy_receipt_and_prunes_orphan(self):
        async def store_image(_value, **_options):
            return "/assets/output/generated.png"

        first_effects = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                **{
                    **self.effects._ports.__dict__,
                    "save_image": store_image,
                }
            )
        )
        request = ImageRun(
            prompt="recover terminal receipt",
            settings={"provider_id": "fake", "model": "fake-image"},
            publication="online-image",
        )
        first_runs = GenerationRuns(
            executor=FakeGenerationAdapter(),
            effects=first_effects,
            store_path=lambda: self.root / "generation-runs.json",
        )
        completed = await first_runs.start(
            request,
            owner="designer-1",
        )
        journal = json.loads(self.journal.read_text(encoding="utf-8"))
        journal["effects"][completed.id].remove("notification")
        journal["pending"] = {
            completed.id: ["history", "notification"],
            "missing-run": ["history"],
            "legacy-empty": [],
        }
        self.journal.write_text(json.dumps(journal), encoding="utf-8")

        replayed_notifications = []

        async def replay_notification(record):
            replayed_notifications.append(record)

        restarted_effects = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                **{
                    **first_effects._ports.__dict__,
                    "notify": replay_notification,
                }
            )
        )
        restarted_runs = GenerationRuns(
            executor=FakeGenerationAdapter(),
            effects=restarted_effects,
            store_path=lambda: self.root / "generation-runs.json",
        )

        recovered = await restarted_runs.recover_legacy_effect_receipts()

        cleaned = json.loads(self.journal.read_text(encoding="utf-8"))
        self.assertEqual(
            {
                "recovered": 1,
                "cleaned": 1,
                "skipped": 0,
                "failed": {},
            },
            recovered,
        )
        self.assertEqual(1, len(replayed_notifications))
        self.assertEqual(
            {"history", "notification"},
            set(cleaned["effects"][completed.id]),
        )
        self.assertEqual({}, cleaned["pending"])

    async def test_corrupt_terminal_receipt_is_reported_and_left_for_retry(self):
        async def store_image(_value, **_options):
            return "/assets/output/generated.png"

        effects = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                **{
                    **self.effects._ports.__dict__,
                    "save_image": store_image,
                }
            )
        )
        runs_path = self.root / "generation-runs.json"
        first_runs = GenerationRuns(
            executor=FakeGenerationAdapter(),
            effects=effects,
            store_path=lambda: runs_path,
        )
        completed = await first_runs.start(
            ImageRun(
                prompt="corrupt receipt",
                settings={"provider_id": "fake"},
                publication="online-image",
            ),
            owner="designer-1",
        )
        stored = json.loads(runs_path.read_text(encoding="utf-8"))
        stored["runs"][0]["prepared_output"]["effects"] = "corrupt"
        runs_path.write_text(json.dumps(stored), encoding="utf-8")
        journal = json.loads(self.journal.read_text(encoding="utf-8"))
        journal["effects"][completed.id].remove("notification")
        journal["pending"] = {completed.id: ["notification"]}
        self.journal.write_text(json.dumps(journal), encoding="utf-8")

        restarted = GenerationRuns(
            executor=FakeGenerationAdapter(),
            effects=effects,
            store_path=lambda: runs_path,
        )
        report = await restarted.recover_legacy_effect_receipts()

        self.assertEqual(0, report["recovered"])
        self.assertIn(completed.id, report["failed"])
        pending = json.loads(self.journal.read_text(encoding="utf-8"))[
            "pending"
        ]
        self.assertEqual(["notification"], pending[completed.id])

    async def test_workflow_and_video_materialize_after_provider_completion(self):
        ports = self.effects._ports

        async def save_video(value, prefix="", stable_id=""):
            del prefix
            return f"/assets/output/{stable_id}-{Path(value).name}"

        async def save_asset(value, prefix="", stable_id=""):
            del prefix
            suffix = Path(str(value).split("?", 1)[0]).suffix or ".bin"
            return f"/assets/output/{stable_id}{suffix}"

        def save_text(value, prefix="", name="", stable_id=""):
            del value, prefix
            return f"/assets/output/{stable_id}-{name}"

        effects = WorkspaceGenerationEffects(
            GenerationEffectPorts(
                **{
                    **ports.__dict__,
                    "save_video": save_video,
                    "save_asset": save_asset,
                    "save_text": save_text,
                }
            )
        )
        workflow = await effects.prepare(
            "run-comfy",
            WorkflowRun("comfyui", {}, publication="history"),
            ProviderOutput(
                legacy={
                    "images": ["image.png"],
                    "videos": ["https://example.test/video.mp4"],
                    "audios": ["https://example.test/sound.wav"],
                    "files": ["https://example.test/archive.zip"],
                    "image_items": [
                        {"kind": "image", "url": "image.png"}
                    ],
                    "items": [
                        {
                            "kind": "audio",
                            "url": "https://example.test/sound.wav",
                        },
                        {
                            "kind": "file",
                            "url": "https://example.test/archive.zip",
                        },
                        {
                            "kind": "text",
                            "name": "caption.txt",
                            "text": "caption",
                            "url": "",
                        }
                    ],
                    "outputs": [
                        "image.png",
                        "https://example.test/video.mp4",
                        "https://example.test/sound.wav",
                        "https://example.test/archive.zip",
                    ],
                    "data": {
                        "urls": ["https://backend.test/view?id=1"],
                        "image_items": [
                            {
                                "kind": "image",
                                "url": "https://backend.test/view?id=1",
                            }
                        ],
                    },
                }
            ),
        )

        self.assertEqual(
            ["/assets/output/image.png"],
            workflow.result["images"],
        )
        self.assertTrue(
            workflow.result["videos"][0].startswith("/assets/output/")
        )
        self.assertTrue(
            workflow.result["texts"][0].startswith("/assets/output/")
        )
        self.assertTrue(workflow.result["audios"][0].endswith(".wav"))
        self.assertTrue(workflow.result["files"][0].endswith(".zip"))
        self.assertEqual(
            workflow.result["audios"][0],
            workflow.result["items"][0]["url"],
        )
        self.assertEqual(
            workflow.result["files"][0],
            workflow.result["items"][1]["url"],
        )
        self.assertNotIn(
            "text", workflow.result["items"][2]
        )
        self.assertEqual(
            workflow.result["data"]["urls"][0],
            workflow.result["data"]["image_items"][0]["url"],
        )
        for value in (
            workflow.result["outputs"]
            + workflow.result["data"]["urls"]
        ):
            self.assertTrue(str(value).startswith("/assets/output/"))

    async def test_stream_partial_events_are_consumed_only_once(self):
        async def source():
            yield TextStreamEvent(
                TextStreamEventKind.DELTA, delta="first"
            )
            yield TextStreamEvent(
                TextStreamEventKind.DELTA, delta="second"
            )

        published = await self.effects.publish_typed(
            "run-stream",
            TextRun(payload={}, stream=True),
            TextStreamOutput(model="fake", events=source()),
        )
        first = [event async for event in published.events]
        second = [event async for event in published.events]

        self.assertEqual(["first", "second"], [item.delta for item in first])
        self.assertEqual([], second)

    async def test_live_notification_connection_deduplicates_effect_id(self):
        class Socket:
            def __init__(self):
                self.messages = []

            async def send_text(self, value):
                self.messages.append(value)

        manager = ConnectionManager()
        socket = Socket()
        manager.active_connections.append(socket)

        await manager.broadcast_new_image(
            {"images": ["one.png"]},
            effect_id="generation-run:one:notification",
        )
        await manager.broadcast_new_image(
            {"images": ["one.png"]},
            effect_id="generation-run:one:notification",
        )

        self.assertEqual(1, len(socket.messages))
        self.assertEqual(
            {
                "type": "new_image",
                "data": {"images": ["one.png"]},
            },
            json.loads(socket.messages[0]),
        )


if __name__ == "__main__":
    unittest.main()
