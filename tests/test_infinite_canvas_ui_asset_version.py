import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "static" / "js" / "infinite-canvas-ui" / "VERSION"
SYNC_SCRIPT = ROOT / "scripts" / "sync_infinite_canvas_ui_version.py"


class InfiniteCanvasUiAssetVersionTests(unittest.TestCase):
    def test_ui_marker_tracks_the_shared_entry(self):
        import json
        manifest = json.loads((ROOT / 'static/frontend-assets.json').read_text())
        expected = manifest['assets']['static/js/infinite-canvas-ui/core.js']['version']
        self.assertEqual(VERSION_FILE.read_text().strip(), expected)

    def test_generated_version_and_references_are_current(self):
        result = subprocess.run(
            [sys.executable, str(SYNC_SCRIPT), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
