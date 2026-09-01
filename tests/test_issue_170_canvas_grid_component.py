import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "static/js/infinite-canvas-ui/canvas-grid.js"
COMPONENT = ROOT / "static/js/infinite-canvas-ui/canvas-grid/canvas-grid.js"
CORE = ROOT / "static/js/infinite-canvas-ui/core.js"
CANVAS_LIST_PAGE = ROOT / "static/canvas-list.html"
CANVAS_LIST_STYLE = ROOT / "static/css/canvas-list.css"
SMART_CANVAS_PAGE = ROOT / "static/smart-canvas.html"
SMART_CANVAS_STYLE = ROOT / "static/css/smart-canvas.css"


class Issue170CanvasGridComponentTests(unittest.TestCase):
    def test_public_component_owns_the_semantic_dot_grid(self):
        source = COMPONENT.read_text(encoding="utf-8")
        entry = ENTRY.read_text(encoding="utf-8")
        core = CORE.read_text(encoding="utf-8")

        self.assertEqual("export { IcCanvasGrid } from './canvas-grid/canvas-grid.js';", entry.strip())
        self.assertIn("export class IcCanvasGrid extends HTMLElement", source)
        self.assertIn("var(--ui-color-surface-canvas)", source)
        self.assertIn("var(--ui-color-border-canvas-grid)", source)
        self.assertIn("radial-gradient", source)
        self.assertIn("background-size:15px 15px", source)
        self.assertIn("pointer-events:none", source)
        self.assertIn("this.dataset.icContractStatus = 'ready'", source)
        self.assertIn("import { IcCanvasGrid }", core)
        self.assertIn("define('ic-canvas-grid', IcCanvasGrid)", core)
        self.assertRegex(core, r"export \{[^}]*\bIcCanvasGrid\b")

    def test_canvas_list_and_smart_canvas_consume_the_same_component(self):
        canvas_list_page = CANVAS_LIST_PAGE.read_text(encoding="utf-8")
        smart_canvas_page = SMART_CANVAS_PAGE.read_text(encoding="utf-8")

        self.assertIn(
            '<div id="board" class="ws-board" aria-busy="true">\n'
            '                <ic-canvas-grid></ic-canvas-grid>',
            canvas_list_page,
        )
        self.assertIn(
            '<div id="shell" class="shell" tabindex="0" aria-label="智能画布" data-i18n-aria-label="smart.title">\n'
            '        <ic-canvas-grid id="smartCanvasGrid"></ic-canvas-grid>',
            smart_canvas_page,
        )
        smart_canvas_script = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        self.assertIn("'smartCanvasGrid',", smart_canvas_script)

    def test_page_styles_do_not_duplicate_or_extend_the_grid_painting(self):
        canvas_list_style = CANVAS_LIST_STYLE.read_text(encoding="utf-8")
        smart_canvas_style = SMART_CANVAS_STYLE.read_text(encoding="utf-8")

        board_rule = canvas_list_style.split(".ws-board {", 1)[1].split("}", 1)[0]
        shell_rule = smart_canvas_style.split(".shell {", 1)[1].split("}", 1)[0]
        for rule in (board_rule, shell_rule):
            self.assertNotIn("background-image", rule)
            self.assertNotIn("background-size", rule)
            self.assertNotIn("radial-gradient", rule)
            self.assertNotIn("linear-gradient", rule)
        self.assertNotIn("--ws-board-major-grid-color", canvas_list_style)


if __name__ == "__main__":
    unittest.main()
