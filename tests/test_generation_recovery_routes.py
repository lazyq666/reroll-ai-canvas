import asyncio
import tempfile
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.providers import implementation as provider_implementation
from infinite_canvas.generation_runs import (
    GenerationRuns,
    ImageRun,
    RecoveryRun,
    VideoRun,
    WorkflowRun,
)
from infinite_canvas.providers.core import Completed, Pending
from infinite_canvas.providers.runtime import ProviderOutput


class Effects:
    def __init__(self):
        self.publications = []

    async def publish(self, run_id, request, output):
        self.publications.append((run_id, request))
        return output.legacy


class RecoveryAdapter:
    def __init__(self):
        self.calls = []

    async def execute(self, request):
        self.calls.append(request)
        if isinstance(request, RecoveryRun):
            kind = request.media_kind
            suffix = "mp4" if kind == "video" else "png"
            return Completed(
                ProviderOutput(
                    media=(f"recovered.{suffix}",),
                    metadata={"media_kind": kind},
                    legacy={
                        "status": "succeeded",
                        "submit_id": request.remote_ref,
                        "kind": kind,
                        "urls": [f"recovered.{suffix}"],
                    },
                )
            )
        if (
            isinstance(request, WorkflowRun)
            and request.operation in {
                "runninghub-query",
                "modelscope-angle-recovery",
            }
        ):
            return Completed(
                ProviderOutput(
                    media=("recovered.png",),
                    legacy={
                        "status": "succeeded",
                        "url": "recovered.png",
                    },
                )
            )
        if isinstance(request, ImageRun):
            provider_id = request.settings.get("provider_id")
        elif isinstance(request, VideoRun):
            provider_id = getattr(request.payload, "provider_id", "")
        else:
            provider_id = request.provider_id
        remote_ref = {
            "fake": "image-task-1",
            "runninghub": "runninghub-task-1",
            "modelscope": "angle-task-1",
            "jimeng": "jimeng-task-1",
        }[provider_id]
        return Pending(remote_ref, status="running")


