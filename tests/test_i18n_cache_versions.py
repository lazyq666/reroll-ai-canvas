import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOADER = ROOT / "static/js/i18n.js"


def short_digest(parts):
    digest = hashlib.sha256()
    for name, payload in parts:
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
    return digest.hexdigest()[:12]


class I18nCacheVersionTests(unittest.TestCase):
    def test_loader_and_page_references_follow_i18n_content(self):
        loader_bytes = LOADER.read_bytes()
        loader = loader_bytes.decode("utf-8")
        module_paths = re.findall(r"'(/static/js/(?:i18n-core|i18n/[^']+)\.js)'", loader)
        self.assertGreater(len(module_paths), 1)

        module_parts = [
            (path, (ROOT / path.lstrip("/")).read_bytes())
            for path in module_paths
        ]
        module_version = f"i18n-{short_digest(module_parts)}"
        self.assertIn(f"const VERSION = '{module_version}'", loader)

        loader_version = f"i18n-loader-{hashlib.sha256(loader_bytes).hexdigest()[:12]}"
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
