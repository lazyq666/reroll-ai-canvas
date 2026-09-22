import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOADER = ROOT / "static/js/i18n.js"



class I18nCacheVersionTests(unittest.TestCase):
    def test_loader_and_page_references_follow_i18n_content(self):
        loader_bytes = LOADER.read_bytes()
        loader = loader_bytes.decode("utf-8")
        module_refs = re.findall(r"'(/static/js/[^'?]+\.js)\?v=([^']+)'", loader)
        self.assertGreater(len(module_refs), 1)
        for path, actual in module_refs:
            expected = 'asset-' + hashlib.sha256((ROOT / path.lstrip('/')).read_bytes()).hexdigest()[:12]
            self.assertEqual(actual, expected, path)
        self.assertNotIn("const VERSION", loader)
        loader_version = f"asset-{hashlib.sha256(loader_bytes).hexdigest()[:12]}"
        pages = [
            page
            for page in (ROOT / "static").glob("*.html")
            if "/static/js/i18n.js?v=" in page.read_text(encoding="utf-8")
        ]
        self.assertTrue(pages)
        for page in pages:
            with self.subTest(page=page.name):
                self.assertIn(
                    f'/static/js/i18n.js?v={loader_version}',
                    page.read_text(encoding="utf-8"),
                )


if __name__ == "__main__":
    unittest.main()
