import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STYLESHEET = ROOT / "static/css/smart-canvas.css"


class SmartCanvasCssCacheVersionTests(unittest.TestCase):
    def test_all_pages_reference_the_current_stylesheet_content(self):
        version = f"asset-{hashlib.sha256(STYLESHEET.read_bytes()).hexdigest()[:12]}"
        reference = f'/static/css/smart-canvas.css?v={version}'
        pages = [
            page
            for page in (ROOT / "static").rglob("*.html")
            if "/static/css/smart-canvas.css?v=" in page.read_text(encoding="utf-8")
        ]

        self.assertTrue(pages)
        for page in pages:
            with self.subTest(page=page.relative_to(ROOT)):
                match = re.search(
                    r'/static/css/smart-canvas\.css\?v=[^"\']+',
                    page.read_text(encoding="utf-8"),
                )
                self.assertIsNotNone(match)
                self.assertEqual(reference, match.group(0))


if __name__ == "__main__":
    unittest.main()
