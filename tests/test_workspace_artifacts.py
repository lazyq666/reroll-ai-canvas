import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.artifacts import WorkspaceArtifacts
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage


class WorkspaceArtifactsTests(unittest.TestCase):
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
    def _artifacts(root: Path, name: str) -> WorkspaceArtifacts:
        workspace = root / name
        (workspace / "data").mkdir(parents=True)
        (workspace / "assets").mkdir()
        storage = WorkspaceStorage(
            root / f"{name}-installation",
            state_dir=root / f"{name}-state",
        )
        storage.save_parent(workspace)
        return WorkspaceArtifacts(WorkspaceService(storage).current())

    def test_artifact_locations_follow_the_selected_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifacts = self._artifacts(root, "team-workspace")
            workspace = (root / "team-workspace").resolve()

            self.assertEqual(
                workspace / "assets",
                artifacts.managed_media,
            )
            self.assertEqual(
                workspace / "assets" / "input",
                artifacts.generation_inputs,
            )
            self.assertEqual(
                workspace / "assets" / "output",
                artifacts.generation_outputs,
            )
            self.assertEqual(
                workspace / "assets" / "uploads",
                artifacts.local_uploads,
            )
            self.assertFalse(hasattr(artifacts, "media_previews"))
            self.assertFalse(hasattr(artifacts, "model_auxiliary"))
            self.assertEqual(
                workspace / "data" / "available_models.json",
                artifacts.available_models,
            )
            self.assertEqual(
                workspace / "data" / "update_staging",
                artifacts.update_staging,
            )
            self.assertEqual(
                workspace / "data" / "update_backups",
                artifacts.update_backups,
            )
            self.assertEqual(
                workspace / "data" / "recovery",
                artifacts.recovery_copies,
            )

    def test_locations_do_not_depend_on_process_or_installation_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifacts = self._artifacts(root, "portable-workspace")
            elsewhere = root / "different-working-directory"
            elsewhere.mkdir()
            original = Path.cwd()
            try:
                os.chdir(elsewhere)
                paths = artifacts.ensure_directories()
            finally:
                os.chdir(original)

            self.assertTrue(
                all(
                    path.is_relative_to(
                        (root / "portable-workspace").resolve()
                    )
                    for path in paths
                )
            )
            self.assertFalse(
                any(
                    path.is_relative_to(
                        (
                            root / "portable-workspace-installation"
                        ).resolve()
                    )
                    for path in paths
                )
            )

    def test_update_backup_allowlist_rejects_workspace_and_device_secrets(self):
        for path in (
            "API/.env",
            "api.env",
            "provider-connections.json",
            "data/auth.db",
            "data/api_providers.json",
            "assets/input/private.png",
            "local-state/workspace-storage.json",
        ):
            with self.subTest(path=path):
                self.assertFalse(
                    WorkspaceArtifacts.is_update_backup_file(path)
                )

        for path in (
            "backend/main.py",
            "backend/infinite_canvas/canvas_sync.py",
            "backend/infinite_canvas/connection_manager.py",
            "backend/infinite_canvas/realtime_presence.py",
            "backend/infinite_canvas/workspace.py",
            "static/index.html",
            "resources/workflows/Z-Image.json",
        ):
            with self.subTest(path=path):
                self.assertTrue(
                    WorkspaceArtifacts.is_update_backup_file(path)
                )

if __name__ == "__main__":
    unittest.main()
