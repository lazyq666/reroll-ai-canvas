import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class UiComponentLibraryDialogMenuDimensionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dialog_case = (ROOT / "static/design-system/infinite-canvas-ui/dialog-case.html").read_text()
        cls.dialog_case_app = (ROOT / "static/js/infinite-canvas-ui/dialog-case.js").read_text()
        cls.menu_case = (ROOT / "static/design-system/infinite-canvas-ui/menu-popover-case.html").read_text()
        cls.menu_case_app = (ROOT / "static/js/infinite-canvas-ui/menu-popover-case.js").read_text()
        cls.matrix_presentation = (ROOT / "static/js/ui-component-library/matrix-presentation.js").read_text()
        cls.preview_css = (ROOT / "static/css/ui-component-library-preview.css").read_text()

    def test_dialog_size_is_a_dedicated_matrix_dimension(self):
        self.assertIn('aria-labelledby="dialog-size-heading"', self.dialog_case)
        self.assertIn('<h2 id="dialog-size-heading">尺寸（Size）</h2>', self.dialog_case)
        size_section = self.dialog_case.split('id="dialog-size-heading"', 1)[1].split('</section>', 1)[0]
        for size in ("Small", "Medium", "Large", "X-Large"):
            self.assertIn(f'data-ui-library-matrix-label="{size}"', size_section)
        for layout in (
            "固定宽度 28rem · 高度随内容",
            "固定宽度 45rem · 高度随内容",
            "固定宽度 72rem · 高度限制为 48rem",
            "宽度 90vw · 高度 92vh",
        ):
            self.assertIn(layout, size_section)
        self.assertIn("xLargeLayout: '宽度 90vw · 高度 92vh'", self.dialog_case_app)
        self.assertNotIn("Confirmation", size_section)
        self.assertIn('<h2 id="dialog-dismiss-heading">关闭策略与标题</h2>', self.dialog_case)
        dismiss_section = self.dialog_case.split('id="dialog-dismiss-heading"', 1)[1].split('</section>', 1)[0]
        self.assertNotIn('data-legal-combination="x-large-explicit-task"', dismiss_section)
        self.assertEqual(dismiss_section.count('data-legal-combination='), 4)
        self.assertIn('<h2 id="dialog-confirmation-heading">Confirmation</h2>', self.dialog_case)
        self.assertIn('<h2 id="dialog-compact-heading">紧凑 Modal</h2>', self.dialog_case)
        compact_section = self.dialog_case.split('id="dialog-compact-heading"', 1)[1].split('</section>', 1)[0]
        self.assertIn('data-legal-combination="small-compact-light-inspection"', compact_section)
        self.assertIn('data-legal-combination="small-compact-explicit-task"', compact_section)

    def test_menu_popover_live_case_requests_room_for_open_overlays(self):
        self.assertIn("params.get('viewport')==='narrow'?'360px':'none'", self.menu_case_app)
        self.assertNotIn("params.get('viewport')==='narrow'?'360px':'900px'", self.menu_case_app)
        self.assertIn("'--ui-library-matrix-cell-min-width','320px'", self.menu_case_app)
        self.assertIn("'--ui-library-matrix-cell-min-height','120px'", self.menu_case_app)
        self.assertNotIn("mentionPicker.show(mentionTrigger.closest", self.menu_case_app)
        self.assertNotIn("mentionScrollPicker.show(mentionScrollTrigger.closest", self.menu_case_app)
        self.assertIn("placement:'block-end'", self.menu_case_app)
        self.assertIn(
            "min-width: var(--ui-library-matrix-cell-min-width, 184px)",
            self.preview_css,
        )
        self.assertIn(
            "height: var(--ui-library-matrix-cell-min-height, auto)",
            self.preview_css,
        )

    def test_menu_popover_matrix_is_split_into_short_semantic_groups(self):
        self.assertIn("const menuPopoverGroupDefinitions", self.menu_case_app)
        for heading in (
            "Mention Picker",
            "Dropdown Menu",
            "选择菜单",
            "Context Menu",
            "命令菜单项",
            "选择菜单项",
            "轻关闭 Popover",
            "显式确认 Popover",
            "Tooltip",
        ):
            with self.subTest(heading=heading):
                self.assertIn(heading, self.menu_case_app)
        self.assertIn(".menu-popover-family-grid", self.matrix_presentation)
        self.assertIn(
            '.ui-library-state-matrix > thead > tr > th {\n  height: auto;',
            self.preview_css,
        )
        shared_cell_rules = self.preview_css.split(
            '.ui-library-state-matrix > :is(thead, tbody) > tr > :is(th, td) {',
            1,
        )[1].split("}", 1)[0]
        self.assertNotIn("height:", shared_cell_rules)

    def test_menu_popover_matrix_owns_titles_and_uses_one_cell_surface(self):
        self.assertIn("example.classList.add('menu-popover-example')", self.menu_case_app)
        self.assertIn("example.dataset.uiLibraryMatrixLabel=", self.menu_case_app)
        self.assertIn(
            'html[data-ui-library-layout="compact"] .menu-popover-example {',
            self.preview_css,
        )
        self.assertIn(
            'html[data-ui-library-layout="compact"] .menu-popover-example > :is(h2, p) {',
            self.preview_css,
        )
        self.assertIn(
            'html[data-menu-popover-case-status][data-ui-library-layout="compact"] .ui-library-state-matrix,',
            self.preview_css,
        )


if __name__ == "__main__":
    unittest.main()
