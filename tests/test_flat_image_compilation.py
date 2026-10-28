"""Canvas and headless image requests share capability and output semantics."""

import asyncio
import copy
import json
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from tests.test_apimart_midjourney_routing import apimart_provider, FakeAsyncClient
from infinite_canvas.providers import cli_impl, http_impl


class FlatImageCompilationTests(unittest.TestCase):
    def test_catalog_tier_reaches_native_gemini_without_pixel_upscaling(self):
        provider = {"id": "native-gemini", "protocol": "gemini", "base_url": "https://example.invalid",
                    "image_models": ["gemini-test-image"]}
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve("apimart", "gpt-image-2", "image.generate"))
        capability["parameters"]["resolution_tier"].update(values=["0.5K"])
        capture = {}
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "resolved_model_capability", return_value=capability),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(http_impl, "gemini_fit_inline_results") as resize,
            patch.object(main.httpx, "AsyncClient", side_effect=lambda *args, **kwargs: FakeAsyncClient(
                capture, {"data": [{"url": "https://example.test/output.png"}]}, *args, **kwargs)),
        ):
            request = main._compile_agent_image_run({
                "prompt": "Use native half K", "provider_id": provider["id"], "model": "gemini-test-image",
                "ratio": "3:4", "resolution": "0.5K", "catalog_revision": capability["catalog_revision"],
            })
            asyncio.run(main._GENERATION_EXECUTOR.execute(request))
        self.assertEqual({"aspectRatio": "3:4", "imageSize": "0.5K"}, capture["json"]["generationConfig"]["imageConfig"])
        resize.assert_not_called()

    def test_catalog_tier_reaches_jimeng_cli_without_tier_inference(self):
        provider = {"id": "jimeng", "protocol": "jimeng", "image_models": ["5.0Pro"]}
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve("jimeng", "5.0Pro", "image.generate"))
        capability["parameters"]["resolution_tier"].update(values=["8K"])
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "resolved_model_capability", return_value=capability),
            patch.object(cli_impl, "run_jimeng_cli", new_callable=AsyncMock, return_value={"images": ["https://example.test/output.png"]}) as execute,
            patch.object(cli_impl, "jimeng_store_outputs", new_callable=AsyncMock, return_value=["/assets/output.png"]),
            patch.object(cli_impl.asyncio, "create_subprocess_exec", new_callable=AsyncMock,
                         side_effect=AssertionError("Unexpected external CLI execution")) as external,
        ):
            request = main._compile_agent_image_run({
                "prompt": "Use the exact native tier", "provider_id": "jimeng", "model": "5.0Pro",
                "ratio": "3:4", "resolution": "8K", "catalog_revision": capability["catalog_revision"],
            })
            asyncio.run(main._GENERATION_EXECUTOR.execute(request))
        self.assertIn("--ratio=3:4", execute.await_args.args[0])
        self.assertIn("--resolution_type=8k", execute.await_args.args[0])
        external.assert_not_called()

    def test_codex_cli_gets_catalog_tier_and_retains_actual_output_pixels(self):
        provider = {"id": "codex", "protocol": "codex", "image_models": ["gpt-image-2"]}
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve("codex", "gpt-image-2", "image.generate"))
        capability["parameters"]["resolution_tier"].update(values=["8K"])
        process = SimpleNamespace(returncode=0, communicate=AsyncMock(return_value=(b"{}", b"")))
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "resolved_model_capability", return_value=capability),
            patch.multiple(cli_impl,
                gpt_image_2_skill_executable=Mock(return_value="/fake/helper"),
                gpt_image_2_skill_auth_file=Mock(return_value=""),
                gpt_image_2_skill_auth_json=Mock(return_value={}),
                gpt_image_2_skill_api_key=Mock(return_value=""),
                gpt_image_2_skill_provider_args=Mock(return_value=(["--provider", "codex"], "codex")),
                parse_gpt_image_2_skill_output=Mock(return_value=({}, [])),
                codex_output_url_from_path=Mock(return_value="/assets/output.png")),
            patch.object(cli_impl.os.path, "isfile", return_value=True),
            patch.object(cli_impl, "codex_postprocess_image_to_requested_size", return_value="") as postprocess,
            patch.object(cli_impl.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)) as execute,
        ):
            request = main._compile_agent_image_run({
                "prompt": "Use the native tier", "provider_id": "codex", "model": "gpt-image-2",
                "ratio": "3:4", "resolution": "8K", "catalog_revision": capability["catalog_revision"],
            })
            asyncio.run(main._GENERATION_EXECUTOR.execute(request))
        args = execute.await_args.args
        self.assertEqual("8K", args[args.index("--size") + 1])
        self.assertIn("3:4", args[args.index("--prompt") + 1])
        self.assertTrue(postprocess.call_args.kwargs["preserve_geometry"])

    def test_catalog_declared_tiers_reach_native_http_without_downgrade(self):
        provider = apimart_provider()
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve("apimart", "gpt-image-2", "image.generate"))
        capability["parameters"]["resolution_tier"].update(values=["0.5K", "8K", "Ultra"], default="0.5K")
        capture = {}
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "resolved_model_capability", return_value=capability),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(main.httpx, "AsyncClient", side_effect=lambda *args, **kwargs: FakeAsyncClient(
                capture, {"data": [{"url": "https://example.test/output.png"}]}, *args, **kwargs)),
        ):
            for tier in capability["parameters"]["resolution_tier"]["values"]:
                with self.subTest(tier=tier):
                    request = main._compile_agent_image_run({
                        "prompt": "Use the declared native tier", "provider_id": "apimart", "model": "gpt-image-2",
                        "ratio": "3:4", "resolution": tier, "catalog_revision": capability["catalog_revision"],
                    })
                    asyncio.run(main._GENERATION_EXECUTOR.execute(request))
                    self.assertEqual("3:4", capture["json"]["size"])
                    self.assertEqual(tier.lower(), capture["json"]["resolution"])
                    self.assertEqual(tier, request.settings["resolution_tier"])

    def test_absent_native_dimensions_are_not_sent_in_http_body(self):
        provider = apimart_provider()
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve("apimart", "gpt-image-2", "image.generate"))
        capability["parameters"] = {"count": capability["parameters"]["count"]}
        capture = {}
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "resolved_model_capability", return_value=capability),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(main.httpx, "AsyncClient", side_effect=lambda *args, **kwargs: FakeAsyncClient(
                capture, {"data": [{"url": "https://example.test/output.png"}]}, *args, **kwargs)),
        ):
            request = main._compile_agent_image_run({
                "prompt": "Use native defaults", "provider_id": "apimart", "model": "gpt-image-2",
                "ratio": None, "resolution": None, "catalog_revision": capability["catalog_revision"],
            })
            asyncio.run(main._GENERATION_EXECUTOR.execute(request))
        self.assertNotIn("size", capture["json"])
        self.assertNotIn("resolution", capture["json"])

    def test_transport_presets_match_every_canvas_preset(self):
        from infinite_canvas.image_capabilities import image_request_size
        source = Path(main.BASE_DIR, "static/js/smart-canvas.js").read_text()
        source_map = re.search(r"const SIZE_MAP = (\{.*?\n\});", source, re.S).group(1)
        completed = subprocess.run(["node", "-e", "console.log(JSON.stringify(" + source_map + "))"],
                                   check=True, capture_output=True, text=True)
        presets = json.loads(completed.stdout)
        ratios = {"square": "1:1", "portrait": "2:3", "landscape": "3:2", "portrait43": "3:4",
                  "landscape43": "4:3", "story": "9:16", "wide": "16:9", "ultrawide": "21:9", "ultratall": "9:21"}
        self.assertEqual(set(ratios), set(presets))
        for key, tiers in presets.items():
            for tier, expected in tiers.items():
                with self.subTest(ratio=ratios[key], tier=tier):
                    self.assertEqual(expected, image_request_size(ratios[key], tier.upper()))

    def test_catalog_decimal_ratio_reaches_provider_without_path_or_integer_coercion(self):
        provider, capture = apimart_provider(), {}
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve('apimart', 'gpt-image-2', 'image.generate'))
        capability['parameters']['aspect_ratio']['values'] = ['1.5:1']
        with (
            patch.object(main, 'get_api_provider', return_value=provider),
            patch.object(main, 'get_api_provider_exact', return_value=provider),
            patch.object(main, 'resolved_model_capability', return_value=capability),
            patch.object(main, 'provider_env_key_value', return_value='test-api-key'),
            patch.object(main.httpx, 'AsyncClient', side_effect=lambda *args, **kwargs: FakeAsyncClient(
                capture, {'data': [{'url': 'https://example.test/output.png'}]}, *args, **kwargs)),
        ):
            request = main._compile_agent_image_run({
                'prompt': 'Use a declared decimal ratio', 'provider_id': 'apimart', 'model': 'gpt-image-2',
                'ratio': '1.5:1', 'resolution': '2K', 'catalog_revision': capability['catalog_revision'],
            })
            asyncio.run(main._GENERATION_EXECUTOR.execute(request))
        self.assertEqual('1.5:1', capture['json']['size'])
        self.assertEqual('2k', capture['json']['resolution'])

    def test_legacy_stored_image_run_keeps_size_based_tier_inference(self):
        provider, capture = apimart_provider(), {}
        request = main.ImageRun("Legacy frozen request", settings={
            "provider_id": "apimart", "model": "gpt-image-2", "size": "1536x2048",
            "target_aspect_ratio": "3:4", "resolution_tier": "",
        })
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(main.httpx, "AsyncClient", side_effect=lambda *args, **kwargs: FakeAsyncClient(
                capture, {"data": [{"url": "https://example.test/output.png"}]}, *args, **kwargs)),
        ):
            asyncio.run(main._GENERATION_EXECUTOR.execute(request))
        self.assertEqual("3:4", capture["json"]["size"])
        self.assertEqual("2k", capture["json"]["resolution"])

    def test_ratio_reaches_midjourney_transport_without_an_independent_tier(self):
        provider = apimart_provider()
        capability = copy.deepcopy(main.MODEL_CAPABILITY_CATALOG.resolve("apimart", "midjourney", "image.generate"))
        capability["parameters"].pop("resolution_tier", None)
        capture = {}
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "resolved_model_capability", return_value=capability),
            patch.object(main, "provider_env_key_value", return_value="test-api-key"),
            patch.object(main.httpx, "AsyncClient", side_effect=lambda *args, **kwargs: FakeAsyncClient(
                capture, {"data": [{"url": "https://example.test/output.png"}]}, *args, **kwargs)),
        ):
            request = main._compile_agent_image_run({
                "prompt": "A portrait composition", "provider_id": "apimart", "model": "midjourney",
                "ratio": "3:4", "resolution": None, "catalog_revision": capability["catalog_revision"],
            })
            asyncio.run(main._GENERATION_EXECUTOR.execute(request))
        self.assertEqual({"prompt": "A portrait composition", "size": "3:4"}, capture["json"])
        self.assertEqual("", request.settings["resolution_tier"])

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

