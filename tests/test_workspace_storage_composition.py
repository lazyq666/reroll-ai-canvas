import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.content import WorkspaceContent
from infinite_canvas.sqlite_authority_publish import publish_sqlite_authority
from infinite_canvas.sqlite_migration import prepare_sqlite_migration
from infinite_canvas.workspace import Workspace
from infinite_canvas.workspace_storage_composition import compose_workspace_storage


class WorkspaceStorageCompositionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "workspace"
        self.data = self.root / "data"
        self.assets = self.root / "assets"
        self.data.mkdir(parents=True)
        self.assets.mkdir(parents=True)
        self.content = WorkspaceContent(
            Workspace(
                directory=self.root,
                _records_directory=self.data,
                _media_directory=self.assets,
            )
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_json_authority_does_not_construct_or_create_sqlite_stores(self):
        composition = compose_workspace_storage(
            self.content,
            workspace_id="workspace-1",
        )

        self.assertEqual("json", composition.mode)
        self.assertIsNone(composition.canvas_store)
        self.assertIsNone(composition.generation_run_store)
        self.assertFalse(self.content.canvas_content.exists())
        self.assertFalse(self.content.generation_run_store.exists())
        self.assertFalse(composition.sqlite_ready)

    def test_sqlite_authority_constructs_both_verified_stores_together(self):
        canvases = self.data / "canvases"
        canvases.mkdir()
        (canvases / "canvas-1.json").write_text(
            json.dumps(
                {
                    "id": "canvas-1",
                    "kind": "smart",
                    "title": "组合根画布",
                    "owner_id": "designer-1",
                    "owner_username": "designer",
                    "visibility": "shared",
                    "nodes": [],
                    "connections": [],
                }
            ),
            encoding="utf-8",
        )
        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-storage-composition",
        )
        publish_sqlite_authority(self.content, prepared)

        composition = compose_workspace_storage(
            self.content,
            workspace_id="workspace-1",
        )

        self.assertEqual("sqlite", composition.mode)
        self.assertTrue(composition.sqlite_ready)
        self.assertIsNotNone(composition.canvas_store)
        self.assertIsNotNone(composition.generation_run_store)
        self.assertTrue(composition.canvas_store.integrity()["ok"])
        self.assertTrue(composition.generation_run_store.integrity()["ok"])


if __name__ == "__main__":
    unittest.main()
