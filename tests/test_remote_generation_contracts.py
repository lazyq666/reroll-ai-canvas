import asyncio
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.generation_runs import (
    GenerationRuns,
    ImageRun,
    ProviderGenerationExecutor,
    RecoveryRun,
    WorkflowRun,
)
from infinite_canvas.providers import (
    cli_impl,
    comfyui_impl,
    http_impl,
    modelscope_impl,
    runninghub_impl,
)
from infinite_canvas.providers.core import Completed, Failed, Pending
from infinite_canvas.providers.runtime import (
    ProviderOutput,
    ProviderRuntime,
    RecoveryExecutors,
    build_recovery_registry,
)


class _StopAtFirstPoll(RuntimeError):
    pass


class _JsonResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)
        self.reason_phrase = "OK"
        self.headers = {}
        self.content = b""

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class _Effects:
    async def publish(self, _run_id, _request, output):
        return output.legacy


class ProviderRemoteCheckpointTransportTests(
    unittest.IsolatedAsyncioTestCase
):
    async def test_jimeng_pro_image_model_uses_upstream_1_5k_minimum(self):
        self.assertEqual(
            "5.0Pro",
            cli_impl.jimeng_normalize_image_model("Seedream 5.0 Pro"),
        )
        self.assertEqual(
            "5.0",
            cli_impl.jimeng_normalize_image_model("Seedream 5.0 Lite"),
        )
        self.assertEqual(
            "1.5k",
            cli_impl.jimeng_image_resolution("5.0Pro", "1024x1536"),
        )
        self.assertEqual(
            "1.5k",
            cli_impl.jimeng_image_resolution(
                "5.0Pro 1k", "1024x1536"
            ),
        )
        self.assertEqual(
            "1.5k",
            cli_impl.jimeng_image_resolution(
                "5.0Pro", "1024x1536", "image2image"
            ),
        )
        self.assertEqual(
            "2k",
            cli_impl.jimeng_image_resolution("5.0", "1024x1536"),
        )
        self.assertEqual(
            "2k",
            cli_impl.jimeng_image_resolution("5.0Pro", "2048x2048"),
        )
        self.assertEqual(
            "4k",
            cli_impl.jimeng_image_resolution("5.0Pro", "4096x4096"),
        )
        self.assertEqual("4.7", cli_impl.jimeng_image_model_version("4.7"))

        for expected, refs in (
            ("text2image", []),
            ("image2image", [{"url": "one.png"}]),
        ):
            with self.subTest(command=expected):
                commands = []
                checkpoints = []

                async def run(args, **_kwargs):
                    commands.append(list(args))
                    if args[0] == "query_result":
                        return {
                            "submit_id": "jimeng-pro-1",
                            "images": ["https://example.test/pro.png"],
                        }
                    return {"submit_id": "jimeng-pro-1"}

                with (
                    mock.patch.object(
                        cli_impl, "run_jimeng_cli", new=run
                    ),
                    mock.patch.object(
                        cli_impl,
                        "jimeng_prepare_local_media",
                        new=mock.AsyncMock(
                            return_value=("/tmp/reference.png", [])
                        ),
                    ),
                    mock.patch.object(
                        cli_impl, "jimeng_poll_seconds", return_value=77
                    ),
                ):
                    await cli_impl.generate_jimeng_provider_image(
                        "draw",
                        "1024x1536",
                        "Seedream 5.0 Pro",
                        refs,
                        {},
                        on_remote=checkpoints.append,
                    )

                self.assertEqual(expected, commands[0][0])
                self.assertIn("--model_version=5.0Pro", commands[0])
                self.assertIn("--resolution_type=1.5k", commands[0])

    async def test_jimeng_submit_failure_with_submit_id_is_not_checkpointed(self):
        checkpoints = []
        failure = {
            "submit_id": "jimeng-rejected-pro-1",
            "gen_status": "fail",
            "fail_reason": (
                "api error: invalid param:resolution_type, "
                "resolution_type should be in [1.5k, 2k, 4k]"
            ),
        }

        with mock.patch.object(
            cli_impl,
            "run_jimeng_cli",
            new=mock.AsyncMock(return_value=failure),
        ):
            with self.assertRaisesRegex(
                HTTPException, "invalid param:resolution_type"
            ):
                await cli_impl.generate_jimeng_provider_image(
                    "draw",
                    "1024x1536",
                    "5.0Pro",
                    [],
                    {},
                    on_remote=checkpoints.append,
                )

        self.assertEqual([], checkpoints)

    async def test_modelscope_checkpoints_submit_id_before_first_poll(self):
        events = []
        checkpoints = []

        class FakeClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                events.append("submit-response")
                return _JsonResponse({"task_id": "ms-task-1"})

            async def get(self, *_args, **_kwargs):
                events.append("first-poll")
                if events[:2] != ["submit-response", "checkpoint"]:
                    raise AssertionError(
                        "ModelScope polled before checkpointing task_id"
                    )
                raise _StopAtFirstPoll("stop after ordering assertion")

        def checkpoint(result):
            checkpoints.append(result)
            events.append("checkpoint")

        ports = replace(
            main._PROVIDER_PORTS.modelscope_impl,
            AI_REQUEST_TIMEOUT=1,
            IMAGE_POLL_INTERVAL=0,
            modelscope_api_key=lambda _value="": "fake-token",
            modelscope_image_api_root=lambda: (
                "https://modelscope.example/api/v1"
            ),
        )
        with (
            modelscope_impl.bind_ports(ports),
            mock.patch.object(
                modelscope_impl.httpx, "AsyncClient", FakeClient
            ),
        ):
            with self.assertRaisesRegex(
                _StopAtFirstPoll, "ordering assertion"
            ):
                await modelscope_impl.generate_modelscope_provider_image(
                    "prompt",
                    "1024x1024",
                    "fake-model",
                    [],
                    {"id": "modelscope", "protocol": "modelscope"},
                    on_remote=checkpoint,
                )

        self.assertEqual(
            ["submit-response", "checkpoint", "first-poll"], events
        )
        self.assertEqual("ms-task-1", checkpoints[0].remote_ref)

    async def test_jimeng_generation_forms_submit_then_query_without_resubmit(self):
        references = {
            "one": [SimpleNamespace(url="one.png", role="")],
            "single_frame": [SimpleNamespace(url="one.png", role="first_frame")],
            "frames": [
                SimpleNamespace(url="one.png", role="first_frame"),
                SimpleNamespace(url="two.png", role="last_frame"),
            ],
            "multi": [
                SimpleNamespace(url="one.png", role=""),
                SimpleNamespace(url="two.png", role=""),
            ],
        }

        def video_payload(**changes):
            values = {
                "prompt": "move",
                "images": [],
                "videos": [],
                "audios": [],
                "duration": 5,
                "model": "",
                "multimodal": False,
                "aspect_ratio": "",
                "resolution": "720P",
            }
            values.update(changes)
            return SimpleNamespace(**values)

        video_cases = (
            ("text2video", video_payload()),
            (
                "image2video",
                video_payload(images=references["one"]),
            ),
            (
                "multimodal2video",
                video_payload(
                    images=references["one"],
                    aspect_ratio="16:9",
                ),
            ),
            (
                "frames2video",
                video_payload(images=references["single_frame"]),
            ),
            (
                "frames2video",
                video_payload(images=references["frames"]),
            ),
            (
                "multiframe2video",
                video_payload(images=references["multi"]),
            ),
            (
                "multimodal2video",
                video_payload(videos=["clip.mp4"]),
            ),
        )
        image_cases = (
            ("text2image", []),
            ("image2image", [{"url": "one.png"}]),
        )

        for expected, refs in image_cases:
            with self.subTest(kind="image", command=expected):
                commands = []
                checkpoints = []

                async def run(args, **_kwargs):
                    commands.append(list(args))
                    if args[0] == "query_result":
                        self.assertEqual(1, len(checkpoints))
                        self.assertFalse(
                            any(
                                item.startswith("--download_dir")
                                for item in args
                            )
                        )
                        return {
                            "submit_id": "jimeng-image-1",
                            "images": ["https://example.test/image.png"],
                        }
                    return {"submit_id": "jimeng-image-1"}

                with (
                    mock.patch.object(
                        cli_impl, "run_jimeng_cli", new=run
                    ),
                    mock.patch.object(
                        cli_impl,
                        "jimeng_prepare_local_media",
                        new=mock.AsyncMock(
                            return_value=("/tmp/reference.png", [])
                        ),
                    ),
                    mock.patch.object(
                        cli_impl, "jimeng_poll_seconds", return_value=77
                    ),
                    mock.patch.object(
                        cli_impl,
                        "jimeng_store_outputs",
                        new=mock.AsyncMock(
                            side_effect=AssertionError(
                                "production chain must not download early"
                            )
                        ),
                    ),
                ):
                    result = await cli_impl.generate_jimeng_provider_image(
                        "draw",
                        "1024x1536",
                        "",
                        refs,
                        {},
                        on_remote=checkpoints.append,
                    )

                self.assertEqual(expected, commands[0][0])
                self.assertIn("--ratio=2:3", commands[0])
                self.assertIn("--poll=0", commands[0])
                self.assertEqual("query_result", commands[1][0])
                self.assertEqual(
                    "https://example.test/image.png",
                    result[0]["value"],
                )

        for expected, payload in video_cases:
            with self.subTest(kind="video", command=expected):
                commands = []
                checkpoints = []

                async def run(args, **_kwargs):
                    commands.append(list(args))
                    if args[0] == "query_result":
                        self.assertEqual(1, len(checkpoints))
                        self.assertFalse(
                            any(
                                item.startswith("--download_dir")
                                for item in args
                            )
                        )
                        return {
                            "submit_id": "jimeng-video-1",
                            "videos": ["https://example.test/video.mp4"],
                        }
                    return {"submit_id": "jimeng-video-1"}

                with (
                    mock.patch.object(
                        cli_impl, "run_jimeng_cli", new=run
                    ),
                    mock.patch.object(
                        cli_impl,
                        "jimeng_prepare_local_media",
                        new=mock.AsyncMock(
                            return_value=("/tmp/reference.bin", [])
                        ),
                    ),
                    mock.patch.object(
                        cli_impl, "jimeng_poll_seconds", return_value=77
                    ),
                    mock.patch.object(
                        cli_impl,
                        "jimeng_store_outputs",
                        new=mock.AsyncMock(
                            side_effect=AssertionError(
                                "production chain must not download early"
                            )
                        ),
                    ),
                ):
                    result = await cli_impl.generate_jimeng_video(
                        payload,
                        {},
                        on_remote=checkpoints.append,
                    )

                self.assertEqual(expected, commands[0][0])
                self.assertIn("--poll=0", commands[0])
                self.assertEqual("query_result", commands[1][0])
                self.assertEqual(
                    ["https://example.test/video.mp4"],
                    result["videos"],
                )

    async def test_jimeng_legacy_facade_keeps_original_poll_and_download(self):
        commands = []

        async def run(args, **_kwargs):
            commands.append(list(args))
            return {"images": ["https://example.test/image.png"]}

        with (
            mock.patch.object(cli_impl, "run_jimeng_cli", new=run),
            mock.patch.object(
                cli_impl, "jimeng_poll_seconds", return_value=77
            ),
            mock.patch.object(
                cli_impl,
                "jimeng_store_outputs",
                new=mock.AsyncMock(
                    return_value=["/assets/output/image.png"]
                ),
            ),
        ):
            result = await cli_impl.generate_jimeng_provider_image(
                "draw", "1024x1024", "", [], {}
            )

        self.assertIn("--poll=77", commands[0])
        self.assertEqual(
            "/assets/output/image.png", result[0]["value"]
        )

    async def test_jimeng_recovery_without_output_stays_pending(self):
        query = mock.AsyncMock(
            return_value={
                "submit_id": "jimeng-pending-1",
                "queue_info": {"queue_idx": 3},
            }
        )
        with mock.patch.object(
            cli_impl, "jimeng_query_result", new=query
        ):
            result = await cli_impl.recover_jimeng_media(
                None, "jimeng-pending-1", "image"
            )

        self.assertEqual("pending", result["status"])
        self.assertEqual("jimeng-pending-1", result["submit_id"])
        self.assertFalse(result["remote_history_missing"])
        query.assert_awaited_once_with(
            "jimeng-pending-1", "image", download=False
        )

    async def test_jimeng_recovery_marks_querying_task_without_remote_history(self):
        query = mock.AsyncMock(
            return_value={
                "submit_id": "jimeng-orphan-1",
                "logid": "log-1",
                "gen_status": "querying",
            }
        )
        with mock.patch.object(
            cli_impl, "jimeng_query_result", new=query
        ):
            result = await cli_impl.recover_jimeng_media(
                None, "jimeng-orphan-1", "image"
            )

        self.assertEqual("pending", result["status"])
        self.assertTrue(result["remote_history_missing"])

    async def test_modelscope_image_run_restarts_through_recovery_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory) / "runs.json"

            class Initial:
                def __init__(self):
                    self.submits = 0

                async def execute(self, _request, checkpoint=None):
                    self.submits += 1
                    checkpoint(
                        Pending("modelscope-image-1", status="pending")
                    )
                    return Pending(
                        "modelscope-image-1", status="pending"
                    )

            initial = Initial()
            first = GenerationRuns(
                executor=initial,
                effects=_Effects(),
                store_path=lambda: store,
            )
            pending = await first.start(
                ImageRun(
                    prompt="draw",
                    settings={"provider_id": "modelscope"},
                ),
                owner="designer-1",
            )

            recovery_calls = []

            async def recover(_provider, task_id):
                recovery_calls.append(task_id)
                return {
                    "status": "succeeded",
                    "task_id": task_id,
                    "images": ["https://example.test/result.png"],
                }

            runtime = ProviderRuntime(
                provider_lookup=lambda provider_id: {
                    "id": provider_id,
                    "protocol": "modelscope",
                },
                image_registry=SimpleNamespace(),
                recovery_registry=build_recovery_registry(
                    RecoveryExecutors(
                        http=recover,
                        runninghub=recover,
                        modelscope=recover,
                    )
                ),
            )
            restarted = GenerationRuns(
                executor=ProviderGenerationExecutor(runtime),
                effects=_Effects(),
                store_path=lambda: store,
            )
            completed = await restarted.resume(
                pending.id,
                owner="designer-1",
            )

        self.assertEqual("succeeded", completed.status)
        self.assertEqual(["modelscope-image-1"], recovery_calls)
        self.assertEqual(1, initial.submits)
        self.assertEqual(
            ["https://example.test/result.png"],
            completed.result["images"],
        )

    async def test_comfy_recovery_includes_inline_text_audio_and_files(self):
        history = {
            "prompt-1": {
                "outputs": {
                    "7": {
                        "text": ["hello from recovery"],
                        "audio": [
                            {
                                "filename": "sound.wav",
                                "subfolder": "",
                                "type": "output",
                            }
                        ],
                        "files": [
                            {
                                "filename": "bundle.zip",
                                "subfolder": "",
                                "type": "output",
                            }
                        ],
                    }
                }
            }
        }
        ports = replace(
            main._PROVIDER_PORTS.comfyui_impl,
            COMFYUI_HISTORY_TIMEOUT=1,
        )
        with (
            comfyui_impl.bind_ports(ports),
            mock.patch.object(
                comfyui_impl,
                "get_comfy_history",
                return_value=history,
            ),
        ):
            result = await comfyui_impl.execute_comfyui_recovery(
                {
                    "prompt_id": "prompt-1",
                    "backend": "127.0.0.1:8188",
                }
            )

        kinds = [item["kind"] for item in result["items"]]
        self.assertIn("text", kinds)
        self.assertIn("audio", kinds)
        self.assertIn("file", kinds)
        text_item = next(
            item for item in result["items"] if item["kind"] == "text"
        )
        self.assertEqual("hello from recovery", text_item["text"])
        self.assertEqual("", text_item["url"])

    async def test_comfy_checkpoints_prompt_id_before_history_poll(self):
        events = []
        checkpoints = []

        class SubmitResponse:
            def read(self):
                events.append("submit-response")
                return json.dumps(
                    {"prompt_id": "comfy-prompt-1"}
                ).encode()

        def checkpoint(result):
            checkpoints.append(result)
            events.append("checkpoint")

        def first_poll(*_args, **_kwargs):
            events.append("first-poll")
            if events[:2] != ["submit-response", "checkpoint"]:
                raise AssertionError(
                    "ComfyUI polled before checkpointing prompt_id"
                )
            raise _StopAtFirstPoll("stop after ordering assertion")

        with tempfile.TemporaryDirectory() as directory:
            workflow = Path(directory) / "fake.json"
            workflow.write_text("{}", encoding="utf-8")
            payload = main.GenerateRequest(
                prompt="prompt",
                workflow_json="fake.json",
            )
            ports = replace(
                main._PROVIDER_PORTS.comfyui_impl,
                COMFYUI_HISTORY_TIMEOUT=1,
            )
            with (
                comfyui_impl.bind_ports(ports),
                mock.patch.object(
                    comfyui_impl,
                    "NEXT_TASK_ID",
                    1,
                    create=True,
                ),
                mock.patch.object(
                    comfyui_impl,
                    "BACKEND_LOCAL_LOAD",
                    {"127.0.0.1:8188": 0},
                    create=True,
                ),
                mock.patch.object(
                    comfyui_impl,
                    "workflow_path_from_name",
                    return_value=str(workflow),
                ),
                mock.patch.object(
                    comfyui_impl,
                    "reserve_best_backend",
                    return_value="127.0.0.1:8188",
                ),
                mock.patch.object(
                    comfyui_impl.urllib.request,
                    "urlopen",
                    return_value=SubmitResponse(),
                ),
                mock.patch.object(
                    comfyui_impl,
                    "get_comfy_history",
                    side_effect=first_poll,
                ),
            ):
                result = comfyui_impl.generate(
                    payload,
                    publish=False,
                    on_remote=checkpoint,
                )

        self.assertIn("ComfyUI 渲染超时", result["error"])
        self.assertEqual(
            ["submit-response", "checkpoint", "first-poll"], events
        )
        self.assertEqual("comfy-prompt-1", checkpoints[0].remote_ref)
        self.assertEqual(
            "127.0.0.1:8188", checkpoints[0].raw["backend"]
        )

    async def test_runninghub_checkpoints_task_id_before_first_poll(self):
        events = []
        checkpoints = []

        class FakeClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                events.append("submit-response")
                return _JsonResponse(
                    {"code": 0, "data": {"taskId": "rh-task-1"}}
                )

        def checkpoint(result):
            checkpoints.append(result)
            events.append("checkpoint")

        async def first_poll(*_args, **_kwargs):
            events.append("first-poll")
            if events[:2] != ["submit-response", "checkpoint"]:
                raise AssertionError(
                    "RunningHub polled before checkpointing taskId"
                )
            raise _StopAtFirstPoll("stop after ordering assertion")

        provider = {
            "id": "runninghub",
            "protocol": "runninghub",
            "api_key": "fake-key",
            "wallet_api_key": "fake-wallet-key",
            "base_url": "https://runninghub.example",
        }
        with (
            mock.patch.object(
                runninghub_impl.httpx, "AsyncClient", FakeClient
            ),
            mock.patch.object(
                runninghub_impl,
                "runninghub_model_definition",
                new=mock.AsyncMock(
                    return_value={"endpoint": "fake-model", "params": []}
                ),
            ),
            mock.patch.object(
                runninghub_impl,
                "runninghub_task_endpoint",
                return_value="https://runninghub.example/generate",
            ),
            mock.patch.object(
                runninghub_impl,
                "wait_for_runninghub_image_task",
                side_effect=first_poll,
            ),
        ):
            with self.assertRaisesRegex(
                _StopAtFirstPoll, "ordering assertion"
            ):
                await runninghub_impl.generate_runninghub_provider_image(
                    "prompt",
                    "1024x1024",
                    "fake-model",
                    [],
                    provider,
                    on_remote=checkpoint,
                )

        self.assertEqual(
            ["submit-response", "checkpoint", "first-poll"], events
        )
        self.assertEqual("rh-task-1", checkpoints[0].remote_ref)

    async def test_http_checkpoints_task_id_before_first_poll(self):
        events = []
        checkpoints = []

        class FakeClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                events.append("submit-response")
                return _JsonResponse(
                    {"task_id": "http-task-1", "status": "queued"}
                )

        def checkpoint(result):
            checkpoints.append(result)
            events.append("checkpoint")

        async def first_poll(_client, task_id, _provider):
            events.append("first-poll")
            self.assertEqual("http-task-1", task_id)
            if events[:2] != ["submit-response", "checkpoint"]:
                raise AssertionError(
                    "HTTP provider polled before checkpointing task_id"
                )
            raise _StopAtFirstPoll("stop after ordering assertion")

        provider = {
            "id": "fake-http",
            "protocol": "openai",
            "base_url": "https://http-provider.example/v1",
            "api_key": "fake-key",
        }
        ports = replace(
            main._PROVIDER_PORTS.http_impl,
            AI_BASE_URL=provider["base_url"],
            get_api_provider=lambda _provider_id: provider,
            provider_env_key_value=lambda _provider_id: "fake-key",
            provider_endpoint_url=lambda _provider, _field, default: (
                f"https://http-provider.example{default}"
            ),
        )
        with (
            http_impl.bind_ports(ports),
            mock.patch.object(http_impl.httpx, "AsyncClient", FakeClient),
        ):
            with self.assertRaisesRegex(
                _StopAtFirstPoll, "ordering assertion"
            ):
                await http_impl.generate_http_provider_image(
                    "prompt",
                    "1024x1024",
                    "",
                    "fake-model",
                    [],
                    "fake-http",
                    wait_for_task=first_poll,
                    on_remote=checkpoint,
                )

        self.assertEqual(
            ["submit-response", "checkpoint", "first-poll"], events
        )
        self.assertEqual("http-task-1", checkpoints[0].remote_ref)


