import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class AccountSetupUiTests(unittest.TestCase):
    def test_first_visible_step_selects_workspace_before_admin_form(self):
        page = (PROJECT_ROOT / "static" / "setup.html").read_text(encoding="utf-8")

        self.assertLess(
            page.index('id="workspace-selection-step"'),
            page.index('id="initial-setup-form"'),
        )
        self.assertRegex(page, r'<form[^>]*id="initial-setup-form"[^>]*hidden')
        self.assertIn("选择工作区目录", page)

    def test_page_uses_business_language_instead_of_internal_layout(self):
        page = (PROJECT_ROOT / "static" / "setup.html").read_text(encoding="utf-8")

        self.assertNotIn("<code>data</code>", page)
        self.assertNotIn("<code>assets</code>", page)
        self.assertNotIn("父目录", page)
        self.assertNotIn("数据目录", page)
        self.assertIn("打开已有工作区", page)

    def test_controller_inspects_before_creating_or_opening_workspace(self):
        controller = (
            PROJECT_ROOT / "static" / "js" / "account-setup.js"
        ).read_text(encoding="utf-8")

        inspect_call = controller.index("/api/setup/inspect-workspace")
        create_call = controller.index("fetch('/api/setup'")
        open_call = controller.index("/api/setup/open-workspace")
        self.assertLess(inspect_call, create_call)
        self.assertLess(inspect_call, open_call)
        self.assertIn("workspace_directory", controller)
        self.assertNotIn("parent_dir", controller)

    def test_directory_picker_action_is_centered_and_reserves_its_label_width(self):
        styles = (
            PROJECT_ROOT / "static" / "css" / "account-setup.css"
        ).read_text(encoding="utf-8")

        self.assertIn("align-items: center;", styles)
        self.assertIn("min-inline-size: 6rem;", styles)
        self.assertIn("white-space: nowrap;", styles)


if __name__ == "__main__":
    unittest.main()
