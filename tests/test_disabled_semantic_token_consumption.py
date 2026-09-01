import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DisabledSemanticTokenConsumptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pagination = (
            ROOT / "static/js/infinite-canvas-ui/navigation-command/pagination.js"
        ).read_text(encoding="utf-8")
        cls.nav_disclosure = (
            ROOT / "static/js/infinite-canvas-ui/navigation-command/nav-disclosure.js"
        ).read_text(encoding="utf-8")
        cls.menu_popover = (
            ROOT / "static/js/infinite-canvas-ui/menu-popover.js"
        ).read_text(encoding="utf-8")
        cls.file_media_input = (
            ROOT / "static/js/infinite-canvas-ui/file-media-input.js"
        ).read_text(encoding="utf-8")
        cls.segmented_control = (
            ROOT / "static/js/infinite-canvas-ui/navigation-command/segmented-control.js"
        ).read_text(encoding="utf-8")
        cls.tabs = (
            ROOT / "static/js/infinite-canvas-ui/navigation-command/tabs.js"
        ).read_text(encoding="utf-8")
        cls.selection_adjustment = (
            ROOT / "static/js/infinite-canvas-ui/selection-adjustment/styles.js"
        ).read_text(encoding="utf-8")
        cls.text_entry = (
            ROOT / "static/js/infinite-canvas-ui/text-entry/styles.js"
        ).read_text(encoding="utf-8")
        cls.aspect_ratio_picker = (
            ROOT / "static/js/infinite-canvas-ui/aspect-ratio-picker.js"
        ).read_text(encoding="utf-8")
        cls.generation_settings_picker = (
            ROOT / "static/js/infinite-canvas-ui/generation-settings-picker.js"
        ).read_text(encoding="utf-8")
        cls.mention_picker = (
            ROOT / "static/js/infinite-canvas-ui/mention-picker.js"
        ).read_text(encoding="utf-8")
        cls.prompt_template_library = (
            ROOT / "static/js/infinite-canvas-ui/prompt-template-library.js"
        ).read_text(encoding="utf-8")

    def test_navigation_actions_use_disabled_semantic_colors(self):
        for source in (self.pagination, self.nav_disclosure):
            self.assertIn("var(--ui-color-text-disabled)", source)
            self.assertIn("opacity:1", source)
        self.assertIn("var(--ui-color-action-secondary-disabled)", self.pagination)
        self.assertIn("var(--ui-color-border-disabled)", self.pagination)
        self.assertIn("var(--ui-color-action-tertiary-disabled)", self.nav_disclosure)

    def test_menu_items_use_disabled_semantic_colors(self):
        self.assertIn("var(--ui-color-action-tertiary-disabled)", self.menu_popover)
        self.assertIn("var(--ui-color-text-disabled)", self.menu_popover)
        self.assertIn(':host([disabled]){opacity:1', self.menu_popover)

    def test_file_input_action_uses_disabled_semantic_colors(self):
        self.assertIn("var(--ui-color-action-secondary-disabled)", self.file_media_input)
        self.assertIn("var(--ui-color-text-disabled)", self.file_media_input)
        self.assertIn("var(--ui-color-border-disabled)", self.file_media_input)
        self.assertIn("button:disabled { cursor:not-allowed; opacity:1;", self.file_media_input)

    def test_navigation_selection_and_composite_controls_use_disabled_semantics(self):
        for source in (
            self.segmented_control,
            self.tabs,
            self.selection_adjustment,
            self.text_entry,
            self.aspect_ratio_picker,
            self.generation_settings_picker,
        ):
            with self.subTest(source=source[:80]):
                self.assertIn("var(--ui-color-text-disabled)", source)
                self.assertIn("opacity:1", source.replace(" ", ""))

        for source in (
            self.segmented_control,
            self.tabs,
            self.aspect_ratio_picker,
            self.generation_settings_picker,
        ):
            self.assertIn("var(--ui-color-action-tertiary-disabled)", source)

        for source in (
            self.segmented_control,
            self.selection_adjustment,
            self.text_entry,
            self.aspect_ratio_picker,
            self.generation_settings_picker,
        ):
            self.assertIn("var(--ui-color-border-disabled)", source)

        for source in (self.selection_adjustment, self.text_entry):
            self.assertIn("var(--ui-color-action-secondary-disabled)", source)

    def test_public_component_implementations_never_consume_palette_primitives(self):
        component_root = ROOT / "static/js/infinite-canvas-ui"
        violations = []
        for path in component_root.rglob("*.js"):
            source = path.read_text(encoding="utf-8")
            if "--ui-palette-" in source:
                violations.append(str(path.relative_to(ROOT)))

        self.assertEqual([], violations)

    def test_default_interactive_surfaces_use_tertiary_action_semantics(self):
        self.assertIn(
            "background:var(--ui-color-action-tertiary);",
            self.mention_picker,
        )
        for part in (
            'part="close"',
            'part="library-item"',
            'part="category-add"',
            'part="template-select"',
        ):
            with self.subTest(part=part):
                self.assertRegex(
                    self.prompt_template_library,
                    rf'\[{part}\]\s*\{{[^}}]*background:var\(--ui-color-action-tertiary\)',
                )


if __name__ == "__main__":
    unittest.main()