class GenerationRecoveryHttpContractTests(unittest.TestCase):
    def test_failed_recovery_payloads_remain_http_200(self):
        class FailedRecovery:
            async def execute(self, request, checkpoint=None):
                del checkpoint
                if isinstance(request, RecoveryRun):
                    legacy = {
                        "status": "failed",
                        "task_id": request.remote_ref,
                        "error": "image failed",
                    }
                else:
                    legacy = {
                        "success": True,
                        "data": {
                            "status": "FAILED",
                            "failReason": "runninghub failed",
                        },
                    }
                return Failed(
                    error=(
                        legacy.get("error")
                        or legacy.get("data", {}).get("failReason")
                    ),
                    raw=ProviderOutput(legacy=legacy),
                )

        with tempfile.TemporaryDirectory() as directory:
            runs = GenerationRuns(
                executor=FailedRecovery(),
                effects=_Effects(),
                store_path=lambda: Path(directory) / "runs.json",
            )
            actor = {"id": "designer-1", "role": "designer"}
            with (
                mock.patch.object(main, "_GENERATION_RUNS", runs),
                mock.patch.object(
                    main, "require_current_user", return_value=actor
                ),
                mock.patch.object(main, "current_user", return_value=actor),
                mock.patch.object(
                    main.AUTH_SYSTEM,
                    "needs_initial_setup",
                    return_value=False,
                ),
                mock.patch.object(
                    main.AUTH_SYSTEM,
                    "user_for_session",
                    return_value=actor,
                ),
            ):
                client = TestClient(main.app)
                try:
                    image = client.post(
                        "/api/image-task-query",
                        json={
                            "provider_id": "fake-http",
                            "task_id": "image-task-1",
                        },
                    )
                    runninghub = client.get(
                        "/api/runninghub/query",
                        params={"taskId": "rh-task-1"},
                    )
                finally:
                    client.close()

        self.assertEqual(200, image.status_code)
        self.assertEqual(
            {
                "status": "failed",
                "task_id": "image-task-1",
                "error": "image failed",
            },
            image.json(),
        )
        self.assertEqual(200, runninghub.status_code)
        self.assertEqual(
            {
                "success": True,
                "data": {
                    "status": "FAILED",
                    "failReason": "runninghub failed",
                },
            },
            runninghub.json(),
        )


