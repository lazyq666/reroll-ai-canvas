"""Canvas and headless image requests share capability and output semantics."""

import copy
import unittest
from unittest.mock import AsyncMock, patch

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main


class FlatImageCompilationTests(unittest.TestCase):
    def test_headless_and_canvas_compile_the_same_ordered_image_request(self):
        provider = {
            "id": "apimart", "name": "Test Provider", "protocol": "apimart",
            "base_url": "https://example.invalid", "image_models": ["gpt-image-2"],
        }
        reference = {
            "url": "/assets/reference.png", "name": "character.png", "kind": "image",
            "natural_w": 405, "natural_h": 240,
        }
        references = [reference, dict(reference)]
        options = dict(
            prompt="Keep image 1 and image 2 in order.\nPreserve this line.",
            provider_id="apimart", model="gpt-image-2",
            ratio="3:4", resolution="2K", references=references,
            catalog_revision=main.MODEL_CAPABILITY_CATALOG.revision,
        )
        canvas = main.OnlineImageRequest(
            prompt=options["prompt"], provider_id=options["provider_id"], model=options["model"],
            size="1536x2048", target_aspect_ratio="3:4", resolution_tier="2K",
            reference_images=references, catalog_revision=options["catalog_revision"],
        )
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "load_api_providers", return_value=[provider]),
        ):
            expected = main._online_image_run(canvas)
            actual = main._compile_agent_image_run(options)
        self.assertEqual(expected, actual)
        self.assertEqual(2, len(actual.references))
        self.assertEqual(options["prompt"], actual.prompt)

    def test_headless_auto_keeps_exact_source_ratio_for_shared_materialization(self):
        provider = {"id": "apimart", "protocol": "apimart", "image_models": ["gpt-image-2"]}
        with (
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "load_api_providers", return_value=[provider]),
        ):
            run = main._compile_agent_image_run({
                "prompt": "Retain the composition", "provider_id": "apimart", "model": "gpt-image-2",
                "ratio": "16:9", "resolution": "4K", "reference_aspect_ratio": "405:240",
                "references": [{"url": "/assets/reference.png", "kind": "image", "natural_w": 405, "natural_h": 240}],
                "catalog_revision": main.MODEL_CAPABILITY_CATALOG.revision,
            })
        self.assertEqual("3840x2160", run.settings["size"])
        self.assertEqual("16:9", run.settings["target_aspect_ratio"])
        self.assertEqual("405:240", run.settings["reference_aspect_ratio"])
        self.assertEqual("image.edit", run.settings["operation"])

    def test_inapplicable_parameters_are_not_invented_by_transport_defaults(self):
        provider = {"id": "apimart", "protocol": "apimart", "image_models": ["gpt-image-2"]}
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve("apimart", "gpt-image-2", "image.generate"))
        capability["parameters"] = {"count": capability["parameters"]["count"]}
        with (
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "resolved_model_capability", return_value=capability),
        ):
            run = main._compile_agent_image_run({
                "prompt": "Native defaults", "provider_id": "apimart", "model": "gpt-image-2",
                "ratio": None, "resolution": None,
                "catalog_revision": capability["catalog_revision"],
            })
        self.assertEqual("auto", run.settings["size"])
        self.assertEqual("", run.settings["target_aspect_ratio"])
        self.assertEqual("", run.settings["resolution_tier"])

    def test_changed_catalog_is_checked_again_by_shared_compilation(self):
        provider = {"id": "apimart", "protocol": "apimart", "image_models": ["gpt-image-2"]}
        with (
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "load_api_providers", return_value=[provider]),
            self.assertRaises(main.HTTPException) as caught,
        ):
            main._compile_agent_image_run({
                "prompt": "Check current capability", "provider_id": "apimart", "model": "gpt-image-2",
                "ratio": "1:1", "resolution": "2K", "catalog_revision": "obsolete",
            })
        self.assertEqual("catalog_changed", caught.exception.detail["code"])

    def test_headless_provider_lookup_never_uses_legacy_fallback(self):
        with (
            patch.object(main, "get_api_provider_exact", side_effect=main.HTTPException(400, detail="missing")) as exact,
            patch.object(main, "get_api_provider") as fallback,
            self.assertRaises(main.HTTPException),
        ):
            main._compile_agent_image_run({
                "prompt": "Keep the requested provider", "provider_id": "missing", "model": "gpt-image-2",
                "ratio": "1:1", "resolution": "2K",
            })
        exact.assert_called_once_with("missing")
        fallback.assert_not_called()


class FrozenImageProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_removed_frozen_provider_fails_before_any_adapter_can_fallback(self):
        with (
            patch.object(main, "get_api_provider", return_value={"id": "another", "protocol": "openai"}) as fallback,
            patch.object(main._PROVIDER_RUNTIME.image_registry, "execute", new_callable=AsyncMock) as execute,
            self.assertRaises(main.HTTPException) as caught,
        ):
            await main._PROVIDER_RUNTIME.execute_image(
                "Keep the frozen provider", "1024x1024", "auto", "gpt-image-2", [], "deleted",
            )
        self.assertEqual("provider_unavailable", caught.exception.detail["code"])
        fallback.assert_called_once_with("deleted")
        execute.assert_not_called()

