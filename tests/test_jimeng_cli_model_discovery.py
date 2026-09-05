import unittest
import json
from unittest import mock

from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.providers import cli_impl, inspection_impl


class JimengCliModelDiscoveryTests(unittest.IsolatedAsyncioTestCase):
    def test_help_parser_accepts_supported_combination_and_flag_formats(self):
        help_text = """
Supported combinations:
- model_version values: seedance2.0mini, seedance2.5

Flags:
      --model_version string   supported values: seedance2.0, seedance2.5; default: seedance2.0
"""

        self.assertEqual(
            ["seedance2.0mini", "seedance2.5", "seedance2.0"],
            cli_impl.jimeng_model_versions_from_help(help_text),
        )

    async def test_model_catalog_is_built_from_live_cli_help(self):
        helps = {
            "text2image": "- model_version: 5.0, 5.0Pro",
            "image2image": "- model_version: 4.7, 5.0Pro",
            "text2video": (
                "--model_version string supported values: "
                "seedance2.0mini, seedance2.5; default: seedance2.0mini"
            ),
            "image2video": "- model_version values: seedance1.5pro, seedance2.5",
            "frames2video": "- model_version: seedance2.0_vip, seedance2.5",
            "multimodal2video": (
                "--model_version string supported values: "
                "seedance2.0, seedance2.5; default: seedance2.0"
            ),
        }

        async def run(args, **_kwargs):
            return {"_stdout": helps[args[0]], "_stderr": ""}

        with mock.patch.object(cli_impl, "run_jimeng_cli", new=run):
            result = await cli_impl.jimeng_models_payload()

        self.assertEqual("cli-help", result["source"])
        self.assertEqual(["5.0", "5.0Pro", "4.7"], result["image_models"])
        self.assertIn("seedance2.0mini", result["video_models"])
        self.assertIn("seedance2.5", result["video_models"])
        self.assertEqual({}, result["raw"]["errors"])
        self.assertEqual(
            ["seedance2.0mini", "seedance2.5"],
            result["capabilities"]["commands"]["text2video"]["models"],
        )
        self.assertEqual(
            helps["text2image"],
            result["_capability_discovery"]["help_outputs"]["text2image"],
        )

    async def test_model_catalog_falls_back_when_cli_help_is_unavailable(self):
        failure = mock.AsyncMock(
            side_effect=HTTPException(status_code=400, detail="missing CLI")
        )
        with mock.patch.object(cli_impl, "run_jimeng_cli", new=failure):
            result = await cli_impl.jimeng_models_payload()

        self.assertEqual("fallback", result["source"])
        self.assertIn("5.0Pro", result["image_models"])
        self.assertIn("seedance2.5", result["video_models"])
        self.assertEqual(
            len(cli_impl.JIMENG_MODEL_HELP_COMMANDS),
            len(result["raw"]["errors"]),
        )

    async def test_jimeng_fetch_route_uses_dynamic_catalog(self):
        payload = {
            "total": 2,
            "model_count": 2,
            "image_models": ["live-image"],
            "chat_models": [],
            "video_models": ["live-video"],
            "all": ["live-image", "live-video"],
            "source": "cli-help",
        }
        with mock.patch.object(
            inspection_impl,
            "jimeng_models_payload",
            new=mock.AsyncMock(return_value=payload),
        ):
            result = await inspection_impl.fetch_models_from_upstream(
                "", "", "jimeng"
            )

        self.assertEqual(payload, result)

    def test_gemini_discovery_keeps_only_capability_fields(self):
        models, names = inspection_impl.gemini_model_discovery(
            {
                "models": [
                    {
                        "name": "models/gemini-2.5-pro",
                        "displayName": "Gemini 2.5 Pro",
                        "version": "2.5",
                        "supportedGenerationMethods": ["generateContent"],
                        "inputTokenLimit": 1048576,
                        "outputTokenLimit": 65536,
                        "description": "must not be persisted as evidence",
                        "pricing": {"input": 1},
                    }
                ]
            }
        )

        self.assertEqual("gemini-2.5-pro", models[0]["model_id"])
        self.assertEqual(["generateContent"], models[0]["supported_generation_methods"])
        self.assertNotIn("description", models[0])
        self.assertNotIn("pricing", models[0])
        self.assertEqual("Gemini 2.5 Pro", names["gemini-2.5-pro"])

    async def test_official_apimart_fetch_requests_and_sanitizes_expanded_metadata(self):
        calls = []
        raw = {
            "data": [
                {
                    "id": "wan2.6",
                    "category": "video",
                    "capability_tags": ["Text to Video"],
                    "parameters": {
                        "operation": "video_generation",
                        "schema_version": "2026-07-30",
                        "input_schema": {
                            "type": "object",
                            "properties": {
                                "duration": {"type": "integer", "minimum": 1},
                                "usage_cost": {"type": "number"},
                            },
                        },
                    },
                    "pricing": {"input": 1},
                }
            ]
        }

        class Response:
            status_code = 200
            text = json.dumps(raw)
            headers = {}

            def json(self):
                return raw

        class Client:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def get(self, url, **_kwargs):
                calls.append(url)
                return Response()

        with mock.patch.object(inspection_impl.httpx, "AsyncClient", Client):
            result = await inspection_impl.fetch_models_from_upstream(
                "https://api.apimart.ai", "secret", "apimart"
            )

        self.assertEqual(
            "https://api.apimart.ai/v1/models?expand=parameters", calls[0]
        )
        self.assertEqual(["wan2.6"], result["video_models"])
        model = result["_capability_discovery"]["models"][0]
        self.assertNotIn("pricing", model)
        self.assertNotIn(
            "usage_cost", model["parameters"]["input_schema"]["properties"]
        )

    async def test_seedance_25_generation_passes_live_model_constraints(self):
        commands = []

        async def run(args, **_kwargs):
            commands.append(list(args))
            return {"videos": ["https://example.test/video.mp4"]}

        payload = main.CanvasVideoRequest(
            prompt="cinematic shot",
            provider_id="jimeng",
            model="seedance2.5",
            duration=30,
            resolution="480p",
        )
        with (
            mock.patch.object(cli_impl, "run_jimeng_cli", new=run),
            mock.patch.object(
                cli_impl,
                "jimeng_store_outputs",
                new=mock.AsyncMock(
                    return_value=["https://example.test/video.mp4"]
                ),
            ),
        ):
            await cli_impl.generate_jimeng_video(payload, {})

        self.assertEqual("text2video", commands[0][0])
        self.assertIn("--model_version=seedance2.5", commands[0])
        self.assertIn("--duration=30", commands[0])
        self.assertIn("--video_resolution=480p", commands[0])

    async def test_multiframe_uses_fixed_model_cli_contract(self):
        commands = []

        async def run(args, **_kwargs):
            commands.append(list(args))
            return {"videos": ["https://example.test/video.mp4"]}

        payload = main.CanvasVideoRequest(
            prompt="continue the scene",
            provider_id="jimeng",
            model="seedance2.5",
            duration=30,
            resolution="1080p",
            images=[
                main.AIReference(url="/tmp/a.png"),
                main.AIReference(url="/tmp/b.png"),
                main.AIReference(url="/tmp/c.png"),
            ],
        )
        with (
            mock.patch.object(
                cli_impl,
                "jimeng_prepare_local_media",
                new=mock.AsyncMock(return_value=("/tmp/reference.png", [])),
            ),
            mock.patch.object(cli_impl, "run_jimeng_cli", new=run),
            mock.patch.object(
                cli_impl,
                "jimeng_store_outputs",
                new=mock.AsyncMock(
                    return_value=["https://example.test/video.mp4"]
                ),
            ),
        ):
            await cli_impl.generate_jimeng_video(payload, {})

        command = commands[0]
        self.assertEqual("multiframe2video", command[0])
        self.assertFalse(
            any(item.startswith("--model_version=") for item in command)
        )
        self.assertEqual(
            2,
            sum(item.startswith("--transition-prompt=") for item in command),
        )
        self.assertEqual(
            2,
            sum(item == "--transition-duration=8" for item in command),
        )
        self.assertIn("--video_resolution=1080p", command)

    def test_seedance_25_and_mini_rules(self):
        self.assertEqual(
            "seedance2.5", cli_impl.jimeng_video_model_version("seedance2.5")
        )
        self.assertEqual(
            "seedance2.0mini",
            cli_impl.jimeng_video_model_version("seedance2.0mini"),
        )
        self.assertEqual((4, 30), cli_impl.jimeng_video_duration_range("seedance2.5"))
        self.assertEqual("480P", cli_impl.jimeng_video_resolution("seedance2.5", "480p"))
        self.assertEqual("1080P", cli_impl.jimeng_video_resolution("seedance2.5", "1080p"))
        self.assertEqual("4K", cli_impl.jimeng_video_resolution("seedance2.0_vip", "4k"))
        self.assertEqual("720P", cli_impl.jimeng_video_resolution("seedance2.0fast_vip", "1080p"))

    def test_future_image_model_is_forwarded_without_reenabling_known_invalid_mode(self):
        self.assertEqual(
            "5.1Pro", cli_impl.jimeng_image_model_version("5.1Pro")
        )
        self.assertEqual(
            "5.1Pro",
            cli_impl.jimeng_image_model_version("5.1Pro", "image2image"),
        )
        self.assertEqual(
            "",
            cli_impl.jimeng_image_model_version("3.0", "image2image"),
        )


if __name__ == "__main__":
    unittest.main()
