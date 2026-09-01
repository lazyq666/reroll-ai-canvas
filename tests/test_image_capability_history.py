import unittest

from infinite_canvas.image_capability_history import (
    build_history_capability_report,
    requested_ratio,
    requested_tier,
)


class ImageCapabilityHistoryTests(unittest.TestCase):
    def test_infers_legacy_ratio_and_resolution_from_size(self):
        self.assertEqual("16:9", requested_ratio({"ratio": "wide"}))
        self.assertEqual("21:9", requested_ratio({"ratio": "ultrawide"}))
        self.assertEqual("9:21", requested_ratio({"ratio": "9:21"}))
        self.assertEqual("2:3", requested_ratio({"size": "1024x1536"}))
        self.assertEqual("2K", requested_tier({"size": "2048x1152"}))

    def test_report_keeps_only_aggregate_dimension_evidence(self):
        report = build_history_capability_report({"runs": [{
            "kind": "image",
            "status": "succeeded",
            "provider_id": "provider",
            "request": {
                "prompt": "private prompt",
                "settings": {
                    "model": "model",
                    "ratio": "16:9",
                    "resolution": "1k",
                },
            },
            "result": {"image_items": [{
                "url": "https://private.example/image.png",
                "natural_w": 1024,
                "natural_h": 576,
            }]},
        }]})
        self.assertEqual(0, report["external_request_count"])
        self.assertEqual(1, report["images_evaluated"])
        model = report["models"][0]
        self.assertEqual(1, model["supported_pair_count"])
        pair = next(
            item for item in model["pairs"]
            if item["aspect_ratio"] == "16:9"
            and item["resolution_tier"] == "1K"
        )
        self.assertEqual("supported", pair["status"])
        self.assertEqual(["1024x576"], pair["actual_sizes"])
        self.assertNotIn("private prompt", str(report))
        self.assertNotIn("private.example", str(report))

    def test_extended_ratio_alignment_is_inferred_as_materialized_support(self):
        report = build_history_capability_report({"runs": [{
            "kind": "image",
            "status": "succeeded",
            "provider_id": "apimart",
            "request": {"settings": {
                "model": "gemini-3.1-flash-image-preview",
                "ratio": "21:9",
                "resolution": "1k",
            }},
            "result": {"image_items": [{
                "natural_w": 1584,
                "natural_h": 672,
            }]},
        }]})
        model = report["models"][0]
        pair = next(
            item for item in model["pairs"]
            if item["aspect_ratio"] == "21:9"
            and item["resolution_tier"] == "1K"
        )
        self.assertEqual("supported_with_materialization", pair["status"])
        self.assertEqual(1, pair["materialized_samples"])
        self.assertIn("21:9", model["suggested_capability"]["aspect_ratios"])

    def test_auto_reference_materialization_is_not_provider_capability_evidence(self):
        report = build_history_capability_report({"runs": [{
            "kind": "image",
            "status": "succeeded",
            "provider_id": "provider",
            "request": {"settings": {
                "model": "model",
                "target_aspect_ratio": "16:9",
                "reference_aspect_ratio": "405:240",
                "resolution_tier": "4K",
            }},
            "result": {"image_items": [{
                "natural_w": 3645,
                "natural_h": 2160,
            }]},
        }]})

        self.assertEqual(0, report["images_evaluated"])
        self.assertEqual([], report["models"])


if __name__ == "__main__":
    unittest.main()
