import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.media import WorkspaceMediaService
from infinite_canvas.workspace import WorkspaceMoveExecutor, WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage


class WorkspaceMediaServiceTests(unittest.TestCase):
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
    def _service(root: Path) -> WorkspaceMediaService:
        workspace = root / "workspace"
        (workspace / "data").mkdir(parents=True)
        (workspace / "assets").mkdir()
        storage = WorkspaceStorage(root / "project", state_dir=root / "state")
        storage.save_parent(workspace)
        return WorkspaceMediaService(WorkspaceService(storage).current())

    def test_import_copies_media_before_returning_a_portable_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "outside" / "Camera Clip.MP4"
            source.parent.mkdir()
            source.write_bytes(b"portable-video")
            service = self._service(root)

            imported = service.import_file(source)

            self.assertEqual("video", imported.kind)
            self.assertTrue(imported.url.startswith("/assets/input/imported/"))
            self.assertNotIn(str(source), repr(imported.public()))
            self.assertNotIn("\\", imported.url)
            self.assertEqual(
                b"portable-video",
                service.resolve_reference(imported.url).read_bytes(),
            )

    def test_duplicate_content_reuses_one_managed_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first.png"
            second = root / "second.png"
            first.write_bytes(b"same-image-content")
            second.write_bytes(b"same-image-content")
            service = self._service(root)

            first_import = service.import_file(first)
            second_import = service.import_file(second)

            self.assertEqual(first_import.media_id, second_import.media_id)
            self.assertEqual(first_import.url, second_import.url)
            self.assertEqual(
                1,
                len(list(service.directory.iterdir())),
            )

    def test_reference_survives_workspace_move_and_path_casing_differences(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "photo.JPEG"
            source.write_bytes(b"portable-image")
            service = self._service(root)
            imported = service.import_file(source)
            moved = root / "moved-workspace"
            moved.mkdir()
            WorkspaceMoveExecutor(
                root / "workspace",
                moved,
                operation_id="portable-media",
            ).copy_and_verify()
            storage = WorkspaceStorage(
                root / "other-project",
                state_dir=root / "other-state",
            )
            storage.save_parent(moved)
            moved_service = WorkspaceMediaService(
                WorkspaceService(storage).current()
            )

            cross_system_reference = imported.url.upper().replace("/", "\\")
            resolved = moved_service.resolve_reference(
                cross_system_reference
            )

            self.assertEqual(b"portable-image", resolved.read_bytes())
            self.assertTrue(resolved.is_relative_to(moved.resolve()))


if __name__ == "__main__":
    unittest.main()
