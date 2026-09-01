import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ModalDialogRadiusContractTests(unittest.TestCase):
    def assert_rule_uses_medium_radius(self, relative_path: str, selector: str):
        source = (ROOT / relative_path).read_text(encoding="utf-8")
        pattern = rf"{re.escape(selector)}\s*\{{[^}}]*border-radius:\s*var\(--ui-radius-m\)"
        self.assertRegex(source, pattern, f"{relative_path}: {selector}")

    def test_shared_dialog_components_use_medium_radius(self):
        dialog_styles = (
            ROOT / "static/js/infinite-canvas-ui/dialog/styles.js"
        ).read_text(encoding="utf-8")
        self.assertRegex(
            dialog_styles,
            r"ic-dialog::part\(dialog\),\s*ic-confirmation-dialog::part\(dialog\)\s*\{[^}]*border-radius:\s*var\(--ui-radius-m\)",
        )
        self.assert_rule_uses_medium_radius(
            "static/js/infinite-canvas-ui/ai-processor-dialog/styles.js",
            "ic-ai-processor-dialog::part(dialog)",
        )

    def test_modal_task_surfaces_use_medium_radius(self):
        rules = (
            (
                "static/js/infinite-canvas-ui/prompt-template-library.js",
                ".task-surface",
            ),
            (
                "static/js/infinite-canvas-ui/nodes/prompt-focus-surface.js",
                '[part="surface"]',
            ),
            ("static/css/design-token-explorer.css", ".token-diff-dialog"),
            ("static/css/canvas.css", ".output-preview"),
            ("static/css/canvas.css", ".log-panel"),
            ("static/css/canvas.css", ".error-panel"),
            ("static/css/canvas.css", ".model-panel"),
            ("static/css/canvas.css", ".image-edit-panel"),
            ("static/css/smart-canvas.css", ".prompt-node-focus-dialog.image-node"),
            ("static/css/smart-canvas.css", ".reference-viewer"),
            ("static/css/smart-canvas.css", ".log-panel"),
            ("static/css/smart-canvas.css", ".shortcut-modal"),
            ("static/css/smart-canvas.css", ".smart-context-result-panel"),
            ("static/css/smart-canvas.css", ".asset-dialog"),
            ("static/css/smart-canvas.css", ".image-edit-dialog::part(dialog)"),
            ("static/css/api-settings.css", ".picker-modal"),
            ("static/css/api-settings.css", ".rh-workflow-editor-modal"),
        )
        for relative_path, selector in rules:
            with self.subTest(path=relative_path, selector=selector):
                self.assert_rule_uses_medium_radius(relative_path, selector)


if __name__ == "__main__":
    unittest.main()
