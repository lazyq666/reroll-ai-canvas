import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "account-management.html"
STYLE = ROOT / "static" / "css" / "account-management.css"
SCRIPT = ROOT / "static" / "js" / "account-management.js"
THEME_ADAPTER = ROOT / "static" / "js" / "infinite-canvas-ui" / "theme-adapter.js"


class AccountManagementPageContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.theme_adapter = THEME_ADAPTER.read_text(encoding="utf-8")

    def test_page_composes_only_public_ic_components(self):
        for tag in (
            "ic-alert",
            "ic-badge",
            "ic-button",
            "ic-card",
            "ic-confirmation-dialog",
            "ic-dialog",
            "ic-icon-button",
            "ic-input",
            "ic-table",
        ):
            self.assertIn(f"<{tag}", self.page)
        self.assertNotRegex(self.page, r"<button\b")
        self.assertNotRegex(self.page, r"<input\b")
        self.assertNotRegex(self.page, r"<dialog\b")
        self.assertNotRegex(self.page, r"<wa-[a-z]")
        self.assertNotIn("--wa-", self.page)
        self.assertIn("/static/js/infinite-canvas-ui/core.js", self.page)
        self.assertIn('data-studio-scale="off"', self.page)

    def test_dynamic_controls_use_public_components_and_confirmation(self):
        self.assertIn("element('ic-button'", self.script)
        self.assertIn("element('ic-badge'", self.script)
        self.assertIn("element('ic-select', 'project-permission-select')", self.script)
        self.assertIn("select.setAttribute('hierarchy', 'quiet')", self.script)
        self.assertIn("select.multiple = true", self.script)
        self.assertIn("const ALL_PROJECTS_VALUE = '__all_projects__'", self.script)
        self.assertIn("tr('auth.allProjects')", self.script)
        self.assertIn("select.value = [ALL_PROJECTS_VALUE]", self.script)
        self.assertIn("select.addEventListener('ic-after-hide'", self.script)
        self.assertIn("element('ic-empty-state'", self.script)
        self.assertNotIn("document.createElement('button')", self.script)
        self.assertNotIn("window.confirm", self.script)
        self.assertIn("'ic-confirm'", self.script)
        self.assertIn("passwordDialog.show()", self.script)

    def test_action_order_and_visual_hierarchy_follow_page_rule(self):
        reject = self.script.index("button(tr('auth.reject'), 'secondary'")
        approve = self.script.index("button(tr('auth.approve'), 'primary'")
        remove = self.script.index("const remove = button(tr('common.delete'), 'secondary'")
        reset = self.script.index("button(tr('auth.resetPassword'), 'secondary'")
        self.assertLess(reject, approve)
        self.assertLess(remove, reset)
        self.assertIn("{ tone: 'danger', actionName: `reject-", self.script)
        self.assertIn("{ tone: 'danger', actionName: `delete-", self.script)
        self.assertIn('<ic-icon-button id="refresh-accounts"', self.page)
        self.assertIn('icon="refresh" label="刷新"', self.page)
        self.assertIn('data-i18n-label="auth.refresh"', self.page)
        self.assertIn('--wa-color-danger-fill-normal: var(--ui-color-action-secondary-danger)', self.theme_adapter)
        self.assertIn('--wa-color-neutral-fill-normal: var(--ui-color-surface-subtle)', self.theme_adapter)
        self.assertIn("element('div', 'user-actions-content')", self.script)
        self.assertIn('thead { border-bottom: var(--ui-border-width-none); }', self.style)
        self.assertIn('tbody tr:not(:last-child)', self.style)
        self.assertIn('border-bottom: var(--ui-border-width-none)', self.style)

    def test_refresh_exposes_loading_and_completion_feedback(self):
        self.assertIn('refreshButton.loading = true', self.script)
        self.assertIn("customElements.get('ic-toast').notify(text, { tone: 'success' })", self.script)
        self.assertIn("await showRefreshToast(tr('auth.accountsRefreshed'))", self.script)
        self.assertNotIn('.account-refresh-toast', self.style)
        self.assertIn('refreshButton.loading = false', self.script)

    def test_capacity_header_table_and_badge_roles_follow_review_feedback(self):
        self.assertNotIn('data-i18n="auth.settings"', self.page)
        self.assertIn('<div class="capacity"', self.page)
        self.assertNotIn('<ic-card class="capacity"', self.page)
        self.assertIn("ic-table { border: var(--ui-border-width-none)", self.style)
        self.assertNotIn("const roleTones", self.script)
        self.assertIn("user.role, 'neutral', 'label'", self.script)
        self.assertIn("node.setAttribute('kind', kind)", self.script)
        self.assertIn("node.setAttribute('tone', tone)", self.script)
        self.assertIn("'neutral', 'label'", self.script)

    def test_account_outcomes_and_permission_endpoints_are_preserved(self):
        for endpoint in (
            "/api/admin/accounts",
            "/api/admin/account-applications/",
            "/approve",
            "/reject",
            "/reset-password",
            "/project-permissions",
            "/api/projects",
            "/api/auth/me",
        ):
            self.assertIn(endpoint, self.script)
        self.assertIn("method: 'DELETE'", self.script)
        self.assertIn("user.id === currentUserId", self.script)
        self.assertIn("auth.cannotDeleteCurrent", self.script)

    def test_page_styles_keep_layout_without_legacy_component_chrome(self):
        self.assertIn('html[data-ui-theme="light"] body { background: var(--ui-color-surface); }', self.style)
        self.assertIn('padding-inline: var(--ui-space-2)', self.style)
        self.assertNotIn('::part(', self.style)
        self.assertNotIn('--ui-shadow-raised', self.style)
        self.assertIn('.account-field-value {', self.style)
        self.assertIn('.account-name {', self.style)
        self.assertIn('.account-display-name {', self.style)
        self.assertGreaterEqual(self.style.count('font: var(--ui-text-body)'), 3)
        for selector in (
            ".button.primary",
            ".button.secondary",
            ".button.danger",
            ".count-badge",
            ".role-pill",
            ".status-pill",
            "dialog::backdrop",
            ".password-row input",
        ):
            self.assertNotIn(selector, self.style)
        self.assertNotRegex(self.style, r"#[0-9a-fA-F]{3,8}\b")
        self.assertNotIn("--wa-", self.style)



if __name__ == "__main__":
    unittest.main()
