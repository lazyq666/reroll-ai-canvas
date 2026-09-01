import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIBRARY_PAGE = ROOT / "static" / "ui-component-library.html"
SURFACE_APP = ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"
REFERENCE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "generation-pending-halftone-reference.html"
REFERENCE_SCRIPT = ROOT / "static" / "js" / "infinite-canvas-ui" / "generation-pending-halftone-reference.js"
PUBLIC_PENDING = ROOT / "static" / "js" / "infinite-canvas-ui" / "generation-pending.js"
BROWSER_SMOKE = ROOT / "tests" / "generation_pending_halftone_reference_browser_smoke.cjs"


class GenerationPendingHalftoneReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library_page = LIBRARY_PAGE.read_text(encoding="utf-8")
        cls.surface_app = SURFACE_APP.read_text(encoding="utf-8")
        cls.reference = REFERENCE.read_text(encoding="utf-8")
        cls.reference_script = REFERENCE_SCRIPT.read_text(encoding="utf-8")
        cls.public_pending = PUBLIC_PENDING.read_text(encoding="utf-8")

    def test_reference_is_registered_as_pending_animation_experiment_b(self):
        self.assertIn('label="动画实验 B"', self.library_page)
        self.assertIn('data-target-review="pending-halftone-reference"', self.library_page)
        self.assertIn('data-pending-halftone-reference', self.library_page)
        self.assertIn('generation-pending-halftone-reference.html', self.library_page)
        self.assertIn("'pending-halftone-reference': '动画实验 B'", self.surface_app)
        self.assertIn("const showPendingHalftoneReference = name === 'pending-halftone-reference'", self.surface_app)
        self.assertIn("pendingHalftoneReference.hidden = !showPendingHalftoneReference", self.surface_app)

    def test_reference_exposes_the_approved_parameters_and_defaults(self):
        for setting in (
            "playing", "count", "speed", "density", "dot", "scale", "contrast",
        ):
            with self.subTest(setting=setting):
                self.assertIn(f'data-setting="{setting}"', self.reference)
        for expected in (
            "speed: 2.3", "density: 36", "dot: 18", "scale: 0.5", "contrast: 1.2",
            "getComputedStyle(this.node).backgroundColor",
            "getComputedStyle(this.canvas).color",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, self.reference_script)
        for obsolete in ("lightBg", "lightDot", "darkBg", "darkDot"):
            with self.subTest(obsolete=obsolete):
                self.assertNotIn(f'data-setting="{obsolete}"', self.reference)

    def test_preview_is_two_by_three_and_contains_only_the_animation(self):
        self.assertIn("aspect-ratio:2 / 3", self.reference)
        self.assertIn('<canvas class="pending-halftone-canvas"', self.reference_script)
        self.assertNotIn("pending-progress", self.reference)
        self.assertNotIn("pending-status", self.reference)
        self.assertNotIn("正在构建画面", self.reference)

    def test_multiple_instances_share_a_bounded_motion_scheduler(self):
        self.assertIn("const TARGET_FRAME_MS = 1000 / 24", self.reference_script)
        self.assertIn("const DPR_LIMIT = 1.5", self.reference_script)
        self.assertIn("const MIN_DOT_RADIUS = 2", self.reference_script)
        self.assertIn("Math.max(MIN_DOT_RADIUS, spacing * (settings.dot / 100))", self.reference_script)
        self.assertIn("requestAnimationFrame(frame)", self.reference_script)
        self.assertIn("'IntersectionObserver' in window", self.reference_script)
        self.assertIn("document.hidden", self.reference_script)
        self.assertIn("prefers-reduced-motion: reduce", self.reference_script)
        self.assertIn("new ResizeObserver", self.reference_script)

    def test_public_pending_adopts_the_reference_animation_without_changing_its_contract(self):
        self.assertIn("export class IcGenerationPending extends HTMLElement", self.public_pending)
        self.assertIn('class="generation-pending-halftone"', self.public_pending)
        self.assertIn("new Set(['image', 'video', 'text'])", self.public_pending)
        self.assertNotIn("generation-pending-loader.webp", self.public_pending)

    def test_browser_smoke_covers_parameters_theme_ratio_and_reduced_motion(self):
        smoke = BROWSER_SMOKE.read_text(encoding="utf-8")
        self.assertIn("pending-halftone-reference", smoke)
        self.assertIn("set('ic-slider[data-setting=\"speed\"]', 3.2)", smoke)
        self.assertIn("set('ic-select[data-setting=\"count\"]', '6')", smoke)
        self.assertIn("var(--ui-color-surface)", self.reference)
        self.assertIn("var(--ui-color-text-disabled)", self.reference)
        self.assertIn("doc.documentElement.dataset.uiMotion = 'reduced'", smoke)
        self.assertIn("report.ratio", smoke)
        self.assertIn("feedback-progress-case.html?theme=light", smoke)
        self.assertIn("canvas.generation-pending-halftone", smoke)
        self.assertIn("productionLight", smoke)
        self.assertIn("productionDark", smoke)


if __name__ == "__main__":
    unittest.main()
