"""Opted-in workflow delivery retries saving without repeating generation."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.generation_runs import (
    GenerationOutputPorts, GenerationOutputSaveError, GenerationRuns,
    VideoRun, WorkflowRun, WorkspaceGenerationEffects,
)
from infinite_canvas.providers.core import Pending
from infinite_canvas.providers.runtime import ProviderOutput
from tests.test_comfy_workflow_progress import executor


class Publication:
    def __init__(self):
        self.history = []
        self.notifications = []

    async def publish_history(self, run_id, record):
        self.history.append((run_id, record))

    async def publish_notification(self, run_id, record):
        self.notifications.append((run_id, record))


class WorkflowManagedDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_download_failure_restarts_only_save_and_never_reposts_generation(self):
        for authority in ("json", "sqlite"):
            with self.subTest(authority=authority), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                store = SqliteGenerationRunStore(root / "runs.sqlite3", workspace_id="media-delivery") if authority == "sqlite" else None
                pool = GenerationRunStoreExecutor() if store else None
                lifecycle = AsyncGenerationRunLifecycleStore(store=store, store_executor=pool) if store else None
                store_path = (lambda: None) if store else (lambda: root / "runs.json")
                video = "http://machine:8188/view?filename=final.mp4&type=output"
                saved = "/assets/output/final.mp4"
                submitted, queried, saves = [], [], []
                fail_save = True
                publication = Publication()

                async def submit(payload, on_remote=None, on_progress=None):
                    submitted.append(payload)
                    on_remote(Pending("original-gpu-job", raw={"prompt_id": "original-gpu-job", "backend": "machine:8188"}))
                    return {"prompt_id": "original-gpu-job", "images": [], "videos": [video],
                            "items": [{"kind": "video", "url": video, "node_id": "21"}], "outputs": [video]}

                async def recover(payload, on_progress=None):
                    queried.append(payload)
                    raise AssertionError("A completed provider must not be queried or submitted again")

                async def save_video(value, **options):
                    saves.append((value, options.get("stable_id")))
                    return value if fail_save else saved

                async def unexpected_save(*args, **kwargs):
                    raise AssertionError("Video sent to the wrong media saver")

                effects = WorkspaceGenerationEffects(
                    GenerationOutputPorts(save_image=unexpected_save, image_meta=lambda *_: {},
                                          extract_images=lambda _: [], save_video=save_video),
                    publication=publication,
                )
                runs = GenerationRuns(executor=executor(submit, recover), effects=effects,
                                      store_path=store_path, lifecycle_store=lifecycle)
                request = WorkflowRun("comfyui", {"prompt": "one GPU submission"},
                                      provider_id="comfyui", publication="history",
                                      effect_context={"require_managed_media": True})
                try:
                    with self.assertRaisesRegex(GenerationOutputSaveError, "generation.output_save_failed"):
                        await runs.start(request, key="one-operation")
                    await runs.wait_for_lifecycle_projection()
                    failed_save_run = await runs.find_by_key(owner="", key="one-operation")
                    self.assertEqual("running", failed_save_run.status)
                    self.assertTrue(failed_save_run.recoverable)
                    self.assertEqual("generation.output_save_failed", failed_save_run.error)
                    self.assertEqual(("original-gpu-job",), failed_save_run.remote_refs)
                    if store:
                        durable = store.load(failed_save_run.id)
                        self.assertEqual("provider_completed", durable.phase)
                        self.assertEqual(video, durable.provider_output["legacy"]["videos"][0])
                        self.assertTrue(durable.effect_context["require_managed_media"])
                    else:
                        durable = json.loads((root / "runs.json").read_text())["runs"][0]
                        self.assertEqual("provider_completed", durable["phase"])
                        self.assertEqual(video, durable["provider_output"]["legacy"]["videos"][0])
                        self.assertTrue(durable["effect_context"]["require_managed_media"])
                    self.assertEqual([], publication.history)
                    self.assertEqual([], publication.notifications)

                    fail_save = False
                    restarted = GenerationRuns(executor=executor(submit, recover), effects=effects,
                                               store_path=store_path, lifecycle_store=lifecycle)
                    if lifecycle:
                        await restarted.restore_lifecycle_authority()
                    completed = await restarted.resume(failed_save_run.id)
                    await restarted.wait_for_lifecycle_projection()
                    self.assertEqual("succeeded", completed.status)
                    self.assertEqual([saved], completed.result["videos"])
                    self.assertEqual(saved, completed.result["items"][0]["url"])
                    self.assertEqual("video", completed.result["items"][0]["kind"])
                    self.assertTrue(all(value == saved for value in completed.result["outputs"]))
                    self.assertEqual(1, len(submitted), "GPU prompt must only be submitted once")
                    self.assertEqual([], queried)
                    self.assertEqual(2, len(saves), "one failed download and one saved retry")
                    self.assertEqual(saves[0][1], saves[1][1], "reuse stable Managed Media identity")
                    self.assertEqual(1, len(publication.history))
                    self.assertEqual(1, len(publication.notifications))
                finally:
                    await runs.pause_active()
                    if lifecycle:
                        await lifecycle.close()
                        await pool.close()

    async def test_unmarked_video_api_and_workflow_keep_existing_download_contract(self):
        url = "https://provider.example/video.mp4"
        async def unchanged(value, **_options):
            return value
        effects = WorkspaceGenerationEffects(GenerationOutputPorts(
            save_image=unchanged, image_meta=lambda *_: {}, extract_images=lambda _: [],
            save_video=unchanged,
        ), publication=Publication())
        for request in (VideoRun({}), WorkflowRun("generic-workflow", {})):
            prepared = await effects.prepare("unchanged", request, ProviderOutput(legacy={"videos": [url]}))
            self.assertEqual([url], prepared.result["videos"])

    async def test_marked_workflow_checks_all_delivery_media_fields(self):
        async def unchanged(value, **_options):
            return value if isinstance(value, str) else value["value"]
        effects = WorkspaceGenerationEffects(GenerationOutputPorts(
            save_image=unchanged, image_meta=lambda *_: {}, extract_images=lambda _: [],
            save_video=unchanged, save_asset=unchanged,
        ), publication=Publication())
        request = WorkflowRun("generic-workflow", {}, effect_context={"require_managed_media": True})
        for output in (
            {"images": ["http://device/view?filename=out.png"]},
            {"videos": ["http://device/view?filename=out.mp4"]},
            {"audios": ["http://device/view?filename=out.wav"]},
            {"texts": ["http://device/view?filename=out.txt"]},
            {"files": ["relative-output.zip"]},
            {"items": [{"kind": "video", "url": "http://device/view"}]},
        ):
            with self.subTest(output=output), self.assertRaises(GenerationOutputSaveError):
                await effects.prepare("needs-save", request, ProviderOutput(legacy=output))
