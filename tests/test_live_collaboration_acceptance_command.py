import importlib.util
import os
import subprocess
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
COMMAND = (
    ROOT / "admin-tools" / "多人协作性能测试-macOS.command"
)
SCRIPT = ROOT / "scripts" / "performance" / "run_live_collaboration_acceptance.py"


def _load_acceptance_module():
    spec = importlib.util.spec_from_file_location("live_acceptance", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load live acceptance CLI")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LiveCollaborationAcceptanceCommandTests(unittest.TestCase):
    def test_browser_open_is_nonfatal_and_uses_new_tab(self):
        module = _load_acceptance_module()
        url = "http://127.0.0.1:3001/static/smart-canvas.html?id=canvas-1"

        with mock.patch.object(module.webbrowser, "open", return_value=True) as opener:
            self.assertTrue(module._open_human_canvas(url))

        opener.assert_called_once_with(url, new=2)

        with mock.patch.object(module.webbrowser, "open", side_effect=OSError):
            self.assertFalse(module._open_human_canvas(url))

    def test_command_dry_run_resolves_safe_default_workflow(self):
        environment = os.environ.copy()
        environment.update(
            {
                "INFINITE_CANVAS_NO_PAUSE": "1",
                "INFINITE_CANVAS_ACCEPTANCE_PORT": "3001",
                "INFINITE_CANVAS_ACCEPTANCE_ADMIN_USERNAME": "admin",
                "INFINITE_CANVAS_ACCEPTANCE_CANVAS_ID": "existing-canvas-1",
                "INFINITE_CANVAS_ACCEPTANCE_ROBOT_ROUNDS": "240",
                "INFINITE_CANVAS_ACCEPTANCE_REQUIRE_HUMAN_GENERATION": "1",
                "INFINITE_CANVAS_ACCEPTANCE_CLEANUP_TEST_CANVAS": "0",
            }
        )

        completed = subprocess.run(
            ["bash", str(COMMAND), "--dry-run"],
            cwd=ROOT.parent,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            check=False,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("http://127.0.0.1:3001", completed.stdout)
        self.assertIn("existing-canvas-1", completed.stdout)
        self.assertIn("--robot-count 9", completed.stdout)
        self.assertIn("--robot-rounds 240", completed.stdout)
        self.assertIn("--open-human-canvas", completed.stdout)
        self.assertIn("--require-human-generation", completed.stdout)
        self.assertNotIn("--cleanup-test-canvas", completed.stdout)
        self.assertNotIn("PASSWORD", completed.stdout)

    def test_command_rejects_invalid_yes_no_environment_value(self):
        environment = os.environ.copy()
        environment.update(
            {
                "INFINITE_CANVAS_NO_PAUSE": "1",
                "INFINITE_CANVAS_ACCEPTANCE_PORT": "3001",
                "INFINITE_CANVAS_ACCEPTANCE_ADMIN_USERNAME": "admin",
                "INFINITE_CANVAS_ACCEPTANCE_CANVAS_ID": "existing-canvas-1",
                "INFINITE_CANVAS_ACCEPTANCE_ROBOT_ROUNDS": "120",
                "INFINITE_CANVAS_ACCEPTANCE_REQUIRE_HUMAN_GENERATION": "maybe",
            }
        )

        completed = subprocess.run(
            ["bash", str(COMMAND), "--dry-run"],
            cwd=ROOT.parent,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            check=False,
        )

        self.assertEqual(1, completed.returncode)
        self.assertIn("人工生成选项请输入 y 或 n", completed.stderr)


if __name__ == "__main__":
    unittest.main()
