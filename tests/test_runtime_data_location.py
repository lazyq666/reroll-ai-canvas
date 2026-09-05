import tempfile
import unittest
from pathlib import Path

from infinite_canvas.artifacts import WorkspaceArtifacts
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.device_cache import DeviceCache
from infinite_canvas.device_state import DeviceState
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage


ROOT = Path(__file__).resolve().parents[1]


class RuntimeDataLocationTests(unittest.TestCase):
    def test_runtime_state_uses_workspace_but_secrets_stay_device_local(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            state = root / "state"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir()
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.save_parent(workspace)
            selected = WorkspaceService(storage).current()
            workspace = workspace.resolve()
            content = WorkspaceContent(selected)
            artifacts = WorkspaceArtifacts(selected)
            device = DeviceState(state)
            cache = DeviceCache(root / "cache")

            self.assertTrue(
                content.smart_canvases.is_relative_to(workspace)
            )
            self.assertEqual(
                content.canvas_content,
                workspace / "data" / "canvas-content.sqlite3",
            )
            self.assertEqual(
                content.generation_run_store,
                workspace / "data" / "generation-runs.sqlite3",
            )
            self.assertEqual(
                content.storage_authority,
                workspace / "data" / "storage-authority.json",
            )
            self.assertTrue(
                artifacts.generation_outputs.is_relative_to(workspace)
            )
            self.assertFalse(
                device.provider_credentials.is_relative_to(workspace)
            )
            self.assertFalse(
                cache.media_previews.is_relative_to(workspace)
            )
            self.assertFalse(cache.models.is_relative_to(workspace))
            self.assertEqual(
                cache.image_processor_models,
                (root / "cache" / "models" / "image-processors").resolve(),
            )
            self.assertEqual(
                cache.image_processor_results,
                (root / "cache" / "image-processor-results").resolve(),
            )
            self.assertFalse(
                cache.canvas_list_index("workspace-a").is_relative_to(workspace)
            )
            self.assertNotEqual(
                cache.canvas_list_index("workspace-a"),
                cache.canvas_list_index("workspace-b"),
            )

    def test_workspace_resources_and_user_workflows_are_separate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir()
            storage = WorkspaceStorage(
                ROOT,
                state_dir=root / "state",
            )
            storage.save_parent(workspace)
            workflows = WorkspaceContent(
                WorkspaceService(storage).current()
            ).user_workflows
            workspace = workspace.resolve()

            self.assertTrue(workflows.is_relative_to(workspace))
            self.assertNotEqual(
                (ROOT / "resources" / "workflows").resolve(),
                workflows,
            )


if __name__ == "__main__":
    unittest.main()
