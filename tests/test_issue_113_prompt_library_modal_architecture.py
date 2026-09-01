import unittest
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class Issue113PromptLibraryModalArchitectureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.host = read_smart_canvas_scripts(ROOT)
        cls.library = (
            ROOT / "static/js/infinite-canvas-ui/prompt-template-library.js"
        ).read_text(encoding="utf-8")
        cls.classic_host = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")
        cls.classic_style = (ROOT / "static/css/canvas.css").read_text(encoding="utf-8")

    def test_shared_dialog_is_the_only_modal_shell_and_lives_outside_canvas_shell(self):
        shell_start = self.page.index('<div id="shell"')
        shell_end = self.page.index('<ic-dialog id="smartLogModal"', shell_start)
        dialog_start = self.page.index('<ic-dialog id="promptTemplateDialog"')
        self.assertGreater(dialog_start, shell_end)
        self.assertIn(
            '<ic-prompt-template-library id="promptTemplatePanel"',
            self.page,
        )
        self.assertIn('size="x-large" dismiss-policy="explicit"', self.page)
        self.assertNotIn('<dialog part="panel"', self.library)
        self.assertNotIn('dialog.showModal()', self.library)
        self.assertIn('<section part="workspace"', self.library)
        self.assertIn("const promptTemplateDialog = document.getElementById('promptTemplateDialog')", self.host)
        self.assertIn('await promptTemplateDialog.show()', self.host)
        self.assertIn(
            "await promptTemplateDialog.hide(event?.detail?.reason || 'programmatic')",
            self.host,
        )
        self.assertNotIn('shell.appendChild(promptTemplatePanel)', self.host)
        self.assertIn('.prompt-template-dialog::part(body)', self.style)

    def test_common_categories_are_a_vertical_sidebar_using_the_public_tabs_contract(self):
        self.assertIn('part="library-layout"', self.library)
        self.assertIn('part="sidebar"', self.library)
        self.assertIn(
            'data-legal-combination="vertical-manual-label"',
            self.library,
        )
        self.assertIn('orientation="vertical"', self.library)
        self.assertIn('activation="manual"', self.library)
        self.assertNotIn('data-legal-combination="horizontal-automatic-label"', self.library)

    def test_category_assignment_moved_out_of_template_editor_and_into_card_drop(self):
        editor = self.library.split('return `<section class="task-surface" part="editor"', 1)[1].split(
            "</section>`;", 1
        )[0]
        self.assertNotIn('data-editor-category', editor)
        self.assertIn('draggable="true" data-template-drag', self.library)
        self.assertIn("this._draggedTemplateId", self.library)
        self.assertIn("this.emit('ic-template-move'", self.library)
        self.assertIn("'ic-template-move'", self.library)
        self.assertNotIn('data-template-move-action', self.library)
        self.assertNotIn('data-template-move-category', self.library)
        self.assertIn('part="template-drag-preview"', self.library)
        self.assertIn('async function movePromptTemplateToCategory(detail={})', self.host)
        self.assertIn("promptTemplatePanel?.addEventListener('ic-template-move'", self.host)

    def test_sidebar_items_reorder_in_place_instead_of_opening_a_second_manager_list(self):
        self.assertIn('data-category-item', self.library)
        self.assertIn('data-category-drag', self.library)
        self.assertIn("this.reorderCategories(sourceId, targetId)", self.library)
        self.assertNotIn('part="category-manager"', self.library)

    def test_classic_canvas_has_only_the_controlled_library_implementation(self):
        self.assertEqual(self.classic_host.count("function renderPromptTemplateModal(){"), 1)
        self.assertEqual(self.classic_host.count("async function openPromptTemplateModal(nodeId){"), 1)
        for legacy_marker in (
            "promptTemplateCats",
            "promptTemplateBody",
            "promptTemplateGroupEditMode",
            "prompt-template-group-panel",
            "prompt-template-list-tools",
        ):
            self.assertNotIn(legacy_marker, self.classic_host)
        for legacy_selector in (
            ".prompt-template-modal",
            ".prompt-template-panel",
            ".prompt-template-group-panel",
            ".prompt-template-detail",
        ):
            self.assertNotIn(legacy_selector, self.classic_style)


if __name__ == "__main__":
    unittest.main()
