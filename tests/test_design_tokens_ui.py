import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
TOKEN_HREF = "/static/css/design-tokens.css"


def product_pages():
    return sorted(STATIC.glob("*.html"))


class DesignTokensUiRegressionTests(unittest.TestCase):
    def test_every_html_entry_loads_tokens_before_page_styles(self):
        pages = product_pages()
        self.assertEqual(17, len(pages))

        for page_path in pages:
            with self.subTest(page=page_path.name):
                page = page_path.read_text(encoding="utf-8")
                self.assertEqual(1, page.count(TOKEN_HREF))
                token_index = page.index(TOKEN_HREF)
                later_stylesheets = [
                    match.start()
                    for match in re.finditer(r'<link\b[^>]*rel=["\']stylesheet["\'][^>]*>', page)
                    if TOKEN_HREF not in match.group(0)
                ]
                self.assertTrue(all(token_index < index for index in later_stylesheets))
                inline_styles = list(
                    re.finditer(r"<style(?:\s[^>]*)?>(.*?)</style>", page, re.S)
                )
                for inline_style in inline_styles:
                    if "smart-canvas-booting body *" in inline_style.group(1):
                        continue
                    self.assertLess(token_index, inline_style.start())

    def test_every_html_entry_declares_a_ui_scope(self):
        for page_path in product_pages():
            with self.subTest(page=page_path.name):
                page = page_path.read_text(encoding="utf-8")
                html_tag = re.search(r"<html\b[^>]*>", page)
                self.assertIsNotNone(html_tag)
                self.assertIn("data-ui-scope=", html_tag.group(0))

    def test_token_module_exposes_confirmed_primitives_semantics_and_themes(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")

        required_tokens = (
            "--ui-palette-gray-500:",
            "--ui-color-surface-canvas:",
            "--ui-color-surface:",
            "--ui-color-surface-subtle:",
            "--ui-color-surface-floating:",
            "--ui-color-text-primary:",
            "--ui-color-text-placeholder:",
            "--ui-color-text-white:",
            "--ui-color-text-link:",
            "--ui-color-text-caret:",
            "--ui-color-icon-primary:",
            "--ui-color-border-primary:",
            "--ui-color-border-nodes:",
            "--ui-color-border-connections:",
            "--ui-color-border-focus:",
            "--ui-color-border-selected:",
            "--ui-color-border-canvas-grid:",
            "--ui-color-action-primary:",
            "--ui-color-action-secondary-selected:",
            "--ui-color-action-tertiary-hover:",
            "--ui-color-text-on-action-primary:",
            "--ui-color-backdrop:",
            "--ui-color-mask:",
            "--ui-font-sans:",
            "--ui-text-title-1:",
            "--ui-text-title-2:",
            "--ui-text-title-3:",
            "--ui-text-subtitle:",
            "--ui-text-body:",
            "--ui-text-label:",
            "--ui-space-4:",
            "--ui-space-16:",
            "--ui-radius-xs:",
            "--ui-border-width-thin:",
            "--ui-control-height-m:",
            "--ui-icon-size-m:",
            "--ui-shadow-overlay:",
            "--ui-motion-duration-deliberate:",
            "--ui-motion-ease-standard:",
            "--ui-z-base:",
            "--ui-z-raised:",
            "--ui-z-sticky:",
            "--ui-z-drag-preview:",
            "--ui-z-popover:",
            "--ui-z-backdrop:",
            "--ui-z-modal:",
            "--ui-z-toast:",
            "--ui-z-tooltip:",
        )
        for token in required_tokens:
            with self.subTest(token=token):
                self.assertIn(token, tokens)

        self.assertNotIn("--ui-palette-white", tokens)
        self.assertNotIn("--ui-palette-black", tokens)
        self.assertIn(
            "--ui-color-border-nodes: light-dark(var(--ui-palette-gray-300), var(--ui-palette-gray-700));",
            tokens,
        )
        self.assertIn("html.theme-dark", tokens)
        self.assertIn('html[data-ui-theme="dark"]', tokens)
        self.assertNotIn('html[data-ui-scope="canvas"] {', tokens)
        self.assertNotIn('html[data-ui-scope="settings"] {', tokens)
        self.assertNotIn('html[data-ui-scope="api-settings"] {', tokens)
        self.assertRegex(
            tokens,
            r"--ui-text-title-3:\s*var\(--ui-font-weight-medium\)",
        )
        self.assertNotRegex(
            tokens,
            r"--ui-text-title-3:[^;]*var\(--ui-font-weight-bold\)",
        )

    def test_all_text_entry_placeholders_use_the_placeholder_token(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        self.assertIn(
            "--ui-color-text-placeholder: light-dark(var(--ui-palette-gray-400), var(--ui-palette-gray-500));",
            tokens,
        )
        self.assertRegex(
            tokens,
            r":where\(input, textarea\)::placeholder\s*\{[^}]*"
            r"color:\s*var\(--ui-color-text-placeholder\);[^}]*opacity:\s*1;",
        )

        violations = []
        for path in STATIC.rglob("*"):
            if (
                not path.is_file()
                or path.suffix not in {".css", ".html", ".js"}
                or "vendor" in path.parts
            ):
                continue
            source = path.read_text(encoding="utf-8")
            for block in source.split("}"):
                if "{" not in block:
                    continue
                selector, body = block.rsplit("{", 1)
                if (
                    "::placeholder" in selector
                    and "color:" in body
                    and "var(--ui-color-text-placeholder)" not in body
                ):
                    violations.append(str(path.relative_to(ROOT)))
                if (
                    re.search(r"content:\s*attr\(data-placeholder\)", body)
                    and "var(--ui-color-text-placeholder)" not in body
                ):
                    violations.append(str(path.relative_to(ROOT)))

        adapter = (STATIC / "js/infinite-canvas-ui/theme-adapter.js").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "--wa-form-control-placeholder-color: var(--ui-color-text-placeholder);",
            adapter,
        )
        explorer = (STATIC / "js/ui-component-library/design-token-explorer.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("suffix === 'text-placeholder'", explorer)
        self.assertNotIn("说明、占位提示和弱化元数据", explorer)
        self.assertEqual([], violations)

    def test_shadow_tokens_expose_the_four_confirmed_elevation_levels(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        expected = (
            "--ui-shadow-none: none;",
            "--ui-shadow-raised: 0 1px 3px 0 rgba(0, 0, 0, 0.05);",
            "--ui-shadow-overlay: 0 8px 10px -5px rgba(0, 0, 0, 0.15);",
            "--ui-shadow-modal: 0 25px 50px -12px rgba(0, 0, 0, 0.25);",
        )

        positions = []
        for declaration in expected:
            with self.subTest(declaration=declaration):
                self.assertIn(declaration, tokens)
                positions.append(tokens.index(declaration))
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("--ui-shadow-popover", tokens)

    def test_first_party_sources_use_only_current_typography_token_names(self):
        retired_names = (
            "--ui-font-size-0",
            "--ui-font-weight-semibold",
            "--ui-line-height-normal",
            "--ui-line-height-relaxed",
            "--ui-text-heading-lg",
            "--ui-text-heading-md",
            "--ui-text-heading-sm",
            "--ui-text-mono",
        )
        remaining = []
        for path in STATIC.rglob("*"):
            if (
                not path.is_file()
                or path.suffix not in {".css", ".html", ".js", ".json"}
                or "vendor" in path.parts
            ):
                continue
            source = path.read_text(encoding="utf-8")
            for name in retired_names:
                if name in source:
                    remaining.append((str(path.relative_to(ROOT)), name))

        self.assertEqual([], remaining)

    def test_legacy_shadow_color_helpers_are_removed_from_first_party_sources(self):
        legacy_name = "--ui-color-shadow"
        remaining = []
        for path in STATIC.rglob("*"):
            if not path.is_file() or path.suffix not in {".css", ".html", ".js", ".json"}:
                continue
            if "vendor" in path.parts:
                continue
            if legacy_name in path.read_text(encoding="utf-8"):
                remaining.append(str(path.relative_to(ROOT)))

        self.assertEqual([], remaining)

        adapter = (STATIC / "js/infinite-canvas-ui/theme-adapter.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("--wa-shadow-s: var(--ui-shadow-raised);", adapter)
        self.assertIn("--wa-shadow-m: var(--ui-shadow-overlay);", adapter)
        self.assertIn("--wa-shadow-l: var(--ui-shadow-modal);", adapter)
        self.assertNotIn("--wa-color-shadow:", adapter)

        smart_canvas = (STATIC / "css/smart-canvas.css").read_text(encoding="utf-8")
        canvas = (STATIC / "css/canvas.css").read_text(encoding="utf-8")
        api_settings = (STATIC / "css/api-settings.css").read_text(encoding="utf-8")
        canvas_share = (STATIC / "css/canvas-share.css").read_text(encoding="utf-8")
        self.assertIn(
            "box-shadow:0 0 0 1px var(--ui-color-border-selected), var(--ui-shadow-raised)",
            smart_canvas,
        )
        self.assertIn(
            "prompt-node-focus-dialog.image-node", smart_canvas
        )
        self.assertIn("box-shadow:var(--ui-shadow-modal)", smart_canvas)
        self.assertIn(
            "box-shadow:inset 0 1px 0 rgba(255,255,255,.55), var(--ui-shadow-raised)",
            canvas,
        )
        self.assertIn("filter:var(--ui-shadow-none)", api_settings)
        self.assertNotIn("text-shadow:", canvas_share)

    def test_layer_tokens_follow_the_documented_semantic_order(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        names = (
            "base", "raised", "sticky", "drag-preview", "popover",
            "backdrop", "modal", "toast", "tooltip",
        )
        values = []
        for name in names:
            match = re.search(rf"--ui-z-{re.escape(name)}:\s*(-?\d+(?:\.\d+)?)\s*;", tokens)
            self.assertIsNotNone(match, name)
            values.append(float(match.group(1)))

        self.assertEqual(values, sorted(set(values)))

    def test_node_and_connection_border_tokens_have_separate_theme_aware_values(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        self.assertIn(
            "--ui-color-border-connections: "
            "light-dark(var(--ui-palette-gray-400), var(--ui-palette-gray-500));",
            tokens,
        )

    def test_comparable_size_tokens_share_one_suffix_scale(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        expected = {
            "radius": ("none", "xs", "s", "m", "l", "pill"),
            "control-height": ("xs", "s", "m", "l"),
            "icon-size": ("xs", "s", "m", "l", "xl"),
            "icon-stroke-width": ("xs", "s", "m", "l", "xl"),
        }

        for family, suffixes in expected.items():
            with self.subTest(family=family):
                actual = tuple(re.findall(rf"--ui-{family}-([a-z]+):", tokens))
                self.assertEqual(suffixes, actual)

        self.assertNotRegex(
            tokens,
            r"--ui-(?:radius|control-height|icon-size|icon-stroke-width)-(?:sm|md|lg):",
        )

        source_roots = (
            STATIC,
            ROOT / "tests",
            ROOT / "docs/current",
            ROOT / "docs/active",
        )
        size_token = re.compile(
            r"--ui-(radius|control-height|icon-size|icon-stroke-width)-([a-z]+)"
        )
        text_suffixes = {".css", ".html", ".js", ".cjs", ".json", ".md", ".py"}
        for source_root in source_roots:
            for path in source_root.rglob("*"):
                if (
                    not path.is_file()
                    or path.suffix not in text_suffixes
                    or "vendor" in path.parts
                ):
                    continue
                source = path.read_text(encoding="utf-8")
                for family, suffix in size_token.findall(source):
                    with self.subTest(path=str(path.relative_to(ROOT)), token=f"{family}-{suffix}"):
                        self.assertIn(suffix, expected[family])

    def test_default_sans_stack_uses_pingfang_for_all_ui_text(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        font_stack = re.search(r"--ui-font-sans:\s*([^;]+);", tokens)

        self.assertIsNotNone(font_stack)
        families = font_stack.group(1)
        self.assertTrue(families.strip().startswith('"PingFang SC"'))
        self.assertLess(families.index('"PingFang SC"'), families.index('"Space Grotesk"'))
        self.assertLess(families.index('"PingFang SC"'), families.index("Inter"))
        self.assertLess(families.index('"PingFang SC"'), families.index("system-ui"))

    def test_t14_through_t20_pages_use_composite_typography(self):
        adopted_styles = (
            "account-login.css",
            "account-management.css",
            "available-model-management.css",
            "api-settings.css",
            "api-settings-t18.css",
            "api-settings-t19.css",
            "comfyui-settings.css",
        )
        legacy_typography_fragments = (
            "--ui-text-heading-s-font-size",
            "--ui-text-body-compact-font-family",
            "--ui-text-label-font-family",
            "--ui-text-code-font-family",
        )

        for name in adopted_styles:
            with self.subTest(stylesheet=name):
                source = (STATIC / "css" / name).read_text(encoding="utf-8")
                self.assertRegex(source, r"font:\s*var\(--ui-text-")
                for fragment in legacy_typography_fragments:
                    self.assertNotIn(fragment, source)

        setup_page = (STATIC / "setup.html").read_text(encoding="utf-8")
        self.assertLess(
            setup_page.index("/static/css/account-login.css"),
            setup_page.index("/static/css/account-setup.css"),
        )

    def test_redundant_color_and_surface_aliases_are_not_defined(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        removed = (
            "--ui-palette-neutral-200:",
            "--ui-palette-neutral-950:",
            "--ui-color-page:",
            "--ui-color-card:",
            "--ui-color-panel-solid:",
            "--ui-color-surface-muted:",
            "--ui-color-selected-text:",
            "--ui-color-selected-border:",
            "--ui-color-user-message:",
        )
        for token in removed:
            with self.subTest(token=token):
                self.assertNotIn(token, tokens)

    def test_legacy_global_token_definitions_are_removed(self):
        legacy_names = (
            "page", "bg", "bg-base", "grid", "panel", "panel-solid",
            "card", "card-solid", "soft", "soft-2", "line", "line-2",
            "line-strong", "border", "text", "text-main", "muted", "faint",
            "strong", "strong-text", "accent", "danger", "danger-soft",
            "success", "success-soft", "ok", "shadow", "shadow-strong",
            "ease", "easing", "fluid-ease",
        )
        definition = re.compile(
            rf"--(?:{'|'.join(re.escape(name) for name in legacy_names)})\s*:"
        )

        candidates = list((STATIC / "css").glob("*.css")) + list(STATIC.glob("*.html"))
        violations = []
        for path in candidates:
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if definition.search(line):
                    violations.append(f"{path.relative_to(ROOT)}:{line_number}")

        self.assertEqual([], violations)

    def test_removed_semantic_color_names_have_no_compatibility_aliases(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        removed = (
            "canvas", "canvas-grid", "panel", "surface-hover", "surface-pressed",
            "hover", "table-row", "table-row-hover", "media-canvas",
            "border", "border-subtle", "border-strong", "control-border",
            "text", "text-subtitle", "text-muted", "text-faint",
            "disabled-surface", "disabled-border", "control-thumb-surface",
            "control-thumb-border", "action", "action-hover", "action-pressed",
            "action-disabled", "on-action", "on-action-disabled", "selected",
            "selected-hover", "selected-strong", "on-selected-strong", "accent",
            "accent-hover", "accent-pressed", "accent-soft", "accent-border",
            "on-accent", "link", "success", "success-soft", "success-border",
            "warning", "warning-soft", "warning-border", "danger", "danger-soft",
            "danger-border", "on-danger", "overlay", "on-overlay",
            "media-scrim-start", "media-scrim-mid", "media-scrim-end",
            "focus-ring", "focus-ring-inner",
        )
        for name in removed:
            with self.subTest(name=name):
                self.assertNotRegex(tokens, rf"--ui-color-{re.escape(name)}\s*:")

        self.assertNotIn("--ui-color-info", tokens)
        self.assertIn("--ui-focus-ring-shadow-enabled: none;", tokens)

    def test_first_party_static_assets_reference_only_declared_semantic_colors(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        declared = set(re.findall(r"(--ui-color-[a-z0-9-]+)\s*:", tokens))
        violations = []

        for path in STATIC.rglob("*"):
            if (
                not path.is_file()
                or path.suffix not in {".css", ".html", ".js", ".json"}
                or "vendor" in path.parts
            ):
                continue
            source = path.read_text(encoding="utf-8")
            for reference in sorted(set(re.findall(r"--ui-color-[a-z0-9-]+", source))):
                if (
                    reference not in declared
                    and reference != "--ui-color-prompt-template-placeholder-"
                ):
                    violations.append(f"{path.relative_to(ROOT)}: {reference}")

        self.assertEqual([], violations)

    def test_opaque_semantic_tints_map_to_sparse_palette_steps(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        expected_primitives = {
            "green-100": "#E6F2EE",
            "green-950": "#193329",
            "amber-100": "#F8EEE6",
            "amber-950": "#392F17",
            "red-50": "#FFF0F2",
            "red-100": "#F8E8E8",
            "red-150": "#F4DBDB",
            "red-300": "#F0CDCD",
            "red-900": "#583030",
            "red-950": "#4B2A2A",
            "red-1000": "#382323",
        }
        for step, value in expected_primitives.items():
            with self.subTest(step=step):
                self.assertIn(f"--ui-palette-{step}: {value};", tokens)

        expected_mappings = (
            "--ui-color-surface-success: light-dark(var(--ui-palette-green-100), var(--ui-palette-gray-800));",
            "--ui-color-surface-warning: light-dark(var(--ui-palette-amber-100), var(--ui-palette-gray-800));",
            "--ui-color-surface-danger: light-dark(var(--ui-palette-red-100), var(--ui-palette-gray-800));",
            "--ui-color-action-secondary-danger: light-dark(var(--ui-palette-red-50), var(--ui-palette-gray-950));",
            "--ui-color-action-secondary-danger-hover: light-dark(var(--ui-palette-red-100), var(--ui-palette-gray-800));",
            "--ui-color-action-tertiary-danger-hover: light-dark(var(--ui-palette-red-50), var(--ui-palette-gray-800));",
            "--ui-color-text-on-action-primary-danger: var(--ui-palette-gray-0);",
        )
        for mapping in expected_mappings:
            with self.subTest(mapping=mapping):
                self.assertIn(mapping, tokens)

        self.assertNotRegex(
            tokens,
            r"color-mix\([^;]*var\(--ui-palette-(?:green|amber|red)-",
        )

    def test_transparent_colors_use_the_shared_palette_primitive(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")

        self.assertIn("--ui-palette-transparent: #00000000;", tokens)
        self.assertIn(
            "--ui-color-action-tertiary: var(--ui-palette-transparent);",
            tokens,
        )
        self.assertIn(
            "color-mix(in srgb, var(--ui-palette-gray-0) 92%, var(--ui-palette-transparent))",
            tokens,
        )
        without_primitive = tokens.replace(
            "--ui-palette-transparent: #00000000;", ""
        )
        self.assertNotRegex(without_primitive, r"(?<![\w-])transparent(?![\w-])")
        self.assertNotRegex(without_primitive, r"rgba\(0,\s*0,\s*0,\s*0\)")

    def test_semantic_color_families_keep_the_agreed_responsibilities(self):
        tokens = (STATIC / "css/design-tokens.css").read_text(encoding="utf-8")
        self.assertNotRegex(tokens, r"--ui-color-[\w-]*-pressed\s*:")
        for mapping in (
            "--ui-motion-duration-press: 90ms;",
            "--ui-motion-duration-release: 240ms;",
            "--ui-motion-ease-press: cubic-bezier(.4, 0, 1, 1);",
            "--ui-motion-ease-spring: cubic-bezier(.34, 1.56, .64, 1);",
        ):
            self.assertIn(mapping, tokens)

        surface_names = set(re.findall(r"--ui-color-(surface(?:-[a-z]+)?)\s*:", tokens))
        self.assertEqual(
            {
                "surface", "surface-canvas", "surface-subtle", "surface-floating",
                "surface-success", "surface-warning", "surface-danger",
            },
            surface_names,
        )
        self.assertNotRegex(
            tokens,
            r"--ui-color-surface-(?:hover|pressed|disabled|selected|media)\s*:",
        )

        blue_consumers = []
        for line in tokens.splitlines():
            if "var(--ui-palette-blue-" in line:
                match = re.search(r"--ui-color-([a-z0-9-]+)\s*:", line)
                blue_consumers.append(match.group(1) if match else line.strip())
        self.assertEqual(
            ["text-link", "text-caret", "minimap-media"],
            blue_consumers,
        )

        self.assertIn(
            "--ui-color-border-focus: light-dark(var(--ui-palette-gray-500), var(--ui-palette-gray-400));",
            tokens,
        )
        self.assertIn(
            "--ui-color-text-white: light-dark(var(--ui-palette-gray-0), var(--ui-palette-gray-0));",
            tokens,
        )


if __name__ == "__main__":
    unittest.main()
