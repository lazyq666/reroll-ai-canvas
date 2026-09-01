import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIBRARY_PAGE = ROOT / "static" / "ui-component-library.html"
SURFACE_APP = ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"
PROTOTYPE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "generation-pending-performance-prototype.html"
PROTOTYPE_SCRIPT = ROOT / "static" / "js" / "infinite-canvas-ui" / "generation-pending-performance-prototype.js"
BENCHMARK_RUNNER = ROOT / "scripts" / "performance" / "benchmark_generation_pending.cjs"


class GenerationPendingPerformancePrototypeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library_page = LIBRARY_PAGE.read_text(encoding="utf-8")
        cls.surface_app = SURFACE_APP.read_text(encoding="utf-8")
        cls.prototype = PROTOTYPE.read_text(encoding="utf-8")
        cls.prototype_script = PROTOTYPE_SCRIPT.read_text(encoding="utf-8")
        cls.runner = BENCHMARK_RUNNER.read_text(encoding="utf-8")

    def test_prototype_is_available_from_the_component_library_reference_group(self):
        self.assertIn('label="动画性能对比"', self.library_page)
        self.assertIn('data-target-review="pending-performance-prototype"', self.library_page)
        self.assertIn('data-pending-performance-prototype', self.library_page)
        self.assertIn("'pending-performance-prototype': '动画性能对比'", self.surface_app)
        self.assertIn("const showPendingPerformancePrototype = name === 'pending-performance-prototype'", self.surface_app)
        self.assertIn("pendingPerformancePrototype.hidden = !showPendingPerformancePrototype", self.surface_app)

    def test_each_candidate_uses_ten_instances_and_an_isolated_mode(self):
        self.assertIn("const INSTANCE_COUNT = 10", self.prototype_script)
        self.assertIn("candidates:['a', 'b', 'current']", self.prototype_script)
        self.assertIn("candidate === 'all' ? ['a', 'b', 'current']", self.prototype_script)
        self.assertIn("同尺寸、同视口、每组同时运行 10 个实例", self.prototype)

    def test_candidate_implementations_keep_the_reference_defaults(self):
        for expected in (
            "--motion-duration:8s", "--motion-blur:28px", "--motion-drift:28%",
            "--motion-blob-size:78%", "const TARGET_FRAME_MS = 1000 / 24",
            "const DPR_LIMIT = 1.5", "const scale = 0.5", "width / 24",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, self.prototype + self.prototype_script)
        self.assertIn("<ic-generation-pending kind=\"video\"", self.prototype_script)

    def test_page_and_runner_measure_complementary_performance_signals(self):
        for expected in (
            "frameIntervalP95Ms", "longFrameRate", "longTaskTotalMs",
            "eventLoopLagP95Ms", "animationUpdateFps", "canvasDrawWorkMs",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, self.prototype_script)
        for expected in (
            "Performance.getMetrics", "SystemInfo.getProcessInfo", "rendererCpuPercent",
            "gpuCpuPercent", "mainThreadTaskPercent", "repeats", "DIAGNOSTIC_SCENARIOS",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, self.runner)


if __name__ == "__main__":
    unittest.main()
