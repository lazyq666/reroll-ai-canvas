import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "static" / "js" / "infinite-canvas-ui" / "VERSION"
SYNC_SCRIPT = ROOT / "scripts" / "sync_infinite_canvas_ui_version.py"
VERSIONED_MODULE_PATTERN = re.compile(
    r"(?P<specifier>(?:/static/js/infinite-canvas-ui/|\.\.?/)"
    r"[^\"'`\s?<>]+\.js)\?v=(?P<version>[^\"'`\s)<>;]+)"
)
SOURCE_SUFFIXES = {".html", ".js", ".py"}


def is_ui_module_reference(path, match):
    specifier = match.group("specifier")
    if specifier.startswith("/static/js/infinite-canvas-ui/"):
        return True
    ui_root = ROOT / "static" / "js" / "infinite-canvas-ui"
    if not path.is_relative_to(ui_root):
        return False
    return (path.parent / specifier).resolve().is_relative_to(ui_root)


def ui_version_references():
    references = []
    for directory in (ROOT / "static", ROOT / "backend", ROOT / "tests"):
        for path in directory.rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            source = path.read_text(encoding="utf-8")
            for match in VERSIONED_MODULE_PATTERN.finditer(source):
                if is_ui_module_reference(path, match):
                    references.append((path, match.group("version")))
    return references


class InfiniteCanvasUiAssetVersionTests(unittest.TestCase):
    def test_every_ui_module_reference_uses_the_canonical_version(self):
        expected = VERSION_FILE.read_text(encoding="utf-8").strip()
        references = ui_version_references()

        self.assertTrue(expected)
        self.assertGreater(len(references), 100)
        mismatches = [
            f"{path.relative_to(ROOT)}: {version}"
            for path, version in references
            if version != expected
        ]
        self.assertEqual([], mismatches)

    def test_generated_version_and_references_are_current(self):
        result = subprocess.run(
            [sys.executable, str(SYNC_SCRIPT), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
