import re
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
UI_ROOT = STATIC / "js" / "infinite-canvas-ui"
UI_VERSION = (UI_ROOT / "VERSION").read_text(encoding="utf-8").strip()


class Issue86ScrollbarFoundationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.core = (UI_ROOT / "core.js").read_text(encoding="utf-8")
        cls.scrollbar = (UI_ROOT / "scrollbar.js").read_text(encoding="utf-8")
        cls.scrollbar_case = (STATIC / "design-system" / "infinite-canvas-ui" / "scrollbar.html").read_text(encoding="utf-8")
        cls.scrollbar_case_app = (UI_ROOT / "scrollbar-case.js").read_text(encoding="utf-8")
        cls.component_library = (STATIC / "ui-component-library.html").read_text(encoding="utf-8")
        cls.surface_app = (STATIC / "js" / "ui-component-library" / "surface-app.js").read_text(encoding="utf-8")
        cls.surface_manifest = json.loads((STATIC / "design-system" / "infinite-canvas-ui" / "surface-manifest.json").read_text(encoding="utf-8"))

    def test_core_installs_one_shared_light_and_shadow_dom_foundation(self):
        self.assertIn(f"from './scrollbar.js?v={UI_VERSION}'", self.core)
        self.assertIn("ensureScrollbarStyles();", self.core)
        self.assertIn("refreshScrollbarStyles();", self.core)
        self.assertIn("new CSSStyleSheet()", self.scrollbar)
        self.assertIn("adoptedStyleSheets", self.scrollbar)
        self.assertIn("new MutationObserver", self.scrollbar)

    def test_shared_visual_matches_prompt_node_reference(self):
        for contract_value in (
            "size: '4px'",
            "track: 'transparent'",
            "thumb: 'var(--ui-color-border-primary)'",
            "thumbHover: 'var(--ui-color-text-tertiary)'",
            "edgeInset: '0px'",
        ):
            self.assertIn(contract_value, self.scrollbar)
        self.assertRegex(self.scrollbar, r"\*::\-webkit-scrollbar\s*\{[^}]*width:\s*4px;[^}]*height:\s*4px;")
        self.assertRegex(self.scrollbar, r"\*::\-webkit-scrollbar-thumb\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;")

    def test_product_pages_all_load_the_ui_core(self):
        pages = sorted(STATIC.glob("*.html"))
        self.assertGreaterEqual(len(pages), 17)
        missing = [page.name for page in pages if "infinite-canvas-ui/core.js" not in page.read_text(encoding="utf-8")]
        self.assertEqual(missing, [])

    def test_product_sources_keep_only_explicit_hidden_scrollbar_overrides(self):
        sources = [
            *STATIC.glob("css/*.css"),
            *STATIC.glob("js/*.js"),
            *STATIC.glob("js/infinite-canvas-ui/**/*.js"),
            *STATIC.glob("js/smart-canvas/**/*.js"),
        ]
        scrollbar_width = re.compile(r"scrollbar-width\s*:\s*([^;}\s]+)")
        visible_color = re.compile(r"scrollbar-color\s*:")
        webkit_rule = re.compile(r"(?s)([^{}]+::\-webkit-scrollbar(?:-[\w-]+)?[^{}]*)\{([^}]*)\}")
        violations = []
        for path in sorted(set(sources)):
            if path == UI_ROOT / "scrollbar.js":
                continue
            text = path.read_text(encoding="utf-8")
            widths = scrollbar_width.findall(text)
            if any(value != "none" for value in widths) or visible_color.search(text):
                violations.append(str(path.relative_to(ROOT)))
                continue
            for selector, body in webkit_rule.findall(text):
                if "display:none" not in body.replace(" ", ""):
                    violations.append(f"{path.relative_to(ROOT)}:{selector.strip()}")
        self.assertEqual(violations, [])

    def test_scrollbar_is_catalogued_in_the_ui_component_library(self):
        self.assertRegex(
            self.component_library,
            r'<ic-nav-item label="滚动条" secondary-label="Scrollbar"[^>]+data-target-review="scrollbar"[^>]+data-target-review-group="foundations"',
        )
        self.assertIn("data-scrollbar-matrix", self.component_library)
        self.assertIn("/static/design-system/infinite-canvas-ui/scrollbar.html", self.component_library)
        self.assertIn("scrollbar: '滚动条'", self.surface_app)
        self.assertIn("['ic-scrollbar', 'Scrollbar Foundation', 'scrollbar']", self.surface_app)
        self.assertIn("const showScrollbar = name === 'scrollbar'", self.surface_app)

        target = self.surface_manifest["surfaces"]["target"]
        self.assertIn("ic-scrollbar", target["foundations"]["components"])
        self.assertEqual(target["scrollbar"]["implementationStatus"], "implemented")
        self.assertEqual(target["scrollbar"]["caseCount"], 4)

    def test_library_fixture_uses_the_real_foundation_for_four_scroll_scenarios(self):
        self.assertIn('data-component-name="ic-scrollbar"', self.scrollbar_case)
        for scenario in ("vertical", "horizontal", "shadow", "hidden"):
            self.assertIn(f'data-scrollbar-sample="{scenario}"', self.scrollbar_case)
        self.assertIn(f"from './core.js?v={UI_VERSION}'", self.scrollbar_case_app)
        self.assertIn("shadowHost.attachShadow({ mode: 'open' })", self.scrollbar_case_app)
        self.assertIn("shadowFoundationInstalled", self.scrollbar_case_app)
        self.assertIn("hiddenScrollable", self.scrollbar_case_app)
        self.assertIn("__icScrollbarLibraryDiagnostics", self.scrollbar_case_app)


if __name__ == "__main__":
    unittest.main()
