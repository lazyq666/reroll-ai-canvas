import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PreferencesUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = (ROOT / "static/index.html").read_text(encoding="utf-8")
        cls.script = (ROOT / "static/js/preferences.js").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/preferences.css").read_text(encoding="utf-8")
        cls.common_i18n = (ROOT / "static/js/i18n/common.js").read_text(encoding="utf-8")
        cls.i18n = (ROOT / "static/js/i18n/preferences.js").read_text(encoding="utf-8")

    def test_settings_tooltip_opens_preferences_modal(self):
        self.assertIn('id="preferences-entry"', self.shell)
        self.assertIn('onclick="openPreferencesModal()"', self.shell)
        self.assertIn('label="数据存储位置"', self.shell)
        self.assertIn('data-i18n-label="common.dataStorageLocation"', self.shell)
        self.assertIn("/static/js/preferences.js", self.shell)
        self.assertIn("/static/css/preferences.css", self.shell)
        self.assertIn('document.createElement("ic-dialog")', self.script)
        self.assertIn('dialog.id = "preferencesDialog"', self.script)
        self.assertIn("void dialog.show()", self.script)

    def test_storage_location_dialog_uses_medium_layout_and_shared_spacing(self):
        self.assertIn('dialog.setAttribute("size", "medium")', self.script)
        self.assertNotIn('dialog.setAttribute("size", "large")', self.script)
        self.assertIn('"common.dataStorageLocation": { zh: "数据存储位置", en: "Data storage location" }', self.common_i18n)
        self.assertIn('"preferences.title": { zh: "数据存储位置", en: "Data storage location" }', self.i18n)
        self.assertIn("width: 100%;", self.style)
        self.assertNotIn("--width:", self.style)
        self.assertRegex(
            self.style,
            r"\.preferences-dialog::part\(header\)\s*\{[^}]*"
            r"padding-block-start: var\(--ui-space-6\);[^}]*"
            r"padding-inline: var\(--ui-space-6\);",
        )
        self.assertNotRegex(self.style, r"\.preferences-dialog::part\((body|footer)\)")

    def test_preferences_uses_one_workspace_directory(self):
        self.assertIn("workspaceDirectory", self.script)
        self.assertIn("/api/workspace-storage-settings/select-directory", self.script)
        self.assertIn("/api/workspace-storage-settings/inspect", self.script)
        self.assertIn("/api/workspace-storage-settings/open", self.script)
        self.assertIn("/api/workspace-storage-settings/plan-move", self.script)
        self.assertIn("/api/workspace-storage-settings/move", self.script)
        self.assertIn("/api/workspace-storage-settings", self.script)
        self.assertIn("workspace_directory:", self.script)
        self.assertIn('tr("preferences.open")', self.script)
        self.assertIn('tr("preferences.move")', self.script)
        self.assertIn('"preferences.open": { zh: "打开已有工作区"', self.i18n)
        self.assertIn('"preferences.move": { zh: "搬家到新位置"', self.i18n)
        self.assertNotIn("父目录", self.script)
        self.assertNotIn("当前 data", self.script)
        self.assertNotIn("当前 assets", self.script)
        self.assertNotIn("storageDir_upload", self.script)
        self.assertNotIn("storageDir_generated", self.script)
        self.assertNotIn("storageDir_local", self.script)
        self.assertNotIn("/api/asset-library", self.script)
        self.assertNotIn("/api/asset-classification-prompt", self.script)

    def test_selection_shows_business_summary_before_confirmation(self):
        self.assertIn('tr("preferences.chooseAction")', self.script)
        self.assertIn("Smart Canvas", self.script)
        self.assertIn('tr("preferences.media")', self.script)
        self.assertNotIn("成员账号", self.script)
        self.assertIn('tr("preferences.fileCount")', self.script)
        self.assertIn('tr("preferences.size")', self.script)
        self.assertIn('tr("preferences.recentlyModified")', self.script)
        self.assertIn('tr("preferences.reminders")', self.script)
        self.assertIn('tr("preferences.confirmOpen")', self.script)
        self.assertIn('tr("preferences.confirmMove")', self.script)
        self.assertIn('tr("preferences.activeTasks")', self.script)
        self.assertNotIn("Generation Run", self.script)
        self.assertIn('tr("preferences.sourceDirectory")', self.script)
        self.assertIn('tr("preferences.targetDirectory")', self.script)
        self.assertIn('moving.progress_url || "/workspace-move"', self.script)
        self.assertIn("return_url:", self.script)
        self.assertIn("moving.progress_url", self.script)
        self.assertNotIn('method: "PUT"', self.script)

    def test_asset_manager_page_is_removed_from_shell(self):
        self.assertNotIn("frame-asset-manager", self.shell)
        self.assertNotIn("'asset-manager'", self.shell)
        self.assertNotIn(">素材库</span>", self.shell)


if __name__ == "__main__":
    unittest.main()
