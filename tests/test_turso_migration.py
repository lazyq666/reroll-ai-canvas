import json
import sqlite3
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from infinite_canvas.batch_generation import BatchGeneration
from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.generation_run_store import GenerationRunEffect, SqliteGenerationRunStore
from infinite_canvas.turso_migration import CloudMigrationError, DATABASES, inspect_snapshots, discard_conflicting_effects
from tests.test_canvas_store import ADMIN, sample_canvas
from tests import test_generation_run_store as run_fixtures
from tests.test_turso_stores import no_provider


class TursoMigrationInspectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.canvases = SqliteCanvasStore(self.directory / DATABASES[0], workspace_id="workspace")
        self.runs = SqliteGenerationRunStore(self.directory / DATABASES[1], workspace_id="workspace")
        BatchGeneration(self.directory / DATABASES[2], submit=no_provider)

    def inspect(self):
        return inspect_snapshots(self.directory, workspace_id="workspace")

    def test_complete_empty_snapshots_are_read_only_and_ready(self):
        before = {path.name: path.read_bytes() for path in self.directory.iterdir()}
        report = self.inspect()
        self.assertTrue(report["ready"])
        self.assertFalse(report["authority_changed"])
        self.assertEqual(set(report["databases"]), set(DATABASES))
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.directory.iterdir()})

    def test_a_closed_terminal_run_does_not_block(self):
        run = replace(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run(), status="succeeded")
        self.runs.save(run)
        self.assertTrue(self.inspect()["ready"])

    def seed_conflict(self):
        document = sample_canvas()
        document["nodes"][0]["generationOperationId"] = "operation"
        self.canvases.commit("canvas-1", ADMIN, CanvasIntent.import_canvas(document, operation_id="import:canvas-1"))
        run = replace(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run(), owner=ADMIN["id"])
        base = dict(
            effect_id="effect:generation-1", node_id="node-a", generation_operation_id="operation",
            request_index=0, run_id=run.run_id, node_changes={"images": [{"url": "/assets/output/a.png"}]},
        )
        self.canvases.commit("canvas-1", ADMIN, CanvasIntent.generation_output_commit(
            **base, final_log={"id": "success-log", "status": "success"},
        ))
        run = replace(run, status="failed")
        self.runs.save(run, effect=GenerationRunEffect(
            effect_id="effect:generation-1", run_id=run.run_id, canvas_id="canvas-1", terminal_status="failed",
            payload={
                "node_id": "node-a", "generation_operation_id": "operation", "request_index": 0,
                "node_changes": {"images": [], "pending": 0, "running": False},
                "final_log": {"status": "failed", "error": "private recovery error"},
            },
            created_at=1000,
        ))

    def test_pending_recovery_failure_cannot_override_a_prior_success_at_cutover(self):
        self.seed_conflict()
        before = {path.name: path.read_bytes() for path in self.directory.iterdir()}
        report = self.inspect()
        self.assertFalse(report["ready"])
        self.assertEqual(report["blockers"], [{"code": "pending_generation_effects", "count": 1}])
        self.assertEqual(report["pending_effect_findings"], {
            "previously_resolved": 1, "terminal_outcome_conflict": 1,
        })
        self.assertNotIn("private recovery error", json.dumps(report))
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.directory.iterdir()})

    def test_explicit_discard_archives_failure_and_preserves_successful_canvas_bytes(self):
        self.seed_conflict()
        canvas_before = (self.directory / DATABASES[0]).read_bytes()
        quarantine = self.directory / "quarantine.json"
        report = discard_conflicting_effects(self.directory, workspace_id="workspace", quarantine_file=quarantine)
        self.assertTrue(report["ready"])
        self.assertEqual(report["discarded_effects"], 1)
        self.assertEqual(canvas_before, (self.directory / DATABASES[0]).read_bytes())
        archived = json.loads(quarantine.read_text())
        self.assertEqual(archived["records"][0]["run"]["status"], "failed")
        self.assertEqual(archived["records"][0]["effect"]["state"], "pending")
        with sqlite3.connect(self.directory / DATABASES[1]) as connection:
            self.assertEqual(connection.execute("SELECT state,outcome,payload_json FROM generation_effect_outbox").fetchone(), ("completed", "discarded", None))
            self.assertEqual(connection.execute("SELECT status,phase FROM generation_runs").fetchone(), ("discarded", "finished"))
        connection.close()
        with self.assertRaises(FileExistsError):
            discard_conflicting_effects(self.directory, workspace_id="workspace", quarantine_file=quarantine)

    def test_discard_rejects_a_different_owner_without_changes(self):
        self.seed_conflict()
        with sqlite3.connect(self.directory / DATABASES[1]) as connection:
            connection.execute("UPDATE generation_runs SET owner_id='another-account'")
        connection.close()
        before = (self.directory / DATABASES[1]).read_bytes()
        with self.assertRaisesRegex(CloudMigrationError, "not_safe_to_discard"):
            discard_conflicting_effects(self.directory, workspace_id="workspace", quarantine_file=self.directory / "quarantine.json")
        self.assertEqual(before, (self.directory / DATABASES[1]).read_bytes())
        self.assertFalse((self.directory / "quarantine.json").exists())

    def test_active_work_and_inline_media_block_without_copying_media_into_report(self):
        run = replace(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run(), status="running")
        self.runs.save(run)
        with sqlite3.connect(self.directory / DATABASES[1]) as connection:
            connection.execute(
                "UPDATE generation_run_payloads SET request_json=?",
                (json.dumps({"reference": "data:image/png;base64,c2VjcmV0"}),),
            )
        connection.close()
        report = self.inspect()
        self.assertEqual({entry["code"] for entry in report["blockers"]}, {
            "active_generation_runs", "inline_media_requires_materialization",
        })
        self.assertNotIn("c2VjcmV0", json.dumps(report))

    def test_missing_database_foreign_identity_and_journal_are_rejected(self):
        with self.assertRaisesRegex(CloudMigrationError, "workspace_mismatch"):
            inspect_snapshots(self.directory, workspace_id="wrong")
        journal = self.directory / (DATABASES[0] + "-wal")
        journal.write_bytes(b"")
        with self.assertRaisesRegex(CloudMigrationError, "not_closed"):
            self.inspect()
        journal.unlink()
        (self.directory / DATABASES[2]).unlink()
        with self.assertRaisesRegex(CloudMigrationError, "snapshot_missing"):
            self.inspect()


if __name__ == "__main__":
    unittest.main()
