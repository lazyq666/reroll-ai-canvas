import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.generation_run_store import (
    GenerationRunAttempt,
    GenerationRunState,
    SqliteGenerationRunStore,
)
from infinite_canvas.generation_runs import GenerationRuns
from infinite_canvas.sqlite_legacy_export import (
    SqliteLegacyExportError,
    export_sqlite_to_legacy,
)


class SqliteLegacyExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.canvas_database = self.root / "canvas-content.sqlite3"
        self.run_database = self.root / "generation-runs.sqlite3"
        self.export_directory = self.root / "legacy-export"
        self.actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "admin",
            "status": "active",
        }
        self.canvas_store = SqliteCanvasStore(
            self.canvas_database,
            workspace_id="workspace-1",
        )
        self.run_store = SqliteGenerationRunStore(
            self.run_database,
            workspace_id="workspace-1",
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_exports_canvas_connections_and_composer_visible_media_to_legacy_json(self):
        document = {
            "id": "canvas-1",
            "kind": "smart",
            "title": "可回退画布",
            "owner_id": "designer-1",
            "owner_username": "designer",
            "visibility": "private",
            "project": "project-a",
            "revision": 9,
            "nodes": [
                {
                    "id": "source-1",
                    "type": "smart-image",
                    "images": [{"url": "/assets/input/reference.png"}],
                },
                {
                    "id": "result-1",
                    "type": "smart-image",
                    "generationOutputNode": True,
                    "images": [{"url": "/assets/output/result.png"}],
                    "generationInputSnapshot": {
                        "prompt": "冻结的构图 Prompt",
                        "refs": [
                            {
                                "url": "/assets/input/reference.png",
                                "role": "image_1",
                            }
                        ],
                        "settings": {"model": "image-model-a"},
                    },
                },
            ],
            "connections": [
                {"from": "source-1", "to": "result-1", "kind": "input"}
            ],
            "settings": {"snapToGrid": True},
        }
        self.canvas_store.commit(
            "canvas-1",
            self.actor,
            CanvasIntent.import_canvas(
                document,
                operation_id="migration:legacy-export-canvas-1",
            ),
        )

        exported = export_sqlite_to_legacy(
            self.canvas_database,
            self.run_database,
            workspace_id="workspace-1",
            destination=self.export_directory,
        )

        canvas_path = self.export_directory / "data" / "canvases" / "canvas-1.json"
        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        self.assertTrue(exported.ok)
        self.assertEqual(1, exported.canvas_count)
        self.assertEqual(9, canvas["revision"])
        self.assertEqual(document["nodes"], canvas["nodes"])
        self.assertEqual(document["connections"], canvas["connections"])
        self.assertEqual({"snapToGrid": True}, canvas["settings"])
        self.assertNotIn("_realtime", canvas)
        self.assertEqual(
            {"version": 1, "runs": []},
            json.loads(
                (self.export_directory / "data" / "generation-runs.json").read_text(
                    encoding="utf-8"
                )
            ),
        )

    def test_exports_unfinished_generation_run_state_needed_by_legacy_recovery(self):
        self.run_store.save(
            GenerationRunState(
                run_id="run-active-1",
                kind="image",
                status="pending",
                phase="provider_submitted",
                owner="designer-1",
                key="request-key-1",
                request_hash="request-sha256",
                provider_id="provider-a",
                created_at=100.0,
                updated_at=105.0,
                request={
                    "prompt": "继续生成",
                    "references": [
                        {"url": "/assets/input/reference.png", "kind": "image"}
                    ],
                },
                effect_context={"publication": "online-image"},
                target={
                    "canvas_id": "canvas-1",
                    "node_id": "pending-node-1",
                    "operation_id": "generation-operation-1",
                    "request_index": 0,
                },
                public_metadata={"model": "image-model-a"},
                recoverable=True,
                attempts=(
                    GenerationRunAttempt(
                        attempt_index=0,
                        status="pending",
                        provider_id="provider-a",
                        remote_ref="remote-task-1",
                        payload={"prompt_index": 0},
                        updated_at=105.0,
                    ),
                ),
                remote_refs=(("provider-a", "remote-task-1"),),
            )
        )

        exported = export_sqlite_to_legacy(
            self.canvas_database,
            self.run_database,
            workspace_id="workspace-1",
            destination=self.export_directory,
        )

        payload = json.loads(
            (self.export_directory / "data" / "generation-runs.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(1, exported.generation_run_count)
        self.assertEqual(["run-active-1"], [run["id"] for run in payload["runs"]])
        run = payload["runs"][0]
        self.assertEqual("pending", run["status"])
        self.assertEqual("provider_submitted", run["phase"])
        self.assertEqual(
            "/assets/input/reference.png",
            run["request"]["references"][0]["url"],
        )
        self.assertEqual(["remote-task-1"], run["remote_refs"])
        self.assertEqual("remote-task-1", run["child_attempts"][0]["remote_ref"])
        self.assertEqual(0, run["child_attempts"][0]["prompt_index"])
        self.assertFalse(run["effects_done"])
        legacy_reader = GenerationRuns(
            executor=object(),
            effects=object(),
            store_path=lambda: (
                self.export_directory / "data" / "generation-runs.json"
            ),
        )
        recovered = legacy_reader.get("run-active-1", owner="designer-1")
        self.assertEqual("pending", recovered.status)
        self.assertEqual(("remote-task-1",), recovered.remote_refs)

    def test_exports_global_history_and_completed_and_pending_publication_receipts(self):
        self.run_store.save(
            GenerationRunState(
                run_id="run-active-publication",
                kind="video",
                status="pending",
                phase="output_prepared",
                owner="designer-1",
                key="publication-key",
                request_hash="publication-hash",
                provider_id="provider-video",
                created_at=50.0,
                updated_at=55.0,
                request={"prompt": "继续发布"},
                prepared_output={
                    "effects": {
                        "notification": {
                            "type": "video",
                            "videos": ["/assets/output/video.mp4"],
                        }
                    }
                },
                recoverable=True,
            )
        )
        history = {
            "timestamp": 100.0,
            "type": "image",
            "provider_id": "provider-image",
            "model": "image-v2",
            "images": ["/assets/output/result.png"],
        }
        self.run_store.publish_history(
            "run-completed-publication",
            "history-completed-publication",
            history,
        )
        self.run_store.seed_publication_receipt(
            "run-completed-publication",
            "notification",
            completed=True,
        )
        self.run_store.seed_publication_receipt(
            "run-active-publication",
            "notification",
            completed=False,
            payload={
                "type": "video",
                "videos": ["/assets/output/video.mp4"],
            },
        )

        exported = export_sqlite_to_legacy(
            self.canvas_database,
            self.run_database,
            workspace_id="workspace-1",
            destination=self.export_directory,
        )

        history_payload = json.loads(
            (self.export_directory / "data" / "generation-history.json").read_text(
                encoding="utf-8"
            )
        )
        effects_payload = json.loads(
            (self.export_directory / "data" / "generation-effects.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(1, exported.generation_history_count)
        self.assertEqual(3, exported.publication_receipt_count)
        self.assertEqual(
            "history-completed-publication",
            history_payload[0]["history_id"],
        )
        self.assertEqual(
            ["history", "notification"],
            effects_payload["effects"]["run-completed-publication"],
        )
        self.assertEqual(
            ["notification"],
            effects_payload["pending"]["run-active-publication"],
        )

    def test_export_report_verifies_legacy_final_logs_without_absolute_paths(self):
        self.canvas_store.commit(
            "canvas-logs",
            self.actor,
            CanvasIntent.import_canvas(
                {
                    "id": "canvas-logs",
                    "kind": "smart",
                    "title": "日志回退",
                    "owner_id": "designer-1",
                    "owner_username": "designer",
                    "visibility": "shared",
                    "nodes": [],
                    "connections": [],
                },
                operation_id="migration:legacy-export-canvas-logs",
            ),
        )
        self.canvas_store.commit(
            "canvas-logs",
            self.actor,
            CanvasIntent.append_final_log(
                {
                    "id": "log-1",
                    "runId": "run-finished-1",
                    "status": "success",
                    "nodeId": "result-node-1",
                    "platform": "provider-a",
                    "model": "image-model-a",
                    "createdAt": 123,
                    "durationMs": 45,
                    "prompt": "最终 Prompt",
                    "request": {"size": "1024x1024"},
                    "refs": [{"url": "/assets/input/reference.png"}],
                    "outputs": [
                        {
                            "url": "/assets/output/result.png",
                            "kind": "image",
                            "width": 1024,
                            "height": 1024,
                        }
                    ],
                },
                operation_id="log:legacy-export-0001",
            ),
        )

        export_sqlite_to_legacy(
            self.canvas_database,
            self.run_database,
            workspace_id="workspace-1",
            destination=self.export_directory,
        )

        canvas = json.loads(
            (
                self.export_directory
                / "data"
                / "canvases"
                / "canvas-logs.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual("log-1", canvas["logs"][0]["id"])
        self.assertEqual(
            "/assets/output/result.png",
            canvas["logs"][0]["outputs"][0]["url"],
        )
        report = json.loads(
            (self.export_directory / "legacy-export-report.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertTrue(report["verified"])
        self.assertEqual(1, report["canvas_count"])
        self.assertEqual(
            [
                "data/canvases/canvas-logs.json",
                "data/generation-runs.json",
                "data/generation-history.json",
                "data/generation-effects.json",
            ],
            [item["relative_path"] for item in report["files"]],
        )
        self.assertNotIn(str(self.root), json.dumps(report))

    def test_integrity_failure_does_not_publish_a_partial_legacy_package(self):
        connection = sqlite3.connect(self.canvas_database)
        try:
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute(
                """
                INSERT INTO canvas_nodes(canvas_id, node_id, position, payload_json)
                VALUES ('missing-canvas', 'orphan-node', 0, '{}')
                """
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaisesRegex(SqliteLegacyExportError, "完整性"):
            export_sqlite_to_legacy(
                self.canvas_database,
                self.run_database,
                workspace_id="workspace-1",
                destination=self.export_directory,
            )

        self.assertFalse(self.export_directory.exists())
        self.assertEqual([], list(self.root.glob(".legacy-export.*.tmp")))

    def test_repeated_exports_are_byte_identical_and_do_not_touch_source_databases(self):
        source_before = {
            path.name: (path.read_bytes(), path.stat().st_mtime_ns)
            for path in (self.canvas_database, self.run_database)
        }
        destination = self.root / "legacy-export-repeatable"

        export_sqlite_to_legacy(
            self.canvas_database,
            self.run_database,
            workspace_id="workspace-1",
            destination=destination,
        )
        first_files = {
            path.relative_to(destination).as_posix(): path.read_bytes()
            for path in destination.rglob("*")
            if path.is_file()
        }
        export_sqlite_to_legacy(
            self.canvas_database,
            self.run_database,
            workspace_id="workspace-1",
            destination=destination,
        )

        second_files = {
            path.relative_to(destination).as_posix(): path.read_bytes()
            for path in destination.rglob("*")
            if path.is_file()
        }
        self.assertEqual(first_files, second_files)
        self.assertEqual(
            source_before,
            {
                path.name: (path.read_bytes(), path.stat().st_mtime_ns)
                for path in (self.canvas_database, self.run_database)
            },
        )


if __name__ == "__main__":
    unittest.main()
