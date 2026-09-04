import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main


def apimart_provider():
    return {
        "id": "apimart",
        "name": "APIMART",
        "base_url": "https://api.apimart.ai",
        "protocol": "apimart",
        "image_request_mode": "openai",
        "image_generation_endpoint": "",
        "image_edit_endpoint": "",
        "image_models": ["midjourney", "gpt-image-2", "gpt-image-2-official"],
        "chat_models": [],
        "video_models": [],
        "model_protocols": {},
        "enabled": True,
    }


class FakeResponse:
    status_code = 200
    reason_phrase = "OK"

    def __init__(self, payload):
        self.payload = payload
        self.text = json.dumps(payload)

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeAsyncClient:
    def __init__(self, capture, response_payload, *args, **kwargs):
        self.capture = capture
        self.response_payload = response_payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, *, headers, json):
        self.capture.update(url=url, headers=headers, json=json)
        return FakeResponse(self.response_payload)


class ApimartMidjourneyRoutingTests(unittest.TestCase):
    def test_midjourney_uses_dedicated_generation_contract(self):
        provider = apimart_provider()
        capture = {}
        wait_for_task = AsyncMock(
            return_value={"data": [{"url": "https://example.test/midjourney.png"}]}
        )

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(main, "wait_for_image_task", wait_for_task),
            patch.object(
                main.httpx,
                "AsyncClient",
                side_effect=lambda *args, **kwargs: FakeAsyncClient(
                    capture,
                    {
                        "code": 200,
                        "data": [
                            {"status": "submitted", "task_id": "task_midjourney_123"}
                        ],
                    },
                    *args,
                    **kwargs,
                ),
            ),
        ):
            image, raw = asyncio.run(
                main.generate_ai_image(
                    "a cinematic mountain",
                    "1024x1024",
                    "",
                    "midjourney",
                    [],
                    "apimart",
                )
            )

        self.assertEqual(
            capture["url"],
            "https://api.apimart.ai/v1/midjourney/generations",
        )
        self.assertEqual(
            capture["json"],
            {"prompt": "a cinematic mountain", "size": "1:1"},
        )
        self.assertEqual(image["value"], "https://example.test/midjourney.png")
        self.assertEqual(raw["data"][0]["url"], "https://example.test/midjourney.png")
        wait_for_task.assert_awaited_once_with(
            unittest.mock.ANY,
            "task_midjourney_123",
            provider,
        )

    def test_other_apimart_images_keep_generic_generation_route(self):
        provider = apimart_provider()
        capture = {}

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(
                main.httpx,
                "AsyncClient",
                side_effect=lambda *args, **kwargs: FakeAsyncClient(
                    capture,
                    {"data": [{"url": "https://example.test/gpt-image.png"}]},
                    *args,
                    **kwargs,
                ),
            ),
        ):
            image, _raw = asyncio.run(
                main.generate_ai_image(
                    "a studio portrait",
                    "1024x1024",
                    "high",
                    "gpt-image-2",
                    [],
                    "apimart",
                )
            )

        self.assertEqual(
            capture["url"],
            "https://api.apimart.ai/v1/images/generations",
        )
        self.assertEqual(capture["json"]["model"], "gpt-image-2")
        self.assertEqual(image["value"], "https://example.test/gpt-image.png")

    def test_official_gpt_image_2_maps_transparent_png_contract(self):
        provider = apimart_provider()
        capture = {}

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(
                main.httpx,
                "AsyncClient",
                side_effect=lambda *args, **kwargs: FakeAsyncClient(
                    capture,
                    {"data": [{"url": "https://example.test/transparent.png"}]},
                    *args,
                    **kwargs,
                ),
            ),
        ):
            image, _raw = asyncio.run(
                main.generate_ai_image(
                    "a transparent icon",
                    "1024x1024",
                    "high",
                    "gpt-image-2-official",
                    [],
                    "apimart",
                    transparent_png=True,
                )
            )

        self.assertEqual(capture["json"]["model"], "gpt-image-2-official")
        self.assertEqual(capture["json"]["background"], "transparent")
        self.assertEqual(capture["json"]["output_format"], "png")
        self.assertEqual(image["value"], "https://example.test/transparent.png")

    def test_transparent_png_is_validated_against_exact_model_capability(self):
        provider = apimart_provider()
        supported = main.OnlineImageRequest(
            prompt="icon",
            provider_id="apimart",
            model="gpt-image-2-official",
            transparent_png=True,
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )
        unsupported = main.OnlineImageRequest(
            prompt="icon",
            provider_id="apimart",
            model="gpt-image-2",
            transparent_png=True,
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with patch.object(main, "get_api_provider", return_value=provider):
            run = main._online_image_run(supported)
            with self.assertRaises(HTTPException) as raised:
                main._online_image_run(unsupported)

        self.assertTrue(run.settings["transparent_png"])
        self.assertEqual("parameter_value", raised.exception.detail["code"])
        self.assertEqual("transparent_png", raised.exception.detail["field"])
        fields = main.build_image_param_fields(
            "api", provider, "gpt-image-2-official"
        )
        self.assertIn(
            {
                "key": "transparent_png",
                "type": "boolean",
                "label": "透明 PNG",
                "control": "switch",
                "default": False,
            },
            fields,
        )


if __name__ == "__main__":
    unittest.main()
