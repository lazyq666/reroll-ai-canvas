"""Page contracts for the approved administrator-first onboarding."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

class AccountSetupUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script=(ROOT/'static/js/account-setup.js').read_text()

    def test_account_before_workspace_without_a_welcome_or_display_name(self):
        self.assertIn("['admin','workspace','services','connect','ready']",self.script)
        self.assertLess(self.script.index('id="initial-setup-form"'),self.script.index('id="workspace-selection-step"'))
        self.assertNotIn('display_name',self.script)

    def test_inspection_precedes_workspace_mutation(self):
        self.assertLess(self.script.index('/api/setup/inspect-workspace'),self.script.index("request('/api/setup',"))
        self.assertLess(self.script.index('/api/setup/inspect-workspace'),self.script.index('/api/setup/open-workspace'))
        self.assertIn("payload.next_step === 'login'",self.script)
        self.assertIn("payload.next_step !== 'create_admin'",self.script)

    def test_picker_is_inside_input_and_back_is_an_accessible_icon(self):
        self.assertIn('<ic-input end-action',self.script)
        self.assertIn('slot="end" id="choose-workspace-directory"',self.script)
        self.assertIn('<ic-icon-button id="back" icon="back" label=',self.script)

    def test_completion_uses_server_readiness_and_navigation(self):
        self.assertIn("request('/api/admin/onboarding/complete',{})",self.script)
        self.assertIn('window.location.assign(result.next_url)',self.script)
        self.assertNotIn('demo-',self.script)

    def test_language_render_cannot_recursively_emit_language_change(self):
        self.assertIn("window.addEventListener('studio-lang-change',render)",self.script)
        self.assertNotIn('StudioI18n.apply()',self.script)

if __name__=='__main__':unittest.main()