class GenerationRecoveryRouteTests(unittest.IsolatedAsyncioTestCase):
    generation_routes = {
        "runninghub_submit": ("/api/runninghub/submit", "POST"),
        "runninghub_workflow_submit": (
            "/api/runninghub/workflow-submit",
            "POST",
        ),
        "runninghub_query": ("/api/runninghub/query", "GET"),
        "runninghub_upload_asset": (
            "/api/runninghub/upload-asset",
            "POST",
        ),
        "jimeng_query_media": ("/api/jimeng/query-media", "POST"),
        "generate_angle_cloud": ("/api/angle/generate", "POST"),
        "generate_cloud": ("/generate", "POST"),
        "ms_generate": ("/api/ms/generate", "POST"),
        "run_workflow": ("/api/workflows/{name:path}/run", "POST"),
    }

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = Path(self.temporary.name) / "runs.json"
        self.adapter = RecoveryAdapter()
        self.effects = Effects()
        self.original_runs = main._GENERATION_RUNS
        main._GENERATION_RUNS = self.runs()

    def tearDown(self):
        main._GENERATION_RUNS = self.original_runs
        self.temporary.cleanup()

    def runs(self):
        return GenerationRuns(
            executor=self.adapter,
            effects=self.effects,
            store_path=lambda: self.store,
        )

    def endpoint(self, path, method):
        return next(
            route.endpoint
            for route in main.app.routes
            if getattr(route, "path", None) == path
            and method in getattr(route, "methods", set())
        )

    async def test_application_lifecycle_resumes_then_pauses_generation_runs(self):
        resume = mock.AsyncMock()
        pause = mock.AsyncMock()
        recover_receipts = mock.AsyncMock(
            return_value={
                "recovered": 0,
                "cleaned": 0,
                "skipped": 0,
                "failed": {},
            }
        )
        repair = mock.AsyncMock(return_value={"repaired": 0, "failed": {}})
        resume_batches = mock.AsyncMock()
        start_batch_scheduler = mock.AsyncMock()
        stop_batch_scheduler = mock.AsyncMock()
        with (
            mock.patch.object(
                main.generation_run_control,
                "resume_active",
                new=resume,
            ),
            mock.patch.object(
                main.generation_run_control,
                "pause_active",
                new=pause,
            ),
            mock.patch.object(
                main._GENERATION_RUNS,
                "recover_legacy_effect_receipts",
                new=recover_receipts,
            ),
            mock.patch.object(
                main._GENERATION_RUNS,
                "repair_publication_outputs",
                new=repair,
            ),
            mock.patch.object(
                main._BATCH_GENERATION,
                "resume_pending",
                new=resume_batches,
            ),
            mock.patch.object(
                main._BATCH_GENERATION,
                "start_scheduler",
                new=start_batch_scheduler,
            ),
            mock.patch.object(
                main._BATCH_GENERATION,
                "stop_scheduler",
                new=stop_batch_scheduler,
            ),
            mock.patch.object(
                main, "_prepare_startup_state", return_value=None
            ),
            mock.patch.object(
                main, "WORKSPACE_CONFIGURED", False
            ),
            mock.patch.object(main, "MATTING_WORKER_TASKS", []),
            mock.patch.object(
                main, "cancel_pending_workspace_open"
            ),
        ):
            await main.startup_event()
            await main.shutdown_event()

        resume.assert_awaited_once_with()
        recover_receipts.assert_awaited_once_with()
        repair.assert_awaited_once_with("batch-generation")
        resume_batches.assert_awaited_once_with()
        start_batch_scheduler.assert_awaited_once_with()
        stop_batch_scheduler.assert_awaited_once_with()
        pause.assert_awaited_once_with()

    async def test_video_task_returns_anchor_and_active_canvas_lookup(self):
        class BlockingVideoAdapter:
            def __init__(self):
                self.started = asyncio.Event()
                self.release = asyncio.Event()

            async def execute(self, _request):
                self.started.set()
                await self.release.wait()
                return Completed(
                    ProviderOutput(
                        media=("generated.mp4",),
                        metadata={"media_kind": "video"},
                        legacy={"urls": ["generated.mp4"], "kind": "video"},
                    )
                )

        adapter = BlockingVideoAdapter()
        main._GENERATION_RUNS = GenerationRuns(
            executor=adapter,
            effects=self.effects,
            store_path=lambda: self.store,
        )
        actor = {"id": "designer-1", "role": "designer"}
        payload = main.CanvasVideoRequest(
            prompt="move",
            provider_id="jimeng",
            model="seedance-test",
            canvas_id="canvas-1",
            node_id="node-1",
            generation_operation_id="operation-1",
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )
        try:
            with (
                mock.patch.object(
                    main,
                    "require_current_user",
                    return_value=actor,
                ),
                mock.patch.object(
                    main.VIDEO_CAPABILITY_REGISTRY,
                    "validate_references",
                    return_value={
                        "valid": True,
                        "count": 0,
                        "minimum": 0,
                        "maximum": 0,
                    },
                ),
                mock.patch.object(
                    main.CANVAS_SYNC,
                    "read",
                    return_value={"id": "canvas-1", "nodes": []},
                ),
            ):
                submission = await self.endpoint(
                    "/api/canvas-video-tasks", "POST"
                )(payload)
                await adapter.started.wait()
                active = self.endpoint(
                    "/api/canvases/{canvas_id}/generation-runs/active",
                    "GET",
                )("canvas-1")

            self.assertTrue(submission["task_id"].startswith("run_"))
            self.assertEqual("designer-1", submission["actor_id"])
            self.assertEqual(1, len(active["runs"]))
            self.assertEqual(submission["task_id"], active["runs"][0]["id"])
            self.assertEqual("node-1", active["runs"][0]["node_id"])
            self.assertEqual(
                "operation-1",
                active["runs"][0]["generation_operation_id"],
            )
        finally:
            adapter.release.set()
            await asyncio.sleep(0.01)

    def test_generation_routes_are_not_overwritten_by_provider_exports(self):
        exported = set(provider_implementation._CATEGORY_EXPORTS)
        moved = set(provider_implementation.MOVED_PROVIDER_FUNCTIONS)
        for name, (path, method) in self.generation_routes.items():
            with self.subTest(name=name):
                self.assertNotIn(name, exported)
                self.assertNotIn(name, moved)
                self.assertIs(
                    getattr(main, name),
                    self.endpoint(path, method),
                )

    async def test_image_query_refreshes_once_then_reuses_after_restart(self):
        started = await main._GENERATION_RUNS.start(
            ImageRun(
                prompt="image",
                settings={"provider_id": "fake"},
            ),
            owner="designer-1",
        )
        payload = main.ImageTaskQueryRequest(
            provider_id="fake",
            task_id="image-task-1",
        )
        with mock.patch.object(
            main,
            "require_current_user",
            return_value={"id": "designer-1", "role": "designer"},
        ):
            query = self.endpoint("/api/image-task-query", "POST")
            first = await query(payload)
            main._GENERATION_RUNS = self.runs()
            repeated = await query(payload)

        self.assertEqual(started.id, main._GENERATION_RUNS.find_by_remote_ref(
            "image-task-1",
            provider_id="fake",
            owner="designer-1",
        ).id)
        self.assertEqual(first, repeated)
        self.assertEqual(2, len(self.adapter.calls))
        self.assertEqual(0, main._GENERATION_RUNS.active_count())
        self.assertEqual(1, len(self.effects.publications))

    async def test_runninghub_query_finishes_original_submission(self):
        actor = {"id": "designer-1", "role": "designer"}
        with (
            mock.patch.object(main, "current_user", return_value=actor),
            mock.patch(
                "infinite_canvas.providers.runninghub_impl.runninghub_submit",
                side_effect=AssertionError("legacy provider route called"),
            ),
            mock.patch(
                "infinite_canvas.providers.runninghub_impl.runninghub_query",
                side_effect=AssertionError("legacy provider route called"),
            ),
        ):
            await main.runninghub_submit(
                main.RunningHubSubmitRequest(useWallet=True)
            )
            first = await main.runninghub_query(
                taskId="runninghub-task-1",
                useWallet=True,
            )
            main._GENERATION_RUNS = self.runs()
            repeated = await main.runninghub_query(
                taskId="runninghub-task-1",
                useWallet=True,
            )

        self.assertEqual(first, repeated)
        self.assertEqual(2, len(self.adapter.calls))
        self.assertEqual(0, main._GENERATION_RUNS.active_count())
        recovery = self.adapter.calls[-1]
        self.assertEqual("runninghub-query", recovery.operation)
        self.assertEqual(True, recovery.payload["useWallet"])

    async def test_runninghub_fresh_query_transient_never_returns_stale_none(self):
        class TransientQueryAdapter:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                if len(self.calls) == 1:
                    raise HTTPException(
                        status_code=503,
                        detail="provider temporarily unavailable",
                    )
                return Completed(
                    ProviderOutput(
                        media=("done.png",),
                        legacy={
                            "status": "SUCCESS",
                            "taskId": "fresh-runninghub-task",
                            "urls": ["done.png"],
                        },
                    )
                )

        adapter = TransientQueryAdapter()
        effects = Effects()
        main._GENERATION_RUNS = GenerationRuns(
            executor=adapter,
            effects=effects,
            store_path=lambda: self.store,
        )
        actor = {"id": "designer-1", "role": "designer"}
        with mock.patch.object(
            main, "current_user", return_value=actor
        ):
            with self.assertRaises(HTTPException) as raised:
                await main.runninghub_query(
                    taskId="fresh-runninghub-task",
                    useWallet=True,
                )
            linked = main._GENERATION_RUNS.find_by_remote_ref(
                "fresh-runninghub-task",
                provider_id="runninghub",
                owner="designer-1",
            )
            result = await main.runninghub_query(
                taskId="fresh-runninghub-task",
                useWallet=True,
            )

        self.assertEqual(503, raised.exception.status_code)
        self.assertIsNotNone(linked)
        self.assertIn(linked.status, {"running", "pending"})
        self.assertTrue(linked.recoverable)
        self.assertEqual(
            {
                "status": "SUCCESS",
                "taskId": "fresh-runninghub-task",
                "urls": ["done.png"],
            },
            result,
        )
        self.assertEqual(2, len(adapter.calls))
        self.assertTrue(
            all(
                isinstance(call, WorkflowRun)
                and call.operation == "runninghub-query"
                for call in adapter.calls
            )
        )
        terminal = main._GENERATION_RUNS.find_by_remote_ref(
            "fresh-runninghub-task",
            provider_id="runninghub",
            owner="designer-1",
        )
        self.assertEqual(linked.id, terminal.id)
        self.assertEqual("succeeded", terminal.status)

    async def test_repeated_fresh_404_queries_keep_stored_http_failure(self):
        class MissingQueryAdapter:
            def __init__(self):
                self.calls = []

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                raise HTTPException(
                    status_code=404,
                    detail="remote task not found",
                )

        adapter = MissingQueryAdapter()
        main._GENERATION_RUNS = GenerationRuns(
            executor=adapter,
            effects=Effects(),
            store_path=lambda: self.store,
        )
        actor = {"id": "designer-1", "role": "designer"}
        image_payload = main.ImageTaskQueryRequest(
            provider_id="fake",
            task_id="missing-image-task",
        )
        with (
            mock.patch.object(
                main, "current_user", return_value=actor
            ),
            mock.patch.object(
                main, "require_current_user", return_value=actor
            ),
        ):
            for query in (
                lambda: main.query_image_task(image_payload),
                lambda: main.query_image_task(image_payload),
                lambda: main.runninghub_query(
                    taskId="missing-runninghub-task",
                    useWallet=True,
                ),
                lambda: main.runninghub_query(
                    taskId="missing-runninghub-task",
                    useWallet=True,
                ),
            ):
                with self.assertRaises(HTTPException) as raised:
                    await query()
                self.assertEqual(404, raised.exception.status_code)
                self.assertEqual(
                    "remote task not found",
                    raised.exception.detail,
                )

        self.assertEqual(2, len(adapter.calls))
        image_run = main._GENERATION_RUNS.find_by_remote_ref(
            "missing-image-task",
            provider_id="fake",
            owner="designer-1",
        )
        runninghub_run = main._GENERATION_RUNS.find_by_remote_ref(
            "missing-runninghub-task",
            provider_id="runninghub",
            owner="designer-1",
        )
        self.assertEqual("failed", image_run.status)
        self.assertEqual("failed", runninghub_run.status)
        self.assertIsNone(image_run.result)
        self.assertIsNone(runninghub_run.result)




    async def test_jimeng_query_preserves_kind_and_finishes_original(self):
        await main._GENERATION_RUNS.start(
            VideoRun(payload=SimpleNamespace(provider_id="jimeng")),
            owner="designer-1",
        )
        payload = main.JimengQueryMediaRequest(
            submit_id="jimeng-task-1",
            kind="video",
        )
        actor = {"id": "designer-1", "role": "designer"}
        with (
            mock.patch.object(main, "current_user", return_value=actor),
            mock.patch(
                "infinite_canvas.providers.cli_impl.jimeng_query_media",
                side_effect=AssertionError("legacy provider route called"),
            ),
        ):
            first = await main.jimeng_query_media(payload)
            main._GENERATION_RUNS = self.runs()
            repeated = await main.jimeng_query_media(payload)

        self.assertEqual(first, repeated)
        self.assertEqual("video", first["kind"])
        self.assertEqual(["recovered.mp4"], first["urls"])
        self.assertEqual(2, len(self.adapter.calls))
        self.assertEqual(0, main._GENERATION_RUNS.active_count())


if __name__ == "__main__":
    unittest.main()
