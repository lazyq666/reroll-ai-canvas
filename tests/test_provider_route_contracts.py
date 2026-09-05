import asyncio
import base64
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi.testclient import TestClient

from tests.runtime_env import ensure_test_workspace, import_fresh_main

ensure_test_workspace()

import main
from infinite_canvas.providers import cli_impl, http_impl
from infinite_canvas.providers import implementation as provider_implementation
from infinite_canvas.providers.ports import (
    HttpPorts,
    bind_provider_implementation,
)


class ProviderRouteContractTests(unittest.TestCase):
    _VALID_PNG = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC"
        "AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )

    @classmethod
    def setUpClass(cls):
        global main
        main = import_fresh_main()

    def test_bound_codex_image_executor_preserves_checkpoint_signature(self):
        calls = []

        async def fake_codex_image(
            prompt,
            size,
            model,
            reference_images=None,
            provider=None,
        ):
            calls.append(
                (prompt, size, model, reference_images, provider)
            )
            return "generated"

        runtime = replace(
            main._PROVIDER_RUNTIME,
            provider_lookup=lambda _provider_id: {
                "id": "gpt-cli",
                "protocol": "codex",
            },
        )
        with mock.patch.object(
            cli_impl,
            "generate_codex_provider_image",
            fake_codex_image,
        ):
            result = asyncio.run(
                runtime.execute_image(
                    "prompt",
                    "1024x1024",
                    "auto",
                    "gpt-image-2",
                    [],
                    "gpt-cli",
                    checkpoint=lambda _result: None,
                )
            )

        self.assertEqual("generated", result.output.legacy)
        self.assertEqual(
            [
                (
                    "prompt",
                    "1024x1024",
                    "gpt-image-2",
                    [],
                    {"id": "gpt-cli", "protocol": "codex"},
                )
            ],
            calls,
        )

    def test_codex_image_helper_uses_gpt_5_5_for_generation_and_reference_edit(self):
        process = SimpleNamespace(
            returncode=0,
            communicate=mock.AsyncMock(return_value=(b"{}", b"")),
        )
        with (
            mock.patch.multiple(
                cli_impl,
                gpt_image_2_skill_executable=mock.Mock(return_value="/fake/gpt-image-2-skill"),
                gpt_image_2_skill_auth_file=mock.Mock(return_value=""),
                gpt_image_2_skill_auth_json=mock.Mock(return_value={}),
                gpt_image_2_skill_api_key=mock.Mock(return_value=""),
                gpt_image_2_skill_provider_args=mock.Mock(return_value=(["--provider", "codex"], "codex")),
                parse_gpt_image_2_skill_output=mock.Mock(return_value=({}, [])),
                codex_postprocess_image_to_requested_size=mock.Mock(side_effect=lambda path, *_: path),
                codex_output_url_from_path=mock.Mock(return_value="/assets/output/poster.png"),
            ),
            mock.patch.object(cli_impl.os.path, "isfile", return_value=True),
            mock.patch.object(cli_impl.asyncio, "create_subprocess_exec", mock.AsyncMock(return_value=process)) as create_process,
        ):
            for reference_count in (0, 5):
                with self.subTest(reference_count=reference_count):
                    refs = [f"/fake/reference-{i}.png" for i in range(reference_count)]
                    asyncio.run(cli_impl.generate_codex_provider_image_via_gpt_image_2_skill(
                        "illustrated poster", "1152x2048", "gpt-image-2", ref_paths=refs,
                    ))
                    args = list(create_process.await_args.args)
                    self.assertEqual("gpt-5.5", args[args.index("--model") + 1])
                    self.assertEqual("edit" if refs else "generate", args[args.index("images") + 1])
                    self.assertEqual(refs, [args[i + 1] for i, arg in enumerate(args) if arg == "--ref-image"])

    def test_codex_gpt_image_2_uses_codex_compatible_transparent_pipeline(self):
        process = SimpleNamespace(
            returncode=0,
            communicate=mock.AsyncMock(return_value=(b"{}", b"")),
        )
        create_process = mock.AsyncMock(return_value=process)
        provider_args = mock.Mock(
            side_effect=[
                (["--provider", "codex"], "codex"),
                (["--provider", "openai", "--api-key", "test"], "openai"),
            ]
        )

        with (
            mock.patch.object(
                cli_impl,
                "gpt_image_2_skill_executable",
                return_value="/fake/gpt-image-2-skill",
            ),
            mock.patch.object(
                cli_impl, "gpt_image_2_skill_auth_file", return_value=""
            ),
            mock.patch.object(
                cli_impl, "gpt_image_2_skill_auth_json", return_value={}
            ),
            mock.patch.object(
                cli_impl,
                "gpt_image_2_skill_provider_args",
                provider_args,
            ),
            mock.patch.object(
                cli_impl.asyncio,
                "create_subprocess_exec",
                create_process,
            ),
            mock.patch.object(
                cli_impl, "parse_gpt_image_2_skill_output", return_value=({}, [])
            ),
            mock.patch.object(cli_impl.os.path, "isfile", return_value=True),
            mock.patch.object(
                cli_impl,
                "codex_postprocess_image_to_requested_size",
                side_effect=lambda path, _size, _provider: path,
            ),
            mock.patch.object(
                cli_impl,
                "codex_output_url_from_path",
                return_value="/assets/output/transparent.png",
            ),
        ):
            image, _raw = asyncio.run(
                cli_impl.generate_codex_provider_image_via_gpt_image_2_skill(
                    "transparent icon",
                    "1024x1024",
                    "gpt-image-2",
                    transparent_png=True,
                )
            )
            asyncio.run(
                cli_impl.generate_codex_provider_image_via_gpt_image_2_skill(
                    "transparent icon",
                    "1024x1024",
                    "gpt-image-2",
                    transparent_png=True,
                )
            )

        codex_source_command = list(create_process.await_args_list[0].args)
        codex_extract_command = list(create_process.await_args_list[1].args)
        openai_command = list(create_process.await_args_list[2].args)
        self.assertEqual("gpt-5.5", codex_source_command[codex_source_command.index("--model") + 1])
        self.assertEqual("gpt-image-2", openai_command[openai_command.index("--model") + 1])
        self.assertIn(
            ["images", "generate"],
            [
                codex_source_command[index:index + 2]
                for index in range(len(codex_source_command) - 1)
            ],
        )
        self.assertNotIn(
            ["transparent", "generate"],
            [
                codex_source_command[index:index + 2]
                for index in range(len(codex_source_command) - 1)
            ],
        )
        self.assertNotIn("--background", codex_source_command)
        self.assertIn("--format", codex_source_command)
        self.assertIn(
            ["transparent", "extract"],
            [
                codex_extract_command[index:index + 2]
                for index in range(len(codex_extract_command) - 1)
            ],
        )
        self.assertIn("--strict", codex_extract_command)
        self.assertEqual(
            "auto",
            codex_extract_command[
                codex_extract_command.index("--matte-color") + 1
            ],
        )
        self.assertIn(
            ["images", "generate"],
            [
                openai_command[index:index + 2]
                for index in range(len(openai_command) - 1)
            ],
        )
        self.assertEqual(
            "transparent",
            openai_command[openai_command.index("--background") + 1],
        )
        self.assertEqual(
            "png", openai_command[openai_command.index("--format") + 1]
        )
        self.assertEqual("/assets/output/transparent.png", image["value"])

    def test_codex_transparent_edit_also_uses_local_alpha_extraction(self):
        process = SimpleNamespace(
            returncode=0,
            communicate=mock.AsyncMock(return_value=(b"{}", b"")),
        )
        create_process = mock.AsyncMock(return_value=process)

        with (
            mock.patch.object(
                cli_impl,
                "gpt_image_2_skill_executable",
                return_value="/fake/gpt-image-2-skill",
            ),
            mock.patch.object(
                cli_impl, "gpt_image_2_skill_auth_file", return_value=""
            ),
            mock.patch.object(
                cli_impl, "gpt_image_2_skill_auth_json", return_value={}
            ),
            mock.patch.object(
                cli_impl,
                "gpt_image_2_skill_provider_args",
                return_value=(["--provider", "codex"], "codex"),
            ),
            mock.patch.object(
                cli_impl.asyncio,
                "create_subprocess_exec",
                create_process,
            ),
            mock.patch.object(
                cli_impl, "parse_gpt_image_2_skill_output", return_value=({}, [])
            ),
            mock.patch.object(cli_impl.os.path, "isfile", return_value=True),
            mock.patch.object(
                cli_impl,
                "codex_postprocess_image_to_requested_size",
                side_effect=lambda path, _size, _provider: path,
            ),
            mock.patch.object(
                cli_impl,
                "codex_output_url_from_path",
                return_value="/assets/output/transparent-edit.png",
            ),
        ):
            asyncio.run(
                cli_impl.generate_codex_provider_image_via_gpt_image_2_skill(
                    "refine icon",
                    "1024x1024",
                    "gpt-image-2",
                    ref_paths=["/fake/reference.png"],
                    transparent_png=True,
                )
            )

        source_command = list(create_process.await_args_list[0].args)
        extract_command = list(create_process.await_args_list[1].args)
        self.assertIn(
            ["images", "edit"],
            [
                source_command[index:index + 2]
                for index in range(len(source_command) - 1)
            ],
        )
        self.assertNotIn("--background", source_command)
        self.assertEqual(
            "/fake/reference.png",
            source_command[source_command.index("--ref-image") + 1],
        )
        self.assertIn(
            ["transparent", "extract"],
            [
                extract_command[index:index + 2]
                for index in range(len(extract_command) - 1)
            ],
        )

    def test_gpt_image_2_skill_failure_keeps_structured_http_detail(self):
        stdout = json.dumps(
            {
                "ok": False,
                "error": {
                    "code": "http_error",
                    "message": "HTTP 400",
                    "detail": json.dumps(
                        {
                            "error": {
                                "message": "Unsupported image_generation option",
                                "param": "tools[0].background",
                            }
                        }
                    ),
                },
            }
        )

        message = cli_impl.gpt_image_2_skill_failure_message(stdout, "", 1)

        self.assertIn("HTTP 400", message)
        self.assertIn("Unsupported image_generation option", message)
        self.assertIn("tools[0].background", message)

    def test_base64_image_save_is_atomic_and_retryable(self):
        original = main._PROVIDER_PORTS.http_impl
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ports = replace(
                original,
                output_path_for=lambda filename, _category: str(
                    root / filename
                ),
                output_url_for=lambda filename, _category: (
                    f"/assets/output/{filename}"
                ),
            )
            http_impl.configure_ports(ports)
            image_data = {
                "type": "b64",
                "mime_type": "image/png",
                "value": base64.b64encode(self._VALID_PNG).decode(),
            }
            try:
                with mock.patch.object(
                    http_impl.os,
                    "replace",
                    side_effect=OSError("simulated interruption"),
                ):
                    with self.assertRaises(OSError):
                        asyncio.run(
                            http_impl.save_ai_image_to_output(
                                image_data,
                                stable_id="run-1-0",
                            )
                        )

                self.assertFalse((root / "online_run-1-0.png").exists())
                self.assertEqual([], list(root.glob(".*.tmp")))

                result = asyncio.run(
                    http_impl.save_ai_image_to_output(
                        image_data,
                        stable_id="run-1-0",
                    )
                )
            finally:
                http_impl.configure_ports(original)

            self.assertEqual(
                "/assets/output/online_run-1-0.png", result
            )
            self.assertEqual(
                ["online_run-1-0.png"],
                [item.name for item in root.iterdir()],
            )

    def test_batch_image_save_preserves_composite_name_prefix(self):
        original = main._PROVIDER_PORTS.http_impl
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ports = replace(
                original,
                output_path_for=lambda filename, _category: str(
                    root / filename
                ),
                output_url_for=lambda filename, _category: (
                    f"/assets/output/{filename}"
                ),
            )
            http_impl.configure_ports(ports)
            image_data = {
                "type": "b64",
                "mime_type": "image/png",
                "value": base64.b64encode(self._VALID_PNG).decode(),
            }
            try:
                result = asyncio.run(
                    http_impl.save_ai_image_to_output(
                        image_data,
                        stable_id="run-batch-0",
                        folder='角色探索：第一批/非法字符',
                        name_prefix=(
                            "7_Seedream/4.0_"
                            "一只红狐站在森林中央，电影感柔"
                        ),
                    )
                )
            finally:
                http_impl.configure_ports(original)

            expected = (
                "角色探索：第一批_非法字符/"
                "7_Seedream_4.0_一只红狐站在森林中央，电影感柔_"
                "online_run-batch-0.png"
            )
            self.assertEqual(f"/assets/output/{expected}", result)
            self.assertTrue((root / expected).is_file())

            source = root / "provider-local.png"
            source.write_bytes(self._VALID_PNG)
            http_impl.configure_ports(ports)
            try:
                copied = asyncio.run(
                    http_impl.save_ai_image_to_output(
                        {"type": "path", "value": str(source)},
                        stable_id="run-batch-1",
                        folder="角色探索",
                        name_prefix="本地提供方结果",
                    )
                )
            finally:
                http_impl.configure_ports(original)
            copied_name = (
                "角色探索/本地提供方结果_online_run-batch-1.png"
            )
            self.assertEqual(f"/assets/output/{copied_name}", copied)
            self.assertTrue((root / copied_name).is_file())

    def test_http_image_save_cleans_atomic_temp_before_retry(self):
        original = main._PROVIDER_PORTS.http_impl

        class FakeResponse:
            headers = {"Content-Type": "image/png"}
            content = ProviderRouteContractTests._VALID_PNG

            def raise_for_status(self):
                return None

        class FakeClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def get(self, _url):
                return FakeResponse()

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ports = replace(
                original,
                output_path_for=lambda filename, _category: str(
                    root / filename
                ),
                output_url_for=lambda filename, _category: (
                    f"/assets/output/{filename}"
                ),
            )
            http_impl.configure_ports(ports)
            image_data = {
                "type": "url",
                "value": "https://example.test/image.png",
            }
            try:
                with (
                    mock.patch.object(
                        http_impl.httpx, "AsyncClient", FakeClient
                    ),
                    mock.patch.object(
                        http_impl.os,
                        "replace",
                        side_effect=OSError("simulated interruption"),
                    ),
                ):
                    failed = asyncio.run(
                        http_impl.save_ai_image_to_output(
                            image_data,
                            stable_id="run-2-0",
                        )
                    )

                self.assertEqual(image_data["value"], failed)
                self.assertFalse((root / "online_run-2-0.png").exists())
                self.assertEqual([], list(root.glob(".*.tmp")))

                with mock.patch.object(
                    http_impl.httpx, "AsyncClient", FakeClient
                ):
                    result = asyncio.run(
                        http_impl.save_ai_image_to_output(
                            image_data,
                            stable_id="run-2-0",
                        )
                    )
            finally:
                http_impl.configure_ports(original)

            self.assertEqual(
                "/assets/output/online_run-2-0.png", result
            )
            self.assertEqual(
                ["online_run-2-0.png"],
                [item.name for item in root.iterdir()],
            )

    def test_remote_video_and_general_asset_are_stable_atomic_files(self):
        original = main._PROVIDER_PORTS.http_impl

        class FakeResponse:
            def __init__(self, content, content_type):
                self.content = content
                self.headers = {"Content-Type": content_type}

            def raise_for_status(self):
                return None

        class FakeClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def get(self, url):
                if str(url).endswith(".mp4"):
                    return FakeResponse(b"fake-video-bytes", "video/mp4")
                return FakeResponse(b"fake-audio-bytes", "audio/wav")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ports = replace(
                original,
                output_path_for=lambda filename, _category: str(
                    root / filename
                ),
                output_url_for=lambda filename, _category: (
                    f"/assets/output/{filename}"
                ),
            )
            http_impl.configure_ports(ports)
            try:
                with mock.patch.object(
                    http_impl.httpx, "AsyncClient", FakeClient
                ):
                    video = asyncio.run(
                        http_impl.save_remote_video_to_output(
                            "https://example.test/result.mp4",
                            prefix="generation_video_",
                            stable_id="run-1-video-0",
                        )
                    )
                    audio = asyncio.run(
                        http_impl.save_remote_asset_to_output(
                            "https://example.test/result.wav",
                            prefix="generation_audio_",
                            stable_id="run-1-audio-0",
                        )
                    )
            finally:
                http_impl.configure_ports(original)

            self.assertEqual(
                "/assets/output/generation_video_run-1-video-0.mp4",
                video,
            )
            self.assertEqual(
                "/assets/output/generation_audio_run-1-audio-0.wav",
                audio,
            )
            self.assertEqual(
                b"fake-video-bytes",
                (root / "generation_video_run-1-video-0.mp4").read_bytes(),
            )
            self.assertEqual(
                b"fake-audio-bytes",
                (root / "generation_audio_run-1-audio-0.wav").read_bytes(),
            )
            self.assertEqual([], list(root.glob("*.tmp")))

    def test_old_http_stream_keeps_its_application_timeout(self):
        observed_timeouts = []

        class FakeResponse:
            status_code = 200

            async def aiter_lines(self):
                yield "data: [DONE]"

        class FakeStream:
            async def __aenter__(self):
                return FakeResponse()

            async def __aexit__(self, *_args):
                return False

        class FakeClient:
            def __init__(self, *, timeout):
                observed_timeouts.append(timeout)

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def stream(self, *_args, **_kwargs):
                return FakeStream()

        original = main._PROVIDER_PORTS.http_impl
        ports_a = replace(
            main._PROVIDER_PORTS,
            http_impl=replace(original, AI_REQUEST_TIMEOUT=11),
        )
        ports_b = replace(
            main._PROVIDER_PORTS,
            http_impl=replace(original, AI_REQUEST_TIMEOUT=22),
        )
        app_a = bind_provider_implementation(
            provider_implementation, ports_a
        )
        app_b = bind_provider_implementation(
            provider_implementation, ports_b
        )
        payload = SimpleNamespace(
            provider="fake", model="fake-model", ms_model=""
        )
        provider = {"id": "fake", "protocol": "openai"}

        async def collect(raw):
            return [item async for item in raw["events"]]

        async def exercise():
            http_impl.configure_ports(ports_a.http_impl)
            old_stream = await app_a.execute_http_text_stream(
                provider, payload, []
            )
            http_impl.configure_ports(ports_b.http_impl)
            new_stream = await app_b.execute_http_text_stream(
                provider, payload, []
            )
            await collect(old_stream)
            await collect(new_stream)

        try:
            with (
                mock.patch.object(
                    http_impl,
                    "resolve_chat_provider",
                    return_value=(
                        "https://fake.example/v1",
                        {},
                        "fake-model",
                    ),
                ),
                mock.patch.object(
                    http_impl.httpx, "AsyncClient", FakeClient
                ),
            ):
                asyncio.run(exercise())
        finally:
            http_impl.configure_ports(original)

        self.assertEqual([11, 22], observed_timeouts)

    def test_volcengine_media_rules_live_behind_http_adapter(self):
        removed_port_fields = {
            "looks_like_image_media_url",
            "probe_local_audio_duration_seconds",
            "volcengine_content_role",
            "volcengine_media_reference_url",
            "volcengine_video_duration",
            "volcengine_video_reference_content_items",
            "volcengine_video_resolution",
        }
        self.assertTrue(
            removed_port_fields.isdisjoint(HttpPorts.__annotations__)
        )

        with mock.patch.object(
            main,
            "reference_to_data_url",
            return_value="data:image/png;base64,fake",
        ) as convert:
            media_url = main.volcengine_media_reference_url(
                "/assets/input/reference.png"
            )

        self.assertEqual("data:image/png;base64,fake", media_url)
        convert.assert_called_once_with(
            {"url": "/assets/input/reference.png"},
            max_size=1536,
        )
        self.assertIsNone(main.volcengine_content_role("", "image"))
        self.assertEqual(
            "reference_audio",
            main.volcengine_content_role("", "audio"),
        )
        self.assertEqual(60, main.volcengine_video_duration(90))
        self.assertEqual(
            "1080p", main.volcengine_video_resolution("1080")
        )
        self.assertEqual(
            [
                {
                    "type": "video_url",
                    "video_url": {"url": "asset://video-id"},
                    "role": "reference_video",
                }
            ],
            asyncio.run(
                main.volcengine_video_reference_content_items(
                    "asset://video-id"
                )
            ),
        )

    def test_installed_http_ports_observe_replaced_provider_resolvers(self):
        provider = {
            "id": "dynamic",
            "name": "Dynamic",
            "base_url": "https://dynamic.example",
            "protocol": "openai",
            "chat_models": ["dynamic-model"],
        }
        with (
            mock.patch.object(
                main, "get_api_provider", return_value=provider
            ) as lookup,
            mock.patch.object(
                main,
                "provider_env_key_value",
                return_value="dynamic-key",
            ),
        ):
            base, headers, model = main.resolve_chat_provider(
                "dynamic", "dynamic-model", ""
            )

        lookup.assert_called_once_with("dynamic")
        self.assertEqual("https://dynamic.example/v1", base)
        self.assertEqual("Bearer dynamic-key", headers["Authorization"])
        self.assertEqual("dynamic-model", model)

    def test_installed_comfy_ports_observe_replaced_workspace_resolver(self):
        class Content:
            def __init__(self, root):
                self.root = root

            def user_workflow(self, name):
                return self.root / name

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            content = Content(root)
            with (
                mock.patch.object(
                    main,
                    "user_workflow_directory",
                    return_value=str(root),
                ),
                mock.patch.object(
                    main,
                    "current_workspace_content",
                    return_value=content,
                ),
            ):
                path = main.workflow_path_from_name("custom/dynamic.json")

        self.assertEqual(root / "dynamic.json", Path(path))

    def test_image_params_empty_and_unknown_ids_remain_generic_api(self):
        providers = [
            {
                "id": "runninghub",
                "name": "RunningHub",
                "protocol": "runninghub",
                "enabled": True,
            }
        ]
        user = {"id": 1, "username": "tester", "role": "admin"}
        with (
            mock.patch.object(
                main.AUTH_SYSTEM,
                "needs_initial_setup",
                return_value=False,
            ),
            mock.patch.object(
                main.AUTH_SYSTEM, "user_for_session", return_value=user
            ),
            mock.patch.object(
                main, "load_api_providers", return_value=providers
            ),
        ):
            client = TestClient(main.app)
            try:
                empty = client.get("/api/image-params")
                unknown = client.get(
                    "/api/image-params", params={"provider_id": "missing"}
                )
            finally:
                client.close()

        self.assertEqual(200, empty.status_code)
        self.assertEqual("api", empty.json()["engine"])
        self.assertEqual(200, unknown.status_code)
        self.assertEqual("api", unknown.json()["engine"])


if __name__ == "__main__":
    unittest.main()
