import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "smart-canvas.html"
HOST = ROOT / "static" / "js" / "smart-canvas.js"
MODULE = ROOT / "static" / "js" / "smart-canvas" / "click-spark-feedback.js"
STYLE = ROOT / "static" / "css" / "smart-canvas.css"


class SmartCanvasClickSparkFeedbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.module = MODULE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")

    def test_selected_demo_parameters_are_the_production_contract(self):
        for setting in (
            "count:8",
            "radius:16",
            "length:10",
            "duration:360",
            "maxBursts:3",
        ):
            with self.subTest(setting=setting):
                self.assertIn(setting, self.module)
        self.assertIn("color:1.5, outline:2.4", self.module)
        self.assertIn("color:var(--ui-color-border-focus)", self.style)

    def test_feedback_is_loaded_before_the_smart_canvas_host_and_installed_on_shell(self):
        module_script = "/static/js/smart-canvas/click-spark-feedback.js"
        host_script = "/static/js/smart-canvas.js"
        self.assertIn(module_script, self.page)
        self.assertLess(self.page.index(module_script), self.page.index(host_script))
        self.assertIn("const clickSparkFeedback = window.SmartCanvasModules?.clickSparkFeedback", self.host)
        self.assertIn("clickSparkFeedback?.install({root:shell})", self.host)

    def test_feedback_is_visual_only_on_demand_and_accessible_to_reduced_motion(self):
        self.assertIn("window.addEventListener('mouseup', finish, true)", self.module)
        self.assertIn("distance >= DRAG_DISTANCE_PX ? 'drag-release' : 'click'", self.module)
        self.assertIn("if(!raf) raf = requestAnimationFrame(draw)", self.module)
        self.assertIn("canvas.dataset.animationState = 'idle'", self.module)
        self.assertIn("prefers-reduced-motion: reduce", self.module)
        self.assertIn("DPR_LIMIT = 1.5", self.module)
        self.assertNotIn(".click()", self.module)
        self.assertIn("pointer-events:none", self.style)
        self.assertIn("z-index:calc(var(--ui-z-toast) + 1)", self.style)


if __name__ == "__main__":
    unittest.main()
