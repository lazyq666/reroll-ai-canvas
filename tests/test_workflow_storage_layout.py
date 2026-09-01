import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.workspace import WorkspaceService
from tests.runtime_env import ensure_test_workspace
from infinite_canvas.workspace_storage import WorkspaceStorage

ensure_test_workspace()

import main


class WorkflowStorageLayoutTests(unittest.TestCase):
    def test_builtin_workflows_resolve_to_versioned_resources(self):
        path = Path(main.workflow_path_from_name("Z-Image.json"))

        self.assertEqual(
            (Path(main.BASE_DIR) / "resources" / "workflows" / "Z-Image.json"),
            path,
        )
        self.assertTrue(main.is_builtin_workflow("Z-Image.json"))

    def test_uploaded_workflows_are_created_lazily_in_workspace_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir()
            storage = WorkspaceStorage(
                root / "installation",
                state_dir=root / "state",
            )
            storage.save_parent(workspace)
            service = WorkspaceService(storage)
            user_dir = workspace / "data" / "workflows"
            payload = main.WorkflowUploadRequest(
                name="my-workflow",
                workflow={
                    "1": {
                        "class_type": "SaveImage",
                        "inputs": {},
                    }
                },
            )
            with patch.object(main, "WORKSPACE_SERVICE", service):
                self.assertFalse(user_dir.exists())
                result = main.upload_workflow(payload)
                stored = Path(
                    main.workflow_path_from_name(result["name"])
                )

            self.assertEqual("custom/my-workflow.json", result["name"])
            self.assertEqual(
                (user_dir / "my-workflow.json").resolve(),
                stored,
            )
            self.assertTrue(stored.is_file())

if __name__ == "__main__":
    unittest.main()
