import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "static/js/infinite-canvas-ui/generation-pending.js"
SMART_CANVAS = ROOT / "static/js/smart-canvas.js"
SMART_CANVAS_STYLE = ROOT / "static/css/smart-canvas.css"
CASE = ROOT / "static/design-system/infinite-canvas-ui/feedback-progress-case.html"
BROWSER_SMOKE = ROOT / "tests/generation_pending_badge_browser_smoke.cjs"


class GenerationPendingBadgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = COMPONENT.read_text(encoding="utf-8")
        cls.smart_canvas = SMART_CANVAS.read_text(encoding="utf-8")
        cls.style = SMART_CANVAS_STYLE.read_text(encoding="utf-8")
        cls.case = CASE.read_text(encoding="utf-8")
        cls.browser_smoke = BROWSER_SMOKE.read_text(encoding="utf-8")

    def test_pending_module_owns_the_external_status_badge(self):
        self.assertIn("'description', 'elapsed'", self.component)
        self.assertIn('class="generation-pending-badge"', self.component)
        self.assertIn('kind="status" tone="info" loading', self.component)
        self.assertIn("inset-block-start:-20px", self.component)
        self.assertNotIn('class="status"', self.component)

    def test_smart_canvas_passes_elapsed_time_through_the_public_interface(self):
        self.assertIn("description='',elapsed=''", self.smart_canvas)
        self.assertIn('elapsed="${escapeAttr(elapsed)}"', self.smart_canvas)
        self.assertIn(
            "return node?.runStartedAt ? formatRunDuration(nodeRunElapsedMs(node)) : ''",
            self.smart_canvas,
        )
        self.assertIn(
            "document.querySelectorAll('ic-generation-pending[data-generation-pending-node]')",
            self.smart_canvas,
        )
        self.assertIn("body.includes('data-generation-pending-node')", self.smart_canvas)
        self.assertNotIn(
            '.image-node.node-pending ic-generation-pending:is([kind="image"],[kind="video"])::part(status)',
            self.style,
        )

    def test_component_library_covers_image_video_and_text_badges(self):
        for kind, elapsed in (("image", "6s"), ("video", "7s"), ("text", "8s")):
            with self.subTest(kind=kind):
                self.assertIn(f'data-component-name="ic-generation-pending-{kind}"', self.case)
                self.assertIn(f'elapsed="{elapsed}"', self.case)
        self.assertIn("['image', 'video', 'text']", self.browser_smoke)
        self.assertIn("badge:true, spinner:true", self.browser_smoke)


if __name__ == "__main__":
    unittest.main()
