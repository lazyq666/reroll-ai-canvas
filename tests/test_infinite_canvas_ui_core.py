import json
import os
import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERIFY_VENDOR = ROOT / "scripts" / "verify_webawesome_vendor.py"
AUDIT_BOUNDARY = ROOT / "scripts" / "audit_infinite_canvas_ui_boundary.py"
BROWSER_SMOKE = ROOT / "tests" / "ic_core_browser_smoke.cjs"
CORE_MODULE = ROOT / "static" / "js" / "infinite-canvas-ui" / "core.js"
FOCUS_POLICY = ROOT / "static" / "js" / "infinite-canvas-ui" / "focus-policy.js"
OVERLAY_LAYER = ROOT / "static" / "js" / "infinite-canvas-ui" / "overlay-layer.js"
THEME_ADAPTER = ROOT / "static" / "js" / "infinite-canvas-ui" / "theme-adapter.js"
DESIGN_TOKENS = ROOT / "static" / "css" / "design-tokens.css"
ENGINE_STYLES = ROOT / "static" / "css" / "webawesome-engine.css"
BROWSER_HARNESS = ROOT / "tests" / "ic_core_browser_harness.html"
class InfiniteCanvasUiVendorTests(unittest.TestCase):
    def test_fixed_webawesome_core_release_is_complete_and_reproducible(self):
        result = subprocess.run(
            [sys.executable, str(VERIFY_VENDOR)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertEqual(report["package"], "@awesome.me/webawesome")
        self.assertEqual(report["version"], "3.10.0")
        self.assertEqual(report["license"], "MIT")
        self.assertEqual(report["archiveFiles"], report["installedFiles"])
        self.assertGreater(report["archiveFiles"], 2000)


class InfiniteCanvasUiBoundaryTests(unittest.TestCase):
    def test_business_sources_cannot_consume_webawesome_directly(self):
        result = subprocess.run(
            [sys.executable, str(AUDIT_BOUNDARY)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertEqual(report["directVendorUsages"], [])
        self.assertGreater(report["scannedFiles"], 30)

    def test_public_contract_is_project_owned_and_runtime_is_fully_local(self):
        source = CORE_MODULE.read_text(encoding="utf-8")

        for tag in ("ic-button", "ic-input", "ic-dialog"):
            self.assertIn(tag, source)
        self.assertIn("customElements.define", source)
        self.assertNotRegex(source, r"dispatchEvent\(new CustomEvent\(['\"]wa-")
        self.assertNotIn("http://", source)
        self.assertNotIn("https://", source)
        self.assertNotIn("node_modules", source)
        self.assertIn("package/dist-cdn", source)

    def test_component_engine_does_not_restyle_page_native_controls(self):
        core = CORE_MODULE.read_text(encoding="utf-8")
        styles = ENGINE_STYLES.read_text(encoding="utf-8")

        self.assertIn("webawesome-engine.css", core)
        self.assertIn("styles/layers.css", styles)
        self.assertIn("styles/utilities.css", styles)
        self.assertIn("styles/themes/default.css", styles)
        self.assertNotIn("styles/native.css", styles)
        self.assertNotIn("styles/webawesome.css", styles)

    def test_browser_harness_observes_only_the_ic_public_seam(self):
        harness = BROWSER_HARNESS.read_text(encoding="utf-8")

        self.assertNotRegex(
            harness,
            r"querySelector\(['\"]ic-[^'\"]+['\"]\)\?*\.shadowRoot",
        )
        self.assertNotRegex(harness, r"\bwa-[a-z]")
        for tag in ("ic-button", "ic-input", "ic-dialog"):
            self.assertIn(tag, harness)

    def test_focus_policy_is_installed_once_at_the_shared_core_seam(self):
        core = CORE_MODULE.read_text(encoding="utf-8")
        policy = FOCUS_POLICY.read_text(encoding="utf-8")

        self.assertIn("import { installFocusPolicy }", core)
        self.assertEqual(core.count("installFocusPolicy();"), 1)
        self.assertIn("const INSTALLED_DOCUMENTS = new WeakSet();", policy)
        self.assertIn("root.dataset.icInputModality = modality;", policy)
        self.assertIn("'pointerdown'", policy)
        self.assertIn("'keydown'", policy)
        self.assertNotIn(".blur(", policy)

    def test_pointer_focus_visuals_are_gated_by_shared_inherited_tokens(self):
        tokens = DESIGN_TOKENS.read_text(encoding="utf-8")
        adapter = THEME_ADAPTER.read_text(encoding="utf-8")

        for token in (
            "--ui-focus-ring-enabled",
            "--ui-focus-ring-shadow-enabled",
            "--ui-focus-background-enabled",
        ):
            self.assertIn(token, tokens)
        self.assertIn(':root[data-ic-input-modality="pointer"]', adapter)
        self.assertIn("--ui-focus-ring: none;", adapter)
        self.assertIn("--ui-focus-ring-shadow: none;", adapter)
        self.assertIn("--ui-focus-background: var(--ui-color-action-tertiary);", adapter)
        self.assertIn('[data-preview-state="focus-visible"]', adapter)

    def test_overlay_scope_and_top_layer_policy_are_installed_at_the_shared_core_seam(self):
        core = CORE_MODULE.read_text(encoding="utf-8")
        policy = OVERLAY_LAYER.read_text(encoding="utf-8")

        self.assertIn("import { installOverlayScopePolicy }", core)
        self.assertEqual(core.count("installOverlayScopePolicy();"), 1)
        self.assertIn("['popover', 'toast', 'tooltip']", policy)
        self.assertIn("ic-overlay-scope-activate", policy)
        self.assertIn("element.showPopover()", policy)
        self.assertIn("element.hidePopover()", policy)
        self.assertNotRegex(policy, r"z-index|\b999+")

    def test_ui_modules_cannot_reintroduce_local_pointer_focus_state(self):
        modules = ROOT / "static" / "js" / "infinite-canvas-ui"
        forbidden = ("data-ic-pointer-focus", "icPointerFocus", "menuInputModality")
        violations = []
        for path in modules.glob("*.js"):
            if path == FOCUS_POLICY:
                continue
            source = path.read_text(encoding="utf-8")
            violations.extend(
                f"{path.name}: {marker}" for marker in forbidden if marker in source
            )
            for line_number, line in enumerate(source.splitlines(), start=1):
                if re.search(r"(?<!-):focus(?![-\w])", line) and "[data-keyboard-focus]:focus" not in line:
                    violations.append(f"{path.name}:{line_number}: raw :focus selector")
        self.assertEqual(violations, [])


@unittest.skipUnless(
    os.environ.get("IC_RUN_BROWSER_TESTS") == "1",
    "set IC_RUN_BROWSER_TESTS=1 to launch the real browser contract suite",
)
class InfiniteCanvasUiBrowserContractTests(unittest.TestCase):
    @classmethod
    def run_browser_contract(cls):
        if not hasattr(cls, "_browser_contract_result"):
            cls._browser_contract_result = subprocess.run(
                ["node", str(BROWSER_SMOKE)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
        return cls._browser_contract_result

    def test_ic_button_preserves_activation_focus_form_and_accessibility(self):
        result = self.run_browser_contract()
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertTrue(report["checks"]["platform"])
        self.assertTrue(report["checks"]["focusPolicy"])
        self.assertTrue(report["checks"]["focusInteraction"])
        self.assertTrue(report["checks"]["menuFocusInteraction"])
        self.assertTrue(report["checks"]["button"])
        self.assertIn(
            {"role": "button", "name": "Save canvas"},
            report["accessibility"],
        )

    def test_ic_input_preserves_value_events_form_validation_focus_and_accessibility(self):
        result = self.run_browser_contract()
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertTrue(report["checks"]["input"])
        self.assertTrue(
            any(
                item["role"] == "textbox"
                and item["name"].startswith("Project name")
                for item in report["accessibility"]
            ),
            report["accessibility"],
        )

    def test_ic_dialog_preserves_events_focus_return_and_accessibility(self):
        result = self.run_browser_contract()
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertTrue(report["checks"]["dialog"])
        self.assertIn(
            {"role": "dialog", "name": "Delete node"},
            report["accessibility"],
        )


if __name__ == "__main__":
    unittest.main()
