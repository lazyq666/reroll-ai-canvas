import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "static" / "js" / "infinite-canvas-ui" / "feedback-progress.js"
CASE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "feedback-progress-case.html"
CONTRACT = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "ic-feedback-progress-v1.json"


class BadgeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = COMPONENT.read_text()
        cls.case = CASE.read_text()
        cls.contract = json.loads(CONTRACT.read_text())
        cls.badge = next(item for item in cls.contract["components"] if item["tag"] == "ic-badge")
        cls.loading = next(item for item in cls.contract["components"] if item["tag"] == "ic-loading")

    def test_all_badge_kinds_accept_small_medium_and_large(self):
        self.assertIn("const BADGE_SIZES = new Set(['small', 'medium', 'large']);", self.component)
        self.assertNotIn("small badge size is only valid for label tags", self.component)
        self.assertEqual(self.badge["semanticDimensions"]["size"], ["small", "medium", "large"])
        self.assertIn("all three sizes are valid for label, count, and status", self.badge["sizeRules"]["scope"])

    def test_component_page_exposes_three_sizes_and_reduced_status_set(self):
        for name in ("ic-badge-label-small", "ic-badge-label", "ic-badge-label-large"):
            self.assertIn(f'data-component-name="{name}"', self.case)
        for name in ("processing", "success", "warning", "danger"):
            self.assertIn(f'data-component-name="ic-badge-status-{name}"', self.case)
        self.assertNotIn('data-copy="idle"', self.case)
        self.assertNotIn('data-component-name="ic-badge-status-loading"', self.case)

    def test_idle_is_absent_and_processing_groups_in_progress_copy(self):
        policy = self.badge["displayPolicy"]
        self.assertEqual(policy["defaultOrIdle"], "do not render a badge")
        for word in ("syncing", "loading", "waiting", "generating"):
            self.assertIn(word, policy["processing"])
        self.assertIn("1.2-second", self.badge["loadingRule"])
        self.assertIn("calc(var(--ui-motion-duration-slow) * 4)", self.component)

    def test_label_uses_size_tokens_and_regular_bordered_surface(self):
        for size, token in (("small", "--ui-font-size-1"), ("medium", "--ui-font-size-2"), ("large", "--ui-font-size-3")):
            self.assertEqual(self.badge["labelPresentation"]["fontSize"][size], token)
        self.assertEqual(self.badge["labelPresentation"]["fontWeight"], "--ui-font-weight-regular")
        self.assertEqual(self.badge["labelPresentation"]["background"], "--ui-color-surface")
        self.assertEqual(self.badge["labelPresentation"]["borderColor"], "--ui-color-border-secondary")
        self.assertIn(':host([kind="label"]) .badge', self.component)
        self.assertIn('border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary)', self.component)
        self.assertIn('background:var(--ui-color-surface)', self.component)
        self.assertIn('font-weight:var(--ui-font-weight-regular)', self.component)

    def test_status_uses_size_tokens_and_regular_weight(self):
        for size, token in (("small", "--ui-font-size-1"), ("medium", "--ui-font-size-2"), ("large", "--ui-font-size-3")):
            self.assertEqual(self.badge["statusTypography"]["fontSize"][size], token)
        self.assertEqual(self.badge["statusTypography"]["fontWeight"], "--ui-font-weight-regular")
        self.assertIn(':host([kind="status"]) .badge { font-weight:var(--ui-font-weight-regular); }', self.component)

    def test_processing_badge_keeps_its_small_size_spinner(self):
        self.assertNotIn("const sharedSpinnerStyles = `", self.component)
        self.assertIn("border-inline-end-color:transparent", self.component)
        self.assertIn("@keyframes ic-badge-spin", self.component)
        self.assertIn("@keyframes ic-spin", self.component)
        self.assertIn("calm 1.2-second default rotation", self.badge["loadingRule"])
        self.assertNotIn("spinnerFoundation", self.loading)


if __name__ == "__main__":
    unittest.main()
