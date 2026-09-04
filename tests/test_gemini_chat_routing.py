import asyncio
import base64
import io
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.providers import http_impl


def provider_config(protocol="gemini", base_url="https://generativelanguage.googleapis.com"):
    return {
        "id": "test-provider",
        "name": "Test Provider",
        "base_url": base_url,
        "protocol": protocol,
        "chat_models": ["gemini-test-model"],
        "image_models": ["gemini-test-image"],
        "model_protocols": {},
        "enabled": True,
    }


class FakeResponse:
    content = b'{"choices":[{"message":{"content":"ok"}}]}'

    def __init__(self, payload=None):
        self.payload = payload or {"choices": [{"message": {"content": "ok"}}]}

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeAsyncClient:
    def __init__(self, capture, response_payload=None, *args, **kwargs):
        self.capture = capture
        self.response_payload = response_payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, *, headers, json):
        self.capture.update(url=url, headers=headers, json=json)
        return FakeResponse(self.response_payload)


class GeminiChatRoutingTests(unittest.TestCase):
    def test_apimart_gemini_custom_size_without_reference_uses_nearest_ratio(self):
        self.assertEqual(
            http_impl.apimart_gemini_size(
                "3000x1000",
                "gemini-3-pro-image-preview",
                has_reference=False,
            ),
            "21:9",
        )
        self.assertEqual(
            http_impl.apimart_gemini_size(
                "8000x1000",
                "gemini-3.1-flash-image-preview",
                has_reference=False,
            ),
            "8:1",
        )

    def test_apimart_non_gemini_size_mapping_is_unchanged(self):
        self.assertEqual(
            http_impl.apimart_size_resolution("3000x1000"),
            ("3:1", "4k"),
        )

    def test_gemini_custom_pixel_size_uses_supported_aspect_ratio(self):
        self.assertEqual(
            main.gemini_image_config("3000x1000"),
            {"aspectRatio": "21:9", "imageSize": "4K"},
        )

    def test_gemini_custom_ratio_is_normalized_to_supported_aspect_ratio(self):
        self.assertEqual(
            main.gemini_image_config("3:1"),
            {"aspectRatio": "21:9", "imageSize": "1K"},
        )

    def test_gemini_custom_size_fits_inline_result_locally(self):
        source = io.BytesIO()
        Image.new("RGB", (210, 90), "blue").save(source, format="PNG")
        capture = {}
        response_payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": base64.b64encode(
                                        source.getvalue()
                                    ).decode(),
                                }
                            }
                        ]
                    }
                }
            ]
        }
        provider = provider_config()

        with (
            patch.object(
                main.httpx,
                "AsyncClient",
                side_effect=lambda *args, **kwargs: FakeAsyncClient(
                    capture, response_payload, *args, **kwargs
                ),
            ),
            patch.object(
                main,
                "provider_env_key_value",
                return_value="test-api-key",
            ),
        ):
            image, raw = asyncio.run(
                main.generate_gemini_provider_image(
                    "draw",
                    "300x100",
                    "gemini-test-image",
                    [],
                    provider,
                )
            )

        self.assertEqual(
            capture["json"]["generationConfig"]["imageConfig"][
                "aspectRatio"
            ],
            "21:9",
        )
        with Image.open(io.BytesIO(base64.b64decode(image["value"]))) as result:
            self.assertEqual(result.size, (300, 100))
        saved_image = main.extract_images(raw)[0]
        with Image.open(
            io.BytesIO(base64.b64decode(saved_image["value"]))
        ) as result:
            self.assertEqual(result.size, (300, 100))

    def test_online_gemini_run_preserves_exact_custom_size(self):
        provider = provider_config()
        payload = main.OnlineImageRequest(
            prompt="draw",
            provider_id=provider["id"],
            model="gemini-test-image",
            size="301x101",
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with patch.object(main, "get_api_provider", return_value=provider):
            run = main._online_image_run(payload)

        self.assertEqual(run.settings["size"], "301x101")
        self.assertEqual(run.settings["requested_size"], "301x101")

    def test_online_non_gemini_run_still_snaps_custom_size(self):
        provider = provider_config(protocol="openai")
        payload = main.OnlineImageRequest(
            prompt="draw",
            provider_id=provider["id"],
            model="openai-test-image",
            size="301x101",
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with patch.object(main, "get_api_provider", return_value=provider):
            run = main._online_image_run(payload)

        self.assertEqual(run.settings["size"], "304x112")
        self.assertEqual(run.settings["requested_size"], "301x101")

    def test_online_auto_aspect_keeps_request_and_reference_ratios_separate(self):
        provider = provider_config(protocol="openai")
        payload = main.OnlineImageRequest(
            prompt="draw",
            provider_id=provider["id"],
            model="openai-test-image",
            size="3840x2160",
            target_aspect_ratio="16:9",
            reference_aspect_ratio="405:240",
            reference_images=[
                main.AIReference(
                    url="reference.png",
                    kind="image",
                    natural_w=405,
                    natural_h=240,
                )
            ],
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with patch.object(main, "get_api_provider", return_value=provider):
            run = main._online_image_run(payload)

        self.assertEqual(run.settings["target_aspect_ratio"], "16:9")
        self.assertEqual(run.settings["reference_aspect_ratio"], "405:240")
        self.assertEqual(run.references[0]["natural_w"], 405)
        self.assertEqual(run.references[0]["natural_h"], 240)

    def test_online_auto_aspect_rejects_a_stale_reference_ratio(self):
        provider = provider_config(protocol="openai")
        payload = main.OnlineImageRequest(
            prompt="draw",
            provider_id=provider["id"],
            model="openai-test-image",
            size="3840x2160",
            target_aspect_ratio="16:9",
            reference_aspect_ratio="1:1",
            reference_images=[
                main.AIReference(
                    url="reference.png",
                    kind="image",
                    natural_w=405,
                    natural_h=240,
                )
            ],
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            self.assertRaises(main.GenerationRunValidation),
        ):
            main._online_image_run(payload)

    def test_canvas_llm_uses_gemini_openai_compatibility_endpoint_and_auth(self):
        provider = provider_config()
        capture = {}

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(
                main.httpx,
                "AsyncClient",
                side_effect=lambda *args, **kwargs: FakeAsyncClient(capture, *args, **kwargs),
            ),
        ):
            result = asyncio.run(
                main.canvas_llm(
                    main.CanvasLLMRequest(
                        message="hello",
                        model="gemini-test-model",
                        provider="test-provider",
                        catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
                    )
                )
            )

        self.assertEqual(result["text"], "ok")
        self.assertEqual(
            capture["url"],
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        self.assertEqual(capture["headers"].get("Authorization"), "Bearer test-api-key")
        self.assertNotIn("x-goog-api-key", capture["headers"])

    def test_gemini_image_requests_keep_native_endpoint_and_auth(self):
        provider = provider_config()

        with patch.object(main, "provider_env_key_value", return_value="test-api-key"):
            headers = main.api_headers(provider=provider, model="gemini-test-image")

        self.assertEqual(headers.get("x-goog-api-key"), "test-api-key")
        self.assertNotIn("Authorization", headers)
        self.assertEqual(
            main.gemini_endpoint_url(provider, "gemini-test-image"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-image:generateContent",
        )

    def test_apimart_gemini_image_uses_official_async_route(self):
        provider = provider_config(
            protocol="apimart",
            base_url="https://api.apimart.ai",
        )
        provider.update(
            id="apimart",
            name="APIMART",
            model_protocols={"gemini-test-image": "gemini"},
        )
        capture = {}
        submitted_response = {
            "code": 200,
            "data": [
                {
                    "status": "submitted",
                    "task_id": "task_gemini_image_123",
                }
            ],
        }
        wait_for_task = AsyncMock(
            return_value={
                "data": {
                    "status": "completed",
                    "result": {
                        "images": [
                            {"url": ["https://example.test/gemini-image.png"]}
                        ]
                    },
                }
            }
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
                    submitted_response,
                    *args,
                    **kwargs,
                ),
            ),
        ):
            image, raw = asyncio.run(
                main.generate_ai_image(
                    "draw a test image",
                    "3000x1000",
                    "",
                    "gemini-test-image",
                    [
                        {
                            "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
                            "name": "structure.png",
                        },
                        {
                            "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
                            "name": "style.png",
                        },
                    ],
                    "apimart",
                )
            )

        self.assertEqual(
            capture["url"],
            "https://api.apimart.ai/v1/images/generations",
        )
        self.assertEqual(
            capture["headers"].get("Authorization"),
            "Bearer test-api-key",
        )
        self.assertNotIn("x-goog-api-key", capture["headers"])
        self.assertEqual(capture["json"]["model"], "gemini-test-image")
        self.assertEqual(capture["json"]["size"], "auto")
        self.assertEqual(capture["json"]["resolution"], "4k")
        self.assertEqual(len(capture["json"]["image_urls"]), 2)
        self.assertEqual(image["type"], "url")
        self.assertEqual(image["value"], "https://example.test/gemini-image.png")
        self.assertEqual(raw["data"]["status"], "completed")
        wait_for_task.assert_awaited_once_with(
            unittest.mock.ANY,
            "task_gemini_image_123",
            provider,
        )

    def test_openai_chat_routing_is_unchanged(self):
        provider = provider_config(protocol="openai", base_url="https://example.test")

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
        ):
            base, headers, model = main.resolve_chat_provider(
                "test-provider", "openai-test-model", ""
            )

        self.assertEqual(base, "https://example.test/v1")
        self.assertEqual(model, "openai-test-model")
        self.assertEqual(headers.get("Authorization"), "Bearer test-api-key")
        self.assertNotIn("x-goog-api-key", headers)


class CliRuntimeDetectionTests(unittest.TestCase):
    def test_jimeng_prefers_native_cli_over_wsl_autodetection(self):
        with (
            patch.object(main.os, "name", "nt"),
            patch.object(main, "jimeng_env_value", return_value=""),
            patch.object(
                main,
                "jimeng_native_cli_executable",
                return_value=r"C:\Tools\dreamina.exe",
            ),
            patch.object(main, "jimeng_wsl_dreamina_available") as wsl_available,
        ):
            self.assertFalse(main.jimeng_use_wsl())
        wsl_available.assert_not_called()

    def test_jimeng_uses_detected_wsl_cli_when_native_cli_is_missing(self):
        with (
            patch.object(main.os, "name", "nt"),
            patch.object(main, "jimeng_env_value", return_value=""),
            patch.object(main, "jimeng_native_cli_executable", return_value=""),
            patch.object(
                main,
                "jimeng_wsl_dreamina_available",
                return_value=True,
            ),
        ):
            self.assertTrue(main.jimeng_use_wsl())

    def test_explicit_jimeng_wsl_setting_overrides_autodetection(self):
        with (
            patch.object(main.os, "name", "nt"),
            patch.object(main, "jimeng_env_value", return_value="0"),
            patch.object(main, "jimeng_native_cli_executable") as native_cli,
            patch.object(main, "jimeng_wsl_dreamina_available") as wsl_available,
        ):
            self.assertFalse(main.jimeng_use_wsl())
        native_cli.assert_not_called()
        wsl_available.assert_not_called()


if __name__ == "__main__":
    unittest.main()
