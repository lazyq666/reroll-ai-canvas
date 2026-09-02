import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "available-model-management.html"
STYLE = ROOT / "static" / "css" / "available-model-management.css"
SCRIPT = ROOT / "static" / "js" / "available-model-management.js"
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
            "ic-icon",
            "ic-tabs",
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
        for key in ("models.icon", "models.modelNaming", "models.modelId", "models.providerId", "models.visibility", "models.operations"):
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



if __name__ == "__main__":
    unittest.main()
