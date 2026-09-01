import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.image_capabilities import (
    COMMON_ASPECT_RATIOS,
    ImageCapabilityRegistry,
    ImageModelCapability,
    intersect_capabilities,
    normalize_image_aspect,
    reconcile_capability_selection,
)


class ImageCapabilityTests(unittest.TestCase):
    def test_maintained_extended_capabilities_are_exposed_without_widening_fallback(self):
        registry = ImageCapabilityRegistry(
            Path(__file__).resolve().parents[1]
            / "resources"
            / "image-model-capabilities.json"
        )
        nano = registry.resolve("apimart", "gemini-3.1-flash-image-preview")
        gpt = registry.resolve("apimart", "gpt-image-2")
        gpt_official = registry.resolve("apimart", "gpt-image-2-official")
        jimeng = registry.resolve("jimeng", "5.0")
        gemini_cli = registry.resolve("gemini-cli", "auto")
        codex_cli = registry.resolve("codex", "gpt-image-2")
        jimeng_pro = registry.resolve("jimeng", "5.0Pro")
        fallback = registry.resolve("unknown", "unknown")

        self.assertIn("21:9", nano.aspect_ratios)
        self.assertNotIn("9:21", nano.aspect_ratios)
        self.assertIn("21:9", gpt.aspect_ratios)
        self.assertIn("9:21", gpt.aspect_ratios)
        self.assertFalse(gpt.supports_transparent_png)
        self.assertTrue(gpt_official.supports_transparent_png)
        self.assertIn("21:9", jimeng.aspect_ratios)
        self.assertEqual(("2K", "4K"), jimeng.resolution_tiers)
        self.assertEqual(nano.aspect_ratios, gemini_cli.aspect_ratios)
        self.assertEqual(nano.resolution_tiers, gemini_cli.resolution_tiers)
        self.assertEqual(gpt.aspect_ratios, codex_cli.aspect_ratios)
        self.assertEqual(gpt.resolution_tiers, codex_cli.resolution_tiers)
        self.assertTrue(codex_cli.supports_transparent_png)
        self.assertEqual(jimeng.aspect_ratios, jimeng_pro.aspect_ratios)
        self.assertEqual(jimeng.resolution_tiers, jimeng_pro.resolution_tiers)
        self.assertNotIn("21:9", fallback.aspect_ratios)
        self.assertFalse(fallback.supports_transparent_png)

    def test_source_priority_and_conservative_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "capabilities.json"
            path.write_text(json.dumps({"capabilities": [{
                "provider_id": "studio",
                "model_id": "image-v2",
                "aspect_ratios": ["1:1", "21:9"],
                "resolution_tiers": ["2K", "4K"],
                "default_resolution_tier": "2K",
                "confirmed_at": "2026-08-14",
            }]}), encoding="utf-8")
            registry = ImageCapabilityRegistry(path)

            maintained = registry.resolve(
                "studio", "image-v2",
                discovered={"aspect_ratios": ["4:3"]},
            )
            discovered = registry.resolve(
                "studio", "image-v3",
                discovered={
                    "aspect_ratios": ["3:4"],
                    "resolution_tiers": ["1k"],
                    "default_resolution_tier": "1k",
                },
            )
            fallback = registry.resolve("studio", "image-v4")

        self.assertEqual("maintained", maintained.source)
        self.assertEqual(("1:1", "21:9"), maintained.aspect_ratios)
        self.assertEqual("discovered", discovered.source)
        self.assertEqual(("1K",), discovered.resolution_tiers)
        self.assertEqual("fallback", fallback.source)
        self.assertFalse(fallback.known)
        self.assertEqual(COMMON_ASPECT_RATIOS, fallback.aspect_ratios)
        self.assertEqual(("1K", "2K", "4K"), fallback.resolution_tiers)
        self.assertTrue(fallback.show_resolution_control)

    def test_one_percent_normalization_boundary_selects_closest_ratio(self):
        ratio, error = normalize_image_aspect(1919, 1080, ["16:9", "4:3"])
        self.assertEqual("16:9", ratio)
        self.assertLess(error, 0.01)

        ratio, error = normalize_image_aspect(101, 100, ["1:1"])
        self.assertEqual("1:1", ratio)
        self.assertAlmostEqual(0.01, error)

        ratio, error = normalize_image_aspect(101.01, 100, ["1:1"])
        self.assertIsNone(ratio)
        self.assertGreater(error, 0.01)

    def test_multi_model_intersection_preserves_first_capability_order(self):
        first = ImageModelCapability(
            "a", "one", ("16:9", "1:1", "21:9"), ("4K", "2K"),
            "2K", "maintained",
        )
        second = ImageModelCapability(
            "b", "two", ("1:1", "16:9"), ("1K", "2K"),
            "2K", "maintained",
        )
        result = intersect_capabilities([first, second])
        self.assertEqual(["16:9", "1:1"], result["aspect_ratios"])
        self.assertEqual(["2K"], result["resolution_tiers"])
        self.assertEqual("2K", result["default_resolution_tier"])
        self.assertFalse(result["blocked"])
        self.assertFalse(result["supports_transparent_png"])

    def test_unknown_resolution_keeps_compatibility_choices_without_blocking(self):
        registry = ImageCapabilityRegistry()
        first = registry.resolve("a", "one")
        result = intersect_capabilities([first, registry.resolve("b", "two")])
        self.assertEqual(list(COMMON_ASPECT_RATIOS), result["aspect_ratios"])
        self.assertEqual(["1K", "2K", "4K"], result["resolution_tiers"])
        self.assertFalse(result["blocked"])
        selection = reconcile_capability_selection(
            first,
            aspect_ratio="1:1",
            resolution_tier="4K",
        )
        self.assertEqual("4K", selection["resolution_tier"])
        self.assertEqual([], selection["invalidated"])

    def test_model_switch_clears_unsupported_values_without_nearest_match(self):
        capability = ImageModelCapability(
            "new", "model", ("1:1", "16:9"), ("1K",), "1K", "maintained"
        )
        result = reconcile_capability_selection(
            capability,
            aspect_ratio="21:9",
            resolution_tier="4K",
        )
        self.assertIsNone(result["aspect_ratio"])
        self.assertEqual("1K", result["resolution_tier"])
        self.assertEqual(
            ["aspect_ratio", "resolution_tier"], result["invalidated"]
        )


if __name__ == "__main__":
    unittest.main()
