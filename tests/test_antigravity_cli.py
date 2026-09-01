import asyncio
import json
import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException
from PIL import Image

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.providers import cli_impl, http_impl


class FakeProcess:
    def __init__(self, stdout=b"", stderr=b"", returncode=0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode

    async def communicate(self):
        return self.stdout, self.stderr

    def kill(self):
        self.returncode = -9

    async def wait(self):
        return self.returncode


class AntigravityCliTests(unittest.TestCase):
    @staticmethod
    def image_ports(output_root):
        return SimpleNamespace(
            GEMINI_CLI_DEFAULT_IMAGE_MODELS=["auto"],
            generation_output_directory=lambda: str(output_root),
            output_path_for=lambda name, _category="output": str(
                output_root / name
            ),
            output_url_for=lambda name, _category="output": (
                f"/assets/output/{name}"
            ),
        )

    def run_cli(self, process, **options):
        create_process = mock.AsyncMock(return_value=process)
        with (
            mock.patch.object(
                http_impl,
                "gemini_cli_executable",
                return_value="/usr/local/bin/agy",
            ),
            mock.patch.object(
                http_impl,
                "is_antigravity_cli",
                return_value=True,
            ),
            mock.patch.object(
                http_impl.asyncio,
                "create_subprocess_exec",
                create_process,
            ),
        ):
            result = asyncio.run(
                http_impl.run_gemini_cli(
                    "describe the image",
                    timeout=30,
                    **options,
                )
            )
        return result, create_process.await_args.args

    def test_read_only_image_tools_run_in_plan_mode_and_sandbox(self):
        result, command = self.run_cli(
            FakeProcess(stdout=b"description"),
            read_only_tools=True,
            workspace_paths=[
                "/private/tmp/canvas-ref/image.png",
                "/private/tmp/canvas-ref/second.png",
            ],
        )

        self.assertEqual("description", result["text"])
        self.assertIn("--mode", command)
        self.assertEqual("plan", command[command.index("--mode") + 1])
        self.assertIn("--sandbox", command)
        self.assertIn("--dangerously-skip-permissions", command)
        self.assertEqual(1, command.count("--add-dir"))
        add_dir_index = command.index("--add-dir")
        self.assertEqual(
            "/private/tmp/canvas-ref",
            command[add_dir_index + 1],
        )

    def test_success_exit_with_only_stderr_is_not_treated_as_empty_reply(self):
        with self.assertRaises(HTTPException) as raised:
            self.run_cli(
                FakeProcess(
                    stderr=(
                        b'jetski: no output produced; a tool required the '
                        b'"read_file" permission'
                    )
                )
            )

        self.assertEqual(502, raised.exception.status_code)
        self.assertIn("read_file", str(raised.exception.detail))

    def test_stdout_reply_survives_nonfatal_stderr_warning(self):
        result, _command = self.run_cli(
            FakeProcess(stdout=b"answer", stderr=b"nonfatal warning")
        )

        self.assertEqual("answer", result["text"])
        self.assertEqual("nonfatal warning", result["_stderr"])

    def test_antigravity_stream_json_output_can_be_requested(self):
        _result, command = self.run_cli(
            FakeProcess(stdout=b'{"type":"result","result":"done"}'),
            output_format="stream-json",
        )

        self.assertIn("--output-format", command)
        output_format_index = command.index("--output-format")
        self.assertEqual("stream-json", command[output_format_index + 1])

    def test_stream_json_preserves_conversation_and_quota_failure(self):
        conversation_id = "cbf4e1c1-eceb-4e8e-81c3-fecbf6e58001"
        stdout = "\n".join(
            [
                json.dumps(
                    {
                        "type": "init",
                        "conversation_id": conversation_id,
                        "tools": ["generate_image"],
                    }
                ),
                json.dumps(
                    {
                        "type": "result",
                        "status": "ERROR",
                        "error": "Image failed to generate.",
                        "result": (
                            "429 RESOURCE_EXHAUSTED: image generation quota "
                            "exhausted; resetTime=2026-08-17T07:32:05Z"
                        ),
                    }
                ),
            ]
        )

        raw, text = cli_impl.gemini_cli_parse_stdout(stdout)

        self.assertEqual(conversation_id, raw["conversation_id"])
        self.assertEqual("ERROR", raw["status"])
        self.assertIn("RESOURCE_EXHAUSTED", text)
        self.assertIn("Image failed to generate", raw["error"])

    def test_image_chat_requests_read_only_tools_for_resolved_paths(self):
        payload = SimpleNamespace(
            system_prompt="",
            messages=[],
            message="describe",
            images=["/assets/input/reference.png"],
            reference_images=[],
            model="auto",
        )
        run_cli = mock.AsyncMock(return_value={"text": "a logo"})
        with (
            mock.patch.object(
                cli_impl,
                "gemini_cli_reference_paths",
                mock.AsyncMock(
                    return_value=(
                        ["/private/tmp/canvas-ref/reference.png"],
                        [],
                    )
                ),
            ),
            mock.patch.object(cli_impl, "run_gemini_cli", run_cli),
        ):
            text, _raw = asyncio.run(cli_impl.gemini_cli_chat_text(payload))

        self.assertEqual("a logo", text)
        self.assertTrue(run_cli.await_args.kwargs["read_only_tools"])
        self.assertEqual(
            ["/private/tmp/canvas-ref/reference.png"],
            run_cli.await_args.kwargs["workspace_paths"],
        )

    def test_local_reference_must_be_a_decodable_image(self):
        with tempfile.TemporaryDirectory() as directory:
            fake_image = Path(directory) / "not-an-image.png"
            fake_image.write_text("sensitive text", encoding="utf-8")

            with self.assertRaises(HTTPException) as raised:
                asyncio.run(
                    cli_impl.codex_prepare_local_media(str(fake_image))
                )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("可识别的图片", str(raised.exception.detail))

    def test_valid_local_reference_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "reference.png"
            Image.new("RGB", (2, 2), "black").save(image_path)

            path, cleanup = asyncio.run(
                cli_impl.codex_prepare_local_media(str(image_path))
            )

        self.assertEqual(str(image_path), path)
        self.assertEqual([], cleanup)

    def test_gemini_reference_is_staged_in_an_isolated_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "reference.png"
            Image.new("RGB", (2, 2), "black").save(image_path)

            staged, cleanup = asyncio.run(
                cli_impl.gemini_cli_reference_paths(
                    [{"url": str(image_path)}]
                )
            )

            self.assertEqual(1, len(staged))
            self.assertNotEqual(str(image_path), staged[0])
            self.assertNotEqual(image_path.parent, Path(staged[0]).parent)
            self.assertTrue(Path(staged[0]).is_file())
            staging_directory = Path(staged[0]).parent
            self.assertIn(str(staging_directory), cleanup)
            cli_impl.cleanup_cli_temp_paths(cleanup)
            self.assertFalse(staging_directory.exists())

    def test_remote_reference_rejects_private_network_targets(self):
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                cli_impl.codex_prepare_local_media(
                    "http://127.0.0.1:9/private.png"
                )
            )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("不允许访问", str(raised.exception.detail))

    def test_canvas_llm_syncs_filtered_images_and_video_frames_to_cli_payload(self):
        image = "data:image/png;base64,aW1hZ2U="
        rejected_video_in_image_field = "data:video/mp4;base64,dmlkZW8="
        video = "data:video/mp4;base64,dmlkZW8="
        frame = "data:image/jpeg;base64,ZnJhbWU="
        captured = {}

        async def run_generation(request, payload=None):
            captured["request"] = request
            captured["payload"] = payload
            return SimpleNamespace(
                text="ok",
                model="auto",
                raw_usage=None,
                expose_raw=False,
            )

        with (
            mock.patch.object(
                main,
                "video_reference_to_frame_data_urls",
                mock.AsyncMock(return_value=[frame]),
            ),
            mock.patch.object(
                main,
                "_run_generation_inline",
                run_generation,
            ),
        ):
            result = asyncio.run(
                main.canvas_llm(
                    main.CanvasLLMRequest(
                        message="describe",
                        provider="gemini-cli",
                        images=[image, rejected_video_in_image_field],
                        videos=[video],
                    )
                )
            )

        self.assertEqual("ok", result["text"])
        self.assertEqual(
            [image, frame],
            captured["request"].payload.images,
        )

    def test_canvas_llm_does_not_reintroduce_rejected_cli_image_values(self):
        captured = {}

        async def run_generation(request, payload=None):
            captured["request"] = request
            return SimpleNamespace(
                text="ok",
                model="auto",
                raw_usage=None,
                expose_raw=False,
            )

        with mock.patch.object(
            main,
            "_run_generation_inline",
            run_generation,
        ):
            asyncio.run(
                main.canvas_llm(
                    main.CanvasLLMRequest(
                        message="describe",
                        provider="gemini-cli",
                        images=["data:video/mp4;base64,dmlkZW8="],
                    )
                )
            )

        self.assertEqual([], captured["request"].payload.images)

    def test_image_generation_does_not_collect_another_tasks_shared_output(self):
        run_directories = []
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)

            async def failed_cli(*_args, **kwargs):
                run_directory = Path(kwargs["workspace_paths"][-1])
                run_directories.append(run_directory)
                Image.new("RGB", (300, 500), "black").save(
                    run_directory / "incomplete-result.png"
                )
                Image.new("RGB", (300, 500), "green").save(
                    output_root / "another-users-result.png"
                )
                return {
                    "text": "无法生成图片文件",
                    "raw": {"text": "无法生成图片文件"},
                }

            with (
                cli_impl.bind_ports(self.image_ports(output_root)),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_reference_paths",
                    mock.AsyncMock(return_value=([], [])),
                ),
                mock.patch.object(cli_impl, "run_gemini_cli", failed_cli),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_executable",
                    return_value="/usr/local/bin/agy",
                ),
                mock.patch.object(
                    cli_impl,
                    "is_antigravity_cli",
                    return_value=True,
                ),
            ):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(
                        cli_impl.generate_gemini_cli_provider_image(
                            "draw a wolf",
                            "2048x2048",
                            "auto",
                        )
                    )

        self.assertEqual(502, raised.exception.status_code)
        self.assertIn("无法生成图片文件", str(raised.exception.detail))
        self.assertEqual(1, len(run_directories))
        self.assertFalse(run_directories[0].exists())

    def test_image_generation_surfaces_antigravity_quota_exhaustion(self):
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)

            async def quota_exhausted(*_args, **_kwargs):
                message = (
                    "429 RESOURCE_EXHAUSTED: image generation quota exhausted; "
                    "resetTime=2026-08-17T07:32:05Z"
                )
                return {
                    "text": message,
                    "raw": {
                        "conversation_id": (
                            "cbf4e1c1-eceb-4e8e-81c3-fecbf6e58001"
                        ),
                        "status": "ERROR",
                        "error": "Image failed to generate.",
                    },
                    "_stdout": message,
                    "_stderr": "",
                }

            with (
                cli_impl.bind_ports(self.image_ports(output_root)),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_reference_paths",
                    mock.AsyncMock(return_value=([], [])),
                ),
                mock.patch.object(
                    cli_impl,
                    "run_gemini_cli",
                    quota_exhausted,
                ),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_executable",
                    return_value="/usr/local/bin/agy",
                ),
                mock.patch.object(
                    cli_impl,
                    "is_antigravity_cli",
                    return_value=True,
                ),
            ):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(
                        cli_impl.generate_gemini_cli_provider_image(
                            "draw a wolf",
                            "1024x1024",
                            "auto",
                        )
                    )

        self.assertEqual(429, raised.exception.status_code)
        self.assertIn("RESOURCE_EXHAUSTED", str(raised.exception.detail))
        self.assertIn("2026-08-17T07:32:05Z", str(raised.exception.detail))

    def test_antigravity_collects_only_this_conversations_named_artifact(self):
        conversation_id = "1584d0b1-7ccd-4783-9cbb-cf9c6958b62e"
        foreign_conversation_id = "2584d0b1-7ccd-4783-9cbb-cf9c6958b62e"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_root = root / "output"
            brain_root = root / "brain"
            own_brain = brain_root / conversation_id
            foreign_brain = brain_root / foreign_conversation_id
            own_brain.mkdir(parents=True)
            foreign_brain.mkdir(parents=True)
            generated_sources = []

            async def successful_cli(image_prompt, **_kwargs):
                image_name_match = re.search(
                    r"ImageName:\s*([A-Za-z0-9_-]+)", image_prompt
                )
                self.assertIsNotNone(image_name_match)
                image_name = image_name_match.group(1)
                own_artifact = own_brain / f"{image_name}_1700000000000.jpg"
                foreign_artifact = (
                    foreign_brain / f"{image_name}_1700000000001.jpg"
                )
                unrelated_artifact = own_brain / "another_task_1700000000002.jpg"
                Image.new("RGB", (64, 64), "green").save(own_artifact)
                Image.new("RGB", (64, 64), "red").save(foreign_artifact)
                Image.new("RGB", (64, 64), "blue").save(unrelated_artifact)
                generated_sources.append(own_artifact)
                return {
                    "text": "Image generated.",
                    "raw": {
                        "conversation_id": conversation_id,
                        "status": "SUCCESS",
                    },
                }

            with (
                cli_impl.bind_ports(self.image_ports(output_root)),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_reference_paths",
                    mock.AsyncMock(return_value=([], [])),
                ),
                mock.patch.object(
                    cli_impl,
                    "run_gemini_cli",
                    successful_cli,
                ),
                mock.patch.object(
                    cli_impl,
                    "antigravity_cli_brain_directory",
                    return_value=str(brain_root),
                ),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_executable",
                    return_value="/usr/local/bin/agy",
                ),
                mock.patch.object(
                    cli_impl,
                    "is_antigravity_cli",
                    return_value=True,
                ),
            ):
                _primary, raw = asyncio.run(
                    cli_impl.generate_gemini_cli_provider_image(
                        "draw a wolf",
                        "64x64",
                        "auto",
                    )
                )

            output_name = raw["images"][0].rsplit("/", 1)[-1]
            with Image.open(output_root / output_name) as image:
                red, green, blue = image.convert("RGB").getpixel((0, 0))
                self.assertGreater(green, red)
                self.assertGreater(green, blue)

            self.assertEqual(1, len(generated_sources))
            self.assertTrue(generated_sources[0].is_file())

    def test_image_generation_uses_and_cleans_an_isolated_output_directory(self):
        run_directories = []
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)

            async def successful_cli(*_args, **kwargs):
                run_directory = Path(kwargs["workspace_paths"][-1])
                run_directories.append(run_directory)
                self.assertNotEqual(output_root, run_directory)
                Image.new("RGB", (300, 500), "green").save(
                    run_directory / "result.png"
                )
                return {
                    "text": str(run_directory / "result.png"),
                    "raw": {"text": "image saved"},
                }

            with (
                cli_impl.bind_ports(self.image_ports(output_root)),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_reference_paths",
                    mock.AsyncMock(return_value=([], [])),
                ),
                mock.patch.object(cli_impl, "run_gemini_cli", successful_cli),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_executable",
                    return_value="/usr/local/bin/agy",
                ),
                mock.patch.object(
                    cli_impl,
                    "is_antigravity_cli",
                    return_value=True,
                ),
            ):
                _primary, raw = asyncio.run(
                    cli_impl.generate_gemini_cli_provider_image(
                        "draw a wolf",
                        "2048x2048",
                        "auto",
                    )
                )

            output_name = raw["images"][0].rsplit("/", 1)[-1]
            output_path = output_root / output_name
            self.assertTrue(output_path.is_file())
            with Image.open(output_path) as image:
                self.assertEqual((2048, 2048), image.size)

        self.assertEqual(1, len(run_directories))
        self.assertFalse(run_directories[0].exists())

    def test_concurrent_image_generations_do_not_share_output_directories(self):
        run_directories = []
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)

            async def successful_cli(image_prompt, **kwargs):
                run_directory = Path(kwargs["workspace_paths"][-1])
                run_directories.append(run_directory)
                color = "red" if "red fox" in image_prompt else "blue"
                await asyncio.sleep(0)
                Image.new("RGB", (64, 64), color).save(
                    run_directory / "result.png"
                )
                await asyncio.sleep(0)
                return {
                    "text": str(run_directory / "result.png"),
                    "raw": {"text": "image saved"},
                }

            async def run_both():
                return await asyncio.gather(
                    cli_impl.generate_gemini_cli_provider_image(
                        "red fox", "64x64", "auto"
                    ),
                    cli_impl.generate_gemini_cli_provider_image(
                        "blue whale", "64x64", "auto"
                    ),
                )

            with (
                cli_impl.bind_ports(self.image_ports(output_root)),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_reference_paths",
                    mock.AsyncMock(side_effect=[([], []), ([], [])]),
                ),
                mock.patch.object(cli_impl, "run_gemini_cli", successful_cli),
                mock.patch.object(
                    cli_impl,
                    "gemini_cli_executable",
                    return_value="/usr/local/bin/agy",
                ),
                mock.patch.object(
                    cli_impl,
                    "is_antigravity_cli",
                    return_value=True,
                ),
            ):
                results = asyncio.run(run_both())

            colors = []
            for _primary, raw in results:
                output_name = raw["images"][0].rsplit("/", 1)[-1]
                with Image.open(output_root / output_name) as image:
                    colors.append(image.getpixel((0, 0)))

        self.assertEqual(2, len(set(run_directories)))
        self.assertEqual([(255, 0, 0), (0, 0, 255)], colors)
        self.assertTrue(all(not path.exists() for path in run_directories))


if __name__ == "__main__":
    unittest.main()
