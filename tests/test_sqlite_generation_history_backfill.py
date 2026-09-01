import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.sqlite_authority_publish import publish_sqlite_authority
from infinite_canvas.sqlite_generation_history_backfill import (
    SqliteGenerationHistoryBackfillError,
    backfill_sqlite_generation_history,
)
from infinite_canvas.sqlite_migration import prepare_sqlite_migration
from infinite_canvas.workspace import Workspace


class SqliteGenerationHistoryBackfillTests(unittest.TestCase):
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
        self.actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "admin",
            "status": "active",
        }
        self._write_canvas("canvas-a", logs=[])
        self._write_canvas("canvas-b", logs=[])
        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="initial-cutover",
        )
        publish_sqlite_authority(self.content, prepared)

    def tearDown(self):
        self.temporary.cleanup()

    def _write_canvas(self, canvas_id, *, logs):
        document = {
            "id": canvas_id,
            "kind": "smart",
            "title": canvas_id,
            "owner_id": "designer-1",
            "owner_username": "designer",
            "visibility": "shared",
            "created_by": "designer-1",
            "updated_by": "designer-1",
            "revision": 2,
            "nodes": [{"id": "node-1", "type": "smart-image"}],
            "connections": [],
            "logs": logs,
        }
        (self.canvases / f"{canvas_id}.json").write_text(
            json.dumps(document),
            encoding="utf-8",
        )

    def test_backfills_after_old_cutover_with_backup_audit_and_one_shot_marker(self):
        self._write_canvas(
            "canvas-a",
            logs=[
                {
                    "id": "copied-log",
                    "generationRunId": "copied-run",
                    "status": "success",
                    "createdAt": 100,
                    "prompt": "first",
                },
                {
                    "id": "second-log",
                    "generationRunId": "copied-run",
                    "status": "failed",
                    "createdAt": 200,
                    "prompt": "second",
                    "error": "legacy failure",
                },
            ],
        )
        self._write_canvas(
            "canvas-b",
            logs=[
                {
                    "id": "copied-log",
                    "generationRunId": "other-run",
                    "status": "success",
                    "createdAt": 300,
                    "prompt": "third",
                }
            ],
        )
        conflict_copy = json.loads(
            (self.canvases / "canvas-a.json").read_text(encoding="utf-8")
        )
        conflict_copy["logs"] = [
            conflict_copy["logs"][0],
            {
                "id": "conflict-copy-only-log",
                "generationRunId": "conflict-copy-only-run",
                "status": "success",
                "createdAt": 350,
                "prompt": "from device conflict copy",
            },
        ]
        (self.canvases / "canvas-a-other-device.json").write_text(
            json.dumps(conflict_copy),
            encoding="utf-8",
        )
        store = SqliteCanvasStore(
            self.content.canvas_content,
            workspace_id="workspace-1",
        )
        store.commit(
            "canvas-a",
            self.actor,
            CanvasIntent.append_final_log(
                {
                    "id": "post-cutover-log",
                    "runId": "post-cutover-run",
                    "status": "success",
                    "createdAt": 400,
                    "prompt": "new",
                },
                operation_id="post-cutover-log-operation",
            ),
        )

        result = backfill_sqlite_generation_history(
            self.content,
            workspace_id="workspace-1",
            migration_id="legacy-history-backfill-1",
        )

        self.assertTrue(result.ok)
        self.assertEqual(4, result.source_log_count)
        self.assertEqual(1, result.starting_log_count)
        self.assertEqual(4, result.imported_log_count)
        self.assertEqual(5, result.final_log_count)
        self.assertTrue(
            result.recovery_directory.joinpath(
                "canvas-content.before.sqlite3"
            ).is_file()
        )
        report = json.loads(result.report.read_text(encoding="utf-8"))
        self.assertEqual("complete", report["status"])
        self.assertEqual(1, report["remapped_log_id_count"])
        self.assertEqual(1, report["duplicate_run_id_count"])
        self.assertEqual(1, report["duplicate_source_log_count"])
        self.assertFalse(report["storage_authority_changed"])
        self.assertEqual(5, store.integrity()["counts"]["logs"])

        with self.assertRaises(SqliteGenerationHistoryBackfillError):
            backfill_sqlite_generation_history(
                self.content,
                workspace_id="workspace-1",
                migration_id="legacy-history-backfill-repeat",
            )
        self.assertEqual(5, store.integrity()["counts"]["logs"])

    def test_rejects_path_like_migration_id_before_creating_recovery(self):
        with self.assertRaises(SqliteGenerationHistoryBackfillError):
            backfill_sqlite_generation_history(
                self.content,
                workspace_id="workspace-1",
                migration_id="../escape",
            )
        self.assertFalse(self.data.joinpath("escape").exists())


if __name__ == "__main__":
    unittest.main()
