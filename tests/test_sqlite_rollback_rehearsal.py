import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.generation_run_store import (
    GenerationRunState,
    SqliteGenerationRunStore,
)
from infinite_canvas.sqlite_authority_publish import publish_sqlite_authority
from infinite_canvas.sqlite_migration import prepare_sqlite_migration
from infinite_canvas.sqlite_rollback_rehearsal import rehearse_sqlite_rollback
from infinite_canvas.storage_authority import resolve_storage_authority
from infinite_canvas.workspace import Workspace


class SqliteRollbackRehearsalTests(unittest.TestCase):
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
                    "title": "迁移前标题",
                    "owner_id": "designer-1",
                    "owner_username": "designer",
                    "visibility": "shared",
                    "revision": 3,
                    "nodes": [{"id": "node-1", "type": "smart-image", "x": 10}],
                    "connections": [],
                }
            ),
            encoding="utf-8",
        )
        prepared = prepare_sqlite_migration(
            self.content,
            workspace_id="workspace-1",
            migration_id="migration-rollback-rehearsal",
        )
        publish_sqlite_authority(self.content, prepared)
        self.actor = {
            "id": "designer-1",
            "username": "designer",
            "role": "admin",
            "status": "active",
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_exports_post_cutover_canvas_log_and_run_without_changing_authority(self):
        canvas_store = SqliteCanvasStore(
            self.content.canvas_content,
            workspace_id="workspace-1",
        )
        canvas_store.commit(
            "canvas-1",
            self.actor,
            CanvasIntent.canvas_mutation(
                {
                    "operation_id": "mutation:post-cutover-0001",
                    "base_revision": 3,
                    "changes": {
                        "canvas_updates": [
                            {"path": ["title"], "value": "切换后的最新标题"}
                        ],
                        "node_updates": [
                            {"id": "node-1", "path": ["x"], "value": 240}
                        ],
                    },
                }
            ),
        )
        canvas_store.commit(
            "canvas-1",
            self.actor,
            CanvasIntent.append_final_log(
                {
                    "id": "post-cutover-log",
                    "runId": "finished-run",
                    "status": "success",
                    "nodeId": "node-1",
                    "createdAt": 200,
                    "prompt": "切换后生成的 Prompt",
                    "outputs": [{"url": "/assets/output/post-cutover.png"}],
                },
                operation_id="log:post-cutover-0001",
            ),
        )
        run_store = SqliteGenerationRunStore(
            self.content.generation_run_store,
            workspace_id="workspace-1",
        )
        run_store.save(
            GenerationRunState(
                run_id="pending-after-cutover",
                kind="image",
                status="pending",
                phase="provider_submitted",
                owner="designer-1",
                key="post-cutover-key",
                request_hash="post-cutover-request-hash",
                provider_id="provider-a",
                created_at=300,
                updated_at=301,
                request={"prompt": "仍在生成"},
                remote_refs=(("provider-a", "remote-after-cutover"),),
                recoverable=True,
            )
        )

        rehearsal = rehearse_sqlite_rollback(
            self.content,
            workspace_id="workspace-1",
            rehearsal_id="rollback-rehearsal-1",
        )

        exported_canvas = json.loads(
            (
                rehearsal.package_directory
                / "data"
                / "canvases"
                / "canvas-1.json"
            ).read_text(encoding="utf-8")
        )
        self.assertTrue(rehearsal.ok)
        self.assertEqual(4, exported_canvas["revision"])
        self.assertEqual("切换后的最新标题", exported_canvas["title"])
        self.assertEqual(240, exported_canvas["nodes"][0]["x"])
        self.assertEqual("post-cutover-log", exported_canvas["logs"][0]["id"])
        exported_runs = json.loads(
            (
                rehearsal.package_directory / "data" / "generation-runs.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual("pending-after-cutover", exported_runs["runs"][0]["id"])
        self.assertEqual(
            3,
            json.loads(self.legacy_canvas.read_text(encoding="utf-8"))["revision"],
        )
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
