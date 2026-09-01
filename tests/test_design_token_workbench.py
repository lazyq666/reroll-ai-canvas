import tempfile
import unittest
from pathlib import Path

from backend.infinite_canvas.design_tokens import (
    DesignTokenConflict,
    DesignTokenValidation,
    DesignTokenWorkbench,
)
from backend.infinite_canvas.artifacts import APPLICATION_UPDATE_RUNTIME_FILES


TOKEN_SOURCE = """/* token fixture */
:root {
    --ui-palette-gray-0: #FFFFFF;
    --ui-palette-gray-800: #212121;
    --ui-palette-gray-950: #141414;
    --ui-palette-legacy-light: var(--ui-palette-gray-0); /* non-literal alias */
    --ui-color-text-primary: light-dark(var(--ui-palette-gray-950), var(--ui-palette-gray-0)); /* text */
    --ui-color-surface-floating: light-dark(
        color-mix(in srgb, var(--ui-palette-gray-0) 92%, transparent),
        color-mix(in srgb, var(--ui-palette-gray-950) 94%, transparent)
    );
    --ui-space-2: .5rem;
}

html[data-ui-motion="reduced"] {
    --ui-motion-duration-fast: 1ms;
}
"""


class DesignTokenWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "design-tokens.css"
        self.path.write_text(TOKEN_SOURCE, encoding="utf-8")
        self.workbench = DesignTokenWorkbench(self.path)

    def test_snapshot_exposes_literal_palette_and_simple_semantic_mappings(self):
        snapshot = self.workbench.snapshot()
        tokens = {token["name"]: token for token in snapshot["tokens"]}

        self.assertEqual(len(snapshot["revision"]), 64)
        self.assertEqual(tokens["--ui-palette-gray-950"]["kind"], "primitive-color")
        self.assertEqual(tokens["--ui-palette-gray-950"]["value"], "#141414")
        self.assertEqual(tokens["--ui-color-text-primary"]["kind"], "semantic-color")
        self.assertEqual(
            tokens["--ui-color-text-primary"]["light"], "--ui-palette-gray-950"
        )
        self.assertEqual(tokens["--ui-color-text-primary"]["dark"], "--ui-palette-gray-0")
        self.assertNotIn("--ui-palette-legacy-light", tokens)
        self.assertNotIn("--ui-color-surface-floating", tokens)
        self.assertNotIn("--ui-space-2", tokens)

    def test_workbench_module_is_included_in_application_updates(self):
        self.assertIn(
            "backend/infinite_canvas/design_tokens.py",
            APPLICATION_UPDATE_RUNTIME_FILES,
        )

    def test_save_updates_root_values_and_preserves_comments_and_other_contexts(self):
        before = self.workbench.snapshot()

        after = self.workbench.save(
            expected_revision=before["revision"],
            changes=[
                {"name": "--ui-palette-gray-950", "value": "#18181B"},
                {
                    "name": "--ui-color-text-primary",
                    "light": "--ui-palette-gray-800",
                    "dark": "--ui-palette-gray-0",
                },
            ],
        )

        source = self.path.read_text(encoding="utf-8")
        self.assertNotEqual(before["revision"], after["revision"])
        self.assertIn("--ui-palette-gray-950: #18181B;", source)
        self.assertIn(
            "--ui-color-text-primary: light-dark(var(--ui-palette-gray-800), var(--ui-palette-gray-0)); /* text */",
            source,
        )
        self.assertIn("--ui-motion-duration-fast: 1ms;", source)
        self.assertIn("/* non-literal alias */", source)

    def test_save_rejects_stale_revision_without_writing(self):
        original = self.path.read_text(encoding="utf-8")

        with self.assertRaises(DesignTokenConflict):
            self.workbench.save(
                expected_revision="stale",
                changes=[
                    {"name": "--ui-palette-gray-950", "value": "#18181B"}
                ],
            )

        self.assertEqual(self.path.read_text(encoding="utf-8"), original)

    def test_save_rejects_unknown_or_non_editable_tokens(self):
        revision = self.workbench.snapshot()["revision"]

        for change in (
            {"name": "--ic-button-color", "value": "#000000"},
            {"name": "--ui-space-2", "value": "1rem"},
            {"name": "--ui-color-surface-floating", "light": "--ui-palette-gray-0", "dark": "--ui-palette-gray-950"},
        ):
            with self.subTest(change=change):
                with self.assertRaises(DesignTokenValidation):
                    self.workbench.save(
                        expected_revision=revision,
                        changes=[change],
                    )

    def test_save_rejects_invalid_colors_and_palette_references(self):
        revision = self.workbench.snapshot()["revision"]

        invalid_changes = (
            {"name": "--ui-palette-gray-950", "value": "not-a-color"},
            {"name": "--ui-palette-gray-950", "value": "#12345"},
            {
                "name": "--ui-color-text-primary",
                "light": "--ui-space-2",
                "dark": "--ui-palette-gray-0",
            },
            {
                "name": "--ui-color-text-primary",
                "light": "--ui-palette-missing",
                "dark": "--ui-palette-gray-0",
            },
        )
        for change in invalid_changes:
            with self.subTest(change=change):
                with self.assertRaises(DesignTokenValidation):
                    self.workbench.save(
                        expected_revision=revision,
                        changes=[change],
                    )

    def test_save_rejects_empty_or_duplicate_change_sets(self):
        revision = self.workbench.snapshot()["revision"]

        with self.assertRaises(DesignTokenValidation):
            self.workbench.save(expected_revision=revision, changes=[])
        with self.assertRaises(DesignTokenValidation):
            self.workbench.save(
                expected_revision=revision,
                changes=[
                    {"name": "--ui-palette-gray-950", "value": "#18181B"},
                    {"name": "--ui-palette-gray-950", "value": "#202024"},
                ],
            )


if __name__ == "__main__":
    unittest.main()
