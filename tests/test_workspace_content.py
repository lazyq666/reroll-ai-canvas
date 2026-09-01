import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.content import WorkspaceContent
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage, WorkspaceStorageError


class WorkspaceContentTests(unittest.TestCase):
    def setUp(self):
        self._environment = patch.dict(
            os.environ,
            {
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
            },
        )
        self._environment.start()

    def tearDown(self):
        self._environment.stop()

    @staticmethod
    def _content(root: Path, name: str) -> WorkspaceContent:
        workspace = root / name
        (workspace / "data").mkdir(parents=True)
        (workspace / "assets").mkdir()
        storage = WorkspaceStorage(
            root / f"{name}-project",
            state_dir=root / f"{name}-state",
        )
        storage.save_parent(workspace)
        return WorkspaceContent(WorkspaceService(storage).current())

    def test_business_content_paths_are_rooted_in_the_selected_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            content = self._content(root, "team-workspace")

            paths = {
                content.smart_canvases,
                content.smart_canvas("canvas-1"),
                content.projects,
                content.generation_history,
                content.generation_runs,
                content.generation_effects,
                content.user_workflows,
                content.user_workflow("workflow.json"),
                content.runninghub_workflows,
                content.prompt_libraries,
            }

            workspace = (root / "team-workspace").resolve()
            self.assertTrue(
                all(path.is_relative_to(workspace) for path in paths)
            )
            self.assertEqual(
                workspace / "data" / "prompt-libraries" / "prompt_libraries.json",
                content.prompt_libraries,
            )
            self.assertEqual(
                workspace / "data" / "prompt-libraries" / "covers",
                content.prompt_library_covers,
            )
            self.assertFalse(
                any(path.is_relative_to(root / "team-workspace-project")
                    for path in paths)
            )

    def test_two_workspaces_keep_the_same_data_format_and_order_isolated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self._content(root, "first")
            second = self._content(root, "second")
            first.ensure_directories()
            second.ensure_directories()
            records = [
                {"id": "newest", "timestamp": 2},
                {"id": "oldest", "timestamp": 1},
            ]
            first.generation_history.write_text(
                json.dumps(records, ensure_ascii=False),
                encoding="utf-8",
            )
            second.generation_history.write_text(
                json.dumps(list(reversed(records)), ensure_ascii=False),
                encoding="utf-8",
            )

            self.assertEqual(
                records,
                json.loads(first.generation_history.read_text()),
            )
            self.assertEqual(
                list(reversed(records)),
                json.loads(second.generation_history.read_text()),
            )

    def test_relative_business_identifiers_cannot_escape_the_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            content = self._content(Path(temporary), "workspace")

            with self.assertRaises(WorkspaceStorageError):
                content.smart_canvas("../outside")
            with self.assertRaises(WorkspaceStorageError):
                content.user_workflow("../outside.json")

if __name__ == "__main__":
    unittest.main()
