import concurrent.futures
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from infinite_canvas.matting_service import BiRefNetMattingEngine, _scaled_size
from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]
HOST_SCRIPT = ROOT / "static/js/smart-canvas.js"
MATTING_MODULE = ROOT / "static/js/smart-canvas/smart-matting.js"
PERSISTENCE_MODULE = ROOT / "static/js/smart-canvas/canvas-persistence.js"


class SmartCanvasMattingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = read_smart_canvas_scripts(ROOT)
        cls.host_script = HOST_SCRIPT.read_text(encoding="utf-8")
        cls.matting_module = MATTING_MODULE.read_text(encoding="utf-8")
        cls.persistence_module = PERSISTENCE_MODULE.read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.server = (
            ROOT / "backend" / "main.py"
        ).read_text(encoding="utf-8")
        cls.requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")

    def test_floating_menu_exposes_matting_for_images(self):
        self.assertIn("{key:'matting', icon:'cut', label:tr('smart.matting')", self.script)
        self.assertIn("if(action === 'matting')", self.script)
        self.assertIn("smartMatting.run({node, imageIndex:index})", self.host_script)

    def test_click_delegates_pending_output_and_polling_to_matting_module(self):
        self.assertIn("smartMattingOutputModule.createPending({", self.matting_module)
        self.assertIn("connectSource:false", self.matting_module)
        self.assertIn("output.mattingJob", self.matting_module)
        self.assertIn("fetch('/api/smart-canvas/matting'", self.matting_module)
        self.assertIn("smartMattingStartPoll(current)", self.matting_module)
        self.assertNotIn("function generationOutputNextPosition", self.script)
        self.assertIn("placement:{", self.script)
        self.assertIn("generationOutputMutationModule.connect({", self.script)
        self.assertIn("kind:'flow'", self.script)

    def test_pending_jobs_resume_after_canvas_reload(self):
        self.assertIn(
            "smartMattingModule.resume();",
            self.persistence_module,
        )
        self.assertIn("function smartMattingResume", self.matting_module)
        self.assertIn("function smartMattingCompleteNode", self.matting_module)
        self.assertIn("<ic-generation-pending", self.matting_module)
        self.assertIn("<ic-alert", self.matting_module)
        self.assertIn(".matting-pending-feedback", self.style)
        self.assertNotIn(".matting-pending-cell", self.style)

    def test_backend_uses_configurable_bounded_fifo_workers(self):
        self.assertIn("MATTING_QUEUE_MAX", self.server)
        self.assertIn("MATTING_PER_USER_MAX", self.server)
        self.assertIn("MATTING_MAX_CONCURRENCY", self.server)
        self.assertIn("MATTING_WORKER_TASKS.append(", self.server)
        self.assertIn('name=f"infinite-canvas-matting-worker-{worker_number}"', self.server)
        self.assertIn("result = await asyncio.to_thread(run_matting_job_sync", self.server)
        self.assertIn("for worker_number in range(", self.server)

    def test_backend_rechecks_canvas_and_local_image_permissions(self):
        self.assertIn('@app.post("/api/smart-canvas/matting")', self.server)
        self.assertIn('@app.get("/api/smart-canvas/matting/{job_id}")', self.server)
        self.assertIn("load_canvas(payload.canvas_id, write=True)", self.server)
        self.assertIn("load_canvas(str(job.get(\"canvas_id\") or \"\"), write=True)", self.server)
        self.assertIn('"/api/storage-files/"', self.server)
        self.assertIn("source_image.verify()", self.server)

    def test_matting_runtime_is_resource_bounded(self):
        service = (
            ROOT
            / "backend"
            / "infinite_canvas"
            / "matting_service.py"
        ).read_text(encoding="utf-8")
        self.assertIn('"MATTING_CPU_THREADS", "2"', service)
        self.assertIn('"MATTING_REFINE_MAX_PIXELS", "1500000"', service)
        self.assertIn('providers=["CPUExecutionProvider"]', service)
        self.assertIn("ORT_SEQUENTIAL", service)
        self.assertIn("birefnet-general", service)
        self.assertIn("estimate_alpha_cf", service)
        self.assertIn("estimate_foreground_ml", service)
        for dependency in ("onnxruntime", "pymatting", "numpy", "scipy"):
            self.assertIn(dependency, self.requirements)

    def test_refinement_size_cap_preserves_aspect_ratio(self):
        width, height = _scaled_size((8000, 4000), 1_500_000)
        self.assertLessEqual(width * height, 1_510_000)
        self.assertAlmostEqual(width / height, 2.0, places=2)
        self.assertEqual(_scaled_size((1000, 500), 1_500_000), (1000, 500))

    def test_existing_transparency_cannot_be_resurrected(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine = BiRefNetMattingEngine(model_dir=tmp)
            source = Image.new("RGBA", (2, 1), (255, 0, 0, 255))
            source.putpixel((0, 0), (255, 0, 0, 0))
            alpha = Image.new("L", source.size, 255)
            result = engine._apply_alpha(source, alpha)
            self.assertEqual(result.getpixel((0, 0))[3], 0)
            self.assertEqual(result.getpixel((1, 0))[3], 255)

    def test_concurrent_jobs_serialize_numba_alpha_refinement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_path = root / "source.png"
            Image.new("RGB", (8, 8), (200, 100, 50)).save(source_path)
            engine = BiRefNetMattingEngine(model_dir=tmp)
            prediction_barrier = threading.Barrier(2, timeout=5)
            state_lock = threading.Lock()
            state = {"active_refinements": 0, "peak_refinements": 0}

            def predict(image):
                prediction_barrier.wait()
                return Image.new("L", image.size, 255)

            def refine(image, mask):
                with state_lock:
                    state["active_refinements"] += 1
                    state["peak_refinements"] = max(
                        state["peak_refinements"],
                        state["active_refinements"],
                    )
                try:
                    time.sleep(0.05)
                    return image.convert("RGBA")
                finally:
                    with state_lock:
                        state["active_refinements"] -= 1

            with (
                mock.patch.object(engine, "_predict_mask", side_effect=predict),
                mock.patch.object(engine, "_refine", side_effect=refine),
                concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor,
            ):
                futures = [
                    executor.submit(
                        engine.remove_background,
                        str(source_path),
                        str(root / f"output-{index}.png"),
                    )
                    for index in range(2)
                ]
                for future in futures:
                    future.result(timeout=10)

            self.assertEqual(1, state["peak_refinements"])

    def test_javascript_syntax(self):
        result = subprocess.run(
            ["node", "--check", str(HOST_SCRIPT)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        module_result = subprocess.run(
            ["node", "--check", str(MATTING_MODULE)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(module_result.returncode, 0, module_result.stderr)


if __name__ == "__main__":
    unittest.main()
