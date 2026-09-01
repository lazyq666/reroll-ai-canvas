import re
import subprocess
import unittest
from collections import defaultdict
from pathlib import Path

from tests.smart_canvas_test_support import SMART_CANVAS_SCRIPT_PATHS


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasModuleLoadingTests(unittest.TestCase):
    def test_every_smart_canvas_script_is_valid_javascript(self):
        for relative_path in SMART_CANVAS_SCRIPT_PATHS:
            with self.subTest(script=relative_path.as_posix()):
                result = subprocess.run(
                    ["node", "--check", str(relative_path)],
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_html_load_order_matches_declared_module_order(self):
        page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        positions = []
        for relative_path in SMART_CANVAS_SCRIPT_PATHS:
            public_path = f"/{relative_path.as_posix()}"
            positions.append(page.index(public_path))
        self.assertEqual(positions, sorted(positions))

    def test_classic_scripts_do_not_redeclare_top_level_identifiers(self):
        declarations = defaultdict(list)
        pattern = re.compile(
            r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("
            r"|^(?:let|const|var|class)\s+([A-Za-z_$][\w$]*)\b",
            re.MULTILINE,
        )
        for relative_path in SMART_CANVAS_SCRIPT_PATHS:
            source = (ROOT / relative_path).read_text(encoding="utf-8")
            for match in pattern.finditer(source):
                declarations[match.group(1) or match.group(2)].append(relative_path.as_posix())
        duplicates = {
            name: paths
            for name, paths in declarations.items()
            if len(paths) > 1
        }
        self.assertEqual(duplicates, {})


if __name__ == "__main__":
    unittest.main()
