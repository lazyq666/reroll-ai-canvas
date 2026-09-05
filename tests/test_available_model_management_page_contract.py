import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "available-model-management.html"
STYLE = ROOT / "static" / "css" / "available-model-management.css"
SCRIPT = ROOT / "static" / "js" / "available-model-management.js"
WORKBENCH_SCRIPT = ROOT / "static" / "js" / "model-capability-workbench.js"
STATE_SCRIPT = ROOT / "static" / "js" / "available-model-management-state.js"
I18N = ROOT / "static" / "js" / "i18n" / "model-management.js"
VENDOR_ICONS = ROOT / "static" / "js" / "model-vendor-icons.js"
BACKEND = ROOT / "backend" / "main.py"
AUTH = ROOT / "backend" / "infinite_canvas" / "auth_system.py"


class AvailableModelManagementPageContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.workbench_script = WORKBENCH_SCRIPT.read_text(encoding="utf-8")
        cls.state_script = STATE_SCRIPT.read_text(encoding="utf-8")
        cls.i18n = I18N.read_text(encoding="utf-8")
        cls.vendor_icons = VENDOR_ICONS.read_text(encoding="utf-8")
        cls.backend = BACKEND.read_text(encoding="utf-8")
        cls.auth = AUTH.read_text(encoding="utf-8")

    def test_page_composes_public_infinite_canvas_components(self):
        for tag in (
            "ic-alert",
            "ic-badge",
            "ic-card",
            "ic-dialog",
            "ic-icon",
            "ic-tabs",
            "ic-textarea",
        ):
            self.assertIn(f"<{tag}", self.page)
        self.assertIn("/static/js/infinite-canvas-ui/core.js", self.page)
        self.assertIn('data-studio-scale="off"', self.page)
        self.assertIn('/static/js/theme.js', self.page)
        self.assertNotRegex(self.page, r"<wa-[a-z]")
        self.assertNotIn("--wa-", self.page)
        self.assertNotIn("/static/vendor/js/lucide.js", self.page)
        self.assertEqual(len(re.findall(r"<button\b", self.page)), 3)
        self.assertEqual(len(re.findall(r'<button data-value="(?:image|video|text)"', self.page)), 3)
        self.assertNotIn('id="management-sections"', self.page)
        self.assertNotIn('id="capability-workbench-view"', self.page)
        self.assertNotIn('id="save-order"', self.page)
        self.assertNotIn('models.saveOrder', self.page)
        self.assertNotIn('id="icon-style"', self.page)
        self.assertNotIn("models.iconStyle", self.page)
        self.assertNotIn("models.iconOutline", self.page)
        self.assertNotIn("models.iconFilled", self.page)
        self.assertNotIn("models.iconStyle", self.i18n)
        self.assertNotIn("models.iconOutline", self.i18n)
        self.assertNotIn("models.iconFilled", self.i18n)

    def test_dynamic_rows_use_public_controls_and_feedback(self):
        self.assertIn("element('ic-icon-button'", self.script)
        self.assertIn("element('ic-empty-state'", self.script)
        self.assertIn("element('ic-input', 'model-name-input')", self.script)
        self.assertIn("element('ic-checkbox', 'model-visibility-checkbox')", self.script)
        self.assertIn("element('ic-table', 'model-table')", self.script)
        self.assertIn("element('ic-toolbar', 'order-actions')", self.script)
        self.assertIn("element('ic-button', 'model-capability-edit'", self.script)
        self.assertIn("empty.setAttribute('label', activeLabel)", self.script)
        self.assertIn("button.setAttribute('label', label)", self.script)
        self.assertIn("button.toggleAttribute('disabled', disabled)", self.script)
        self.assertNotIn("document.createElement('button')", self.script)
        self.assertNotIn("window.lucide", self.script)
        self.assertNotIn("data-lucide", self.script)
        self.assertNotIn("const setTheme", self.script)

    def test_dynamic_rows_share_vendor_icon_rules_with_model_pickers(self):
        self.assertIn('/static/js/model-vendor-icons.js', self.page)
        self.assertIn("window.ModelVendorIcons?.markup(", self.script)
        self.assertIn("iconCell.appendChild(modelVendorIcon(model))", self.script)
        self.assertIn("identity.appendChild(modelNameInput(model))", self.script)
        self.assertIn("midjourney: { label: 'Midjourney', src: '/static/images/providers/midjourney.svg'", self.vendor_icons)
        self.assertIn("if (/mid[-_ ]?journey/.test(value)) return 'midjourney';", self.vendor_icons)
        self.assertIn(".model-vendor-icon { width: 18px;", self.style)
        self.assertIn('img[data-monochrome="true"]', self.style)

    def test_model_type_counts_ordering_and_save_outcomes_are_preserved(self):
        for kind in ("image", "video", "text"):
            self.assertIn(f'id="{kind}-count"', self.page)
        for interaction in ("dragstart", "dragover", "drop", "move(index, index - 1)", "move(index, index + 1)"):
            self.assertIn(interaction, self.script)
        self.assertIn("'/api/admin/available-models'", self.script)
        self.assertIn("method: 'PUT'", self.script)
        self.assertIn("models.map((model) => model.id)", self.script)
        self.assertIn("names: Object.fromEntries(state.dirtyNames)", self.script)
        self.assertIn("visible: Object.fromEntries", self.script)
        self.assertIn("input.addEventListener('focusout'", self.script)
        self.assertIn("if (event.key === 'Enter') commitChanges()", self.script)
        self.assertIn("state.orderDirty = true", self.script)
        self.assertIn("const namesApplied = [...submittedNames].every", self.script)
        self.assertIn("throw new Error(tr('models.saveNotApplied'))", self.script)
        for key in ("models.icon", "models.modelNaming", "models.modelId", "models.providerId", "models.features", "models.visibility", "models.operations"):
            self.assertIn(key, self.script)
        self.assertNotIn("input.setAttribute('required'", self.script)
        self.assertIn("parent.postMessage({ type: 'models-changed' }", self.script)
        self.assertIn("new BroadcastChannel('studio-api')", self.script)
        self.assertNotIn("saveButton", self.script)
        self.assertIn("isError ? 'danger' : 'success'", self.script)
        self.assertIn("model.provider_name,\n      'auto',", self.script)
        self.assertNotIn("iconStyleControl", self.script)
        self.assertNotIn("state.iconStyle", self.script)
        self.assertNotIn("'outline'", self.script)

    def test_sequential_visibility_edits_keep_live_row_objects_connected(self):
        self.assertIn("const applySavedModelsInPlace =", self.script)
        self.assertIn("stateTools.applySavedModelsInPlace(state.models, savedModels)", self.script)
        self.assertIn("stateTools.setModelVisibility(state.models, kind, model.id, checkbox.checked)", self.script)
        self.assertIn("Object.assign(current, saved)", self.state_script)
        self.assertIn("const current = (models?.[kind] || []).find", self.state_script)
        self.assertEqual(1, self.script.count("state.models = payload.models || state.models;"))

    def test_admin_permission_boundary_remains_server_enforced(self):
        endpoint = self.backend.index('@app.put("/api/admin/available-models")')
        enforcement = self.backend.index('require_current_user("admin")', endpoint)
        response = self.backend.index('return {"models": models}', endpoint)
        self.assertLess(endpoint, enforcement)
        self.assertLess(enforcement, response)
        self.assertIn('"/static/available-model-management.html"', self.auth)

    def test_page_styles_keep_layout_without_legacy_component_chrome(self):
        self.assertIn('html[data-ui-theme="light"] body { background: var(--ui-color-surface); }', self.style)
        self.assertIn(".model-page {", self.style)
        self.assertIn(".model-row {", self.style)
        self.assertIn("color: var(--ui-color-text-primary)", self.style)
        self.assertNotIn("--ui-palette-", self.style)
        self.assertIn("@media (max-width: 45rem)", self.style)
        self.assertNotIn("::part(", self.style)
        self.assertNotRegex(self.style, r"#[0-9a-fA-F]{3,8}\b")
        self.assertNotIn("--wa-", self.style)
        for selector in (
            ".button.primary",
            ".type-tab.active",
            ".platform-tag",
            ".order-button",
            ".empty-state",
            ".page-message.error",
        ):
            self.assertNotIn(selector, self.style)

    def test_model_rows_open_capability_details_in_a_dialog(self):
        self.assertIn('/static/js/model-capability-workbench.js', self.page)
        self.assertIn('id="capability-editor-dialog"', self.page)
        self.assertIn('id="capability-operation-editors"', self.page)
        self.assertIn('id="capability-import-open"', self.page)
        self.assertIn('id="capability-import-data"', self.page)
        self.assertNotIn('id="capability-model-rows"', self.page)
        self.assertNotIn('data-i18n="models.modelType"', self.page)
        self.assertNotIn('data-i18n="models.platforms"', self.page)
        self.assertNotIn('id="capability-provider"', self.page)
        self.assertNotIn('Inputs JSON', self.page)
        self.assertNotIn('Parameters JSON', self.page)
        for endpoint in (
            "/api/admin/model-capability-matrix",
            "/api/admin/model-capability-matrix/import",
            "/api/admin/model-capabilities/refresh",
        ):
            self.assertIn(endpoint, self.workbench_script)
        self.assertNotIn("/api/admin/model-capability-matrix/ai-draft", self.backend)
        self.assertNotIn("/api/admin/model-capability-drafts/extract", self.backend)
        self.assertNotIn("AI 补全能力", self.page)
        self.assertIn("inputTypes.forEach", self.workbench_script)
        self.assertIn("const lookupPrompt =", self.workbench_script)
        self.assertIn("channel_id: provider.id", self.workbench_script)
        self.assertIn("model_types: modelTypes", self.workbench_script)
        self.assertIn("available_operations:", self.workbench_script)
        self.assertIn("aliases:", self.workbench_script)
        self.assertIn("schema_version: 1", self.workbench_script)
        self.assertIn("state.validatedImport", self.workbench_script)
        self.assertIn("output_count_maximum", self.workbench_script)
        self.assertIn("aspect_ratios", self.workbench_script)
        self.assertIn("window.ModelCapabilityEditor = Object.freeze", self.workbench_script)
        self.assertIn("window.ModelCapabilityEditor.open(model.model)", self.script)
        self.assertIn("model-capability-matrix-change", self.workbench_script)
        self.assertIn("model-capability-matrix-change", self.script)
        self.assertIn("models.tagLayerDecomposition", self.script)
        self.assertIn("models.tagTransparentPng", self.script)
        self.assertNotIn("innerHTML", self.workbench_script)
        self.assertNotIn("document.createElement('button')", self.workbench_script)

    def test_capability_workbench_copy_is_localized_in_both_languages(self):
        keys = set(re.findall(r'data-i18n(?:-label)?="([^"]+)"', self.page))
        keys.update(re.findall(r"(?:tr|tf)\('([^']+)'", self.workbench_script))
        keys.update(re.findall(r"(?:tr|tf)\('([^']+)'", self.script))
        for key in keys:
            self.assertRegex(
                self.i18n,
                rf'"{re.escape(key)}"\s*:\s*\{{\s*zh:\s*"[^"]+",\s*en:\s*"[^"]+"',
                key,
            )

    def test_capability_workbench_resizes_without_hardcoded_visual_tokens(self):
        self.assertIn(".capability-product-editor { min-width: 0; }", self.style)
        self.assertIn(".capability-choice-grid { grid-template-columns: 1fr; }", self.style)
        self.assertIn(".capability-catalog-actions > * { flex: 1 1 100%; }", self.style)



if __name__ == "__main__":
    unittest.main()
