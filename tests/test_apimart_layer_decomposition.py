import asyncio
import json
import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.providers import http_impl


def apimart_provider(model="seedream-5-0-pro"):
    return {
        "id": "apimart",
        "name": "APIMART",
        "base_url": "https://api.apimart.ai",
        "protocol": "apimart",
        "image_request_mode": "openai",
        "image_generation_endpoint": "",
        "image_edit_endpoint": "",
        "image_models": [model],
        "chat_models": [],
        "video_models": [],
        "model_protocols": {},
        "enabled": True,
    }


def completed_response():
    return {
        "id": "task-layer-1",
        "status": "success",
        "result": {
            "images": [
                {
                    "url": [
                        "https://cdn.example.test/base.png",
                        "https://cdn.example.test/layer.png",
                    ],
                    "sizes": ["1000x800", "200x100"],
                    "output_formats": ["png", "png"],
                    "layer_decomposition": True,
                    "layers": [
                        {"z_index": 0, "size": "1000x800", "output_format": "png"},
                        {
                            "z_index": 4,
                            "size": "200x100",
                            "output_format": "png",
                            "name": "Title",
                            "description": "Title layer",
                            "bounding_box": {
                                "absolute": [100, 50, 300, 150],
                                "normalized": [100, 62, 300, 187],
                            },
                        },
                    ],
                }
            ]
        },
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


class FakeRecoveryClient:
    def __init__(self, payload, *args, **kwargs):
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def get(self, *_args, **_kwargs):
        return FakeResponse(self.payload)

    async def request(self, *_args, **_kwargs):
        return FakeResponse(self.payload)


class RoutedUploadClient:
    def __init__(self, calls, *args, **kwargs):
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, **_kwargs):
        self.calls.append(url)
        if "api.apimart.ai" in url:
            raise httpx.ConnectError("TLS connection interrupted")
        if url.endswith("/v1/images/generations"):
            return FakeResponse(
                {
                    "code": 200,
                    "data": [
                        {"status": "submitted", "task_id": "task-layer-1"}
                    ],
                }
            )
        return FakeResponse(
            {"data": {"url": "https://cdn.example.test/uploaded.png"}}
        )


class FailingUploadClient:
    def __init__(self, calls=None):
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, **_kwargs):
        if self.calls is not None:
            self.calls.append(url)
        raise httpx.ConnectError("")


class SubmitFailingClient(RoutedUploadClient):
    async def post(self, url, **kwargs):
        if url.endswith("/v1/images/generations"):
            self.calls.append(url)
            raise httpx.ConnectError("")
        return await super().post(url, **kwargs)


