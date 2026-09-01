import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIBRARY_PAGE = ROOT / "static" / "ui-component-library.html"
SURFACE_APP = ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"
REFERENCE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "click-spark-reference.html"
REFERENCE_SCRIPT = ROOT / "static" / "js" / "infinite-canvas-ui" / "click-spark-reference.js"
BROWSER_SMOKE = ROOT / "tests" / "click_spark_reference_browser_smoke.cjs"


class ClickSparkReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library_page = LIBRARY_PAGE.read_text(encoding="utf-8")
        cls.surface_app = SURFACE_APP.read_text(encoding="utf-8")
        cls.reference = REFERENCE.read_text(encoding="utf-8")
        cls.reference_script = REFERENCE_SCRIPT.read_text(encoding="utf-8")

    def test_reference_is_registered_as_an_isolated_component_library_experiment(self):
        self.assertIn('label="点击反馈实验"', self.library_page)
        self.assertIn('data-target-review="click-spark-reference"', self.library_page)
        self.assertIn('data-click-spark-reference', self.library_page)
        self.assertIn('click-spark-reference.html', self.library_page)
        self.assertIn("'click-spark-reference': '点击反馈实验'", self.surface_app)
        self.assertIn("const showClickSparkReference = name === 'click-spark-reference'", self.surface_app)
        self.assertIn("clickSparkReference.hidden = !showClickSparkReference", self.surface_app)
        self.assertIn("参考实现 · 非公共组件", self.reference)

    def test_reference_exposes_theme_and_motion_parameters(self):
        for setting in (
            "count",
            "radius",
            "length",
            "lineWidth",
            "duration",
            "maxBursts",
            "useCustomColor",
            "color",
        ):
            with self.subTest(setting=setting):
                self.assertIn(f'data-setting="{setting}"', self.reference)
        self.assertIn('data-preview-theme="light"', self.reference)
        self.assertIn('data-preview-theme="dark"', self.reference)
        self.assertIn("--click-spark-color:var(--ui-color-border-focus)", self.reference)
        self.assertIn("--click-spark-outline", self.reference)
        self.assertIn('color-scheme:light', self.reference)
        self.assertIn('color-scheme:dark', self.reference)
        self.assertIn("getComputedStyle(this._sparkColorProbe).color", self.reference_script)
        self.assertIn("lineWidth: 1.5", self.reference_script)
        self.assertIn("`lineWidth:${settings.lineWidth}px`", self.reference_script)

    def test_reference_uses_on_demand_canvas_without_changing_business_clicks(self):
        self.assertIn("class IcClickSparkReference extends HTMLElement", self.reference_script)
        self.assertIn("window.addEventListener('mouseup', this._onMouseUp)", self.reference_script)
        self.assertIn("distance >= DRAG_DISTANCE_PX ? 'drag-release' : 'click'", self.reference_script)
        self.assertIn("if (!this._raf) this._raf = requestAnimationFrame(this._drawFrame)", self.reference_script)
        self.assertIn("if (this._bursts.length)", self.reference_script)
        self.assertIn("this.dataset.animationState = 'idle'", self.reference_script)
        self.assertIn("DPR_LIMIT = 1.5", self.reference_script)
        self.assertIn("prefers-reduced-motion: reduce", self.reference_script)
        self.assertIn("pointer-events:none", self.reference_script)
        self.assertNotIn(".click()", self.reference_script)

    def test_browser_smoke_covers_click_drag_theme_reduced_motion_and_idle_raf(self):
        smoke = BROWSER_SMOKE.read_text(encoding="utf-8")
        for evidence in (
            "drag-release",
            "reducedMotion:'reduce'",
            "animationActive",
            "pointerEvents",
            "report.theme !== 'dark'",
        ):
            with self.subTest(evidence=evidence):
                self.assertIn(evidence, smoke)


if __name__ == "__main__":
    unittest.main()
