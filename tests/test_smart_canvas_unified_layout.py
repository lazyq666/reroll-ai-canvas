"""Exercise unified spatial rules through the production JS modules."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasUnifiedLayoutTests(unittest.TestCase):
    def test_production_layout_and_persistence_contracts(self):
        result = subprocess.run(
            ['node', '--test', 'tests/smart_canvas_unified_layout.test.cjs'],
            cwd=ROOT, text=True, capture_output=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