class CanvasGenerationRecoveryGetTests(unittest.IsolatedAsyncioTestCase):
    async def test_restart_gets_resume_in_background_and_coalesce(self):
        class InitialPending:
            async def execute(self, request, checkpoint=None):
                del checkpoint
                if isinstance(request, ImageRun):
                    return Pending(
                        "image-remote-1",
                        raw={"task_id": "image-remote-1"},
                    )
                return Pending(
                    "comfy-prompt-1",
                    raw={
                        "prompt_id": "comfy-prompt-1",
                        "backend": "127.0.0.1:8188",
                    },
                )

        class BlockingRecovery:
            def __init__(self):
                self.calls = []
                self.release = asyncio.Event()

            async def execute(self, request, checkpoint=None):
                del checkpoint
                self.calls.append(request)
                await self.release.wait()
                return Completed(
                    ProviderOutput(
                        media=("recovered.png",),
                        legacy={"images": ["recovered.png"]},
                    )
                )

        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory) / "runs.json"
            first = GenerationRuns(
                executor=InitialPending(),
                effects=_Effects(),
                store_path=lambda: store,
            )
            image = await first.start(
                ImageRun(
                    prompt="image",
                    settings={"provider_id": "fake-http"},
                ),
                owner="designer-1",
                public_metadata={
                    "type": "online-image",
                    "provider_id": "fake-http",
                    "model": "fake-model",
                },
            )
            comfy = await first.start(
                WorkflowRun(
                    "comfyui",
                    {"workflow_json": "fake.json"},
                    provider_id="comfyui",
                ),
                owner="designer-1",
                public_metadata={
                    "type": "comfy",
                    "workflow_json": "fake.json",
                },
            )

            recovery = BlockingRecovery()
            restarted = GenerationRuns(
                executor=recovery,
                effects=_Effects(),
                store_path=lambda: store,
            )
            actor = {"id": "designer-1", "role": "designer"}
            original = main._GENERATION_RUNS
            main._GENERATION_RUNS = restarted
            try:
                with mock.patch.object(
                    main, "require_current_user", return_value=actor
                ):
                    image_first = await main.get_canvas_image_task(
                        image.id
                    )
                    image_repeat = await main.get_canvas_image_task(
                        image.id
                    )
                    comfy_first = await main.get_canvas_comfy_task(
                        comfy.id
                    )
                    comfy_repeat = await main.get_canvas_comfy_task(
                        comfy.id
                    )

                await asyncio.sleep(0.01)
                self.assertEqual(2, len(recovery.calls))
                self.assertEqual(
                    1,
                    sum(
                        isinstance(item, RecoveryRun)
                        for item in recovery.calls
                    ),
                )
                self.assertEqual(
                    1,
                    sum(
                        isinstance(item, WorkflowRun)
                        and item.operation == "comfyui-recovery"
                        for item in recovery.calls
                    ),
                )
                self.assertEqual("running", image_first["status"])
                self.assertEqual("running", image_repeat["status"])
                self.assertEqual("running", comfy_first["status"])
                self.assertEqual("running", comfy_repeat["status"])
                self.assertEqual("online-image", image_first["type"])
                self.assertEqual("comfy", comfy_first["type"])
            finally:
                recovery.release.set()
                for _ in range(50):
                    await asyncio.sleep(0.01)
                    if restarted.active_count() == 0:
                        break
                main._GENERATION_RUNS = original


if __name__ == "__main__":
    unittest.main()
