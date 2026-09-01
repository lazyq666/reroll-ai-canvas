import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/image-studio-geometry.js"


def run_geometry(expression):
    script = (
        f"const geometry = require({json.dumps(str(MODULE))});"
        f"const value = ({expression});"
        "process.stdout.write(JSON.stringify(value));"
    )
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


class ImageStudioGeometryTests(unittest.TestCase):
    def test_module_is_loaded_before_smart_canvas_host(self):
        page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        geometry_index = page.index("/static/js/smart-canvas/image-studio-geometry.js")
        host_index = page.index("/static/js/smart-canvas.js")
        self.assertLess(geometry_index, host_index)

    def test_image_studio_implementation_is_isolated_behind_a_small_interface(self):
        page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        studio_path = ROOT / "static/js/smart-canvas/image-studio.js"
        studio = studio_path.read_text(encoding="utf-8")
        host = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        geometry_index = page.index("/static/js/smart-canvas/image-studio-geometry.js")
        studio_index = page.index("/static/js/smart-canvas/image-studio.js")
        host_index = page.index("/static/js/smart-canvas.js")

        self.assertLess(geometry_index, studio_index)
        self.assertLess(studio_index, host_index)
        self.assertIn("window.SmartCanvasModules.imageStudio = Object.freeze({", studio)
        self.assertIn("open({nodeId, imageIndex=0, mode='preview'", studio)
        self.assertIn("openGroup({group, startNodeId=''", studio)
        self.assertIn("close(){", studio)
        self.assertIn("const imageStudio = window.SmartCanvasModules?.imageStudio;", host)
        self.assertNotIn("function currentEditImage(){", host)

    def test_scale_image_clamps_and_rounds(self):
        self.assertEqual(
            run_geometry("geometry.scaleImage({width:101, height:51, scale:0.333})"),
            {
                "sourceW": 101,
                "sourceH": 51,
                "scale": 0.33,
                "targetW": 33,
                "targetH": 17,
            },
        )
        self.assertEqual(
            run_geometry("geometry.scaleImage({width:0, height:0, scale:9})"),
            {
                "sourceW": 1,
                "sourceH": 1,
                "scale": 1,
                "targetW": 1,
                "targetH": 1,
            },
        )

    def test_regular_and_custom_grid_splitting_preserve_gaps(self):
        regular = run_geometry(
            "geometry.splitGrid({width:100, height:80, rows:2, cols:2, gap:4})"
        )
        self.assertEqual(
            regular,
            [
                {"row": 0, "col": 0, "x": 0, "y": 0, "w": 48, "h": 38},
                {"row": 0, "col": 1, "x": 52, "y": 0, "w": 48, "h": 38},
                {"row": 1, "col": 0, "x": 0, "y": 42, "w": 48, "h": 38},
                {"row": 1, "col": 1, "x": 52, "y": 42, "w": 48, "h": 38},
            ],
        )
        custom = run_geometry(
            "geometry.splitGrid({width:100, height:80, gap:10,"
            "lines:[{type:'v',pos:0.5}]})"
        )
        self.assertEqual(
            custom,
            [
                {"row": 0, "col": 0, "x": 0, "y": 0, "w": 45, "h": 80},
                {"row": 0, "col": 1, "x": 55, "y": 0, "w": 45, "h": 80},
            ],
        )

    def test_crop_fit_and_resize_keep_aspect(self):
        fitted = run_geometry(
            "geometry.fitCrop({bounds:{w:100,h:100},"
            "rect:{x:10,y:10,w:80,h:40},ratio:1})"
        )
        self.assertEqual(fitted, {"x": 30, "y": 10, "w": 40, "h": 40})

        resized = run_geometry(
            "geometry.resizeCrop({bounds:{w:100,h:100},"
            "start:{x:10,y:10,w:40,h:40},dx:20,dy:10,ratio:1,handle:'se'})"
        )
        self.assertEqual(resized, {"x": 10, "y": 10, "w": 50, "h": 50})

    def test_join_layout_uses_stable_order_and_common_cells(self):
        layout = run_geometry(
            "geometry.layoutGrid({"
            "items:[{index:0,w:1000,h:500},{index:1,w:400,h:800}],"
            "order:[1,0],rows:1,cols:2,gap:8})"
        )
        self.assertEqual(layout["rows"], 1)
        self.assertEqual(layout["cols"], 2)
        self.assertEqual(layout["cellW"], 420)
        self.assertEqual(layout["cellH"], 336)
        self.assertEqual(
            layout["items"],
            [
                {"index": 1, "x": 0, "y": 0, "w": 420, "h": 336},
                {"index": 0, "x": 428, "y": 0, "w": 420, "h": 336},
            ],
        )


if __name__ == "__main__":
    unittest.main()
