import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.content import WorkspaceContent
from infinite_canvas.legacy_generation_archive import LegacyGenerationArchiveError
from infinite_canvas.sqlite_authority_publish import (
    SqliteAuthorityPublishError,
    publish_sqlite_authority,
)
from infinite_canvas.sqlite_migration import prepare_sqlite_migration
from infinite_canvas.storage_authority import resolve_storage_authority
from infinite_canvas.workspace import Workspace


class SqliteAuthorityPublishTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "workspace"
        self.data = self.root / "data"
        self.assets = self.root / "assets"
        self.canvases = self.data / "canvases"
        self.canvases.mkdir(parents=True)
        self.assets.mkdir(parents=True)
        self.content = WorkspaceContent(
            Workspace(
                directory=self.root,
                _records_directory=self.data,
                _media_directory=self.assets,
            )
        )
        self.legacy_canvas = self.canvases / "canvas-1.json"
        self.legacy_canvas.write_text(
            json.dumps(
                {
                    "id": "canvas-1",
                    "kind": "smart",
                    "title": "原子切换画布",
                    "owner_id": "designer-1",
                    "owner_username": "designer",
                    "visibility": "shared",
                    "revision": 3,
                    "nodes": [],
                    "connections": [],
                }
            ),
            encoding="utf-8",
        )
        self.prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-authority-publish",
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_publishes_both_databases_then_one_sqlite_authority_manifest(self):
        published = publish_sqlite_authority(self.content, self.prepared)

        self.assertTrue(published.ok)
        self.assertTrue(self.content.canvas_content.is_file())
        self.assertTrue(self.content.generation_run_store.is_file())
        self.assertTrue(self.content.storage_authority.is_file())
        self.assertTrue(self.legacy_canvas.is_file())
        authority = resolve_storage_authority(
            self.content.storage_authority,
            "workspace-1",
            supported_modes=("sqlite",),
        )
        self.assertEqual("sqlite", authority.mode)
        self.assertEqual("migration-authority-publish", authority.migration_id)
        manifest = json.loads(
            self.content.storage_authority.read_text(encoding="utf-8")
        )
        self.assertEqual("sqlite", manifest["canvas"])
        self.assertEqual("sqlite", manifest["generation_runs"])
        self.assertEqual(64, len(manifest["canvas_sha256"]))
        self.assertEqual(64, len(manifest["generation_runs_sha256"]))
        report = json.loads(published.legacy_export_report.read_text(encoding="utf-8"))
        self.assertTrue(report["verified"])
        self.assertEqual(1, report["canvas_count"])
        publication_intent = json.loads(
            (
                self.data
                / "recovery"
                / "migration-authority-publish"
                / "publication-intent.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual("databases_durable", publication_intent["phase"])

    def test_crash_after_database_placement_keeps_json_then_resumes_manifest_last(self):
        with patch(
            "infinite_canvas.sqlite_authority_publish._write_manifest",
            side_effect=KeyboardInterrupt("simulated process crash"),
        ):
            with self.assertRaises(KeyboardInterrupt):
                publish_sqlite_authority(self.content, self.prepared)

        self.assertTrue(self.content.canvas_content.is_file())
        self.assertTrue(self.content.generation_run_store.is_file())
        self.assertFalse(self.content.storage_authority.exists())
        authority_before_resume = resolve_storage_authority(
            self.content.storage_authority,
            "workspace-1",
        )
        self.assertEqual("json", authority_before_resume.mode)

        resumed = publish_sqlite_authority(self.content, self.prepared)

        self.assertTrue(resumed.ok)
        authority_after_resume = resolve_storage_authority(
            self.content.storage_authority,
            "workspace-1",
            supported_modes=("sqlite",),
        )
        self.assertEqual("sqlite", authority_after_resume.mode)

    def test_staging_changed_after_preparation_keeps_json_authority(self):
        connection = sqlite3.connect(self.prepared.canvas_database)
        try:
            connection.execute(
                "UPDATE canvases SET title = '审计后被改动' WHERE canvas_id = 'canvas-1'"
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaisesRegex(
            SqliteAuthorityPublishError,
            "审计|指纹|变化",
        ):
            publish_sqlite_authority(self.content, self.prepared)

        self.assertFalse(self.content.canvas_content.exists())
        self.assertFalse(self.content.generation_run_store.exists())
        self.assertFalse(self.content.storage_authority.exists())
        self.assertEqual(
            "json",
            resolve_storage_authority(
                self.content.storage_authority,
                "workspace-1",
            ).mode,
        )

    def test_crash_between_database_placements_resumes_missing_half_before_manifest(self):
        real_replace = __import__("os").replace

        def crash_before_run_database(source, destination):
            if Path(destination) == self.content.generation_run_store:
                raise KeyboardInterrupt("simulated crash between database placements")
            return real_replace(source, destination)

        with patch(
            "infinite_canvas.sqlite_authority_publish.os.replace",
            side_effect=crash_before_run_database,
        ):
            with self.assertRaises(KeyboardInterrupt):
                publish_sqlite_authority(self.content, self.prepared)

        self.assertTrue(self.content.canvas_content.is_file())
        self.assertFalse(self.content.generation_run_store.exists())
        self.assertFalse(self.content.storage_authority.exists())
        self.assertEqual(
            "json",
            resolve_storage_authority(
                self.content.storage_authority,
                "workspace-1",
            ).mode,
        )

        resumed = publish_sqlite_authority(self.content, self.prepared)

        self.assertTrue(resumed.ok)
        self.assertTrue(self.content.generation_run_store.is_file())
        self.assertEqual(
            "sqlite",
            resolve_storage_authority(
                self.content.storage_authority,
                "workspace-1",
                supported_modes=("sqlite",),
            ).mode,
        )

    def test_failed_post_manifest_rollback_preserves_sqlite_authority_for_resume(self):
        with (
            patch(
                "infinite_canvas.sqlite_authority_publish.archive_legacy_generation_json",
                side_effect=RuntimeError("archive failed"),
            ),
            patch(
                "infinite_canvas.sqlite_authority_publish.restore_legacy_generation_json",
                side_effect=LegacyGenerationArchiveError("restore failed"),
            ),
        ):
            with self.assertRaisesRegex(
                SqliteAuthorityPublishError,
                "已保留 manifest 与数据库",
            ):
                publish_sqlite_authority(self.content, self.prepared)

        self.assertTrue(self.content.canvas_content.is_file())
        self.assertTrue(self.content.generation_run_store.is_file())
        self.assertTrue(self.content.storage_authority.is_file())
        self.assertEqual(
            "sqlite",
            resolve_storage_authority(
                self.content.storage_authority,
                "workspace-1",
                supported_modes=("sqlite",),
            ).mode,
        )


if __name__ == "__main__":
    unittest.main()