class ApimartLayerDecompositionRequestTests(unittest.TestCase):
    def test_local_upload_falls_back_to_official_domestic_endpoint(self):
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            source.write_bytes(b"png")
            with (
                patch.object(main, "provider_env_key_value", return_value="test-api-key"),
                patch.object(main, "output_file_from_url", return_value=str(source)),
                patch.object(
                    http_impl.httpx,
                    "AsyncClient",
                    side_effect=lambda *args, **kwargs: RoutedUploadClient(
                        calls, *args, **kwargs
                    ),
                ),
                patch.object(http_impl.asyncio, "sleep", AsyncMock()),
            ):
                result = asyncio.run(
                    main.upload_image_for_apimart(
                        RoutedUploadClient(calls),
                        apimart_provider(),
                        "/assets/input/source.png",
                    )
                )

        self.assertEqual("https://cdn.example.test/uploaded.png", result)
        self.assertEqual(
            "https://api.apimart.ai/v1/uploads/images", calls[0]
        )
        self.assertEqual("https://apib.ai/v1/uploads/images", calls[-1])

    def test_upload_transport_failure_is_not_reported_as_invalid_parameter(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            source.write_bytes(b"png")
            with (
                patch.object(main, "get_api_provider", return_value=apimart_provider()),
                patch.object(main, "provider_env_key_value", return_value="test-api-key"),
                patch.object(main, "output_file_from_url", return_value=str(source)),
                patch.object(
                    http_impl.httpx,
                    "AsyncClient",
                    side_effect=lambda *args, **kwargs: FailingUploadClient(),
                ),
                patch.object(http_impl.asyncio, "sleep", AsyncMock()),
                self.assertRaises(HTTPException) as raised,
            ):
                asyncio.run(
                    main.generate_http_provider_image(
                        "",
                        "2K",
                        "",
                        "seedream-5-0-pro",
                        [{"url": "/assets/input/source.png", "role": "source"}],
                        "apimart",
                        operation="image.layer_decomposition",
                        resolution_tier="2K",
                    )
                )

        self.assertEqual(502, raised.exception.status_code)
        self.assertEqual(
            "provider_connection_interrupted", raised.exception.detail
        )

    def test_layer_submit_stays_on_domestic_route_after_upload_fallback(self):
        calls = []
        provider = apimart_provider()
        waiter = AsyncMock(return_value=completed_response())
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            source.write_bytes(b"png")
            with (
                patch.object(main, "get_api_provider", return_value=provider),
                patch.object(main, "provider_env_key_value", return_value="test-api-key"),
                patch.object(main, "output_file_from_url", return_value=str(source)),
                patch.object(
                    http_impl.httpx,
                    "AsyncClient",
                    side_effect=lambda *args, **kwargs: RoutedUploadClient(
                        calls, *args, **kwargs
                    ),
                ),
                patch.object(http_impl.asyncio, "sleep", AsyncMock()),
            ):
                result = asyncio.run(
                    main.generate_http_provider_image(
                        "",
                        "2K",
                        "",
                        "seedream-5-0-pro",
                        [{"url": "/assets/input/source.png", "role": "source"}],
                        "apimart",
                        wait_for_task=waiter,
                        operation="image.layer_decomposition",
                        resolution_tier="2K",
                    )
                )

        self.assertIn("https://apib.ai/v1/uploads/images", calls)
        self.assertIn("https://apib.ai/v1/images/generations", calls)
        self.assertEqual("task-layer-1", result["upstream_task_id"])
        waiter.assert_awaited_once()
        self.assertEqual(
            "https://apib.ai", waiter.call_args.args[2]["base_url"]
        )

    def test_paid_submit_transport_failure_is_not_retried_or_misclassified(self):
        calls = []
        provider = apimart_provider()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            source.write_bytes(b"png")
            with (
                patch.object(main, "get_api_provider", return_value=provider),
                patch.object(main, "provider_env_key_value", return_value="test-api-key"),
                patch.object(main, "output_file_from_url", return_value=str(source)),
                patch.object(
                    http_impl.httpx,
                    "AsyncClient",
                    side_effect=lambda *args, **kwargs: SubmitFailingClient(
                        calls, *args, **kwargs
                    ),
                ),
                patch.object(http_impl.asyncio, "sleep", AsyncMock()),
                self.assertRaises(HTTPException) as raised,
            ):
                asyncio.run(
                    main.generate_http_provider_image(
                        "",
                        "2K",
                        "",
                        "seedream-5-0-pro",
                        [{"url": "/assets/input/source.png", "role": "source"}],
                        "apimart",
                        operation="image.layer_decomposition",
                        resolution_tier="2K",
                    )
                )

        self.assertEqual(502, raised.exception.status_code)
        self.assertEqual(
            "provider_connection_interrupted", raised.exception.detail
        )
        self.assertEqual(
            1,
            calls.count("https://apib.ai/v1/images/generations"),
        )

    def test_custom_apimart_gateway_never_falls_back_to_official_hosts(self):
        calls = []
        provider = apimart_provider()
        provider["base_url"] = "https://gateway.example.test/v1"
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            source.write_bytes(b"png")
            with (
                patch.object(main, "provider_env_key_value", return_value="test-api-key"),
                patch.object(main, "output_file_from_url", return_value=str(source)),
                patch.object(
                    http_impl.httpx,
                    "AsyncClient",
                    side_effect=lambda *args, **kwargs: FailingUploadClient(calls),
                ),
                patch.object(http_impl.asyncio, "sleep", AsyncMock()),
                self.assertRaises(HTTPException) as raised,
            ):
                asyncio.run(
                    main.upload_image_for_apimart(
                        FailingUploadClient(calls),
                        provider,
                        "/assets/input/source.png",
                    )
                )

        self.assertEqual(502, raised.exception.status_code)
        self.assertTrue(calls)
        self.assertEqual(
            {"https://gateway.example.test/v1/uploads/images"}, set(calls)
        )

    def test_task_endpoint_requires_designer_and_freezes_operation_metadata(self):
        request = main.LayerDecompositionRequest(
            image=main.AIReference(
                url="https://images.example.test/source.png",
                role="source",
                kind="image",
            ),
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
            canvas_id="canvas-1",
            node_id="image-node-1",
            source_media_id="media-1",
            generation_operation_id="layer-op-0001",
        )
        run = SimpleNamespace(
            id="run-layer-1",
            status="queued",
            deduplicated=False,
            owner="designer-1",
        )
        with (
            patch.object(main, "require_current_user", return_value={"id": "designer-1", "role": "designer"}) as require_user,
            patch.object(main, "get_api_provider", return_value=apimart_provider()),
            patch.object(main._GENERATION_RUNS, "start", AsyncMock(return_value=run)) as start,
        ):
            response = asyncio.run(main.create_canvas_layer_decomposition_task(request))

        require_user.assert_any_call("admin", "designer")
        self.assertEqual("run-layer-1", response["task_id"])
        started_request = start.call_args.args[0]
        self.assertEqual("image.layer_decomposition", started_request.settings["operation"])
        self.assertEqual("layer-decomposition", started_request.publication)
        self.assertEqual(
            "image.layer_decomposition",
            start.call_args.kwargs["public_metadata"]["operation"],
        )

    def test_recovery_query_rebuilds_structured_result_from_original_task(self):
        with patch.object(
            main.httpx,
            "AsyncClient",
            side_effect=lambda *args, **kwargs: FakeRecoveryClient(
                completed_response(), *args, **kwargs
            ),
        ), patch.object(
            main, "provider_env_key_value", return_value="test-api-key"
        ):
            result = asyncio.run(
                main.recover_http_image_task(
                    apimart_provider(),
                    "task-layer-1",
                    "image_layer_decomposition",
                )
            )

        self.assertEqual("succeeded", result["status"])
        self.assertEqual("image_layer_decomposition", result["kind"])
        self.assertEqual("task-layer-1", result["upstream_task_id"])
        self.assertEqual(1, len(result["layers"]))

    def execute(self, prompt=""):
        capture = {}
        provider = apimart_provider()
        waiter = AsyncMock(return_value=completed_response())
        checkpoint = unittest.mock.Mock()
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(
                main.httpx,
                "AsyncClient",
                side_effect=lambda *args, **kwargs: FakeAsyncClient(
                    capture,
                    {
                        "code": 200,
                        "data": [{"status": "submitted", "task_id": "task-layer-1"}],
                    },
                    *args,
                    **kwargs,
                ),
            ),
        ):
            result = asyncio.run(
                main.generate_http_provider_image(
                    prompt,
                    "2K",
                    "",
                    "seedream-5-0-pro",
                    [{"url": "https://images.example.test/source.png", "role": "source"}],
                    "apimart",
                    wait_for_task=waiter,
                    n=1,
                    on_remote=checkpoint,
                    operation="image.layer_decomposition",
                    resolution_tier="2K",
                )
            )
        return capture, waiter, checkpoint, result

    def test_maps_exact_paid_request_contract_and_omits_empty_prompt(self):
        capture, waiter, checkpoint, result = self.execute()

        self.assertEqual(
            "https://api.apimart.ai/v1/images/generations", capture["url"]
        )
        self.assertEqual(
            {
                "model": "seedream-5-0-pro",
                "image_urls": ["https://images.example.test/source.png"],
                "layer_decomposition": True,
                "size": "2K",
                "n": 1,
                "output_format": "png",
            },
            capture["json"],
        )
        waiter.assert_awaited_once_with(
            unittest.mock.ANY, "task-layer-1", apimart_provider()
        )
        self.assertEqual("task-layer-1", result["upstream_task_id"])
        self.assertEqual(1, len(result["layers"]))
        self.assertEqual("task-layer-1", checkpoint.call_args.args[0].remote_ref)

    def test_preserves_optional_layer_instruction(self):
        capture, _waiter, _checkpoint, _result = self.execute(
            "Separate the title and product"
        )
        self.assertEqual(
            "Separate the title and product", capture["json"]["prompt"]
        )

    def test_unified_capability_validation_runs_before_provider_execution(self):
        provider = apimart_provider()
        invalid = main.LayerDecompositionRequest(
            provider_id="apimart",
            model="seedream-5-0-pro",
            resolution_tier="4K",
            image=main.AIReference(
                url="https://images.example.test/source.png",
                role="source",
                kind="image",
            ),
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main.MODEL_CAPABILITY_CATALOG, "validate", wraps=main.MODEL_CAPABILITY_CATALOG.validate) as validate,
            self.assertRaises(HTTPException) as raised,
        ):
            main._layer_decomposition_run(invalid)

        self.assertEqual(422, raised.exception.status_code)
        self.assertEqual("parameter_value", raised.exception.detail["code"])
        self.assertEqual("resolution_tier", raised.exception.detail["field"])
        validate.assert_called_once()

    def test_operation_is_not_enabled_for_other_provider_or_model(self):
        cases = (
            ("other", "seedream-5-0-pro"),
            ("apimart", "other-model"),
        )
        for provider_id, model in cases:
            provider = apimart_provider(model)
            provider["id"] = provider_id
            request = main.LayerDecompositionRequest(
                provider_id=provider_id,
                model=model,
                image=main.AIReference(
                    url="https://images.example.test/source.png",
                    role="source",
                    kind="image",
                ),
                catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
            )
            with (
                self.subTest(provider=provider_id, model=model),
                patch.object(main, "get_api_provider", return_value=provider),
                self.assertRaises(HTTPException) as raised,
            ):
                main._layer_decomposition_run(request)
            self.assertEqual(422, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
