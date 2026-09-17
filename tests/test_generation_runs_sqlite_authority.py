import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_publication import SqliteGenerationPublication
from infinite_canvas.generation_run_store import (
    GenerationRunStoreError,
    GenerationRunState,
    SqliteGenerationRunStore,
)
from infinite_canvas.generation_runs import (
    GenerationOutputPorts,
    GenerationRunLifecycleProjectionError,
    GenerationRuns,
    ImageRun,
    Inline,
    TextRun,
    VideoRun,
    WorkspaceGenerationEffects,
)
from infinite_canvas.providers.core import Completed
from infinite_canvas.providers.runtime import ProviderOutput, TextOutput


class GenerationRunsSqliteAuthorityTests(unittest.IsolatedAsyncioTestCase):
    async def test_multimodal_text_persists_workspace_reference_before_provider(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SqliteGenerationRunStore(
                Path(temporary) / "generation-runs.sqlite3",
                workspace_id="workspace-text-media",
            )
            store_executor = GenerationRunStoreExecutor(max_workers=1, max_pending=8)
            lifecycle = AsyncGenerationRunLifecycleStore(
                store=store,
                store_executor=store_executor,
            )
            provider_messages = []

            class Executor:
                async def execute(self, request, checkpoint=None):
                    del checkpoint
                    provider_messages.extend(request.messages)
                    return Completed(TextOutput(text="ok", model="text-model"))

            effects = WorkspaceGenerationEffects(
                GenerationOutputPorts(
                    save_image=lambda *_args, **_kwargs: None,
                    image_meta=lambda url, _source: {"url": url},
                    extract_images=lambda _raw: [],
                ),
                publication=SqliteGenerationPublication(
                    store=store,
                    store_executor=store_executor,
                    notify=None,
                    worker_id="text-media-worker",
                ),
            )
            transport_url = "data:image/png;base64,dHJhbnNwb3J0"
            workspace_url = "/assets/input/reference.png"
            request = TextRun(
                payload={"provider": "provider-text", "images": [transport_url]},
                messages=({
                    "role": "user",
                    "content": [{"type": "image_url", "image_url": {"url": transport_url}}],
                },),
                durable_payload={"provider": "provider-text", "images": [workspace_url]},
                durable_messages=({
                    "role": "user",
                    "content": [{"type": "image_url", "image_url": {"url": workspace_url}}],
                },),
            )
            runs = GenerationRuns(
                executor=Executor(),
                effects=effects,
                store_path=lambda: None,
                lifecycle_store=lifecycle,
            )
            try:
                completed = await runs.start(request, owner="designer-1", delivery=Inline())
                await runs.wait_for_lifecycle_projection()
            finally:
                await lifecycle.close()
                await store_executor.close()

            self.assertEqual("succeeded", completed.status)
            self.assertIn(transport_url, json.dumps(provider_messages))
            stored = store.load(completed.id)
            self.assertNotIn("data:image", json.dumps(stored.request))
            self.assertIn(workspace_url, json.dumps(stored.request))

    async def test_inline_provider_output_is_materialized_before_persistence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            store = SqliteGenerationRunStore(
                root / "generation-runs.sqlite3",
                workspace_id="workspace-isolation",
            )
            store_executor = GenerationRunStoreExecutor(
                max_workers=1,
                max_pending=16,
            )
            lifecycle = AsyncGenerationRunLifecycleStore(
                store=store,
                store_executor=store_executor,
            )
            provider_calls = []

            class Executor:
                async def execute(self, request, checkpoint=None):
                    del checkpoint
                    provider_calls.append(request.prompt)
                    image = (
                        "data:image/png;base64,aW5saW5l"
                        if request.prompt == "poison"
                        else "https://provider.test/safe.png"
                    )
                    return Completed(
                        ProviderOutput(
                            media=(image,),
                            raw={
                                "images": [image],
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "cmF3LW1lZGlhLWJ5dGVz",
                                },
                            },
                            legacy={"images": [image]},
                        )
                    )

            async def save_image(_value, **_options):
                return "/assets/output/materialized.png"

            async def notify(_record, **_options):
                return None

            effects = WorkspaceGenerationEffects(
                GenerationOutputPorts(
                    save_image=save_image,
                    image_meta=lambda url, _source: {"url": url},
                    extract_images=lambda raw: list(raw.get("images") or []),
                ),
                publication=SqliteGenerationPublication(
                    store=store,
                    store_executor=store_executor,
                    notify=notify,
                    worker_id="isolation-worker",
                ),
            )
            runs = GenerationRuns(
                executor=Executor(),
                effects=effects,
                store_path=lambda: None,
                lifecycle_store=lifecycle,
            )
            try:
                first = await runs.start(
                    ImageRun(
                        prompt="poison",
                        settings={"provider_id": "provider-a"},
                        publication="history",
                    ),
                    owner="designer-1",
                    delivery=Inline(),
                )
                await runs.wait_for_lifecycle_projection()

                second = await runs.start(
                    ImageRun(
                        prompt="safe",
                        settings={"provider_id": "provider-b"},
                        publication="history",
                    ),
                    owner="designer-1",
                    delivery=Inline(),
                )
                await runs.wait_for_lifecycle_projection()
            finally:
                await lifecycle.close()
                await store_executor.close()

            self.assertEqual("succeeded", first.status)
            self.assertEqual("succeeded", second.status)
            self.assertEqual(["poison", "safe"], provider_calls)
            stored = store.load(first.id)
            self.assertIsNotNone(stored)
            self.assertNotIn("data:image", json.dumps(stored.provider_output))
            self.assertNotIn("cmF3LW1lZGlhLWJ5dGVz", json.dumps(stored.provider_output))
            self.assertIn(
                "/assets/output/materialized.png",
                json.dumps(stored.provider_output),
            )

    async def test_lifecycle_failure_isolated_from_next_apimart_and_cli_runs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            store = SqliteGenerationRunStore(
                root / "generation-runs.sqlite3",
                workspace_id="workspace-failure-isolation",
            )
            store_executor = GenerationRunStoreExecutor(max_workers=1, max_pending=16)
            delegate = AsyncGenerationRunLifecycleStore(
                store=store,
                store_executor=store_executor,
            )

            class FailOneProjection:
                failed = False
                run_id = ""

                async def persist(self, value, *, effect=None):
                    if (
                        not self.failed
                        and value.get("phase") == "provider_completed"
                        and value.get("request", {}).get("prompt") == "poison"
                    ):
                        self.failed = True
                        self.run_id = str(value.get("id") or "")
                        raise GenerationRunStoreError(
                            "inline_media_not_materialized",
                            "media data URLs must be materialized before persistence",
                        )
                    return await delegate.persist(value, effect=effect)

                async def load(self, run_id):
                    return await delegate.load(run_id)

                async def load_unfinished(self, *, limit=1000):
                    return await delegate.load_unfinished(limit=limit)

            provider_calls = []

            class Executor:
                async def execute(self, request, checkpoint=None):
                    del checkpoint
                    provider_calls.append(
                        (request.settings.get("provider_id"), request.prompt)
                    )
                    return Completed(ProviderOutput(
                        media=("https://provider.test/output.png",),
                        raw={"images": ["https://provider.test/output.png"]},
                        legacy={"images": ["https://provider.test/output.png"]},
                    ))

            async def save_image(_value, **_options):
                return "/assets/output/materialized.png"

            effects = WorkspaceGenerationEffects(
                GenerationOutputPorts(
                    save_image=save_image,
                    image_meta=lambda url, _source: {"url": url},
                    extract_images=lambda raw: list(raw.get("images") or []),
                ),
                publication=SqliteGenerationPublication(
                    store=store,
                    store_executor=store_executor,
                    notify=None,
                    worker_id="failure-isolation-worker",
                ),
            )
            failing_lifecycle = FailOneProjection()
            runs = GenerationRuns(
                executor=Executor(),
                effects=effects,
                store_path=lambda: None,
                lifecycle_store=failing_lifecycle,
            )
            try:
                with self.assertRaises(GenerationRunLifecycleProjectionError):
                    await runs.start(
                        ImageRun(
                            prompt="poison",
                            settings={"provider_id": "provider-a"},
                        ),
                        owner="designer-1",
                        delivery=Inline(),
                    )
                apimart = await runs.start(
                    ImageRun(
                        prompt="safe-apimart",
                        settings={"provider_id": "apimart"},
                    ),
                    owner="designer-1",
                    delivery=Inline(),
                )
                cli = await runs.start(
                    ImageRun(
                        prompt="safe-cli",
                        settings={"provider_id": "gemini-cli"},
                    ),
                    owner="designer-1",
                    delivery=Inline(),
                )
                await runs.wait_for_lifecycle_projection()
            finally:
                await delegate.close()
                await store_executor.close()

            self.assertEqual("succeeded", apimart.status)
            self.assertEqual("succeeded", cli.status)
            failed = store.load(failing_lifecycle.run_id)
            self.assertIsNotNone(failed)
            self.assertEqual("failed", failed.status)
            self.assertEqual((), failed.remote_refs)
            self.assertEqual(
                [
                    ("provider-a", "poison"),
                    ("apimart", "safe-apimart"),
                    ("gemini-cli", "safe-cli"),
                ],
                provider_calls,
            )

    async def test_restores_unfinished_runs_from_lifecycle_store_without_json(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            json_path = root / "generation-runs.json"
            store = SqliteGenerationRunStore(
                root / "generation-runs.sqlite3",
                workspace_id="workspace-1",
            )
            store.save(
                GenerationRunState(
                    run_id="run-pending-1",
                    kind="image",
                    status="pending",
                    phase="provider_submitted",
                    owner="designer-1",
                    key="request-key-1",
                    request_hash="request-hash-1",
                    provider_id="provider-a",
                    created_at=10,
                    updated_at=11,
                    request={
                        "prompt": "恢复中的图片",
                        "settings": {"provider_id": "provider-a"},
                    },
                    target={
                        "canvas_id": "canvas-1",
                        "node_id": "node-1",
                        "operation_id": "operation-1",
                        "request_index": 0,
                    },
                    remote_refs=(("provider-a", "remote-task-1"),),
                    recoverable=True,
                )
            )
            store_executor = GenerationRunStoreExecutor(
                max_workers=1,
                max_pending=4,
            )
            lifecycle_store = AsyncGenerationRunLifecycleStore(
                store=store,
                store_executor=store_executor,
            )
            runs = GenerationRuns(
                executor=object(),
                effects=object(),
                store_path=lambda: None,
                lifecycle_store=lifecycle_store,
            )
            try:
                restored = await runs.restore_lifecycle_authority()
                snapshot = runs.get("run-pending-1", owner="designer-1")
            finally:
                await store_executor.close()

            self.assertEqual(1, restored)
            self.assertEqual("pending", snapshot.status)
            self.assertEqual(("remote-task-1",), snapshot.remote_refs)
            self.assertEqual("canvas-1", snapshot.target.canvas_id)
            self.assertFalse(json_path.exists())

    async def test_real_composition_runs_image_video_text_restart_and_never_touches_json(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "assets" / "output"
            output.mkdir(parents=True)
            legacy_paths = tuple(
                root / name
                for name in (
                    "generation-history.json",
                    "generation-effects.json",
                    "generation-runs.json",
                )
            )
            sentinels = (b"history-sentinel", b"effects-sentinel", b"runs-sentinel")
            for path, payload in zip(legacy_paths, sentinels):
                path.write_bytes(payload)
            before = {
                path: (path.read_bytes(), path.stat().st_mtime_ns)
                for path in legacy_paths
            }
            database = root / "generation-runs.sqlite3"
            store = SqliteGenerationRunStore(
                database,
                workspace_id="workspace-runtime",
            )
            executor = GenerationRunStoreExecutor(max_workers=1, max_pending=16)
            notifications = []

            async def notify(record, *, effect_id=""):
                notifications.append((effect_id, dict(record)))

            async def save_image(value, **_options):
                del value
                path = output / "image.png"
                path.write_bytes(b"image")
                return "/assets/output/image.png"

            effects = WorkspaceGenerationEffects(
                GenerationOutputPorts(
                    save_image=save_image,
                    image_meta=lambda url, _source: {"url": url, "kind": "image"},
                    extract_images=lambda raw: list(raw.get("images") or []),
                ),
                publication=SqliteGenerationPublication(
                    store=store,
                    store_executor=executor,
                    notify=notify,
                    worker_id="runtime-worker",
                ),
            )
            lifecycle = AsyncGenerationRunLifecycleStore(
                store=store,
                store_executor=executor,
            )

            class ThreeMediaExecutor:
                async def execute(self, request, checkpoint=None):
                    del checkpoint
                    if isinstance(request, ImageRun):
                        return Completed(
                            ProviderOutput(
                                raw={"images": ["provider-image.png"]},
                                legacy=(
                                    {"type": "url", "value": "provider-image.png"},
                                    {},
                                ),
                            )
                        )
                    if isinstance(request, VideoRun):
                        (output / "video.mp4").write_bytes(b"video")
                        return Completed(
                            ProviderOutput(
                                media=("/assets/output/video.mp4",),
                                legacy={
                                    "type": "video",
                                    "provider_id": "provider-video",
                                    "model": "video-v1",
                                    "timestamp": 20,
                                    "videos": ["/assets/output/video.mp4"],
                                },
                            )
                        )
                    (output / "transcript.txt").write_bytes(b"text")
                    return Completed(
                        ProviderOutput(
                            media=("/assets/output/transcript.txt",),
                            legacy={
                                "type": "text",
                                "provider_id": "provider-text",
                                "model": "text-v1",
                                "timestamp": 10,
                                "texts": ["/assets/output/transcript.txt"],
                            },
                        )
                    )

            runs = GenerationRuns(
                executor=ThreeMediaExecutor(),
                effects=effects,
                store_path=lambda: None,
                lifecycle_store=lifecycle,
            )
            try:
                snapshots = (
                    await runs.start(
                        ImageRun(
                            prompt="image",
                            settings={
                                "provider_id": "provider-image",
                                "model": "image-v2",
                            },
                            publication="history",
                        ),
                        owner="designer-1",
                        key="image-operation",
                        delivery=Inline(),
                    ),
                    await runs.start(
                        VideoRun(
                            payload={"provider_id": "provider-video"},
                            publication="history",
                        ),
                        owner="designer-1",
                        key="video-operation",
                        delivery=Inline(),
                    ),
                    await runs.start(
                        TextRun(
                            payload={"provider_id": "provider-text"},
                            publication="history",
                        ),
                        owner="designer-1",
                        key="text-operation",
                        delivery=Inline(),
                    ),
                )
                await runs.wait_for_lifecycle_projection()
                first_page = await effects.history_page(limit=2)
                second_page = await effects.history_page(
                    limit=2, cursor=first_page.next_cursor
                )

                restarted_effects = WorkspaceGenerationEffects(
                    GenerationOutputPorts(
                        save_image=save_image,
                        image_meta=lambda url, _source: {"url": url},
                        extract_images=lambda raw: list(raw.get("images") or []),
                    ),
                    publication=SqliteGenerationPublication(
                        store=SqliteGenerationRunStore(
                            database,
                            workspace_id="workspace-runtime",
                        ),
                        store_executor=executor,
                        notify=notify,
                        worker_id="restart-worker",
                    ),
                )
                restarted_page = await restarted_effects.history_page(limit=10)
                deleted = await restarted_effects.delete_history(
                    history_id=restarted_page.items[1]["history_id"]
                )
            finally:
                await executor.close()

            self.assertTrue(all(snapshot.status == "succeeded" for snapshot in snapshots))
            self.assertEqual(3, len(first_page.items) + len(second_page.items))
            self.assertEqual(3, len(restarted_page.items))
            self.assertEqual({"success": True}, deleted)
            self.assertEqual(3, len(notifications))
            self.assertEqual(
                {"online", "video", "text"},
                {item["type"] for item in restarted_page.items},
            )
            self.assertEqual(2, store.integrity()["counts"]["history"])
            self.assertTrue((output / "video.mp4").is_file())
            for path, expected in before.items():
                self.assertEqual(expected, (path.read_bytes(), path.stat().st_mtime_ns))

    async def test_pending_notification_replays_once_after_restart_with_stable_effect_id(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "generation-runs.sqlite3"
            store = SqliteGenerationRunStore(
                database,
                workspace_id="workspace-replay",
            )
            store.save(
                GenerationRunState(
                    run_id="run-replay",
                    kind="image",
                    status="succeeded",
                    phase="output_prepared",
                    owner="designer-1",
                    key="replay-key",
                    request_hash="replay-hash",
                    provider_id="provider-a",
                    created_at=1,
                    updated_at=2,
                    prepared_output={
                        "effects": {
                            "notification": {
                                "images": ["/assets/output/replay.png"]
                            }
                        }
                    },
                )
            )
            executor = GenerationRunStoreExecutor()
            first_calls = []

            async def interrupted(record, *, effect_id=""):
                first_calls.append((effect_id, dict(record)))
                raise RuntimeError("transport interrupted")

            first = SqliteGenerationPublication(
                store=store,
                store_executor=executor,
                notify=interrupted,
                worker_id="first-worker",
                retry_delay_seconds=0,
            )
            with self.assertRaisesRegex(RuntimeError, "transport interrupted"):
                await first.publish_notification(
                    "run-replay",
                    {"images": ["/assets/output/replay.png"]},
                )

            restarted_calls = []

            async def delivered(record, *, effect_id=""):
                restarted_calls.append((effect_id, dict(record)))

            restarted = SqliteGenerationPublication(
                store=SqliteGenerationRunStore(
                    database,
                    workspace_id="workspace-replay",
                ),
                store_executor=executor,
                notify=delivered,
                worker_id="restart-worker",
                retry_delay_seconds=0,
            )
            try:
                recovered = await restarted.recover_pending()
                repeated = await restarted.recover_pending()
            finally:
                await executor.close()

            effect_id = "generation-run:run-replay:notification"
            self.assertEqual(effect_id, first_calls[0][0])
            self.assertEqual([(effect_id, {"images": ["/assets/output/replay.png"]})], restarted_calls)
            self.assertEqual({"recovered": 1, "failed": {}}, recovered)
            self.assertEqual({"recovered": 0, "failed": {}}, repeated)
            self.assertEqual(0, store.integrity()["counts"]["pending_publications"])
            for name in (
                "generation-history.json",
                "generation-effects.json",
                "generation-runs.json",
            ):
                self.assertFalse((root / name).exists())


if __name__ == "__main__":
    unittest.main()
