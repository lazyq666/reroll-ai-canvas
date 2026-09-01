import unittest
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasPromptTemplatePanelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.script = read_smart_canvas_scripts(ROOT)
        cls.component = (
            ROOT / "static/js/infinite-canvas-ui/prompt-template-library.js"
        ).read_text(encoding="utf-8")
        cls.server = (ROOT / "backend/main.py").read_text(encoding="utf-8")
        cls.classic_page = (ROOT / "static/canvas.html").read_text(encoding="utf-8")
        cls.classic_script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")
        cls.commit_lane = (
            ROOT / "static/js/infinite-canvas-ui/canvas-commit-lane.js"
        ).read_text(encoding="utf-8")

    def test_canvas_prompt_writes_share_one_commit_lane_without_prompt_revision_cache(self):
        for page, host_script in (
            (self.page, "/static/js/smart-canvas.js"),
            (self.classic_page, "/static/js/canvas.js"),
        ):
            lane_script = "/static/js/infinite-canvas-ui/canvas-commit-lane.js"
            self.assertIn(lane_script, page)
            self.assertLess(page.index(lane_script), page.index(host_script))
        self.assertIn("return Object.freeze({commitPrompt});", self.commit_lane)
        self.assertIn("smartPromptCommitLane().commitPrompt", self.script)
        self.assertIn("classicPromptCommitLane().commitPrompt", self.classic_script)
        self.assertNotIn("promptTemplateRevision", self.script)
        self.assertNotIn("canvasPromptTemplateRevision", self.classic_script)
        self.assertIn('"action": "create"', self.server)
        self.assertIn('"expected_item_version"', self.server)

    def test_template_library_uses_one_public_component_shell(self):
        start = self.page.index('id="promptTemplateDialog"')
        end = self.page.index('</ic-dialog>', start)
        panel = self.page[start:end]
        self.assertIn('<ic-dialog id="promptTemplateDialog" class="prompt-template-dialog"', self.page)
        self.assertIn('<ic-prompt-template-library id="promptTemplatePanel"', self.page)
        self.assertIn('can-manage></ic-prompt-template-library>', panel)
        for old_internal_id in (
            "promptTemplateLibraryTabs",
            "promptTemplateSearch",
            "promptTemplateCats",
            "promptTemplateGroupManager",
            "promptTemplateBody",
            "promptTemplateEditorBackdrop",
        ):
            self.assertNotIn(old_internal_id, panel)
        self.assertIn("promptTemplatePanel.libraries = promptLibraries", self.script)
        self.assertIn("promptTemplatePanel.templates = promptQuickTemplateItems()", self.script)
        self.assertNotIn("fetch(", self.component)
        self.assertNotIn("localStorage", self.component)
        self.assertIn('size="s" background="ghost" icon="close"', self.component)

    def test_template_cards_use_whole_card_activation_with_edit_as_the_only_inline_action(self):
        for marker in (
            'part="new-card"',
            'part="template-card"',
            'data-template-edit=',
            'part="template-mask"',
            'data-editor-delete',
            'data-template-delete-confirmation',
            "openCreate()",
            "openEdit(templateId)",
            "ic-template-select",
            "ic-template-create",
            "ic-template-edit",
            "ic-template-delete",
            "ic-template-copy",
        ):
            self.assertIn(marker, self.component)
        actions = self.component.split('<span part="template-actions">', 1)[1].split('</span>', 1)[0]
        self.assertIn('data-template-edit=', actions)
        self.assertNotIn('data-template-copy=', actions)
        self.assertNotIn('data-template-promote=', actions)
        self.assertNotIn('data-template-delete', actions)
        self.assertNotIn("button.matches('[data-template-delete]')", self.component)
        self.assertIn("async function copyPromptTemplateText", self.script)
        self.assertIn("copyTextToClipboard(text)", self.script)
        self.assertIn("async function activatePromptTemplateFromPanel", self.script)
        self.assertIn("target === 'composer'", self.script)
        self.assertIn("target === 'node'", self.script)
        self.assertIn("return copyPromptTemplateText(templateId)", self.script)
        self.assertIn("async function savePromptTemplateEdit(detail={})", self.script)
        self.assertIn("async function deletePromptTemplate(templateId='')", self.script)
        self.assertNotIn("applyPromptTemplateToNode", self.script)
        self.assertNotIn("prompt-template-use-btn", self.component)

    def test_copy_result_toasts_distinguish_success_from_failure(self):
        self.assertGreaterEqual(
            self.script.count("{tone:copied ? 'success' : 'danger'}"),
            3,
        )
        self.assertIn("copied ? message : tr('smart.copyRetry')", self.script)
        self.assertIn("tr('smart.diagnosticsCopied') : tr('canvas.copyFailed')", self.script)

    def test_group_management_emits_crud_and_ordering_to_smart_canvas(self):
        for marker in (
            'part="sidebar"',
            'data-legal-combination="vertical-manual-label"',
            "this._draggedCategoryId",
            "this._draggedTemplateId",
            "handleDragStart(event)",
            "handleDrop(event)",
            "ic-category-create",
            "ic-category-edit",
            "ic-category-delete",
            "this.emit('ic-template-reorder', { scope: 'categories', categoryIds })",
        ):
            self.assertIn(marker, self.component)
        for marker in (
            "async function createPromptTemplateGroup(detail={})",
            "async function renamePromptTemplateGroup(detail={})",
            "async function deletePromptTemplateGroup",
            "async function persistPromptTemplateGroupOrder",
            "/categories/order",
        ):
            self.assertIn(marker, self.script)
        for marker in (
            "openCategoryEditor(mode, categoryId = '')",
            'part="category-rename-field"',
            "name: categoryName",
        ):
            self.assertIn(marker, self.component)
        self.assertIn("event.detail || {}", self.script)
        self.assertNotIn("window.prompt(", self.script)
        self.assertNotIn("window.confirm(", self.script)

    def test_server_persists_prompt_group_order(self):
        for marker in (
            "class PromptLibraryCategoryReorderRequest",
            '@app.patch("/api/prompt-libraries/{library_id}/categories/order")',
            "async def reorder_prompt_library_categories",
            'library["categories"] = [category_by_id[category_id] for category_id in requested_ids]',
            "data = save_prompt_libraries(data)",
        ):
            self.assertIn(marker, self.server)

    def test_group_sidebar_is_responsive_scrollable_and_owned_by_component(self):
        self.assertIn("grid-template-columns:calc(13 * var(--ui-space-4)) minmax(0,1fr)", self.component)
        self.assertIn("overflow:auto", self.component)
        self.assertIn('data-category-item', self.component)
        self.assertNotIn(".prompt-template-group-manager", self.style)

    def test_template_library_uses_shared_large_modal_semantics(self):
        self.assertIn('<ic-dialog id="promptTemplateDialog" class="prompt-template-dialog"', self.page)
        self.assertIn('size="x-large" dismiss-policy="explicit"', self.page)
        self.assertIn('<section part="workspace"', self.component)
        self.assertNotIn('<dialog part="panel"', self.component)
        self.assertNotIn("dialog.showModal()", self.component)
        self.assertNotIn("position:absolute; right:22px; top:66px; bottom:140px", self.style)

    def test_template_editor_keeps_cover_data_at_business_boundary(self):
        self.assertIn('<ic-file-input data-editor-cover-input', self.component)
        self.assertIn('accept="image/*" hidden', self.component)
        self.assertIn('event.detail?.acceptedFiles', self.component)
        self.assertIn('part="editor-preview editor-cover"', self.component)
        self.assertIn("coverFile", self.component)
        self.assertIn("detail.draft?.coverFile", self.script)
        self.assertIn("uploadPromptTemplateCover(detail.draft.coverFile)", self.script)
        self.assertIn("fetch('/api/prompt-libraries/covers'", self.script)
        self.assertIn("fetch('/api/prompt-libraries/covers'", self.classic_script)
        self.assertNotIn("form.append('files', file, file.name || 'prompt-cover')", self.classic_script)
        self.assertIn('"cover": payload.cover or ""', self.server)
        self.assertIn('"cover": item.get("cover") if payload.cover is None else payload.cover', self.server)

    def test_prompt_template_contract_removes_scene_metadata(self):
        self.assertNotIn("scene: str =", self.server)
        self.assertIn('normalized.pop("scene", None)', self.server)
        self.assertIn('normalized.pop("scene_en", None)', self.server)
        self.assertNotIn("template.scene", self.component)
        self.assertNotIn("template.scene_en", self.component)

    def test_composer_and_dock_entry_keep_their_shared_open_source(self):
        self.assertIn('id="composerTemplateBtn"', self.page)
        self.assertIn('id="promptTemplateDockToggle"', self.page)
        self.assertIn("promptTemplatePanel.dataset.target = target", self.script)
        self.assertIn("const target = options.target === 'composer' ? 'composer' : options.target === 'library' ? 'library' : 'node'", self.script)
        self.assertIn("await promptTemplateDialog.show()", self.script)
        self.assertIn("await promptTemplateDialog.hide", self.script)
        self.assertIn("promptTemplatePanel?.addEventListener('ic-close', closePromptTemplatePanel)", self.script)
        self.assertIn("promptTemplateDialog?.addEventListener('ic-hide', closePromptTemplatePanel)", self.script)
        self.assertIn("requestAnimationFrame(() => (target === 'composer' ? composerTemplateBtn : promptTemplateDockToggle)?.focus", self.script)


if __name__ == "__main__":
    unittest.main()
