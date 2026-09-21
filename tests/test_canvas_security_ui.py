import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CanvasSecurityUiTests(unittest.TestCase):
    def test_retired_classic_editor_script_is_removed(self):
        self.assertFalse((ROOT / "static/js/canvas.js").exists())
        retired_page = (ROOT / "static/canvas.html").read_text(encoding="utf-8")
        self.assertNotIn("onclick=", retired_page)


if __name__ == "__main__":
    unittest.main()
