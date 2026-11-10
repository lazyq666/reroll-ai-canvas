import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ApiSettingsStandardContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/api-settings.html").read_text()
        cls.script = (ROOT / "static/js/api-settings.js").read_text()
        cls.models = (ROOT / "static/js/available-model-management.js").read_text()
        cls.shell = (ROOT / "static/index.html").read_text()
        cls.navigation = (ROOT / "static/js/studio-shell.js").read_text()
        cls.auth = (ROOT / "backend/infinite_canvas/auth_system.py").read_text()

    def test_one_admin_entry_and_legacy_navigation_migration(self):
        self.assertEqual(self.shell.count('id="frame-model-providers"'), 1)
        self.assertIn("switchUI(this, 'model-providers')", self.shell)
        self.assertNotIn('id="frame-api-settings"', self.shell)
        self.assertNotIn('id="frame-available-model-management"', self.shell)
        self.assertIn("['api-settings', 'available-model-management']", self.navigation)
        self.assertIn("canonicalPage(localStorage.getItem(ACTIVE_PAGE_KEY))", self.navigation)
        self.assertIn('"/static/api-settings.html"', self.auth)
        self.assertIn('"/static/available-model-management.html"', self.auth)
        legacy = (ROOT / "static/available-model-management.html").read_text()
        self.assertIn('content="0;url=/static/api-settings.html"', legacy)
        self.assertNotIn('id="model-list"', legacy)

    def test_one_model_list_with_stable_ids_and_local_names(self):
        self.assertEqual(self.page.count('id="model-list"'), 1)
        for obsolete in ("imageModelList", "videoModelList", "chatModelList", "providerNavigation"):
            self.assertNotIn(f'id="{obsolete}"', self.page)
        self.assertNotIn("function renderModels(", self.script)
        self.assertNotIn("function updateModel(", self.script)
        self.assertIn("window.ProviderModels = Object.freeze", self.models)
        self.assertIn("window.ProviderConnections = Object.freeze", self.script)
        self.assertIn("model.provider_id === state.providerId", self.models)
        self.assertIn("'/api/admin/available-models'", self.models)
        self.assertIn("names: Object.fromEntries(state.dirtyNames)", self.models)
        self.assertIn("provider-models-saved", self.models)
        self.assertIn("provider-models-saved", self.script)

    def test_provider_detail_does_not_create_nested_dialogs(self):
        self.assertRegex(self.page, r'<section id="providerEditor"[^>]+hidden>')
        self.assertNotRegex(self.page, r'<ic-dialog id="providerEditor"')
        for dialog in ("capability-editor-dialog", "apiActionConfirmation"):
            self.assertIn(f'id="{dialog}"', self.page)
        for panel in ("manualModelPanel", "modelPickerPanel"):
            self.assertRegex(self.page, rf'<section id="{panel}"[^>]+hidden>')
        self.assertNotIn('id="manualModelDialog"', self.page)
        self.assertNotIn('id="modelPickerOverlay"', self.page)
        self.assertIn("window.ProviderModels.flush()", self.script)
        self.assertIn("!await commitAutoSave()", self.script)

    def test_backup_has_one_owner_and_keeps_password_confirmation(self):
        for control in ("export-model-settings", "import-model-settings", "apiSettingsImportInput", "apiTransferDialog", "apiImportConfirmation"):
            self.assertEqual(self.page.count(f'id="{control}"'), 1)
        self.assertIn("showBackupError(tr('api.passwordMismatch'))", self.models)
        self.assertIn("password.length < 8", self.models)
        self.assertIn("form.append('preview', 'true')", self.models)
        self.assertIn("requestApiImportConfirmation(summary)", self.models)
        self.assertIn("window.ProviderConnections.flush()", self.models)
        self.assertIn("window.ProviderConnections?.reload()", self.models)

    def test_connection_and_specialized_controls_keep_existing_owners(self):
        for control in ("nameInput", "baseInput", "keyInput", "rhFreeKeyInput", "rhWalletKeyInput", "volcAkInput", "volcSkInput"):
            self.assertRegex(self.page, rf'<ic-input[^>]+id="{control}"')
        for panel in ("jimengCliPanel", "codexCliPanel", "geminiCliPanel", "runninghubConfigBlock", "modelExtensions"):
            self.assertIn(f'id="{panel}"', self.page)
        for endpoint in ("/api/providers", "/api/providers/test-connection", "/api/providers/fetch-models"):
            self.assertIn(endpoint, self.script)
        self.assertIn("applyDetectedImageRequestMode(data.image_request_mode)", self.script)
        self.assertIn("modelProtocolSelectHtml", self.script)
        self.assertIn('id="modelRouting"', self.page)

    def test_public_components_and_unique_dom_ids(self):
        self.assertNotRegex(self.page, r"<wa-[a-z]")
        self.assertNotIn("--wa-", self.page)
        identities = re.findall(r'\bid="([^"]+)"', self.page)
        self.assertEqual(len(identities), len(set(identities)))
        self.assertIn('data-studio-scale="off"', self.page)
        self.assertIn('data-i18n="providers.title"', self.page)
        self.assertIn('data-i18n-label="providers.localNameOptional"', self.page)
        for control in ("providers-message", "retryProviders", "retryModels", "providerSaveStatus"):
            self.assertIn(f'id="{control}"', self.page)


if __name__ == "__main__":
    unittest.main()
