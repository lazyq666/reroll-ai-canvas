import asyncio
import unittest

from infinite_canvas.providers import (
    Capability,
    Completed,
    Failed,
    Pending,
    ProviderAdapter,
    ProviderCapabilityError,
    ProviderInspectorAdapter,
    ProviderInspectorRegistry,
    ProviderRegistry,
    Queued,
)
from infinite_canvas.providers.runtime import (
    ImageExecutors,
    ProviderOutput,
    ProviderRuntime,
    RecoveryExecutors,
    TextDelivery,
    TextExecutors,
    TextStreamEventKind,
    VideoExecutors,
    WorkflowExecutors,
    build_image_registry,
    build_recovery_registry,
    build_text_registry,
    build_video_registry,
    build_workflow_registry,
)


class ProviderRegistryTests(unittest.TestCase):
    def test_registry_selects_highest_priority_matching_real_capability(self):
        calls = []

        async def generic_image(**request):
            calls.append(("generic", request["prompt"]))
            return Completed({"kind": "complete"})

        async def cli_image(**request):
            calls.append(("cli", request["prompt"]))
            return Queued("local-queue-1", {"kind": "queued"})

        registry = ProviderRegistry()
        registry.extend(
            [
                ProviderAdapter(
                    "generic-http",
                    lambda _provider, _request: True,
                    {Capability.IMAGE: generic_image},
                ),
                ProviderAdapter(
                    "cli",
                    lambda provider, _request: provider.get("protocol") == "cli",
                    {Capability.IMAGE: cli_image},
                    priority=100,
                ),
            ]
        )

        result = asyncio.run(
            registry.execute(
                {"id": "local", "protocol": "cli"},
                Capability.IMAGE,
                prompt="draw",
            )
        )

        self.assertEqual("local-queue-1", result.queue_ref)
        self.assertEqual({"kind": "queued"}, result.raw)
        self.assertEqual([("cli", "draw")], calls)

    def test_adapter_does_not_claim_fake_lifecycle_capabilities(self):
        async def generate(**_request):
            return Completed({"kind": "complete"})

        adapter = ProviderAdapter(
            "inline-only",
            lambda _provider, _request: True,
            {Capability.IMAGE: generate},
        )

        self.assertEqual({Capability.IMAGE}, set(adapter.capabilities))
        self.assertFalse(hasattr(adapter, "submit"))
        self.assertFalse(hasattr(adapter, "poll"))
        self.assertFalse(hasattr(adapter, "cancel"))

    def test_missing_capability_has_provider_facing_error(self):
        registry = ProviderRegistry()
        registry.register(
            ProviderAdapter("text-only", lambda _provider, _request: True, {})
        )

        with self.assertRaisesRegex(
            ProviderCapabilityError, "Example does not support video"
        ):
            registry.select({"id": "example", "name": "Example"}, Capability.VIDEO)

    def test_execution_results_require_recovery_references(self):
        with self.assertRaisesRegex(ValueError, "remote_ref"):
            Pending("")
        with self.assertRaisesRegex(ValueError, "queue_ref"):
            Queued("")
        with self.assertRaisesRegex(ValueError, "invalid pending"):
            Pending("remote-1", status="succeeded")

    def test_inspector_registry_owns_settings_behaviour_selection(self):
        class Inspector:
            async def status(self, provider):
                return {"provider": provider["id"], "available": True}

            async def test_connection(self, provider, **request):
                return {"ok": request["token"] == "fake"}

            async def model_catalog(self, provider, **request):
                return {"models": [provider["id"]]}

        registry = ProviderInspectorRegistry()
        inspector = Inspector()
        registry.register(
            ProviderInspectorAdapter(
                "http-inspector",
                lambda provider, _request: provider.get("protocol") == "openai",
                inspector,
            )
        )

        selected = registry.select({"id": "demo", "protocol": "openai"})
        self.assertIs(inspector, selected)
        self.assertEqual(
            {"provider": "demo", "available": True},
            asyncio.run(selected.status({"id": "demo"})),
        )

    def test_production_image_registry_hides_vendor_selection_from_caller(self):
        calls = []

        def fake(name):
            async def execute(*args):
                calls.append((name, args[-1].get("id") if isinstance(args[-1], dict) else args[-1]))
                return ({"type": "url", "value": f"https://fake/{name}.png"}, {})

            return execute

        async def fake_http(*args):
            calls.append(("http", args[-1]))
            return ({"type": "url", "value": "https://fake/http.png"}, {})

        executors = ImageExecutors(
            http=fake_http,
            modelscope=fake("modelscope"),
            codex=fake("codex"),
            gemini_cli=fake("gemini-cli"),
            jimeng=fake("jimeng"),
            runninghub=fake("runninghub"),
            gemini_native=fake("gemini"),
            volcengine=fake("volcengine"),
        )
        providers = {
            "cli": {"id": "cli", "protocol": "codex"},
            "runninghub": {"id": "runninghub", "protocol": "runninghub"},
            "gemini-model": {
                "id": "mixed",
                "protocol": "openai",
                "model_protocols": {"native-image": "gemini"},
            },
            "api": {"id": "api", "protocol": "openai"},
        }
        runtime = ProviderRuntime(
            provider_lookup=providers.__getitem__,
            image_registry=build_image_registry(executors),
        )

        asyncio.run(
            runtime.generate_image("p", "1x1", "", "m", provider_id="cli")
        )
        asyncio.run(
            runtime.generate_image(
                "p", "1x1", "", "rh-model", provider_id="runninghub"
            )
        )
        asyncio.run(
            runtime.generate_image(
                "p", "1x1", "", "native-image", provider_id="gemini-model"
            )
        )
        asyncio.run(
            runtime.generate_image("p", "1x1", "", "m", provider_id="api")
        )

        self.assertEqual(
            ["codex", "runninghub", "gemini", "http"],
            [item[0] for item in calls],
        )

    def test_jimeng_pending_is_typed_then_legacy_facade_reraises(self):
        class PendingError(Exception):
            submit_id = "jimeng-task-1"

        async def pending(*_args):
            raise PendingError("queued")

        async def complete(*_args):
            return ({}, {})

        executors = ImageExecutors(
            http=complete,
            modelscope=complete,
            codex=complete,
            gemini_cli=complete,
            jimeng=pending,
            runninghub=complete,
            gemini_native=complete,
            volcengine=complete,
        )
        registry = build_image_registry(executors)
        provider = {"id": "jimeng", "protocol": "jimeng"}
        typed = asyncio.run(
            registry.execute(
                provider,
                Capability.IMAGE,
                prompt="p",
                size="1x1",
                quality="",
                model="m",
                reference_images=[],
            )
        )
        self.assertIsInstance(typed, Queued)
        self.assertEqual("jimeng-task-1", typed.queue_ref)

        runtime = ProviderRuntime(lambda _provider_id: provider, registry)
        with self.assertRaises(PendingError):
            asyncio.run(
                runtime.generate_image(
                    "p", "1x1", "", "m", provider_id="jimeng"
                )
            )

    def test_video_registry_selects_runninghub_without_route_branching(self):
        calls = []

        async def fake_http(_payload, _provider):
            calls.append("http")
            return {"videos": ["https://fake/http.mp4"]}

        async def fake_jimeng(_payload, _provider):
            calls.append("jimeng")
            return {"videos": ["https://fake/jimeng.mp4"]}

        async def fake_runninghub(_payload, _provider):
            calls.append("runninghub")
            return {"videos": ["https://fake/runninghub.mp4"]}

        class Payload:
            provider_id = "rh"

        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "runninghub",
                "protocol": "runninghub",
            },
            image_registry=ProviderRegistry(),
            video_registry=build_video_registry(
                VideoExecutors(
                    http=fake_http,
                    jimeng=fake_jimeng,
                    runninghub=fake_runninghub,
                )
            ),
        )

        result = asyncio.run(runtime.generate_video(Payload()))

        self.assertEqual(["runninghub"], calls)
        self.assertEqual(
            {"videos": ["https://fake/runninghub.mp4"]}, result
        )

    def test_execute_methods_return_normalized_execution_results(self):
        async def fake_image(*_args):
            return (
                {"type": "url", "value": "https://fake/image.png"},
                {"request_id": "image-1"},
            )

        async def fake_video(_payload, _provider):
            return {"videos": ["https://fake/video.mp4"]}

        image_executors = ImageExecutors(
            http=fake_image,
            modelscope=fake_image,
            codex=fake_image,
            gemini_cli=fake_image,
            jimeng=fake_image,
            runninghub=fake_image,
            gemini_native=fake_image,
            volcengine=fake_image,
        )
        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "fake",
                "protocol": "openai",
            },
            image_registry=build_image_registry(image_executors),
            video_registry=build_video_registry(
                VideoExecutors(
                    http=fake_video,
                    jimeng=fake_video,
                    runninghub=fake_video,
                )
            ),
        )

        image_result = asyncio.run(
            runtime.execute_image(
                "p", "1024x1024", "auto", "fake", provider_id="fake"
            )
        )

        class VideoPayload:
            provider_id = "fake"

        video_result = asyncio.run(runtime.execute_video(VideoPayload()))

        self.assertIsInstance(image_result, Completed)
        self.assertIsInstance(image_result.output, ProviderOutput)
        self.assertEqual(
            ({"type": "url", "value": "https://fake/image.png"},),
            image_result.output.media,
        )
        self.assertIsInstance(video_result, Completed)
        self.assertEqual(
            ("https://fake/video.mp4",), video_result.output.media
        )

    def test_text_registry_handles_cli_and_http_delivery_and_streams(self):
        async def fake_http(_provider, _payload, _messages):
            return {
                "text": "http reply",
                "model": "http-model",
                "raw_usage": {"tokens": 3},
                "raw": {"id": "http-1"},
            }

        async def fake_http_stream(_provider, _payload, _messages):
            async def events():
                yield {"type": "delta", "delta": "http "}
                yield {"type": "delta", "delta": "stream"}
                yield {"type": "usage", "usage": {"tokens": 4}}

            return {"model": "http-model", "events": events()}

        async def fake_cli(_payload, _history):
            return "cli reply", {"command": ["fake"]}

        registry = build_text_registry(
            TextExecutors(
                http=fake_http,
                http_stream=fake_http_stream,
                codex=fake_cli,
                gemini_cli=fake_cli,
                codex_default_model="codex-default",
                gemini_cli_default_model="gemini-default",
            )
        )
        providers = {
            "cli": {
                "id": "cli",
                "protocol": "codex",
                "chat_models": ["codex-configured"],
            },
            "http": {"id": "http", "protocol": "openai"},
        }
        runtime = ProviderRuntime(
            provider_lookup=providers.__getitem__,
            image_registry=ProviderRegistry(),
            text_registry=registry,
        )

        class Payload:
            model = ""
            ms_model = ""

            def __init__(self, provider):
                self.provider = provider

        cli_payload = Payload("cli")
        http_payload = Payload("http")
        cli_result = asyncio.run(
            runtime.execute_text(cli_payload, [], [{"role": "user"}])
        )
        http_result = asyncio.run(
            runtime.execute_text(http_payload, [], [{"role": "user"}])
        )
        cli_stream = asyncio.run(
            runtime.execute_text_stream(
                cli_payload, [], [{"role": "user"}]
            )
        )
        http_stream = asyncio.run(
            runtime.execute_text_stream(
                http_payload, [], [{"role": "user"}]
            )
        )

        async def collect(result):
            return [event async for event in result.output.events]

        cli_events = asyncio.run(collect(cli_stream))
        http_events = asyncio.run(collect(http_stream))

        self.assertEqual(TextDelivery.BUFFERED, runtime.text_delivery(cli_payload))
        self.assertEqual(TextDelivery.STREAMING, runtime.text_delivery(http_payload))
        self.assertEqual("cli reply", cli_result.output.text)
        self.assertTrue(cli_result.output.metadata["expose_raw"])
        self.assertEqual("http reply", http_result.output.text)
        self.assertEqual(
            [TextStreamEventKind.DELTA, TextStreamEventKind.COMPLETE],
            [event.kind for event in cli_events],
        )
        self.assertEqual(
            [
                TextStreamEventKind.DELTA,
                TextStreamEventKind.DELTA,
                TextStreamEventKind.USAGE,
            ],
            [event.kind for event in http_events],
        )

    def test_recovery_uses_recovery_adapter_without_resubmitting(self):
        calls = []

        async def submit(*_args):
            calls.append("submit")
            return ({}, {})

        async def recover(_provider, task_id):
            calls.append(("recover", task_id))
            return {
                "status": "running",
                "task_id": task_id,
                "images": [],
            }

        image_executors = ImageExecutors(
            http=submit,
            modelscope=submit,
            codex=submit,
            gemini_cli=submit,
            jimeng=submit,
            runninghub=submit,
            gemini_native=submit,
            volcengine=submit,
        )
        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "fake",
                "protocol": "openai",
            },
            image_registry=build_image_registry(image_executors),
            recovery_registry=build_recovery_registry(
                RecoveryExecutors(http=recover, runninghub=recover)
            ),
        )

        result = asyncio.run(runtime.execute_recovery("fake", "task-1"))

        self.assertIsInstance(result, Pending)
        self.assertEqual([("recover", "task-1")], calls)
        self.assertEqual("task-1", result.remote_ref)
        self.assertEqual(("task-1",), result.raw.remote_refs)

    def test_jimeng_recovery_preserves_media_kind_and_legacy_json(self):
        calls = []
        legacy = {
            "status": "succeeded",
            "submit_id": "jimeng-task-1",
            "kind": "video",
            "urls": ["video.mp4"],
        }

        async def generic_recover(_provider, _task_id):
            raise AssertionError("generic recovery selected")

        async def jimeng_recover(_provider, task_id, kind):
            calls.append((task_id, kind))
            return legacy

        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "custom-jimeng",
                "protocol": "jimeng",
            },
            image_registry=ProviderRegistry(),
            recovery_registry=build_recovery_registry(
                RecoveryExecutors(
                    http=generic_recover,
                    runninghub=generic_recover,
                    jimeng=jimeng_recover,
                )
            ),
        )

        result = asyncio.run(
            runtime.execute_recovery(
                "custom-jimeng",
                "jimeng-task-1",
                "video",
            )
        )

        self.assertIsInstance(result, Completed)
        self.assertEqual([("jimeng-task-1", "video")], calls)
        self.assertEqual(legacy, result.output.legacy)
        self.assertEqual("video", result.output.metadata["media_kind"])

    def test_workflow_pending_result_preserves_remote_reference(self):
        async def complete(_payload):
            return {"ok": True}

        async def pending(_payload):
            return {"status": "pending", "task_id": "workflow-task-1"}

        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "fake",
                "protocol": "local",
            },
            image_registry=ProviderRegistry(),
            workflow_registry=build_workflow_registry(
                WorkflowExecutors(
                    comfyui=complete,
                    modelscope=pending,
                    modelscope_cloud=complete,
                    modelscope_angle=complete,
                    modelscope_angle_recovery=complete,
                    runninghub_submit=complete,
                    runninghub_query=complete,
                    runninghub_app_submit=complete,
                    runninghub_upload_asset=complete,
                )
            ),
        )

        result = asyncio.run(
            runtime.execute_workflow("modelscope", object())
        )

        self.assertIsInstance(result, Pending)
        self.assertEqual("workflow-task-1", result.remote_ref)
        self.assertIsInstance(result.raw, ProviderOutput)

    def test_failed_recovery_is_typed_and_legacy_facade_returns_mapping(self):
        failure = {
            "status": "failed",
            "task_id": "task-failed",
            "error": "provider rejected the task",
        }

        async def recover(_provider, _task_id):
            return failure

        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "fake",
                "protocol": "openai",
            },
            image_registry=ProviderRegistry(),
            recovery_registry=build_recovery_registry(
                RecoveryExecutors(http=recover, runninghub=recover)
            ),
        )

        result = asyncio.run(
            runtime.execute_recovery("fake", "task-failed")
        )

        self.assertIsInstance(result, Failed)
        self.assertEqual("failed", result.status)
        self.assertEqual("provider rejected the task", result.error)
        self.assertIsInstance(result.raw, ProviderOutput)
        self.assertEqual(
            failure,
            asyncio.run(
                runtime.recover_image_task("fake", "task-failed")
            ),
        )

    def test_cancelled_workflow_is_typed_failed_result(self):
        async def complete(_payload):
            return {"ok": True}

        async def cancelled(_payload):
            return {
                "data": {
                    "status": "cancelled",
                    "message": "cancelled by user",
                }
            }

        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "fake",
                "protocol": "local",
            },
            image_registry=ProviderRegistry(),
            workflow_registry=build_workflow_registry(
                WorkflowExecutors(
                    comfyui=cancelled,
                    modelscope=complete,
                    modelscope_cloud=complete,
                    modelscope_angle=complete,
                    modelscope_angle_recovery=complete,
                    runninghub_submit=complete,
                    runninghub_query=complete,
                    runninghub_app_submit=complete,
                    runninghub_upload_asset=complete,
                )
            ),
        )

        result = asyncio.run(
            runtime.execute_workflow("comfyui", object())
        )

        self.assertIsInstance(result, Failed)
        self.assertEqual("cancelled", result.status)
        self.assertEqual("cancelled by user", result.error)

    def test_failed_and_cancelled_video_results_never_become_completed(self):
        async def failed(_payload, _provider, on_remote=None):
            del on_remote
            return {
                "status": "failed",
                "error": "render rejected",
            }

        async def cancelled(_payload, _provider, on_remote=None):
            del on_remote
            return {
                "data": {
                    "status": "cancelled",
                    "message": "stopped by user",
                }
            }

        provider = {"id": "fake", "protocol": "openai"}
        for executor, expected_status, expected_error in (
            (failed, "failed", "render rejected"),
            (cancelled, "cancelled", "stopped by user"),
        ):
            with self.subTest(status=expected_status):
                runtime = ProviderRuntime(
                    provider_lookup=lambda _provider_id: provider,
                    image_registry=ProviderRegistry(),
                    video_registry=build_video_registry(
                        VideoExecutors(
                            http=executor,
                            jimeng=executor,
                            runninghub=executor,
                        )
                    ),
                )
                result = asyncio.run(
                    runtime.execute_video(
                        type("Payload", (), {"provider_id": "fake"})()
                    )
                )
                self.assertIsInstance(result, Failed)
                self.assertEqual(expected_status, result.status)
                self.assertEqual(expected_error, result.error)

    def test_http_native_count_is_mode_accurate(self):
        async def executor(*_args, **_kwargs):
            return {"images": []}

        providers = {
            "responses": {
                "id": "responses",
                "protocol": "openai",
                "image_request_mode": "openai-responses",
            },
            "json": {
                "id": "json",
                "protocol": "openai",
                "image_request_mode": "openai-json",
            },
            "video-proxy": {
                "id": "video-proxy",
                "protocol": "openai",
                "image_request_mode": "openai-video-proxy",
            },
            "midjourney": {
                "id": "midjourney",
                "protocol": "apimart",
                "base_url": "https://api.apimart.ai",
            },
            "regular": {"id": "regular", "protocol": "openai"},
        }
        executors = ImageExecutors(
            http=executor,
            modelscope=executor,
            codex=executor,
            gemini_cli=executor,
            jimeng=executor,
            runninghub=executor,
            gemini_native=executor,
            volcengine=executor,
        )
        runtime = ProviderRuntime(
            provider_lookup=providers.__getitem__,
            image_registry=build_image_registry(executors),
        )

        self.assertFalse(runtime.image_native_count("responses", {}))
        self.assertFalse(runtime.image_native_count("json", {}))
        self.assertFalse(runtime.image_native_count("video-proxy", {}))
        self.assertFalse(
            runtime.image_native_count(
                "midjourney", {"model": "midjourney"}
            )
        )
        self.assertFalse(
            runtime.image_native_count(
                "regular",
                {"model": "gpt-image-2", "_reference_count": 0},
            )
        )
        self.assertTrue(
            runtime.image_native_count(
                "regular",
                {"model": "gpt-image-2", "_reference_count": 1},
            )
        )
        self.assertTrue(
            runtime.image_native_count(
                "regular", {"model": "flux"}
            )
        )

    def test_runninghub_app_and_upload_use_workflow_registry(self):
        calls = []

        async def complete(_payload):
            return {"ok": True}

        async def app_submit(payload):
            calls.append(("app", payload))
            return {"success": True, "data": {"taskId": "app-task-1"}}

        async def upload_asset(payload):
            calls.append(("upload", payload))
            return {
                "success": True,
                "data": {"fileName": "asset.png", "fileType": "image/png"},
            }

        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "runninghub",
                "protocol": "runninghub",
            },
            image_registry=ProviderRegistry(),
            workflow_registry=build_workflow_registry(
                WorkflowExecutors(
                    comfyui=complete,
                    modelscope=complete,
                    modelscope_cloud=complete,
                    modelscope_angle=complete,
                    modelscope_angle_recovery=complete,
                    runninghub_submit=complete,
                    runninghub_query=complete,
                    runninghub_app_submit=app_submit,
                    runninghub_upload_asset=upload_asset,
                )
            ),
        )

        app_payload = object()
        upload_payload = object()
        app_result = asyncio.run(
            runtime.execute_workflow(
                "runninghub-app-submit", app_payload, "runninghub"
            )
        )
        upload_result = asyncio.run(
            runtime.execute_workflow(
                "runninghub-upload-asset", upload_payload, "runninghub"
            )
        )

        self.assertIsInstance(app_result, Queued)
        self.assertEqual("app-task-1", app_result.queue_ref)
        self.assertIsInstance(upload_result, Completed)
        self.assertEqual(
            "asset.png",
            upload_result.output.legacy["data"]["fileName"],
        )
        self.assertEqual(
            [("app", app_payload), ("upload", upload_payload)],
            calls,
        )

    def test_unknown_workflow_operation_is_unsupported(self):
        async def complete(_payload):
            return {"ok": True}

        runtime = ProviderRuntime(
            provider_lookup=lambda _provider_id: {
                "id": "fake",
                "protocol": "local",
            },
            image_registry=ProviderRegistry(),
            workflow_registry=build_workflow_registry(
                WorkflowExecutors(
                    comfyui=complete,
                    modelscope=complete,
                    modelscope_cloud=complete,
                    modelscope_angle=complete,
                    modelscope_angle_recovery=complete,
                    runninghub_submit=complete,
                    runninghub_query=complete,
                    runninghub_app_submit=complete,
                    runninghub_upload_asset=complete,
                )
            ),
        )

        with self.assertRaisesRegex(
            ProviderCapabilityError,
            "does not support workflow",
        ):
            asyncio.run(
                runtime.execute_workflow("unknown-operation", object())
            )

    def test_image_engine_comes_from_adapter_metadata(self):
        async def fake(*_args):
            return ({}, {})

        executors = ImageExecutors(
            http=fake,
            modelscope=fake,
            codex=fake,
            gemini_cli=fake,
            jimeng=fake,
            runninghub=fake,
            gemini_native=fake,
            volcengine=fake,
        )
        providers = {
            "rh": {"id": "runninghub", "protocol": "runninghub"},
            "volc": {"id": "volc", "protocol": "volcengine"},
            "http": {"id": "http", "protocol": "openai"},
        }
        runtime = ProviderRuntime(
            provider_lookup=providers.__getitem__,
            image_registry=build_image_registry(executors),
        )

        self.assertEqual("runninghub", runtime.image_engine("rh"))
        self.assertEqual("volcengine", runtime.image_engine("volc"))
        self.assertEqual("api", runtime.image_engine("http"))


if __name__ == "__main__":
    unittest.main()
