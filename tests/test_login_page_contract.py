import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGIN = ROOT / "static" / "login.html"
UI_VERSION = (
    ROOT / "static" / "js" / "infinite-canvas-ui" / "VERSION"
).read_text(encoding="utf-8").strip()
STYLE = ROOT / "static" / "css" / "account-login.css"
SCRIPT = ROOT / "static" / "js" / "account-login.js"
BACKEND = ROOT / "backend" / "main.py"


class LoginPageContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = LOGIN.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.backend = BACKEND.read_text(encoding="utf-8")

    def test_login_page_composes_only_public_ic_controls(self):
        for tag in (
            "ic-alert",
            "ic-button",
            "ic-card",
            "ic-checkbox",
            "ic-form-field",
            "ic-input",
            "ic-segmented-control",
        ):
            self.assertIn(f"<{tag}", self.page)
        self.assertNotRegex(self.page, r"<input\b")
        self.assertNotRegex(self.page, r"<wa-[a-z]")
        self.assertNotIn("--wa-", self.page)
        self.assertIn(
            "/static/js/infinite-canvas-ui/core.js?v=" + UI_VERSION,
            self.page,
        )

    def test_page_styles_keep_layout_and_remove_legacy_control_chrome(self):
        for selector in (
            ".auth-tabs",
            ".auth-tab",
            "input:not([type=\"checkbox\"])",
            ".remember-option",
            ".error",
            ".success",
            ".field-help",
        ):
            self.assertNotIn(selector, self.style)
        self.assertNotRegex(self.style, r"#[0-9a-fA-F]{3,8}\b")
        self.assertNotIn("--wa-", self.style)
        self.assertIn(":root { font-family: var(--ui-font-sans); }", self.style)
        self.assertNotIn(":root { font: var(--ui-text-body); }", self.style)

    def test_login_surface_uses_the_approved_card_and_mode_treatments(self):
        self.assertIn(
            '<ic-card class="login-card" label="工作区访问" tone="plain" size="large">',
            self.page,
        )
        self.assertIn('data-legal-combination="single-label"', self.page)
        self.assertIn("background: var(--ui-color-surface);", self.style)
        self.assertIn("box-shadow: var(--ui-shadow-modal);", self.style)
        self.assertIn("margin-bottom: var(--ui-space-6);", self.style)

    def test_remember_password_uses_the_complete_checkbox_component(self):
        self.assertIn(
            '<ic-checkbox id="remember-password" label="记住密码" hint="仅保存在本机"></ic-checkbox>',
            self.page,
        )
        self.assertNotIn('class="remember-row"', self.page)
        self.assertNotIn(".remember-row", self.style)
        self.assertIn("rememberPassword.setAttribute('label', tr('auth.rememberPassword'));", self.script)
        self.assertIn("rememberPassword.setAttribute('hint', tr('auth.localOnly'));", self.script)

    def test_login_csp_allows_ic_component_runtime_styles_but_not_inline_scripts(self):
        login_route = self.backend[
            self.backend.index('@app.get("/login")'):
            self.backend.index('@app.get("/share/{token}")')
        ]
        self.assertIn("style-src 'self' 'unsafe-inline'", login_route)
        self.assertIn("script-src 'self'", login_route)
        self.assertIn("connect-src 'self' data:", login_route)
        self.assertNotIn("script-src 'self' 'unsafe-inline'", login_route)

    def test_authentication_outcomes_and_public_component_events_are_preserved(self):
        for endpoint in (
            "/api/auth/me",
            "/api/auth/registration",
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/logout",
        ):
            self.assertIn(endpoint, self.script)
        self.assertIn("'ic-change'", self.script)
        self.assertIn("payload.user?.role === 'guest'", self.script)
        self.assertIn("window.location.replace('/')", self.script)
        self.assertNotIn("classList.toggle('active'", self.script)



if __name__ == "__main__":
    unittest.main()
