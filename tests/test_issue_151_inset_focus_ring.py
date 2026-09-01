import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
TOKENS = STATIC / "css" / "design-tokens.css"
DESIGN_TOKENS_DOC = ROOT / "docs" / "current" / "design-tokens.md"
UI_GUIDELINES = ROOT / "docs" / "current" / "ui-design-guidelines.md"


def first_party_style_sources():
    for entry in STATIC.iterdir():
        if entry.name == "vendor":
            continue
        candidates = [entry] if entry.is_file() else entry.rglob("*")
        for path in candidates:
            if path.is_file() and path.suffix in {".css", ".html", ".js"}:
                yield path


class Issue151InsetFocusRingTests(unittest.TestCase):
    maxDiff = None

    def test_global_focus_ring_is_single_color_and_draws_inward(self):
        tokens = TOKENS.read_text(encoding="utf-8")

        self.assertIn(
            "--ui-color-border-focus: light-dark("
            "var(--ui-palette-gray-500), var(--ui-palette-gray-400));",
            tokens,
        )
        self.assertIn(
            "--ui-focus-ring-offset: calc(-1 * var(--ui-focus-ring-width));",
            tokens,
        )
        self.assertIn(
            "--ui-focus-ring-width: var(--ui-border-width-thin);",
            tokens,
        )
        self.assertIn(
            "--ui-focus-ring-enabled: var(--ui-focus-ring-width) solid "
            "var(--ui-color-border-focus);",
            tokens,
        )
        self.assertIn("--ui-focus-ring-shadow-enabled: none;", tokens)

    def test_every_first_party_focus_outline_consumes_the_global_offset(self):
        violations = []

        for path in first_party_style_sources():
            source = path.read_text(encoding="utf-8")
            source_offset = 0
            for fragment in source.split("}"):
                rule_start = fragment.rfind("{")
                selector = fragment[:rule_start] if rule_start >= 0 else ""
                body = fragment[rule_start + 1 :] if rule_start >= 0 else ""
                if ":focus" not in selector:
                    source_offset += len(fragment) + 1
                    continue
                consumes_focus_ring = re.search(
                    r"outline\s*:\s*var\(--ui-focus-ring\)",
                    body,
                )
                if not consumes_focus_ring and "outline-offset" not in body:
                    source_offset += len(fragment) + 1
                    continue
                if not re.search(
                    r"outline-offset\s*:\s*var\(--ui-focus-ring-offset\)",
                    body,
                ):
                    line = source.count("\n", 0, source_offset + max(rule_start, 0)) + 1
                    violation = f"{path.relative_to(ROOT)}:{line}"
                    if violation not in violations:
                        violations.append(violation)
                source_offset += len(fragment) + 1

        self.assertEqual([], violations)

    def test_non_focus_states_do_not_consume_the_focus_offset(self):
        violations = []
        offset_pattern = re.compile(
            r"outline-offset\s*:\s*var\(--ui-focus-ring-offset\)",
        )
        focus_markers = re.compile(
            r":focus|is-focus|preview-focus|data-preview-state|data-focus-sample",
        )

        for path in first_party_style_sources():
            source = path.read_text(encoding="utf-8")
            for match in offset_pattern.finditer(source):
                previous_rule_end = source.rfind("}", 0, match.start()) + 1
                rule_start = source.rfind("{", previous_rule_end, match.start())
                selector = source[previous_rule_end:rule_start] if rule_start >= 0 else ""
                if not focus_markers.search(selector):
                    line = source.count("\n", 0, match.start()) + 1
                    violations.append(f"{path.relative_to(ROOT)}:{line}")

        self.assertEqual([], violations)

    def test_current_docs_define_the_inset_focus_contract_and_actual_colors(self):
        token_doc = DESIGN_TOKENS_DOC.read_text(encoding="utf-8")
        guidelines = UI_GUIDELINES.read_text(encoding="utf-8")

        self.assertIn("single-color, one-pixel", token_doc)
        self.assertIn("draws inward", token_doc)
        self.assertIn("`gray-500` in Light and `gray-400` in Dark", token_doc)
        self.assertIn("单层向内绘制", guidelines)
        self.assertIn("1px 单层向内绘制", guidelines)
        self.assertIn("不得被祖先的 `overflow` 裁剪", guidelines)


if __name__ == "__main__":
    unittest.main()
