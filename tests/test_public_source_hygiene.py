import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TASK_ID = re.compile(r"(?<![A-Za-z0-9])[Tt]\d{2,3}(?![A-Za-z0-9])")
LINE_ANCHOR_PLACEHOLDER = re.compile(
    r"(?:\u4fdd\u7559|\u7a33\u5b9a).{0,30}(?:\u884c\u4f4d|\u884c\u53f7|\u6e90\u7801\u884c|\u951a\u70b9)|"
    r"(?:line|source).{0,20}(?:anchor|position)",
    re.IGNORECASE,
)


class PublicSourceHygieneTests(unittest.TestCase):
    def test_runtime_code_has_no_historical_task_number_identity(self):
        excluded_files = {
            ROOT / "static/css/api-settings-t18.css",
            ROOT / "static/css/api-settings-t19.css",
        }
        excluded_directories = {
            ROOT / "static/design-system",
            ROOT / "static/prototypes",
        }
        allowed_api_stylesheets = {
            "/static/css/api-settings-t18.css",
            "/static/css/api-settings-t19.css",
        }
        violations = []
        for base in (ROOT / "static", ROOT / "scripts"):
            for path in base.rglob("*"):
                if (
                    not path.is_file()
                    or path in excluded_files
                    or "vendor" in path.parts
                    or any(parent in path.parents for parent in excluded_directories)
                ):
                    continue
                if path.suffix not in {".css", ".html", ".js", ".json", ".py"}:
                    continue
                for line_number, line in enumerate(
                    path.read_text(encoding="utf-8").splitlines(), 1
                ):
                    matches = TASK_ID.findall(line)
                    if not matches:
                        continue
                    if path == ROOT / "static/api-settings.html" and any(
                        stylesheet in line for stylesheet in allowed_api_stylesheets
                    ):
                        continue
                    violations.append(
                        f"{path.relative_to(ROOT)}:{line_number}: {', '.join(matches)}"
                    )
        self.assertEqual(violations, [])

    def test_runtime_markup_has_no_source_line_placeholders(self):
        violations = []
        for path in (ROOT / "static").rglob("*.html"):
            if "vendor" in path.parts or "prototypes" in path.parts:
                continue
            for line_number, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), 1
            ):
                if LINE_ANCHOR_PLACEHOLDER.search(line):
                    violations.append(f"{path.relative_to(ROOT)}:{line_number}")
        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
