"""Include the production pan event regression in unittest discovery."""
import subprocess
import unittest
from pathlib import Path


class SmartCanvasPanReleaseTests(unittest.TestCase):
    def test_release_and_interruption_sequences(self):
        result = subprocess.run(
            ["node", "--test", "tests/smart_canvas_pan_release_test.cjs"],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
