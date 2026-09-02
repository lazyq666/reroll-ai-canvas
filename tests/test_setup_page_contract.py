import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "setup.html"
STYLE = ROOT / "static" / "css" / "account-setup.css"
SCRIPT = ROOT / "static" / "js" / "account-setup.js"


class SetupPageContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")

    def test_setup_page_composes_only_public_ic_controls(self):
        for tag in ("ic-alert", "ic-button", "ic-card", "ic-form-field", "ic-input"):
            self.assertIn(f"<{tag}", self.page)
        self.assertNotRegex(self.page, r"<input\b")
        self.assertNotRegex(self.page, r"<button\b")
        self.assertNotRegex(self.page, r"<wa-[a-z]")
        self.assertNotIn("--wa-", self.page)
        self.assertIn("/static/js/infinite-canvas-ui/core.js", self.page)
        self.assertIn('data-studio-scale="off"', self.page)

    def test_page_styles_keep_layout_without_legacy_control_chrome(self):
        for selector in (
            ".secondary-button",
            ".workspace-summary",
            ".preferences-note",
            ".field-help",
            ".error",
            ".success",
        ):
            self.assertNotIn(selector, self.style)
        self.assertNotRegex(self.style, r"#[0-9a-fA-F]{3,8}\b")
        self.assertNotIn("--wa-", self.style)

    def test_workspace_and_admin_outcomes_remain_in_controller(self):
        endpoints = (
            "/api/setup/status",
            "/api/setup/select-directory",
            "/api/setup/inspect-workspace",
            "/api/setup/open-workspace",
            "/api/setup",
            "/api/runtime/restart",
        )
        for endpoint in endpoints:
            self.assertIn(endpoint, self.script)
        self.assertIn("payload.next_step === 'create_admin'", self.script)
        self.assertIn("payload.next_step === 'login'", self.script)
        self.assertIn("window.location.replace('/startup')", self.script)
        self.assertIn("const setupUsername", self.script)
        self.assertNotIn("form.username", self.script)

    def test_server_messages_use_stable_codes_and_do_not_leak_chinese_in_english(self):
        self.assertIn("const setupMessageKeys = {", self.script)
        self.assertIn("payload?.reason || payload?.message_code", self.script)
        self.assertIn("containsHan(message)", self.script)
        self.assertIn("window.StudioI18n?.lang?.() === 'en'", self.script)
        self.assertNotIn("status.workspace_error !== '尚未选择工作区目录'", self.script)
        self.assertIn(
            "workspace_source_repository_overlap: 'auth.workspaceSourceRepositoryOverlap'",
            self.script,
        )



if __name__ == "__main__":
    unittest.main()
