"""Include controlled preview loading/decoding regressions in unittest discovery."""
import subprocess
import unittest
from pathlib import Path


class SmartCanvasLodMediaTests(unittest.TestCase):
    def test_preview_loading_and_stale_results(self):
        result = subprocess.run(
            ['node', '--test', 'tests/smart_canvas_lod_media_test.cjs'],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
