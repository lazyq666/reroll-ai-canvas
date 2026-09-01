import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.prompt_library import PromptLibraryStorage
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage, WorkspaceStorageError


class PromptLibraryStorageTests(unittest.TestCase):
    @staticmethod
    def _storage(root: Path) -> tuple[PromptLibraryStorage, Path]:
        workspace = root / "workspace"
        (workspace / "data").mkdir(parents=True)
        (workspace / "assets").mkdir()
        selection = WorkspaceStorage(
            root / "project",
            state_dir=root / "state",
        )
        selection.save_parent(workspace)
        current = WorkspaceService(selection).current()
        return PromptLibraryStorage(current), workspace

    def test_new_layout_keeps_data_and_deduplicated_covers_together(self):
        with tempfile.TemporaryDirectory() as temporary:
            storage, workspace = self._storage(Path(temporary))
            content = b"prompt-cover-image"

            first = storage.import_cover_bytes(
                content,
                name="Cover.PNG",
                content_type="image/png",
            )
            second = storage.import_cover_bytes(
                content,
                name="same.png",
                content_type="image/png",
            )
            storage.save({"libraries": [], "updated_at": 1})

            self.assertEqual(first["url"], second["url"])
            self.assertEqual(
                (
                    workspace
                    / "data"
                    / "prompt-libraries"
                    / "prompt_libraries.json"
                ).resolve(),
                storage.data_file,
            )
            self.assertTrue(storage.data_file.is_file())
            covers = list(storage.covers_directory.iterdir())
            self.assertEqual(len(covers), 1)
            self.assertEqual(content, covers[0].read_bytes())
            self.assertFalse((workspace / "assets" / "input").exists())

    def test_legacy_layout_migrates_json_and_available_cover_with_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            storage, workspace = self._storage(Path(temporary))
            imported = workspace / "assets" / "input" / "imported"
            imported.mkdir(parents=True)
            legacy_cover = imported / "old-cover.png"
            legacy_cover.write_bytes(b"legacy-cover")
            legacy = {
                "active_library_id": "system",
                "libraries": [{
                    "id": "system",
                    "items": [
                        {
                            "id": "with-cover",
                            "cover": "/assets/input/imported/old-cover.png",
                        },
                        {
                            "id": "missing-cover",
                            "cover": "/assets/input/imported/missing.png",
                        },
                        {
                            "id": "remote-cover",
                            "cover": "https://example.com/cover.png",
                        },
                    ],
                }],
            }
            legacy_bytes = json.dumps(legacy, ensure_ascii=False).encode()
            storage.legacy_data_file.write_bytes(legacy_bytes)

            self.assertTrue(storage.migrate_legacy_layout())
            migrated = storage.load()
            items = migrated["libraries"][0]["items"]

            self.assertTrue(
                items[0]["cover"].startswith(
                    "/api/prompt-libraries/covers/"
                )
            )
            filename = items[0]["cover"].rsplit("/", 1)[-1]
            cover_path, content_type = storage.resolve_cover(filename)
            self.assertEqual(b"legacy-cover", cover_path.read_bytes())
            self.assertEqual("image/png", content_type)
            self.assertEqual(
                "/assets/input/imported/missing.png",
                items[1]["cover"],
            )
            self.assertEqual(
                "https://example.com/cover.png",
                items[2]["cover"],
            )
            self.assertFalse(storage.legacy_data_file.exists())
            recovery = list(storage.recovery_directory.glob("*.json"))
            self.assertEqual(len(recovery), 1)
            self.assertEqual(legacy_bytes, recovery[0].read_bytes())
            manifest = json.loads(storage.migration_manifest.read_text())
            self.assertEqual(1, manifest["migrated_covers"])
            self.assertEqual(
                ["/assets/input/imported/missing.png"],
                manifest["missing_covers"],
            )
            self.assertTrue(legacy_cover.exists())
            self.assertFalse(storage.migrate_legacy_layout())

    def test_invalid_legacy_json_is_preserved_without_publishing_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            storage, _workspace = self._storage(Path(temporary))
            storage.legacy_data_file.write_text("{invalid", encoding="utf-8")

            with self.assertRaises(WorkspaceStorageError):
                storage.migrate_legacy_layout()

            self.assertEqual(
                "{invalid",
                storage.legacy_data_file.read_text(encoding="utf-8"),
            )
            self.assertFalse(storage.data_file.exists())
            self.assertFalse(storage.migration_manifest.exists())

    def test_migration_failure_before_publication_keeps_legacy_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            storage, _workspace = self._storage(Path(temporary))
            legacy = {"libraries": [], "updated_at": 1}
            storage.legacy_data_file.write_text(
                json.dumps(legacy),
                encoding="utf-8",
            )
            atomic_write = storage._atomic_write

            def fail_manifest(path, content):
                if path == storage.migration_manifest:
                    raise OSError("simulated manifest failure")
                atomic_write(path, content)

            with patch.object(
                storage,
                "_atomic_write",
                side_effect=fail_manifest,
            ):
                with self.assertRaises(OSError):
                    storage.migrate_legacy_layout()

            self.assertTrue(storage.legacy_data_file.is_file())
            self.assertFalse(storage.data_file.exists())
            recovery_payloads = [
                json.loads(path.read_text())
                for path in storage.recovery_directory.glob("*.json")
            ]
            self.assertEqual(
                [legacy],
                recovery_payloads,
            )

            self.assertTrue(storage.migrate_legacy_layout())
            self.assertEqual(legacy, storage.load())

    def test_cover_resolution_rejects_non_digest_and_path_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            storage, _workspace = self._storage(Path(temporary))
            for value in (
                "cover.png",
                "../cover.png",
                "%2e%2e%2fcover.png",
                "a" * 64 + ".txt",
            ):
                with self.subTest(value=value):
                    with self.assertRaises(WorkspaceStorageError):
                        storage.resolve_cover(value)


if __name__ == "__main__":
    unittest.main()
