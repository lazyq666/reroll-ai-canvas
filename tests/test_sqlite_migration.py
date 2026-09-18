import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.canvas_store import (
    CanvasProjection,
    CanvasStoreError,
    SqliteCanvasStore,
)
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.sqlite_migration import (
    normalize_legacy_global_history,
    prepare_sqlite_migration,
)
from infinite_canvas.sqlite_migration import SqliteMigrationError
from infinite_canvas.workspace import Workspace


class SqliteMigrationPreparationTests(unittest.TestCase):
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

    def tearDown(self):
        self.temporary.cleanup()

    @staticmethod
    def canvas(canvas_id="canvas-1", *, visibility="shared"):
        return {
            "id": canvas_id,
            "kind": "smart",
            "title": "迁移画布",
            "owner_id": "designer-1",
            "owner_username": "designer",
            "visibility": visibility,
            "created_by": "designer-1",
            "updated_by": "designer-1",
            "project": "project-a",
            "revision": 7,
            "nodes": [
                {
                    "id": "node-1",
                    "type": "smart-image",
                    "images": [{"url": "/assets/output/one.png"}],
                }
            ],
            "connections": [],
            "logs": [
                {
                    "id": f"{canvas_id}-legacy-log",
                    "generationRunId": f"{canvas_id}-legacy-run",
                    "nodeId": "node-1",
                    "status": "failed",
                    "createdAt": 650,
                    "runMs": 1200,
                    "platform": "legacy-provider",
                    "model": "legacy-model",
                    "prompt": "preserve me",
                    "error": "legacy provider failure",
                }
            ],
            "_realtime": {"history": [{"large": "drop me"}]},
        }

    def write_canvas(self, document):
        path = self.canvases / f"{document['id']}.json"
        path.write_text(json.dumps(document), encoding="utf-8")

    def test_missing_global_history_ids_are_deterministic_and_order_stable(self):
        source = (
            {
                "timestamp": 20,
                "type": "image",
                "images": ["/assets/output/one.png"],
            },
            {
                "timestamp": 20,
                "type": "image",
                "images": ["/assets/output/one.png"],
            },
        )

        first = normalize_legacy_global_history(source)
        repeated = normalize_legacy_global_history(source)

        self.assertEqual(first, repeated)
        self.assertNotEqual(first[0][0], first[1][0])
        self.assertTrue(first[0][0].startswith("legacy-history:"))

    def test_prepares_verified_staging_databases_without_publishing_authority(self):
        self.write_canvas(self.canvas())
        self.write_canvas(self.canvas("private-canvas", visibility="private"))
        self.content.generation_runs.write_text(
            json.dumps(
                {
                    "version": 1,
                    "runs": [
                        {
                            "id": "old-finished-run",
                            "status": "succeeded",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-test-1",
        )

        self.assertTrue(prepared.ok)
        self.assertEqual(prepared.canvas_count, 2)
        self.assertEqual(prepared.omitted_terminal_run_count, 0)
        self.assertEqual(prepared.imported_generation_run_count, 1)
        self.assertTrue(prepared.canvas_database.is_file())
        self.assertTrue(prepared.generation_run_database.is_file())
        self.assertTrue(prepared.recovery_manifest.is_file())
        self.assertTrue(prepared.preparation_report.is_file())
        self.assertFalse(self.content.canvas_content.exists())
        self.assertFalse(self.content.generation_run_store.exists())
        self.assertFalse(self.content.storage_authority.exists())

        recovery = json.loads(
            prepared.recovery_manifest.read_text(encoding="utf-8")
        )
        self.assertEqual("workspace-1", recovery["workspace_id"])
        self.assertEqual("migration-test-1", recovery["migration_id"])
        sources = {
            item["relative_path"]: item for item in recovery["sources"]
        }
        for relative_path in (
            "data/canvases/canvas-1.json",
            "data/canvases/private-canvas.json",
            "data/generation-runs.json",
        ):
            copied = prepared.recovery_manifest.parent / "source" / relative_path
            self.assertTrue(copied.is_file())
            self.assertEqual(
                hashlib.sha256(copied.read_bytes()).hexdigest(),
                sources[relative_path]["sha256"],
            )

        report = json.loads(
            prepared.preparation_report.read_text(encoding="utf-8")
        )
        self.assertEqual("ready", report["status"])
        self.assertEqual("complete", report["phase"])
        self.assertEqual(2, report["canvas_count"])
        self.assertEqual(0, report["omitted_terminal_run_count"])
        self.assertEqual(1, report["imported_generation_run_count"])
        self.assertFalse(report["authority_published"])
        self.assertNotIn(str(self.root), json.dumps(report))

        actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "designer",
            "status": "active",
            "project_ids": ["project-a"],
        }
        canvas_store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        snapshot = canvas_store.read(
            "private-canvas",
            actor,
            CanvasProjection.public_snapshot(),
        ).canvas
        self.assertEqual(7, snapshot["revision"])
        self.assertEqual(["node-1"], [node["id"] for node in snapshot["nodes"]])
        self.assertNotIn("logs", snapshot)
        self.assertNotIn("_realtime", snapshot)
        self.assertTrue(canvas_store.integrity()["ok"])
        self.assertEqual(2, canvas_store.integrity()["counts"]["logs"])
        migrated_log = canvas_store.read(
            "private-canvas",
            actor,
            CanvasProjection.log_detail("private-canvas-legacy-log"),
        ).log
        self.assertEqual("private-canvas-legacy-run", migrated_log["runId"])
        self.assertEqual("preserve me", migrated_log["prompt"])
        self.assertEqual("legacy provider failure", migrated_log["error"])
        self.assertEqual(2, report["legacy_generation_log_count"])
        self.assertEqual(2, report["imported_generation_log_count"])

        run_store = SqliteGenerationRunStore(
            prepared.generation_run_database,
            workspace_id="workspace-1",
        )
        self.assertEqual(1, run_store.integrity()["counts"]["runs"])
        self.assertEqual(
            "succeeded", run_store.load("old-finished-run").status
        )

    def test_duplicate_legacy_log_and_run_ids_preserve_every_record(self):
        first = self.canvas("canvas-a")
        first["logs"] = [
            {
                "id": "copied-log-id",
                "generationRunId": "copied-run-id",
                "status": "success",
                "createdAt": 100,
                "prompt": "first record",
            },
            {
                "id": "second-log-id",
                "generationRunId": "copied-run-id",
                "status": "failed",
                "createdAt": 200,
                "prompt": "duplicate run record",
                "error": "failed later",
            },
        ]
        second = self.canvas("canvas-b")
        second["logs"] = [
            {
                "id": "copied-log-id",
                "generationRunId": "other-run-id",
                "status": "success",
                "createdAt": 300,
                "prompt": "copied canvas record",
            }
        ]
        self.write_canvas(first)
        self.write_canvas(second)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-duplicate-history",
        )

        report = json.loads(
            prepared.preparation_report.read_text(encoding="utf-8")
        )
        audit = report["generation_history_audit"]
        self.assertEqual(3, audit["legacy_count"])
        self.assertEqual(3, audit["imported_count"])
        self.assertEqual(1, audit["remapped_log_id_count"])
        self.assertEqual(1, audit["duplicate_run_id_count"])
        store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "designer",
            "status": "active",
            "project_ids": ["project-a"],
        }
        first_page = store.read(
            "canvas-a",
            actor,
            CanvasProjection.log_page(limit=50, include_details=True),
        )
        second_page = store.read(
            "canvas-b",
            actor,
            CanvasProjection.log_page(limit=50, include_details=True),
        )
        self.assertEqual(2, len(first_page.logs))
        self.assertEqual(1, len(second_page.logs))
        self.assertNotEqual(first_page.logs[1]["id"], second_page.logs[0]["id"])
        self.assertEqual(
            "copied-run-id",
            first_page.logs[0]["diagnostics"][
                "legacy_duplicate_generation_run_id"
            ],
        )
        self.assertEqual(
            "copied-log-id",
            second_page.logs[0]["diagnostics"]["legacy_log_id"],
        )

    def test_freezes_and_audits_each_result_node_composer_recipe(self):
        document = self.canvas()
        document["nodes"] = [
            {
                "id": "source-last",
                "type": "smart-image",
                "uploadedAttachment": True,
                "images": [
                    {
                        "url": "/assets/input/same.png",
                        "name": "尾帧",
                        "kind": "image",
                        "outputId": "output-last",
                    }
                ],
            },
            {
                "id": "source-first",
                "type": "smart-image",
                "uploadedAttachment": True,
                "images": [
                    {
                        "url": "/assets/input/same.png",
                        "name": "首帧",
                        "kind": "image",
                        "outputId": "output-first",
                    }
                ],
            },
            {
                "id": "result-video",
                "type": "smart-image",
                "generationOutputNode": True,
                "images": [
                    {
                        "url": "/assets/output/result.mp4",
                        "kind": "video",
                        "outputId": "result-output",
                    }
                ],
                "runPrompt": "  雨夜中的双人镜头  ",
                "runModelPrompt": "雨夜中的双人镜头\r\n",
                "runInputRefs": [
                    {
                        "url": "/assets/input/stale.png",
                        "name": "已经断开的旧输入",
                        "kind": "image",
                        "inputInstanceId": "instance-stale",
                    },
                ],
                "inputRefOrder": [
                    "output|output-first",
                    "output|output-last",
                ],
                "runSettings": {
                    "engine": "api",
                    "apiKind": "video",
                    "provider_id": "provider-a",
                    "model": "video-model-a",
                    "videoUseFrameRoles": True,
                    "videoDuration": 5,
                    "promptH": 180,
                },
            }
        ]
        document["connections"] = [
            {"from": "source-last", "to": "result-video", "kind": "input"},
            {"from": "source-first", "to": "result-video", "kind": "input"},
        ]
        self.write_canvas(document)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-composer-freeze",
        )

        actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "designer",
            "status": "active",
            "project_ids": ["project-a"],
        }
        store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        imported = store.read(
            "canvas-1",
            actor,
            CanvasProjection.public_snapshot(),
        ).canvas
        result_node = next(
            node for node in imported["nodes"] if node["id"] == "result-video"
        )
        frozen = result_node["generationInputSnapshot"]
        self.assertEqual("雨夜中的双人镜头", frozen["prompt"])
        self.assertEqual(
            ["output-first", "output-last"],
            [ref["outputId"] for ref in frozen["refs"]],
        )
        self.assertEqual(
            ["first_frame", "last_frame"],
            [ref["role"] for ref in frozen["refs"]],
        )
        self.assertEqual("provider-a", frozen["settings"]["provider_id"])
        self.assertEqual("video-model-a", frozen["settings"]["model"])

        report = json.loads(
            prepared.preparation_report.read_text(encoding="utf-8")
        )
        self.assertEqual(1, report["composer_audit"]["result_node_count"])
        self.assertEqual(1, report["composer_audit"]["verified_node_count"])
        self.assertEqual([], report["composer_audit"]["differences"])
        self.assertFalse(self.content.storage_authority.exists())

    def test_unique_legacy_log_output_backfills_missing_composer_prompt_and_refs(self):
        document = self.canvas()
        document["nodes"] = [
            {
                "id": "legacy-result",
                "type": "smart-image",
                "generationOutputNode": True,
                "images": [
                    {
                        "url": "/assets/output/legacy-result.png",
                        "kind": "image",
                    }
                ],
                "runSettings": {
                    "engine": "api",
                    "apiKind": "image",
                    "provider_id": "provider-a",
                    "model": "image-model-a",
                },
            }
        ]
        document["logs"] = [
            {
                "id": "legacy-log-1",
                "prompt": "由旧日志证明的 Prompt",
                "outputs": [
                    {"url": "/assets/output/legacy-result.png"}
                ],
                "refs": [
                    {
                        "url": "/assets/input/reference.png",
                        "kind": "image",
                        "nodeId": "source-node",
                        "imageIndex": 0,
                        "role": "image_1",
                    }
                ],
            }
        ]
        self.write_canvas(document)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-log-backfill",
        )

        actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "designer",
            "status": "active",
            "project_ids": ["project-a"],
        }
        store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        imported = store.read(
            "canvas-1",
            actor,
            CanvasProjection.public_snapshot(),
        ).canvas
        frozen = imported["nodes"][0]["generationInputSnapshot"]
        self.assertEqual("由旧日志证明的 Prompt", frozen["prompt"])
        self.assertEqual(
            ["/assets/input/reference.png"],
            [ref["url"] for ref in frozen["refs"]],
        )

        report = json.loads(
            prepared.preparation_report.read_text(encoding="utf-8")
        )
        self.assertEqual(1, report["composer_audit"]["log_backfilled_node_count"])
        self.assertEqual([], report["composer_audit"]["differences"])

    def test_ambiguous_legacy_log_matches_do_not_invent_composer_history(self):
        document = self.canvas()
        document["nodes"] = [
            {
                "id": "ambiguous-result",
                "type": "smart-image",
                "generationOutputNode": True,
                "images": [{"url": "/assets/output/shared-result.png"}],
                "runSettings": {"engine": "api", "apiKind": "image"},
            }
        ]
        document["logs"] = [
            {
                "id": "legacy-log-a",
                "prompt": "候选 A",
                "outputs": [{"url": "/assets/output/shared-result.png"}],
                "refs": [{"url": "/assets/input/a.png"}],
            },
            {
                "id": "legacy-log-b",
                "prompt": "候选 B",
                "outputs": [{"url": "/assets/output/shared-result.png"}],
                "refs": [{"url": "/assets/input/b.png"}],
            },
        ]
        self.write_canvas(document)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-ambiguous-log",
        )

        actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "designer",
            "status": "active",
            "project_ids": ["project-a"],
        }
        store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        imported = store.read(
            "canvas-1",
            actor,
            CanvasProjection.public_snapshot(),
        ).canvas
        frozen = imported["nodes"][0]["generationInputSnapshot"]
        self.assertEqual("", frozen["prompt"])
        self.assertEqual(
            ["/assets/output/shared-result.png"],
            [ref["url"] for ref in frozen["refs"]],
        )

        report = json.loads(
            prepared.preparation_report.read_text(encoding="utf-8")
        )
        self.assertEqual(0, report["composer_audit"]["log_backfilled_node_count"])
        self.assertEqual(1, report["composer_audit"]["verified_node_count"])

    def test_legacy_result_without_generation_output_flag_is_still_audited(self):
        document = self.canvas()
        document["nodes"] = [
            {
                "id": "legacy-unflagged-result",
                "type": "smart-image",
                "images": [{"url": "/assets/output/legacy.png"}],
                "runAt": 1720000000000,
                "runPrompt": "旧版结果 Prompt",
                "runSettings": {
                    "engine": "api",
                    "apiKind": "image",
                    "model": "legacy-model",
                },
            }
        ]
        self.write_canvas(document)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-unflagged-result",
        )

        report = json.loads(
            prepared.preparation_report.read_text(encoding="utf-8")
        )
        self.assertEqual(1, report["composer_audit"]["result_node_count"])
        self.assertEqual(1, report["composer_audit"]["verified_node_count"])

    def test_composer_freeze_uses_current_upstream_prompt_text(self):
        document = self.canvas()
        document["nodes"] = [
            {
                "id": "current-prompt",
                "type": "smart-prompt",
                "text": "迁移当下的上游文本",
                "images": [],
            },
            {
                "id": "result-with-prompt-input",
                "type": "smart-image",
                "generationOutputNode": True,
                "images": [{"url": "/assets/output/result.png"}],
                "runPrompt": "原结果 Node 的冻结文本",
                "runModelPrompt": "原结果 Node 的冻结文本",
                "runSettings": {"engine": "api", "apiKind": "image"},
            },
        ]
        document["connections"] = [
            {
                "from": "current-prompt",
                "to": "result-with-prompt-input",
                "kind": "input",
            }
        ]
        self.write_canvas(document)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-current-upstream-prompt",
        )

        actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "designer",
            "status": "active",
            "project_ids": ["project-a"],
        }
        store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        imported = store.read(
            "canvas-1",
            actor,
            CanvasProjection.public_snapshot(),
        ).canvas
        result = next(
            node
            for node in imported["nodes"]
            if node["id"] == "result-with-prompt-input"
        )
        self.assertEqual(
            "迁移当下的上游文本\n\n原结果 Node 的冻结文本",
            result["generationInputSnapshot"]["prompt"],
        )

    def test_composer_freeze_preserves_empty_refs_after_blocked_legacy_ref(self):
        document = self.canvas()
        document["nodes"] = [
            {
                "id": "result-with-blocked-legacy-ref",
                "type": "smart-image",
                "generationOutputNode": True,
                "images": [
                    {
                        "url": "/assets/output/result.png",
                        "outputId": "result-output",
                    }
                ],
                "blockedInputRefs": ["removed-source|0"],
                "generationInputSnapshot": {
                    "prompt": "历史生成文本",
                    "refs": [
                        {
                            "url": "/assets/input/removed.png",
                            "nodeId": "removed-source",
                            "imageIndex": 0,
                        }
                    ],
                    "settings": {"engine": "api", "apiKind": "image"},
                },
                "runSettings": {"engine": "api", "apiKind": "image"},
            }
        ]
        self.write_canvas(document)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-blocked-legacy-ref",
        )

        store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        imported = store.read(
            "canvas-1",
            {
                "id": "designer-1",
                "username": "designer",
                "role": "designer",
                "status": "active",
                "project_ids": ["project-a"],
            },
            CanvasProjection.public_snapshot(),
        ).canvas
        result = next(
            node
            for node in imported["nodes"]
            if node["id"] == "result-with-blocked-legacy-ref"
        )
        self.assertEqual([], result["generationInputSnapshot"]["refs"])
        self.assertEqual(1, prepared.composer_audit["verified_node_count"])

    def test_deleted_canvas_is_verified_without_becoming_publicly_readable(self):
        document = self.canvas()
        document["deleted_at"] = 1_787_110_471_956
        document["nodes"] = []
        self.write_canvas(document)

        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-deleted-canvas",
        )

        store = SqliteCanvasStore(
            prepared.canvas_database,
            workspace_id="workspace-1",
        )
        actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "designer",
            "status": "active",
            "project_ids": ["project-a"],
        }
        with self.assertRaisesRegex(CanvasStoreError, "画布不存在"):
            store.read(
                "canvas-1",
                actor,
                CanvasProjection.public_snapshot(),
            )
        deleted = next(
            item for item in store.list_items(actor) if item["id"] == "canvas-1"
        )
        self.assertEqual(document["deleted_at"], deleted["deleted_at"])

    def test_active_generation_run_rejects_before_any_staging_or_authority_write(self):
        self.write_canvas(self.canvas())
        self.content.generation_runs.write_text(
            json.dumps(
                {
                    "version": 1,
                    "runs": [
                        {
                            "id": "paid-run-1",
                            "status": "pending",
                            "remote_refs": ["provider-task-1"],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            SqliteMigrationError,
            "未结束 Generation Run.*paid-run-1",
        ):
            prepare_sqlite_migration(
                self.content,
                workspace_id="workspace-1",
                migration_id="migration-active-run",
            )

        staging = (
            self.data
            / "recovery"
            / "migration-active-run"
            / "staging"
        )
        self.assertFalse(staging.exists())
        self.assertFalse(self.content.canvas_content.exists())
        self.assertFalse(self.content.generation_run_store.exists())
        self.assertFalse(self.content.storage_authority.exists())

    def test_existing_authority_rejects_without_creating_staging(self):
        self.write_canvas(self.canvas())
        self.content.storage_authority.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "workspace_id": "workspace-1",
                    "migration_id": "older-migration",
                    "canvas": "sqlite",
                    "generation_runs": "sqlite",
                }
            ),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            SqliteMigrationError,
            "已有 storage-authority.json",
        ):
            prepare_sqlite_migration(
                self.content,
                workspace_id="workspace-1",
                migration_id="migration-must-not-start",
            )

        self.assertFalse(
            (
                self.data
                / "recovery"
                / "migration-must-not-start"
                / "staging"
            ).exists()
        )

    def test_dot_path_migration_ids_are_rejected_before_recovery_write(self):
        self.write_canvas(self.canvas())

        for migration_id in (".", ".."):
            with self.subTest(migration_id=migration_id):
                with self.assertRaisesRegex(
                    SqliteMigrationError,
                    "migration ID 无效",
                ):
                    prepare_sqlite_migration(
                        self.content,
                        workspace_id="workspace-1",
                        migration_id=migration_id,
                    )

        self.assertFalse((self.data / "recovery").exists())

    def test_invalid_canvas_keeps_recovery_evidence_without_publishing(self):
        invalid = self.canvas("canvas-id-inside-document")
        path = self.canvases / "different-file-name.json"
        path.write_text(json.dumps(invalid), encoding="utf-8")

        with self.assertRaisesRegex(
            SqliteMigrationError,
            "Canvas ID 与文件名不一致",
        ):
            prepare_sqlite_migration(
                self.content,
                workspace_id="workspace-1",
                migration_id="migration-invalid-canvas",
            )

        migration_root = (
            self.data / "recovery" / "migration-invalid-canvas"
        )
        self.assertTrue(
            (
                migration_root
                / "source"
                / "data"
                / "canvases"
                / "different-file-name.json"
            ).is_file()
        )
        report = json.loads(
            (migration_root / "preparation-report.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual("failed", report["status"])
        self.assertEqual("import_canvases", report["phase"])
        self.assertEqual("migration-invalid-canvas", report["migration_id"])
        self.assertNotIn(str(self.root), json.dumps(report))
        self.assertFalse(self.content.canvas_content.exists())
        self.assertFalse(self.content.generation_run_store.exists())
        self.assertFalse(self.content.storage_authority.exists())


if __name__ == "__main__":
    unittest.main()
