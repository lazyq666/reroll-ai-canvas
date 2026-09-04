import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace


ensure_test_workspace()

import main


class ModelCapabilityApiTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def workbench_catalog(path):
        return main.ModelCapabilityCatalog(
            image_registry=main.ImageCapabilityRegistry(
                Path(main.BASE_DIR) / "resources" / "image-model-capabilities.json"
            ),
            video_registry=main.VideoCapabilityRegistry(
                Path(main.BASE_DIR) / "resources" / "video-model-capabilities.json"
            ),
            text_path=Path(main.BASE_DIR) / "resources" / "text-model-capabilities.json",
            revision_paths=(
                Path(main.BASE_DIR) / "resources" / "image-model-capabilities.json",
                Path(main.BASE_DIR) / "resources" / "video-model-capabilities.json",
                Path(main.BASE_DIR) / "resources" / "text-model-capabilities.json",
            ),
            published_path=path,
        )

    async def test_unified_api_resolves_all_three_media_kinds(self):
        image = await main.model_capability(
            "apimart", "gpt-image-2-official", "image.generate"
        )
        video = await main.model_capability(
            "jimeng", "seedance2.5", "video.generate"
        )
        text = await main.model_capability(
            "codex", "gpt-5.5", "text.generate"
        )

        self.assertEqual("supported", image["support_state"])
        self.assertEqual("supported", video["support_state"])
        self.assertEqual("unknown", text["support_state"])
        self.assertEqual(
            image["catalog_revision"], video["catalog_revision"]
        )
        self.assertEqual(
            image["catalog_revision"], text["catalog_revision"]
        )

    async def test_unified_api_exposes_layer_decomposition_contract(self):
        capability = await main.model_capability(
            "apimart", "seedream-5-0-pro", "image.layer_decomposition"
        )

        self.assertEqual("supported", capability["support_state"])
        self.assertEqual(1, capability["inputs"]["image"]["minimum"])
        self.assertEqual(1, capability["inputs"]["image"]["maximum"])
        self.assertEqual(
            ["auto", "1K", "1.5K", "2K"],
            capability["parameters"]["resolution_tier"]["values"],
        )
        self.assertEqual(1, capability["parameters"]["count"]["maximum"])
        self.assertEqual(
            "image_layer_decomposition", capability["output"]["kind"]
        )
        self.assertEqual(
            16,
            capability["output"]["manifest"]["fields"]["layers"]["maximum"],
        )

    async def test_validate_api_reports_catalog_change(self):
        payload = main.ModelCapabilityValidationRequest(
            provider_id="codex",
            model_id="gpt-5.5",
            operation="text.generate",
            catalog_revision="stale",
            inputs={"text": 1},
        )

        result = await main.validate_model_capability(payload)

        self.assertFalse(result["valid"])
        self.assertEqual("catalog_changed", result["errors"][0]["code"])

    def test_image_request_rejects_count_instead_of_clamping(self):
        provider = {
            "id": "apimart",
            "name": "APIMART",
            "base_url": "https://api.apimart.ai",
            "protocol": "apimart",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        payload = main.OnlineImageRequest(
            prompt="test",
            provider_id="apimart",
            model="gpt-image-2",
            target_aspect_ratio="1:1",
            resolution_tier="1K",
            n=5,
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "load_api_providers", return_value=[provider]),
            self.assertRaises(HTTPException) as raised,
        ):
            main._online_image_run(payload)

        self.assertEqual(422, raised.exception.status_code)
        self.assertEqual("parameter_maximum", raised.exception.detail["code"])
        self.assertEqual("count", raised.exception.detail["field"])

    def test_image_request_without_catalog_revision_requires_reload(self):
        provider = {
            "id": "apimart",
            "name": "APIMART",
            "base_url": "https://api.apimart.ai",
            "protocol": "apimart",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        payload = main.OnlineImageRequest(
            prompt="test",
            provider_id="apimart",
            model="gpt-image-2",
            target_aspect_ratio="1:1",
            resolution_tier="1K",
        )

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "load_api_providers", return_value=[provider]),
            self.assertRaises(HTTPException) as raised,
        ):
            main._online_image_run(payload)

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual("catalog_changed", raised.exception.detail["code"])

    def test_image_generation_run_preserves_the_user_intent_output_count(self):
        provider = {
            "id": "apimart",
            "name": "APIMART",
            "base_url": "https://api.apimart.ai",
            "protocol": "apimart",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        payload = main.OnlineImageRequest(
            prompt="test",
            provider_id="apimart",
            model="gpt-image-2",
            target_aspect_ratio="1:1",
            resolution_tier="1K",
            n=3,
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "load_api_providers", return_value=[provider]),
        ):
            run = main._online_image_run(payload)

        self.assertEqual(3, run.count)
        self.assertEqual("image.generate", run.settings["operation"])
        self.assertEqual(
            main.MODEL_CAPABILITY_CATALOG.revision,
            run.settings["catalog_revision"],
        )

    def test_image_legality_errors_come_from_the_unified_catalog(self):
        provider = {
            "id": "apimart",
            "name": "APIMART",
            "base_url": "https://api.apimart.ai",
            "protocol": "apimart",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        cases = (
            ({"target_aspect_ratio": "7:5"}, "aspect_ratio"),
            ({"resolution_tier": "8K"}, "resolution_tier"),
            ({"transparent_png": True}, "transparent_png"),
        )

        for changes, field in cases:
            with self.subTest(field=field):
                request = {
                    "prompt": "test",
                    "provider_id": "apimart",
                    "model": "gpt-image-2",
                    "target_aspect_ratio": "1:1",
                    "resolution_tier": "1K",
                    "catalog_revision": main.MODEL_CAPABILITY_CATALOG.revision,
                }
                request.update(changes)
                payload = main.OnlineImageRequest(**request)
                with (
                    patch.object(main, "get_api_provider", return_value=provider),
                    patch.object(main, "load_api_providers", return_value=[provider]),
                    self.assertRaises(HTTPException) as raised,
                ):
                    main._online_image_run(payload)

                self.assertEqual(422, raised.exception.status_code)
                self.assertEqual("parameter_value", raised.exception.detail["code"])
                self.assertEqual(field, raised.exception.detail["field"])

    async def test_text_request_rejects_reference_overflow_without_truncating(self):
        payload = main.CanvasLLMRequest(
            message="test",
            provider="codex",
            model="gpt-5.5",
            images=[f"data:image/png;base64,aW1hZ2U{index}=" for index in range(9)],
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with self.assertRaises(HTTPException) as raised:
            await main._canvas_llm_run(payload)

        self.assertEqual(422, raised.exception.status_code)
        self.assertEqual("input_maximum", raised.exception.detail["code"])
        self.assertEqual("image", raised.exception.detail["field"])

    async def test_text_request_rejects_history_overflow_without_truncating(self):
        payload = main.CanvasLLMRequest(
            message="test",
            provider="codex",
            model="gpt-5.5",
            messages=[{"role": "user", "content": str(index)} for index in range(31)],
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with self.assertRaises(HTTPException) as raised:
            await main._canvas_llm_run(payload)

        self.assertEqual(422, raised.exception.status_code)
        self.assertEqual("parameter_maximum", raised.exception.detail["code"])
        self.assertEqual("history", raised.exception.detail["field"])

    def test_video_request_freezes_catalog_revision(self):
        payload = main.CanvasVideoRequest(
            prompt="test",
            provider_id="jimeng",
            model="seedance2.5",
            duration=5,
            aspect_ratio="16:9",
            resolution="720p",
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        capability = main.validate_canvas_video_capability(payload)

        self.assertEqual(capability["catalog_revision"], payload.catalog_revision)

    def test_video_cross_media_errors_come_from_the_unified_catalog(self):
        payload = main.CanvasVideoRequest(
            prompt="test",
            provider_id="jimeng",
            model="seedance2.0",
            duration=5,
            resolution="720p",
            audios=["audio.mp3"],
            multimodal=True,
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with self.assertRaises(HTTPException) as raised:
            main.validate_canvas_video_capability(payload)

        self.assertEqual(422, raised.exception.status_code)
        self.assertEqual("input_combination", raised.exception.detail["code"])
        self.assertEqual("visual_reference", raised.exception.detail["field"])

    def test_video_frame_role_order_comes_from_the_unified_catalog(self):
        payload = main.CanvasVideoRequest(
            prompt="test",
            provider_id="jimeng",
            model="seedance2.0",
            duration=5,
            resolution="720p",
            images=[
                main.AIReference(url="first.png", role="last_frame"),
                main.AIReference(url="last.png", role="first_frame"),
            ],
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )

        with self.assertRaises(HTTPException) as raised:
            main.validate_canvas_video_capability(payload)

        self.assertEqual(422, raised.exception.status_code)
        self.assertEqual("input_role", raised.exception.detail["code"])
        self.assertEqual("image", raised.exception.detail["field"])

    async def test_text_request_without_catalog_revision_requires_reload(self):
        payload = main.CanvasLLMRequest(
            message="test",
            provider="codex",
            model="gpt-5.5",
        )

        with self.assertRaises(HTTPException) as raised:
            await main._canvas_llm_run(payload)

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual("catalog_changed", raised.exception.detail["code"])

    def test_video_request_without_catalog_revision_requires_reload(self):
        payload = main.CanvasVideoRequest(
            prompt="test",
            provider_id="jimeng",
            model="seedance2.5",
            duration=5,
            aspect_ratio="16:9",
            resolution="720p",
        )

        with self.assertRaises(HTTPException) as raised:
            main.validate_canvas_video_capability(payload)

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual("catalog_changed", raised.exception.detail["code"])

    async def test_admin_http_flow_publishes_a_new_runtime_catalog_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-capability-workbench.json"
            workbench = main.ModelCapabilityWorkbench(path)
            catalog = self.workbench_catalog(path)
            original_revision = catalog.revision
            actor = {"id": "admin-1", "role": "admin"}
            with (
                patch.object(main, "MODEL_CAPABILITY_WORKBENCH", workbench),
                patch.object(main, "MODEL_CAPABILITY_CATALOG", catalog),
                patch.object(main, "require_current_user", return_value=actor),
            ):
                evidence = await main.create_model_capability_evidence(
                    main.ModelCapabilityEvidencePayload(
                        provider_id="codex",
                        model_id="gpt-5.5",
                        operation="text.generate",
                        source_type="official_docs",
                        source_locator="https://example.test/models/gpt-5.5",
                        fetched_at="2026-09-04T10:00:00+08:00",
                        applicable_version="2026-09-04",
                        content_location="Supported operations",
                        excerpt="The model supports text generation.",
                    )
                )
                draft = await main.save_model_capability_draft(
                    main.ModelCapabilityDraftPayload(
                        provider_id="codex",
                        model_id="gpt-5.5",
                        operation="text.generate",
                        capability={
                            "support_state": "supported",
                            "inputs": {},
                            "output": {},
                            "parameters": {},
                        },
                        field_evidence={
                            "/support_state": {
                                "evidence_ids": [evidence["id"]],
                                "confidence": "high",
                            }
                        },
                        base_catalog_revision=original_revision,
                    )
                )
                await main.submit_model_capability_draft(draft["id"])
                result = await main.publish_model_capability_draft(
                    draft["id"],
                    main.ModelCapabilityPublishPayload(
                        expected_catalog_revision=original_revision
                    ),
                )
                snapshot = await main.model_capability_workbench_snapshot()

            self.assertNotEqual(
                original_revision, result["catalog"]["catalog_revision"]
            )
            self.assertEqual("published", result["draft"]["review_state"])
            self.assertEqual(1, len(snapshot["published"]["capabilities"]))
            self.assertEqual(
                "supported",
                catalog.resolve("codex", "gpt-5.5", "text.generate")[
                    "support_state"
                ],
            )

    async def test_model_capability_workbench_requires_an_administrator(self):
        denied = HTTPException(status_code=403, detail="forbidden")
        with patch.object(main, "require_current_user", side_effect=denied):
            with self.assertRaises(HTTPException) as raised:
                await main.model_capability_workbench_snapshot()

        self.assertEqual(403, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
