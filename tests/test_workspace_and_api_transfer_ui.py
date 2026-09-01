import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class WorkspaceAndApiTransferUiTests(unittest.TestCase):
    def test_preferences_exposes_workspace_connect_and_migration(self):
        script = (ROOT / "static/js/preferences.js").read_text(
            encoding="utf-8"
        )
        page = (ROOT / "static/index.html").read_text(
            encoding="utf-8"
        )
        translations = (ROOT / "static/js/i18n/preferences.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("/api/workspace-storage-settings", script)
        self.assertIn('tr("preferences.workspaceDirectory")', script)
        self.assertIn("workspace_directory: workspaceDirectory", script)
        self.assertNotIn('id="workspaceDataDir"', script)
        self.assertNotIn('id="workspaceAssetsDir"', script)
        self.assertNotIn("工作区父目录", script)
        self.assertNotIn("当前 data", script)
        self.assertNotIn("当前 assets", script)
        self.assertIn('tr("preferences.open")', script)
        self.assertIn('tr("preferences.move")', script)
        self.assertIn('zh: "工作区目录"', translations)
        self.assertIn('zh: "打开已有工作区"', translations)
        self.assertIn('zh: "搬家到新位置"', translations)
        self.assertIn('id="preferences-entry"', page)
        self.assertRegex(
            page,
            r"/static/js/preferences\.js\?v=[^\"']+",
        )

    def test_api_settings_exposes_encrypted_export_and_import(self):
        page = (ROOT / "static/api-settings.html").read_text(
            encoding="utf-8"
        )
        script = (ROOT / "static/js/api-settings.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("导出加密包", page)
        self.assertIn("导入加密包", page)
        self.assertIn("/api/providers/export-encrypted", script)
        self.assertIn("/api/providers/import-encrypted", script)
        self.assertIn("FormData", script)
        self.assertIn("{cache:'no-store'}", script)
        self.assertIn("tr('api.noProvidersAdded')", script)
        self.assertIn("trf('api.updatedProviders'", script)
        self.assertIn("providers = data.providers", script)
        self.assertRegex(
            page,
            r'<ic-input[^>]+id="apiTransferPassword"[^>]+type="password"',
        )
        self.assertIn('id="apiImportConfirmation"', page)
        self.assertNotIn("window.prompt", script)
        self.assertRegex(
            page,
            r"/static/js/api-settings\.js\?v=[^\"']+",
        )

    def test_light_api_transfer_buttons_use_on_action_contrast(self):
        page = (ROOT / "static/api-settings.html").read_text(
            encoding="utf-8"
        )
        transfer_actions = page.split('<div class="api-transfer-actions">', 1)[1].split('</div>', 1)[0]
        self.assertEqual(transfer_actions.count('<ic-button'), 2)
        self.assertEqual(transfer_actions.count('hierarchy="secondary"'), 2)

    def test_api_primary_actions_use_semantic_foreground_pairing(self):
        styles = (ROOT / "static/css/api-settings.css").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "background:var(--ui-color-action-primary) !important;",
            styles,
        )
        self.assertIn(
            "color:var(--ui-color-text-on-action-primary) !important;",
            styles,
        )
        self.assertNotIn(
            "color:var(--ui-color-border-selected) !important;",
            styles,
        )

        self.assertIn(
            ".content-actions { display:flex; gap:var(--ui-space-2); align-items:center; max-width:100%; flex-wrap:wrap; }",
            styles,
        )
        self.assertIn(
            ".models-toolbar-actions { display:flex; gap:var(--ui-space-2); align-items:center; justify-content:flex-end; flex:0 1 auto; max-width:100%; flex-wrap:wrap; }",
            styles,
        )


if __name__ == "__main__":
    unittest.main()
