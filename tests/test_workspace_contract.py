import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.artifacts import WorkspaceArtifacts
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage


class WorkspaceContractTests(unittest.TestCase):
    def test_legacy_environment_and_source_directories_do_not_select_workspace(
        self,
    ):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "project"
            state = root / "state"
            legacy_data = project / "data"
            legacy_assets = project / "assets"
            legacy_data.mkdir(parents=True)
            legacy_assets.mkdir()
            storage = WorkspaceStorage(project, state_dir=state)

            with patch.dict(
                os.environ,
                {
                    "INFINITE_CANVAS_DATA_DIR": str(legacy_data),
                    "INFINITE_CANVAS_ASSETS_DIR": str(legacy_assets),
                    "AUTH_DB_PATH": str(root / "legacy-auth.db"),
                },
            ):
                workspace, error = WorkspaceService(storage).try_current()

            self.assertIsNone(workspace)
            self.assertIn("尚未选择工作区目录", error)
            self.assertFalse(storage.settings_file.exists())

    def test_missing_selection_stays_missing_without_blank_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing = root / "moved-workspace"
            storage = WorkspaceStorage(
                root / "project",
                state_dir=root / "state",
            )
            storage.remember_parent(missing)

            workspace, error = WorkspaceService(storage).try_current()

            self.assertIsNone(workspace)
            self.assertIn("不可访问", error)
            self.assertFalse(missing.exists())
            self.assertEqual(
                missing.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )

    def test_user_facing_failures_use_workspace_language(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ordinary = root / "ordinary"
            ordinary.mkdir()
            (ordinary / "notes.txt").write_text("keep", encoding="utf-8")
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "state")
            )
            messages = [
                service.inspect("").message,
                service.inspect(ordinary).message,
            ]
            exposed = re.compile(
                r"(?i)(?:\bdata\b|\bassets\b|父目录|数据目录|素材目录|"
                r"数据库锁|database\s+lock|db\s+lock)"
            )

            self.assertEqual(
                [],
                [message for message in messages if exposed.search(message)],
            )

    def test_update_contract_excludes_workspace_and_local_secrets(self):
        for path in (
            "data/auth.db",
            "data/api_providers.json",
            "assets/output/result.png",
            "api.env",
            "provider-connections.json",
            "local-state/workspace-storage.json",
            "API/.env",
        ):
            with self.subTest(path=path):
                self.assertFalse(
                    WorkspaceArtifacts.is_update_backup_file(path)
                )


if __name__ == "__main__":
    unittest.main()
