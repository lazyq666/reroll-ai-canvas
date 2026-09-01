import unittest
import importlib.util
from types import SimpleNamespace
from pathlib import Path

from infinite_canvas.image_capability_probe import ProbeAttempt, build_probe_report

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "probe_image_model_capabilities.py"
_SPEC = importlib.util.spec_from_file_location("image_capability_probe_script", _SCRIPT)
_MODULE = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
_SPEC.loader.exec_module(_MODULE)
candidates = _MODULE.candidates
apimart_image_url = _MODULE.apimart_image_url


def attempt(**overrides):
    values = {
        "provider_id": "studio",
        "model_id": "image-v3",
        "environment": "test",
        "requested_aspect_ratio": "16:9",
        "requested_resolution_tier": "2K",
        "attempt": 1,
        "accepted": True,
        "output_width": 1600,
        "output_height": 900,
        "elapsed_seconds": 1.2,
        "tested_at": "2026-08-14T00:00:00Z",
    }
    values.update(overrides)
    return ProbeAttempt(**values)


class ImageCapabilityProbeTests(unittest.TestCase):
    def test_apimart_image_url_accepts_documented_url_array(self):
        payload = {"data": {"result": {"images": [{
            "url": ["https://upload.apimart.ai/f/image/result.png"]
        }]}}}
        self.assertEqual(
            "https://upload.apimart.ai/f/image/result.png",
            apimart_image_url(payload),
        )

    def test_exact_candidate_file_avoids_retesting_historical_pairs(self):
        import json
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "candidates.json"
            path.write_text(json.dumps({"candidates": [
                {"aspect_ratio": "16:9", "resolution_tier": "2k"},
                {"aspect_ratio": "16:9", "resolution_tier": "2K"},
            ]}), encoding="utf-8")
            args = SimpleNamespace(
                candidate_set="common",
                candidate_file=path,
                tiers="1K",
            )
            self.assertEqual([("16:9", "2K")], candidates(args))

    def test_wrong_real_dimensions_are_accepted_but_not_honored_and_not_suggested(self):
        report = build_probe_report([
            attempt(output_width=1200, output_height=900),
        ])
        self.assertEqual("accepted_but_not_honored", report["candidates"][0]["status"])
        self.assertEqual([], report["suggested_capability"]["aspect_ratios"])

    def test_small_provider_alignment_error_is_supported_with_materialization(self):
        report = build_probe_report([
            attempt(
                requested_aspect_ratio="21:9",
                output_width=1584,
                output_height=672,
            ),
        ])
        candidate = report["candidates"][0]
        self.assertEqual("supported_with_materialization", candidate["status"])
        self.assertTrue(candidate["attempts"][0]["materialization_required"])
        self.assertFalse(candidate["attempts"][0]["parameter_honored"])
        self.assertEqual(
            ["21:9"], report["suggested_capability"]["aspect_ratios"]
        )

    def test_rate_limit_balance_and_network_failures_are_inconclusive(self):
        for category in ("rate_limit", "insufficient_balance", "network"):
            with self.subTest(category=category):
                report = build_probe_report([
                    attempt(accepted=False, output_width=None, output_height=None, error_category=category)
                ])
                self.assertEqual("inconclusive", report["candidates"][0]["status"])

    def test_only_supported_pairs_enter_suggested_capability(self):
        report = build_probe_report([
            attempt(),
            attempt(requested_aspect_ratio="4:3", output_width=1200, output_height=900),
            attempt(requested_aspect_ratio="21:9", output_width=1200, output_height=900),
        ])
        self.assertEqual(["16:9", "4:3"], report["suggested_capability"]["aspect_ratios"])
        self.assertNotIn("21:9", report["suggested_capability"]["aspect_ratios"])

    def test_suggestion_never_implies_an_untested_cross_product_pair(self):
        report = build_probe_report([
            attempt(requested_aspect_ratio="16:9", requested_resolution_tier="1K"),
            attempt(requested_aspect_ratio="4:3", requested_resolution_tier="1K", output_width=1200, output_height=900),
            attempt(requested_aspect_ratio="16:9", requested_resolution_tier="2K"),
            attempt(requested_aspect_ratio="4:3", requested_resolution_tier="2K", output_width=1600, output_height=900),
        ])
        suggestion = report["suggested_capability"]
        self.assertEqual(["16:9", "4:3"], suggestion["aspect_ratios"])
        self.assertEqual(["1K"], suggestion["resolution_tiers"])


if __name__ == "__main__":
    unittest.main()
