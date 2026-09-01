import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InfiniteCanvasUiConfirmPopoverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = (ROOT / "static/js/infinite-canvas-ui/confirm-popover.js").read_text(encoding="utf-8")
        cls.core = (ROOT / "static/js/infinite-canvas-ui/core.js").read_text(encoding="utf-8")
        cls.case = (ROOT / "static/js/infinite-canvas-ui/menu-popover-case.js").read_text(encoding="utf-8")
        cls.surface_app = (ROOT / "static/js/ui-component-library/surface-app.js").read_text(encoding="utf-8")
        cls.contract = json.loads((ROOT / "static/design-system/infinite-canvas-ui/ic-menu-popover-v1.json").read_text(encoding="utf-8"))
        cls.manifest = json.loads((ROOT / "static/design-system/infinite-canvas-ui/surface-manifest.json").read_text(encoding="utf-8"))

    def test_component_is_registered_and_exported(self):
        self.assertIn("import { IcConfirmPopover } from './confirm-popover.js", self.core)
        self.assertIn("define('ic-confirm-popover', IcConfirmPopover)", self.core)
        self.assertIn("IcConfirmPopover", self.core.split("export {", 1)[1])

    def test_component_owns_confirmation_contract_with_neutral_surface_tokens(self):
        for marker in (
            "export class IcConfirmPopover extends IcPopover",
            "'confirm-label', 'cancel-label', 'consequence', 'confirm-loading'",
            "role=\"alertdialog\"",
            "new CustomEvent('ic-confirm'",
            "new CustomEvent('ic-cancel'",
            "this.cancel(reason)",
            "event.stopPropagation();",
            "this.cancel('escape');",
            "this.shadowRoot.querySelector('[data-cancel]')?.focus",
            "border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary)",
            "background:var(--ui-color-surface)",
            "box-shadow:var(--ui-shadow-overlay)",
            "confirm.tone = destructive ? 'danger' : 'neutral'",
        ):
            self.assertIn(marker, self.component)
        self.assertNotIn("var(--ui-color-border-danger)", self.component)

    def test_component_is_visible_in_the_public_library_and_contract(self):
        self.assertIn("<ic-confirm-popover", self.case)
        self.assertIn("['ic-confirm-popover', 'Confirm Popover', 'menu-popover']", self.surface_app)
        contract_component = next(
            component for component in self.contract["components"]
            if component["tag"] == "ic-confirm-popover"
        )
        self.assertEqual(contract_component["legalCombinations"][0]["id"], "destructive-confirmation")
        self.assertIn(
            "ic-confirm-popover",
            self.manifest["surfaces"]["target"]["menuPopover"]["components"],
        )
        self.assertIn(
            "ic-confirm-popover",
            self.manifest["surfaces"]["migration"]["targetComponentIds"],
        )


if __name__ == "__main__":
    unittest.main()
