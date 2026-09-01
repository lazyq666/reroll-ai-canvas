import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.matting_capacity import parse_levels, recommend_capacity


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts" / "performance" / "run_matting_capacity.py"
MACOS_COMMAND = ROOT / "admin-tools" / "抠图并行容量测试-macOS.command"
CURRENT_REFERENCE = ROOT / "docs" / "current" / "smart-matting-performance.md"


class MattingCapacityBenchmarkTests(unittest.TestCase):
    def test_capacity_recommendation_separates_stable_maximum_from_safe_default(self):
        results = [
            {
                "concurrency": 1,
                "failures": [],
                "throughput_jobs_per_minute": 6.0,
                "p95_ms": 10_000,
                "peak_rss_mb": 2_000,
            },
            {
                "concurrency": 2,
                "failures": [],
                "throughput_jobs_per_minute": 10.0,
                "p95_ms": 13_000,
                "peak_rss_mb": 3_000,
            },
            {
                "concurrency": 3,
                "failures": [],
                "throughput_jobs_per_minute": 10.4,
                "p95_ms": 20_000,
                "peak_rss_mb": 4_500,
            },
        ]

        recommendation = recommend_capacity(results, physical_memory_mb=16_000)

        self.assertEqual(3, recommendation["highest_stable_tested"])
        self.assertEqual(2, recommendation["recommended_concurrency"])
        self.assertIn("吞吐提升不足", recommendation["rejected"]["3"])

    def test_level_parser_requires_ordered_unique_positive_values(self):
        self.assertEqual([1, 2, 4], parse_levels("1,2,4"))
        for invalid in ("", "0,1", "2,1", "1,1", "1,9", "one,2"):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    parse_levels(invalid)

    def test_failed_serial_baseline_produces_no_safe_recommendation(self):
        recommendation = recommend_capacity(
            [
                {
                    "concurrency": 1,
                    "failures": [{"job": 1, "error": "failed"}],
                    "throughput_jobs_per_minute": 0,
                    "p95_ms": 0,
                    "peak_rss_mb": 100,
                }
            ],
            physical_memory_mb=16_000,
        )

        self.assertEqual(0, recommendation["highest_stable_tested"])
        self.assertEqual(0, recommendation["recommended_concurrency"])

    def test_dry_run_reports_machine_and_model_without_running_inference(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run(
                [
                    sys.executable,
                    str(RUNNER),
                    "--dry-run",
                    "--levels",
                    "1,2",
                    "--output-dir",
                    temporary,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )

        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual([1, 2], payload["config"]["levels"])
        self.assertIn("cpu_count", payload["machine"])
        self.assertIn("model_ready", payload)

    def test_macos_admin_entry_uses_the_standard_runner(self):
        source = MACOS_COMMAND.read_text(encoding="utf-8")
        self.assertTrue(MACOS_COMMAND.stat().st_mode & 0o111)
        self.assertIn("scripts/performance/run_matting_capacity.py", source)
        self.assertIn('"$PYTHON" "$RUNNER" "$@"', source)

    def test_default_config_and_current_reference_match_verified_capacity(self):
        server = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        environment = (ROOT / ".env.example").read_text(encoding="utf-8")
        reference = CURRENT_REFERENCE.read_text(encoding="utf-8")

        self.assertIn(
            'MATTING_MAX_CONCURRENCY = _matting_env_int("MATTING_MAX_CONCURRENCY", 2, 1, 8)',
            server,
        )
        self.assertIn("MATTING_MAX_CONCURRENCY=2", environment)
        self.assertIn("本次最高稳定测试档位为 4，建议日常并行数为 2", reference)
        self.assertIn("Numba workqueue", reference)


if __name__ == "__main__":
    unittest.main()
