import subprocess
import unittest
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasFrameUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.script = read_smart_canvas_scripts(ROOT)

    def test_frame_entry_points_and_shortcut_are_present(self):
        self.assertIn('id="smartFrameTool"', self.page)
        self.assertIn('shortcut="Shift+S"', self.page)
        self.assertIn("e.shiftKey && key === 's'", self.script)
        self.assertIn("activateSmartFrameTool()", self.script)

    def test_frame_is_an_organizational_node_not_a_runnable_group(self):
        self.assertIn("node.type === 'smart-frame'", self.script)
        self.assertIn("node.type === 'smart-section'", self.script)
        self.assertIn("|| smartContainer.isGroup(node)", self.script)
        self.assertNotIn("isSmartImageNode(node) || smartContainer.isGroup(node) || smartContainer.isFrame(node)", self.script)
        self.assertIn("const showQuickAdd = !nodeFarMode && !isAnnotation && !isFrame", self.script)
        self.assertIn(
            "function smartCanvasInteractionCanConnect(",
            self.script,
        )
        self.assertIn(
            "canvasInteractionContainerModule.isFrame(sourceNode)",
            self.script,
        )
        self.assertIn(
            "canvasInteractionContainerModule.isFrame(targetNode)",
            self.script,
        )

    def test_frame_supports_wrap_draw_rename_and_colors(self):
        for marker in (
            "function createFrameFromSelection",
            "function smartCanvasInteractionBeginFrame",
            "function smartCanvasInteractionEndFrame",
            "function beginSmartFrameTitleEdit",
            "function cycleSmartFrameColor",
        ):
            self.assertIn(marker, self.script)
        self.assertIn("SMART_FRAME_COLORS = ['blue', 'violet', 'amber', 'green', 'slate']", self.script)
        self.assertIn("SMART_FRAME_DEFAULT_COLOR = 'slate'", self.script)
        self.assertIn("frameColor:SMART_FRAME_COLORS.includes(data.frameColor)", self.script)
        self.assertIn(": SMART_FRAME_DEFAULT_COLOR", self.script)
        self.assertIn('.image-node.smart-frame-node', self.style)
        self.assertIn('body.smart-frame-tool .shell', self.style)
        self.assertIn('[data-frame-color="blue"]', self.style)
        self.assertIn('[data-frame-color="violet"]', self.style)

    def test_frame_hover_highlight_is_scoped_to_the_title_area(self):
        self.assertNotIn(
            ".image-node.smart-frame-node:hover {",
            self.style,
        )
        self.assertIn(
            ".image-node.smart-frame-node.frame-title-hover {",
            self.style,
        )
        self.assertIn(
            "frameHeader?.addEventListener('pointerenter'",
            self.script,
        )
        self.assertIn(
            "el.classList.remove('frame-title-hover')",
            self.script,
        )

    def test_new_frames_enter_title_editing_immediately(self):
        self.assertIn("function beginCreatedSmartFrameTitleEdit", self.script)
        self.assertIn(
            "requestAnimationFrame(() => beginSmartFrameTitleEdit(node.id));",
            self.script,
        )
        # Helper definition plus the selection-wrap, create-menu, and draw-complete entry points.
        self.assertGreaterEqual(
            self.script.count("beginCreatedSmartFrameTitleEdit("),
            4,
        )

    def test_frame_membership_move_and_delete_semantics_are_wired(self):
        self.assertIn("function smartContainerReconcileFrames", self.script)
        self.assertIn("smartContainer.expand([node.id])", self.script)
        self.assertIn(
            "dragIds = canvasInteractionContainerModule.expand(dragIds)",
            self.script,
        )
        self.assertIn(
            "canvasInteractionContainerModule.reconcileFrames();",
            self.script,
        )
        self.assertIn("preserveFrameContents:Boolean(e.ctrlKey || e.metaKey)", self.script)
        self.assertIn(
            "smartContainerIsFrame(node) && !options.preserveFrameContents",
            self.script,
        )

    def test_frame_members_are_preserved_across_copy_and_import(self):
        self.assertGreaterEqual(
            self.script.count("copy.items = copy.items.map(id => idMap.get(id)).filter(Boolean)"),
            2,
        )
        self.assertIn("function canvasMutationDuplicate(", self.script)
        self.assertIn(
            "const ids = smartContainer.expand("
            "window.SmartCanvasModules.viewportSelection.selection.ids())",
            self.script,
        )

    def test_smart_canvas_script_is_valid_javascript(self):
        result = subprocess.run(
            ["node", "--check", "static/js/smart-canvas.js"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
