import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.workspace_storage import (
    SETTINGS_VERSION,
    WorkspaceStorage,
    WorkspaceStorageError,
)


class WorkspaceStorageTests(unittest.TestCase):
    def test_unconfigured_source_tree_has_no_implicit_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            storage = WorkspaceStorage(base, state_dir=base / "state")

            with self.assertRaisesRegex(
                WorkspaceStorageError,
                "尚未选择工作区",
            ):
                storage.paths()

            self.assertFalse((base / "data").exists())
            self.assertFalse((base / "assets").exists())

    def test_saved_workspace_selection_is_device_local_and_read_directly(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            state = base / "state"
            target = base / "OneDrive" / "Infinite-Canvas"
            data_dir = target / "data"
            assets_dir = target / "assets"
            data_dir.mkdir(parents=True)
            assets_dir.mkdir()
            storage = WorkspaceStorage(base, state_dir=state)

            paths = storage.save_parent(target)

            self.assertEqual(data_dir.resolve(), paths.data_dir)
            self.assertEqual(assets_dir.resolve(), paths.assets_dir)
            self.assertEqual(
                (state / "workspace-storage.json").resolve(),
                paths.settings_file.resolve(),
            )
            raw = json.loads(paths.settings_file.read_text(encoding="utf-8"))
            self.assertEqual(SETTINGS_VERSION, raw["version"])
            self.assertEqual(str(target.resolve()), raw["parent_dir"])
            self.assertNotIn("data_dir", raw)
            self.assertNotIn("assets_dir", raw)

    def test_parent_directory_creates_children_only_after_explicit_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            parent = base / "OneDrive" / "InfiniteCanvas"
            parent.mkdir(parents=True)
            storage = WorkspaceStorage(base, state_dir=base / "state")

            self.assertFalse((parent / "data").exists())
            self.assertFalse((parent / "assets").exists())
            paths = storage.save_parent(parent)

            self.assertEqual((parent / "data").resolve(), paths.data_dir)
            self.assertEqual((parent / "assets").resolve(), paths.assets_dir)
            self.assertTrue(paths.data_dir.is_dir())
            self.assertTrue(paths.assets_dir.is_dir())
            raw = json.loads(paths.settings_file.read_text(encoding="utf-8"))
            self.assertEqual(SETTINGS_VERSION, raw["version"])
            self.assertEqual(str(parent.resolve()), raw["parent_dir"])

    def test_recovery_reconnect_requires_existing_workspace_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            parent = base / "Synced" / "InfiniteCanvas"
            parent.mkdir(parents=True)
            storage = WorkspaceStorage(base, state_dir=base / "state")

            with self.assertRaisesRegex(
                WorkspaceStorageError,
                "工作区目录.*不存在",
            ):
                storage.reconnect_parent(parent)

            (parent / "data").mkdir()
            (parent / "assets").mkdir()
            paths = storage.reconnect_parent(parent)

            self.assertEqual(paths.data_dir, (parent / "data").resolve())
            self.assertEqual(paths.assets_dir, (parent / "assets").resolve())

    def test_missing_configured_workspace_fails_without_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            state = base / "state"
            state.mkdir()
            missing = base / "missing-workspace"
            (state / "workspace-storage.json").write_text(
                json.dumps(
                    {
                        "version": SETTINGS_VERSION,
                        "parent_dir": str(missing),
                    }
                ),
                encoding="utf-8",
            )
            storage = WorkspaceStorage(base, state_dir=state)

            paths, error = storage.try_paths()

            self.assertIsNone(paths)
            self.assertIn("不存在", error)
            self.assertFalse((base / "data").exists())
            self.assertFalse((base / "assets").exists())
            self.assertFalse((missing / "data").exists())

    def test_configuration_presence_is_independent_of_path_availability(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            state = base / "state"
            state.mkdir()
            storage = WorkspaceStorage(base, state_dir=state)

            self.assertFalse(storage.has_configuration())
            (state / "workspace-storage.json").write_text(
                json.dumps(
                    {
                        "version": SETTINGS_VERSION,
                        "parent_dir": str(base / "missing-workspace"),
                    }
                ),
                encoding="utf-8",
            )

            self.assertTrue(storage.has_configuration())
            paths, _error = storage.try_paths()
            self.assertIsNone(paths)

    def test_rejects_nested_data_and_assets_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = WorkspaceStorage(tmp, state_dir=Path(tmp) / "state")
            root = Path(tmp) / "OneDrive"
            data_dir = root / "data"
            assets_dir = data_dir / "assets"

            with self.assertRaises(WorkspaceStorageError):
                storage.validate_pair(
                    data_dir.resolve(),
                    assets_dir.resolve(),
                    require_existing=False,
                )

if __name__ == "__main__":
    unittest.main()
