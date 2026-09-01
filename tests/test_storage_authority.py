import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.storage_authority import (
    StorageAuthorityError,
    resolve_storage_authority,
)
from infinite_canvas.workspace_storage_composition import (
    WorkspaceStorageCompositionError,
)
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)


class StorageAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "storage-authority.json"

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, **overrides):
        payload = {
            "schema_version": 1,
            "workspace_id": "workspace-1",
            "migration_id": "migration-2026-08-17",
            "canvas": "sqlite",
            "generation_runs": "sqlite",
        }
        payload.update(overrides)
        self.path.write_text(json.dumps(payload), encoding="utf-8")

    def test_missing_manifest_keeps_json_authority(self):
        authority = resolve_storage_authority(self.path, "workspace-1")

        self.assertEqual(authority.mode, "json")
        self.assertFalse(authority.explicit)
        self.assertEqual(authority.workspace_id, "workspace-1")

    def test_complete_sqlite_declaration_can_be_selected_when_supported(self):
        self.write()

        authority = resolve_storage_authority(
            self.path,
            "workspace-1",
            supported_modes=("sqlite",),
        )

        self.assertEqual(authority.mode, "sqlite")
        self.assertTrue(authority.explicit)
        self.assertEqual(authority.migration_id, "migration-2026-08-17")

    def test_mixed_authority_is_rejected(self):
        self.write(generation_runs="json")

        with self.assertRaisesRegex(StorageAuthorityError, "不同"):
            resolve_storage_authority(
                self.path,
                "workspace-1",
                supported_modes=("json", "sqlite"),
            )

    def test_foreign_or_malformed_manifest_never_falls_back(self):
        cases = (
            ("not-json", "有效 JSON"),
            (json.dumps([]), "根节点"),
            (
                json.dumps(
                    {
                        "schema_version": 2,
                        "workspace_id": "workspace-1",
                    }
                ),
                "schema_version",
            ),
            (
                json.dumps(
                    {
                        "schema_version": 1,
                        "workspace_id": "workspace-2",
                        "migration_id": "migration-1",
                        "canvas": "json",
                        "generation_runs": "json",
                    }
                ),
                "不属于",
            ),
        )
        for payload, message in cases:
            with self.subTest(message=message):
                self.path.write_text(payload, encoding="utf-8")
                with self.assertRaisesRegex(StorageAuthorityError, message):
                    resolve_storage_authority(self.path, "workspace-1")

    def test_unsupported_sqlite_authority_fails_closed(self):
        self.write()

        with self.assertRaisesRegex(StorageAuthorityError, "拒绝部分启动"):
            resolve_storage_authority(self.path, "workspace-1")

    def test_unreadable_manifest_path_does_not_fall_back(self):
        self.path.mkdir()

        with self.assertRaisesRegex(StorageAuthorityError, "无法读取"):
            resolve_storage_authority(self.path, "workspace-1")


class StorageAuthorityStartupTests(unittest.TestCase):
    def test_main_checks_authority_before_legacy_canvas_migration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            state = root / "state"
            configure_test_workspace(workspace, state)
            previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            try:
                import main

                manifest = main.current_workspace_content().storage_authority
                manifest.write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "workspace_id": main.current_workspace_id(),
                            "migration_id": "migration-startup-check",
                            "canvas": "sqlite",
                            "generation_runs": "sqlite",
                        }
                    ),
                    encoding="utf-8",
                )
                with patch.object(main, "migrate_all_canvas_access") as migrate:
                    with self.assertRaisesRegex(
                        WorkspaceStorageCompositionError,
                        "缺少 Canvas 或 Generation Run 数据库",
                    ):
                        main._prepare_startup_state()
                migrate.assert_not_called()
            finally:
                unload_main()
                if previous_state is None:
                    os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
                else:
                    os.environ["INFINITE_CANVAS_STATE_DIR"] = previous_state
                ensure_test_workspace()


if __name__ == "__main__":
    unittest.main()
