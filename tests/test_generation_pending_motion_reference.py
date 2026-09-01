import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIBRARY_PAGE = ROOT / "static" / "ui-component-library.html"
SURFACE_APP = ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"
REFERENCE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "generation-pending-motion-reference.html"
REFERENCE_SCRIPT = ROOT / "static" / "js" / "infinite-canvas-ui" / "generation-pending-motion-reference.js"
PUBLIC_PENDING = ROOT / "static" / "js" / "infinite-canvas-ui" / "generation-pending.js"
BROWSER_SMOKE = ROOT / "tests" / "generation_pending_motion_reference_browser_smoke.cjs"


class GenerationPendingMotionReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library_page = LIBRARY_PAGE.read_text(encoding="utf-8")
        cls.surface_app = SURFACE_APP.read_text(encoding="utf-8")
        cls.reference = REFERENCE.read_text(encoding="utf-8")
        cls.reference_script = REFERENCE_SCRIPT.read_text(encoding="utf-8")
        cls.public_pending = PUBLIC_PENDING.read_text(encoding="utf-8")

    def test_reference_is_registered_under_the_component_library_reference_group(self):
        self.assertIn('label="动画实验 A"', self.library_page)
        self.assertIn('data-target-review="pending-motion-reference"', self.library_page)
        self.assertIn('data-pending-motion-reference', self.library_page)
        self.assertIn('generation-pending-motion-reference.html', self.library_page)
        self.assertIn("'pending-motion-reference': '动画实验 A'", self.surface_app)
        self.assertIn("const showPendingMotionReference = name === 'pending-motion-reference'", self.surface_app)
        self.assertIn("pendingMotionReference.hidden = !showPendingMotionReference", self.surface_app)

    def test_reference_exposes_variant_b_motion_and_color_parameters(self):
        for setting in (
            "playing",
            "count",
            "duration",
            "blur",
            "drift",
            "size",
            "opacity",
            "saturation",
            "colorOne",
            "colorTwo",
            "colorThree",
        ):
            with self.subTest(setting=setting):
                self.assertIn(f'data-setting="{setting}"', self.reference)
        self.assertIn('class="motion-blob blob-one"', self.reference_script)
        self.assertIn('class="motion-blob blob-two"', self.reference_script)
        self.assertIn('class="motion-blob blob-three"', self.reference_script)
        self.assertIn("--motion-duration", self.reference_script)
        self.assertIn("--motion-blur", self.reference_script)
        self.assertIn("--motion-drift", self.reference_script)
        self.assertIn("--motion-blob-size", self.reference_script)

    def test_reference_pauses_for_visibility_viewport_and_reduced_motion(self):
        self.assertIn("'IntersectionObserver' in window", self.reference_script)
        self.assertIn("document.hidden", self.reference_script)
        self.assertIn("prefers-reduced-motion: reduce", self.reference_script)
        self.assertIn("data-motion-state=\"paused\"", self.reference)
        self.assertIn("document.addEventListener('visibilitychange', syncMotionState)", self.reference_script)
        self.assertIn("contain:layout paint style", self.reference)
        self.assertNotIn("<video", self.reference)
        self.assertNotIn("<canvas", self.reference)

    def test_reference_remains_isolated_from_the_public_halftone_pending_component(self):
        self.assertIn("export class IcGenerationPending extends HTMLElement", self.public_pending)
        self.assertIn('class="generation-pending-halftone"', self.public_pending)
        self.assertNotIn("motion-blob", self.public_pending)

    def test_browser_smoke_covers_live_parameters_theme_and_reduced_motion(self):
        smoke = BROWSER_SMOKE.read_text(encoding="utf-8")
        self.assertIn("pending-motion-reference", smoke)
        self.assertIn("control.value = 14", smoke)
        self.assertIn("control.value = '6'", smoke)
        self.assertIn("root.dataset.uiMotion = 'reduced'", smoke)
        self.assertIn("report.theme !== 'dark'", smoke)


if __name__ == "__main__":
    unittest.main()
