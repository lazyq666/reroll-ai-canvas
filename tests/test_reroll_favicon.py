import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FAVICON_PATH = "/static/images/brand/favicon.png"
FAVICON_URL = f"{FAVICON_PATH}?v=2026.08.29.reroll.1"


class RerollFaviconTests(unittest.TestCase):
    def test_product_surfaces_cache_bust_the_reroll_favicon(self):
        surfaces = [
            *sorted((ROOT / "static").glob("*.html")),
            ROOT / "backend" / "infinite_canvas" / "app.py",
        ]
        consumers = []
        for surface in surfaces:
            source = surface.read_text(encoding="utf-8")
            if FAVICON_PATH not in source:
                continue
            consumers.append(surface)
            self.assertNotIn(
                f'href="{FAVICON_PATH}"',
                source,
                f"{surface.relative_to(ROOT)} can reuse a cached pre-Reroll favicon",
            )
            self.assertIn(FAVICON_URL, source)

        self.assertGreater(len(consumers), 10)


if __name__ == "__main__":
    unittest.main()
