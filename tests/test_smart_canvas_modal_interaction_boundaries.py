import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "smart-canvas.html"
HOST = ROOT / "static" / "js" / "smart-canvas.js"
INTERACTION = ROOT / "static" / "js" / "smart-canvas" / "canvas-interaction.js"


class SmartCanvasModalInteractionBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.interaction = INTERACTION.read_text(encoding="utf-8")

    def test_modal_shells_are_siblings_of_the_canvas_gesture_root(self):
        shell_boundary = self.page.index(
            '\n    </div>\n    <ic-prompt-node-focus-surface'
        )
        for modal_id in (
            'id="promptNodeFocusSurface"',
            'id="imageEditModal"',
            'id="smartContextResultBackdrop"',
            'id="referenceViewerBackdrop"',
            'id="smartLogModal"',
            'id="smartShortcutDialog"',
            'id="smartNodePackageImportDialog"',
            'id="promptTemplateDialog"',
            'id="workspaceAssetDialog"',
        ):
            with self.subTest(modal_id=modal_id):
                self.assertGreater(self.page.index(modal_id), shell_boundary)

        self.assertLess(
            self.page.index('id="generationFailureAlertQueue"'),
            shell_boundary,
        )
        self.assertLess(self.page.index('id="mentionPreview"'), shell_boundary)

    def test_all_canvas_capture_paths_share_one_chrome_target_contract(self):
        self.assertIn("const SMART_CANVAS_CHROME_SELECTOR = [", self.interaction)
        self.assertIn(
            "function smartCanvasInteractionOwnsTarget(target)",
            self.interaction,
        )
        self.assertIn(
            "if(smartCanvasInteractionOwnsTarget(event.target)){",
            self.interaction,
        )
        self.assertIn("ownsTarget:smartCanvasInteractionOwnsTarget", self.interaction)
        self.assertIn("return canvasInteraction.ownsTarget(target);", self.host)
        self.assertIn("return smartCanvasChromeTarget(target);", self.host)
        self.assertNotIn(".image-edit-modal", self.interaction)
        self.assertNotIn(".image-edit-dialog", self.interaction)

    def test_reference_viewer_initial_focus_uses_static_title(self):
        self.assertIn('id="referenceViewerTitle" tabindex="-1"', self.page)
        self.assertIn("referenceViewerTitle?.focus({preventScroll:true});", self.host)
        self.assertNotIn("referenceViewerClose?.focus({preventScroll:true});", self.host)


if __name__ == "__main__":
    unittest.main()
