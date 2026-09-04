import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from infinite_canvas.generation_run_store import (
    GenerationRunState,
    SqliteGenerationRunStore,
)
from infinite_canvas.sqlite_authority_publish import publish_sqlite_authority
from infinite_canvas.sqlite_migration import prepare_sqlite_migration
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)


ensure_test_workspace()


class MainSqliteAuthorityIntegrationTests(unittest.TestCase):
    def setUp(self):
        self._previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")

    def tearDown(self):
        unload_main()
        if self._previous_state is None:
            os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_STATE_DIR"] = self._previous_state
        ensure_test_workspace()

    def test_public_startup_uses_sqlite_canvas_and_generation_run_authority_together(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / "workspace"
            state = root / "state"
            configure_test_workspace(workspace, state)
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            bootstrap = importlib.import_module("main")
            admin = bootstrap.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            canvas_id = "sqlite-production-canvas"
            canvas_path = Path(
                bootstrap.current_workspace_content().smart_canvas(canvas_id)
            )
            canvas_path.parent.mkdir(parents=True, exist_ok=True)
            canvas_path.write_text(
                json.dumps(
                    {
                        "id": canvas_id,
                        "kind": "smart",
                        "title": "SQLite production canvas",
                        "icon": "layers",
                        "owner_id": admin["id"],
                        "owner_username": admin["username"],
                        "visibility": "shared",
                        "created_by": admin["id"],
                        "updated_by": admin["id"],
                        "project": "default",
                        "created_at": 100,
                        "updated_at": 200,
                        "revision": 1,
                        "nodes": [],
                        "connections": [],
                    }
                ),
                encoding="utf-8",
            )
            content = bootstrap.current_workspace_content()
            workspace_id = bootstrap.current_workspace_id()
            prepared = prepare_sqlite_migration(
                content,
                workspace_id=workspace_id,
                migration_id="main-sqlite-authority",
            )
            publish_sqlite_authority(content, prepared)
            run_id = "sqlite-restored-run"
            run_store = SqliteGenerationRunStore(
                content.generation_run_store,
                workspace_id=workspace_id,
            )
            run_store.save(
                GenerationRunState(
                    run_id=run_id,
                    kind="image",
                    status="pending",
                    phase="provider_submitted",
                    owner=admin["id"],
                    key="sqlite-restored-key",
                    request_hash="sqlite-restored-request",
                    provider_id="provider-a",
                    created_at=300,
                    updated_at=400,
                    request={
                        "prompt": "恢复这条任务",
                        "settings": {"provider_id": "provider-a"},
                    },
                    remote_refs=(("provider-a", "remote-task-1"),),
                    recoverable=True,
                )
            )
            run_store.publish_history(
                "history-run-newer",
                "history-newer",
                {
                    "timestamp": 20,
                    "type": "video",
                    "videos": ["/assets/output/newer.mp4"],
                    "provider_id": "provider-video",
                    "model": "video-v1",
                },
            )
            run_store.publish_history(
                "history-run-older",
                "history-older",
                {
                    "timestamp": 10,
                    "type": "text",
                    "texts": ["/assets/output/older.txt"],
                    "provider_id": "provider-text",
                    "model": "text-v1",
                },
            )
            unload_main()
            main = importlib.import_module("main")

            with TestClient(main.app) as client:
                login = client.post(
                    "/api/auth/login",
                    json={
                        "username": "admin",
                        "password": "admin-password",
                    },
                )
                canvases = client.get("/api/canvases")
                restored_run = client.get(f"/api/canvas-image-tasks/{run_id}")
                first_history = client.get("/api/history/page?limit=1")
                next_cursor = first_history.json()["next_cursor"]
                second_history = client.get(
                    "/api/history/page",
                    params={"limit": 1, "cursor": next_cursor},
                )
                history_detail = client.get("/api/history/history-newer")
                deleted_history = client.post(
                    "/api/history/delete",
                    json={"history_id": "history-newer"},
                )

                self.assertEqual(login.status_code, 200)
                self.assertEqual(canvases.status_code, 200)
                self.assertEqual(
                    [item["id"] for item in canvases.json()["canvases"]],
                    [canvas_id],
                )
                self.assertEqual(restored_run.status_code, 200)
                self.assertEqual(restored_run.json()["id"], run_id)
                self.assertEqual(
                    ["history-newer"],
                    [
                        item["history_id"]
                        for item in first_history.json()["items"]
                    ],
                )
                self.assertTrue(next_cursor)
                self.assertEqual(
                    ["history-older"],
                    [
                        item["history_id"]
                        for item in second_history.json()["items"]
                    ],
                )
                self.assertEqual("history-newer", history_detail.json()["history_id"])
                self.assertEqual({"success": True}, deleted_history.json())
            self.assertFalse(content.generation_runs.exists())
            self.assertFalse(content.generation_history.exists())
            self.assertFalse(content.generation_effects.exists())


if __name__ == "__main__":
    unittest.main()
