import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from infinite_canvas.canvas_list_index import CanvasListIndex
from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.canvas_sync import CanvasSync
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)
from tests.websocket_helpers import receive_canvas_message


ensure_test_workspace()


class CanvasSyncContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.state = root / "state"
        configure_test_workspace(root / "workspace", self.state)
        self.previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
        os.environ["INFINITE_CANVAS_STATE_DIR"] = str(self.state)
        unload_main()
        self.main = importlib.import_module("main")
        self.actor = self.main.AUTH_SYSTEM.create_user(
            username="admin",
            password="admin-password",
            role="admin",
        )
        self.client_context = TestClient(self.main.app)
        self.client = self.client_context.__enter__()
        response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin-password",
            },
        )
        self.assertEqual(response.status_code, 200)

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        unload_main()
        if self.previous_state is None:
            os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_STATE_DIR"] = self.previous_state
        ensure_test_workspace()
        self.temporary.cleanup()

    def create_canvas(self, kind):
        response = self.client.post(
            "/api/canvases",
            json={"title": f"{kind.title()} contract", "kind": kind},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["canvas"]

    def test_progressive_opening_stream_keeps_one_canvas_identity_and_revision(self):
        created = self.create_canvas("smart")

        response = self.client.get(
            f"/api/canvases/{created['id']}/open",
            headers={"Accept": "application/x-ndjson"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            response.headers["content-type"].startswith(
                "application/x-ndjson"
            )
        )
        self.assertEqual(response.headers["cache-control"], "no-store")
        events = [
            json.loads(line)
            for line in response.text.splitlines()
            if line.strip()
        ]
        self.assertEqual(
            [event["type"] for event in events],
            ["canvas_outline", "canvas_document"],
        )
        document = events[1]["canvas"]
        self.assertEqual(events[0]["canvas_id"], created["id"])
        self.assertEqual(events[0]["canvas_id"], document["id"])
        self.assertEqual(events[0]["revision"], document["revision"])

    def test_public_canvas_list_uses_sqlite_list_projection_without_legacy_files(self):
        root = Path(self.temporary.name)
        store = SqliteCanvasStore(
            root / "sqlite-list" / "canvas-content.sqlite3",
            workspace_id="sqlite-list-contract",
            now_ms=lambda: 500,
        )
        for canvas_id, project, updated_at in (
            ("sqlite-visible", "project-a", 300),
            ("sqlite-other-project", "project-b", 400),
        ):
            store.commit(
                canvas_id,
                self.actor,
                CanvasIntent.import_canvas(
                    {
                        "id": canvas_id,
                        "kind": "smart",
                        "title": canvas_id,
                        "icon": "layers",
                        "owner_id": self.actor["id"],
                        "owner_username": self.actor["username"],
                        "visibility": "shared",
                        "created_by": self.actor["id"],
                        "updated_by": self.actor["id"],
                        "project": project,
                        "created_at": 100,
                        "updated_at": updated_at,
                        "revision": 3,
                        "board_x": 17,
                        "board_y": 29,
                        "cover_image": {
                            "url": f"/assets/{canvas_id}.png",
                            "node_id": "node-a",
                            "image_index": 0,
                        },
                        "nodes": [
                            {"id": "node-a", "type": "smart-image"},
                            {"id": "node-b", "type": "smart-prompt"},
                        ],
                        "connections": [],
                    },
                    operation_id=f"migration:{canvas_id}",
                ),
            )
        legacy_directory = root / "legacy-must-stay-absent"
        legacy_index = root / "legacy-index-must-stay-absent.json"
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: 500,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: legacy_directory,
            index_file=lambda: legacy_index,
            record_loader=sync.list_canvas_items,
        )

        response = self.client.get("/api/canvases?project=project-a&limit=20")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([item["id"] for item in body["canvases"]], ["sqlite-visible"])
        item = body["canvases"][0]
        self.assertEqual(item["node_count"], 2)
        self.assertEqual(item["cover_url"], "/assets/sqlite-visible.png")
        self.assertTrue(item["cover_custom"])
        self.assertEqual(item["board_x"], 17)
        self.assertEqual(item["board_y"], 29)
        self.assertNotIn("nodes", item)
        self.assertEqual(body["total"], 1)
        self.assertFalse(body["rebuilding"])
        self.assertFalse(body["index_error"])
        self.assertFalse(legacy_directory.exists())
        self.assertFalse(legacy_index.exists())

    def test_failed_generation_log_is_available_after_reopening_smart_canvas(self):
        root = Path(self.temporary.name)
        store = SqliteCanvasStore(
            root / "sqlite-generation-history" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: 900,
        )
        canvas_id = "smart-generation-history"
        store.commit(
            canvas_id,
            self.actor,
            CanvasIntent.import_canvas(
                {
                    "id": canvas_id,
                    "kind": "smart",
                    "title": "Generation history",
                    "icon": "layers",
                    "owner_id": self.actor["id"],
                    "owner_username": self.actor["username"],
                    "visibility": "shared",
                    "created_by": self.actor["id"],
                    "updated_by": self.actor["id"],
                    "project": "default",
                    "created_at": 100,
                    "updated_at": 800,
                    "revision": 2,
                    "nodes": [{"id": "node-a", "type": "smart-image"}],
                    "connections": [],
                },
                operation_id="migration:smart-generation-history",
            ),
        )
        store.commit(
            canvas_id,
            self.actor,
            CanvasIntent.append_final_log(
                {
                    "id": "failed-log",
                    "runId": "failed-run",
                    "nodeId": "node-a",
                    "status": "failed",
                    "createdAt": 850,
                    "durationMs": 1200,
                    "platform": "provider-a",
                    "model": "image-v1",
                    "prompt": "keep this prompt",
                    "request": {"size": "1024x1024"},
                    "error": "provider rejected the request",
                },
                operation_id="generation:failed-run:log",
            ),
        )
        self.main.CANVAS_SYNC = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: 900,
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )

        appended = self.client.post(
            f"/api/canvases/{canvas_id}/logs",
            json={
                "id": "client-failed-log",
                "generationRunId": "client-failed-run",
                "nodeId": "node-a",
                "status": "failed",
                "createdAt": 875,
                "runMs": 300,
                "platform": "provider-a",
                "model": "text-v1",
                "prompt": "persist this immediate failure",
                "error": "provider timeout",
            },
        )

        reopened = self.client.get(f"/api/canvases/{canvas_id}")
        history = self.client.get(
            f"/api/canvases/{canvas_id}/logs?limit=50"
        )
        detail = self.client.get(
            f"/api/canvases/{canvas_id}/logs/failed-log"
        )

        self.assertEqual(appended.status_code, 200)
        self.assertEqual(appended.json()["log_id"], "client-failed-log")
        self.assertEqual(reopened.status_code, 200)
        self.assertNotIn("logs", reopened.json()["canvas"])
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["next_cursor"], "")
        self.assertEqual(len(history.json()["logs"]), 2)
        restored = next(
            item for item in history.json()["logs"] if item["id"] == "failed-log"
        )
        self.assertEqual(restored["id"], "failed-log")
        self.assertEqual(restored["status"], "failed")
        self.assertEqual(restored["prompt"], "keep this prompt")
        self.assertEqual(restored["error"], "provider rejected the request")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["log"], restored)
        client_log = next(
            item
            for item in history.json()["logs"]
            if item["id"] == "client-failed-log"
        )
        self.assertEqual(client_log["runId"], "client-failed-run")
        self.assertEqual(client_log["prompt"], "persist this immediate failure")

    def test_public_share_uses_validated_sqlite_grant_without_legacy_file(self):
        root = Path(self.temporary.name)
        store = SqliteCanvasStore(
            root / "sqlite-share" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: 600,
        )
        canvas_id = "sqlite-shared-canvas"
        store.commit(
            canvas_id,
            self.actor,
            CanvasIntent.import_canvas(
                {
                    "id": canvas_id,
                    "kind": "smart",
                    "title": "SQLite shared canvas",
                    "icon": "layers",
                    "owner_id": self.actor["id"],
                    "owner_username": self.actor["username"],
                    "visibility": "shared",
                    "created_by": self.actor["id"],
                    "updated_by": self.actor["id"],
                    "project": "default",
                    "created_at": 100,
                    "updated_at": 600,
                    "revision": 4,
                    "nodes": [
                        {
                            "id": "image-a",
                            "type": "smart-image",
                            "images": [{"url": "https://example.test/shared.png"}],
                        }
                    ],
                    "connections": [],
                },
                operation_id="migration:sqlite-shared-canvas",
            ),
        )
        legacy_path = Path(
            self.main.current_workspace_content().smart_canvas(canvas_id)
        )
        self.main.CANVAS_SYNC = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: 600,
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        share = self.main.AUTH_SYSTEM.replace_canvas_share(
            self.main.current_workspace_id(),
            canvas_id,
            self.actor["id"],
        )
        self.client.post("/api/auth/logout")

        response = self.client.get(f"/api/shares/{share['token']}")

        self.assertEqual(response.status_code, 200)
        public = response.json()["canvas"]
        self.assertEqual(public["id"], canvas_id)
        self.assertEqual(public["title"], "SQLite shared canvas")
        self.assertEqual([node["id"] for node in public["nodes"]], ["image-a"])
        self.assertNotIn("owner_id", public)
        self.assertFalse(legacy_path.exists())

    def test_public_trash_list_uses_sqlite_deleted_projection(self):
        root = Path(self.temporary.name)
        store = SqliteCanvasStore(
            root / "sqlite-trash" / "canvas-content.sqlite3",
            workspace_id="sqlite-trash-contract",
            now_ms=lambda: 700,
        )
        canvas_id = "sqlite-trashed-canvas"
        store.commit(
            canvas_id,
            self.actor,
            CanvasIntent.import_canvas(
                {
                    "id": canvas_id,
                    "kind": "smart",
                    "title": "SQLite trashed canvas",
                    "icon": "layers",
                    "owner_id": self.actor["id"],
                    "owner_username": self.actor["username"],
                    "visibility": "shared",
                    "created_by": self.actor["id"],
                    "updated_by": self.actor["id"],
                    "project": "default",
                    "created_at": 100,
                    "updated_at": 650,
                    "deleted_at": 600,
                    "revision": 2,
                    "nodes": [{"id": "node-a", "type": "smart-image"}],
                    "connections": [],
                },
                operation_id="migration:sqlite-trashed-canvas",
            ),
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: 700,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-trash-must-stay-absent",
            index_file=lambda: root / "legacy-trash-index-must-stay-absent.json",
            record_loader=sync.list_canvas_items,
        )

        active = self.client.get("/api/canvases")
        trash = self.client.get("/api/canvases/trash")

        self.assertEqual(active.status_code, 200)
        self.assertEqual(active.json()["canvases"], [])
        self.assertEqual(trash.status_code, 200)
        self.assertEqual(
            [item["id"] for item in trash.json()["canvases"]],
            [canvas_id],
        )
        self.assertEqual(trash.json()["canvases"][0]["deleted_at"], 600)

    def test_public_trash_and_restore_commands_use_sqlite_authority(self):
        root = Path(self.temporary.name)
        store = SqliteCanvasStore(
            root / "sqlite-trash-commands" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: 800,
        )
        canvas_id = "sqlite-trash-command-canvas"
        store.commit(
            canvas_id,
            self.actor,
            CanvasIntent.import_canvas(
                {
                    "id": canvas_id,
                    "kind": "smart",
                    "title": "SQLite trash command canvas",
                    "icon": "layers",
                    "owner_id": self.actor["id"],
                    "owner_username": self.actor["username"],
                    "visibility": "shared",
                    "created_by": self.actor["id"],
                    "updated_by": self.actor["id"],
                    "project": "default",
                    "created_at": 100,
                    "updated_at": 700,
                    "revision": 2,
                    "nodes": [],
                    "connections": [],
                },
                operation_id="migration:sqlite-trash-command-canvas",
            ),
        )
        legacy_path = Path(
            self.main.current_workspace_content().smart_canvas(canvas_id)
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: 800,
            administration=self.main.AUTH_SYSTEM,
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-trash-command-must-stay-absent",
            index_file=lambda: root / "legacy-trash-command-index.json",
            record_loader=sync.list_canvas_items,
        )

        deleted = self.client.delete(f"/api/canvases/{canvas_id}")
        trash = self.client.get("/api/canvases/trash")
        restored = self.client.post(f"/api/canvases/{canvas_id}/restore")
        active = self.client.get("/api/canvases")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"ok": True})
        self.assertEqual([item["id"] for item in trash.json()["canvases"]], [canvas_id])
        self.assertEqual(restored.status_code, 200)
        restored_canvas = restored.json()["canvas"]
        self.assertEqual(restored_canvas["id"], canvas_id)
        self.assertNotIn("deleted_at", restored_canvas)
        self.assertEqual(restored_canvas["updated_at"], 700)
        self.assertEqual(restored_canvas["updated_by"], self.actor["id"])
        self.assertEqual(restored_canvas["revision"], 2)
        self.assertEqual(trash.json()["canvases"][0]["updated_at"], 700)
        self.assertEqual(trash.json()["canvases"][0]["updated_by"], self.actor["id"])
        self.assertEqual(trash.json()["canvases"][0]["revision"], 2)
        self.assertEqual([item["id"] for item in active.json()["canvases"]], [canvas_id])
        self.assertFalse(legacy_path.exists())

    def test_public_purge_command_permanently_deletes_sqlite_canvas(self):
        root = Path(self.temporary.name)
        store = SqliteCanvasStore(
            root / "sqlite-purge-command" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: 900,
        )
        canvas_id = "sqlite-purge-command-canvas"
        store.commit(
            canvas_id,
            self.actor,
            CanvasIntent.import_canvas(
                {
                    "id": canvas_id,
                    "kind": "smart",
                    "title": "SQLite purge command canvas",
                    "icon": "layers",
                    "owner_id": self.actor["id"],
                    "owner_username": self.actor["username"],
                    "visibility": "shared",
                    "created_by": self.actor["id"],
                    "updated_by": self.actor["id"],
                    "project": "default",
                    "created_at": 100,
                    "updated_at": 800,
                    "revision": 2,
                    "nodes": [],
                    "connections": [],
                },
                operation_id="migration:sqlite-purge-command-canvas",
            ),
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: 900,
            administration=self.main.AUTH_SYSTEM,
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-purge-command-must-stay-absent",
            index_file=lambda: root / "legacy-purge-command-index.json",
            record_loader=sync.list_canvas_items,
        )

        self.assertEqual(
            self.client.delete(f"/api/canvases/{canvas_id}").status_code,
            200,
        )
        purged = self.client.delete(f"/api/canvases/{canvas_id}/purge")

        self.assertEqual(purged.status_code, 200)
        self.assertEqual(purged.json(), {"ok": True})
        self.assertEqual(self.client.get("/api/canvases/trash").json()["canvases"], [])
        self.assertEqual(self.client.get(f"/api/canvases/{canvas_id}").status_code, 404)

    def test_public_create_command_persists_new_canvas_in_sqlite_only(self):
        root = Path(self.temporary.name)
        store = SqliteCanvasStore(
            root / "sqlite-create-command" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: 1000,
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: 1000,
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-create-command-must-stay-absent",
            index_file=lambda: root / "legacy-create-command-index.json",
            record_loader=sync.list_canvas_items,
        )

        created = self.client.post(
            "/api/canvases",
            json={
                "title": "SQLite created canvas",
                "kind": "smart",
                "project": "default",
                "board_x": 11,
                "board_y": 22,
            },
        )

        self.assertEqual(created.status_code, 200)
        canvas = created.json()["canvas"]
        self.assertEqual(canvas["title"], "SQLite created canvas")
        self.assertEqual(canvas["kind"], "smart")
        self.assertEqual(canvas["board_x"], 11.0)
        self.assertEqual(canvas["board_y"], 22.0)
        self.assertEqual(canvas["nodes"], [])
        self.assertEqual(canvas["connections"], [])
        listed = self.client.get("/api/canvases").json()["canvases"]
        self.assertEqual([item["id"] for item in listed], [canvas["id"]])
        self.assertEqual(listed[0]["node_count"], 0)
        self.assertFalse(
            Path(
                self.main.current_workspace_content().smart_canvas(canvas["id"])
            ).exists()
        )

    def test_public_project_delete_moves_sqlite_canvases_to_default_project(self):
        root = Path(self.temporary.name)
        clock = {"now": 1050}
        project = self.client.post(
            "/api/projects",
            json={"name": "Campaign archive"},
        ).json()["project"]
        store = SqliteCanvasStore(
            root / "sqlite-project-delete" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: clock["now"],
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: clock["now"],
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-project-delete-index-must-stay-absent",
            index_file=lambda: root / "legacy-project-delete-index.json",
            record_loader=sync.list_canvas_items,
        )
        created = [
            self.client.post(
                "/api/canvases",
                json={
                    "title": title,
                    "kind": "smart",
                    "project": project["id"],
                },
            ).json()["canvas"]
            for title in ("Campaign one", "Campaign two")
        ]

        clock["now"] = 1100
        deleted = self.client.delete(f"/api/projects/{project['id']}")
        default_canvases = self.client.get(
            "/api/canvases?project=default&limit=20"
        ).json()["canvases"]

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"ok": True, "moved": 2})
        self.assertEqual(
            {canvas["id"] for canvas in created},
            {canvas["id"] for canvas in default_canvases},
        )
        self.assertTrue(
            all(canvas["project"] == "default" for canvas in default_canvases)
        )
        created_edit_facts = {
            canvas["id"]: (
                canvas["updated_at"],
                canvas["updated_by"],
                canvas["revision"],
            )
            for canvas in created
        }
        self.assertEqual(
            {
                canvas["id"]: (
                    canvas["updated_at"],
                    canvas["updated_by"],
                    canvas["revision"],
                )
                for canvas in default_canvases
            },
            created_edit_facts,
        )
        self.assertNotIn(
            project["id"],
            {
                item["id"]
                for item in self.client.get("/api/projects").json()["projects"]
            },
        )
        self.assertTrue(
            all(
                not Path(
                    self.main.current_workspace_content().smart_canvas(canvas["id"])
                ).exists()
                for canvas in created
            )
        )

    def test_public_metadata_command_updates_sqlite_list_projection(self):
        root = Path(self.temporary.name)
        clock = {"now": 1100}
        store = SqliteCanvasStore(
            root / "sqlite-metadata-command" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: clock["now"],
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: clock["now"],
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-metadata-command-must-stay-absent",
            index_file=lambda: root / "legacy-metadata-command-index.json",
            record_loader=sync.list_canvas_items,
        )
        created = self.client.post(
            "/api/canvases",
            json={"title": "Before metadata", "kind": "smart"},
        ).json()["canvas"]
        clock["now"] = 1150

        updated = self.client.post(
            f"/api/canvases/{created['id']}/meta",
            json={
                "title": "After metadata",
                "pinned": True,
                "board_x": 31,
                "board_y": 47,
                "cover_url": "/assets/custom-cover.png",
                "cover_node_id": "node-cover",
                "cover_image_index": 2,
            },
        )

        self.assertEqual(updated.status_code, 200)
        item = updated.json()["canvas"]
        self.assertEqual(item["title"], "After metadata")
        self.assertTrue(item["pinned"])
        self.assertEqual(item["board_x"], 31.0)
        self.assertEqual(item["board_y"], 47.0)
        self.assertEqual(item["cover_url"], "/assets/custom-cover.png")
        self.assertTrue(item["cover_custom"])
        self.assertEqual(item["cover_node_id"], "node-cover")
        self.assertEqual(item["cover_image_index"], 2)
        self.assertEqual(item["updated_at"], 1150)
        self.assertEqual(item["updated_by"], self.actor["id"])
        self.assertEqual(item["revision"], 0)
        clock["now"] = 1175
        management = self.client.post(
            f"/api/canvases/{created['id']}/meta",
            json={"pinned": False, "board_x": 45, "color": "amber"},
        ).json()["canvas"]
        self.assertEqual(management["updated_at"], 1150)
        self.assertEqual(management["updated_by"], self.actor["id"])
        self.assertEqual(management["revision"], 0)
        listed = self.client.get("/api/canvases").json()["canvases"]
        self.assertEqual(listed, [management])

    def test_public_visibility_command_revokes_sqlite_canvas_share(self):
        root = Path(self.temporary.name)
        clock = {"now": 1200}
        store = SqliteCanvasStore(
            root / "sqlite-visibility-command" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: clock["now"],
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: clock["now"],
            administration=self.main.AUTH_SYSTEM,
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-visibility-command-must-stay-absent",
            index_file=lambda: root / "legacy-visibility-command-index.json",
            record_loader=sync.list_canvas_items,
        )
        created = self.client.post(
            "/api/canvases",
            json={"title": "Visibility command", "kind": "smart"},
        ).json()["canvas"]
        share = self.client.post(f"/api/canvases/{created['id']}/share")
        self.assertEqual(share.status_code, 200)
        token = share.json()["token"]
        after_share = self.client.get(
            f"/api/canvases/{created['id']}"
        ).json()["canvas"]
        self.assertEqual(after_share["updated_at"], created["updated_at"])
        self.assertEqual(after_share["updated_by"], created["updated_by"])
        self.assertEqual(after_share["revision"], created["revision"])
        clock["now"] = 1250

        updated = self.client.put(
            f"/api/canvases/{created['id']}/visibility",
            json={"visibility": "private"},
        )

        self.assertEqual(updated.status_code, 200)
        private = updated.json()["canvas"]
        self.assertEqual(private["visibility"], "private")
        self.assertEqual(private["updated_at"], created["updated_at"])
        self.assertEqual(private["updated_by"], created["updated_by"])
        self.assertEqual(private["revision"], created["revision"])
        self.client.post("/api/auth/logout")
        self.assertEqual(self.client.get(f"/api/shares/{token}").status_code, 404)

    def test_public_touch_command_preserves_sqlite_canvas_edit_facts(self):
        root = Path(self.temporary.name)
        clock = {"now": 1300}
        store = SqliteCanvasStore(
            root / "sqlite-touch-command" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: clock["now"],
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: clock["now"],
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        self.main.CANVAS_LIST_INDEX = CanvasListIndex(
            lambda: root / "legacy-touch-command-must-stay-absent",
            index_file=lambda: root / "legacy-touch-command-index.json",
            record_loader=sync.list_canvas_items,
        )
        created = self.client.post(
            "/api/canvases",
            json={"title": "Touch command", "kind": "smart"},
        ).json()["canvas"]
        clock["now"] = 1400

        touched = self.client.post(f"/api/canvases/{created['id']}/touch")

        self.assertEqual(touched.status_code, 200)
        touched_canvas = touched.json()["canvas"]
        self.assertEqual(touched.json()["updated_at"], created["updated_at"])
        self.assertEqual(touched_canvas["updated_at"], created["updated_at"])
        self.assertEqual(touched_canvas["updated_by"], created["updated_by"])
        self.assertEqual(touched_canvas["revision"], created["revision"])
        listed = self.client.get("/api/canvases").json()["canvases"]
        self.assertEqual(listed[0]["updated_at"], created["updated_at"])
        self.assertEqual(listed[0]["updated_by"], created["updated_by"])
        self.assertEqual(listed[0]["revision"], created["revision"])

    def test_public_classic_snapshot_command_persists_in_sqlite_only(self):
        root = Path(self.temporary.name)
        clock = {"now": 1500}
        store = SqliteCanvasStore(
            root / "sqlite-snapshot-command" / "canvas-content.sqlite3",
            workspace_id=self.main.current_workspace_id(),
            now_ms=lambda: clock["now"],
        )
        sync = CanvasSync(
            content=self.main.current_workspace_content,
            now_ms=lambda: clock["now"],
            workspace_id=self.main.current_workspace_id,
            canvas_store=lambda: store,
        )
        self.main.CANVAS_SYNC = sync
        created = self.client.post(
            "/api/canvases",
            json={"title": "Classic before", "kind": "classic"},
        ).json()["canvas"]
        original_viewport = created["viewport"]
        clock["now"] = 1600

        saved = self.client.put(
            f"/api/canvases/{created['id']}",
            json={
                "title": "Classic after",
                "icon": "layers",
                "nodes": [{"id": "classic-node", "type": "image"}],
                "connections": [],
                "viewport": {"x": 99, "y": 88, "scale": 0.5},
                "settings": {"quality": "high"},
                "base_updated_at": created["updated_at"],
            },
        )

        self.assertEqual(saved.status_code, 200)
        canvas = saved.json()["canvas"]
        self.assertEqual(canvas["title"], "Classic after")
        self.assertEqual(canvas["nodes"], [{"id": "classic-node", "type": "image"}])
        self.assertEqual(canvas["viewport"], original_viewport)
        self.assertEqual(canvas["updated_at"], 1600)
        self.assertEqual(canvas["revision"], 0)
        clock["now"] = 1700
        unchanged = self.client.put(
            f"/api/canvases/{created['id']}",
            json={
                "title": canvas["title"],
                "icon": canvas["icon"],
                "nodes": canvas["nodes"],
                "connections": canvas["connections"],
                "viewport": {"x": -999, "y": -888, "scale": 2},
                "settings": canvas.get("settings") or {},
                "base_updated_at": canvas["updated_at"],
            },
        )
        self.assertEqual(unchanged.status_code, 200)
        unchanged_canvas = unchanged.json()["canvas"]
        self.assertEqual(unchanged_canvas["updated_at"], 1600)
        self.assertEqual(unchanged_canvas["updated_by"], canvas["updated_by"])
        self.assertEqual(unchanged_canvas["revision"], 0)
        self.assertEqual(unchanged_canvas["viewport"], original_viewport)
        self.assertFalse(
            Path(
                self.main.current_workspace_content().smart_canvas(created["id"])
            ).exists()
        )

    def test_classic_save_preserves_viewport_and_legacy_broadcast_contract(self):
        canvas = self.create_canvas("classic")
        original_viewport = canvas["viewport"]
        payload = {
            "title": "Saved title",
            "icon": "layers",
            "nodes": [{"id": "node-a", "type": "image"}],
            "connections": [],
            "viewport": {"x": 999, "y": 888, "scale": 0.25},
            "logs": [],
            "settings": {},
            "client_id": "classic-tab-a",
            "base_updated_at": canvas["updated_at"],
        }

        with self.client.websocket_connect(
            "/ws/stats?client_id=classic-observer"
        ) as observer:
            self.assertEqual(observer.receive_json()["type"], "stats")
            response = self.client.put(
                f"/api/canvases/{canvas['id']}",
                json=payload,
            )
            self.assertEqual(response.status_code, 200)
            saved = response.json()["canvas"]
            notice = observer.receive_json()

        self.assertEqual(saved["viewport"], original_viewport)
        self.assertEqual(
            notice,
            {
                "type": "canvas_updated",
                "canvas_id": canvas["id"],
                "updated_at": saved["updated_at"],
                "client_id": "classic-tab-a",
            },
        )
        stored = self.client.get(
            f"/api/canvases/{canvas['id']}"
        ).json()["canvas"]
        self.assertEqual(stored["viewport"], original_viewport)
        self.assertEqual(stored["nodes"], payload["nodes"])

    def test_classic_stale_save_returns_current_canvas_without_overwrite(self):
        canvas = self.create_canvas("classic")
        first = self.client.put(
            f"/api/canvases/{canvas['id']}",
            json={
                "title": "Newer title",
                "nodes": [{"id": "newer-node"}],
                "connections": [],
                "base_updated_at": canvas["updated_at"],
            },
        )
        self.assertEqual(first.status_code, 200)
        newer = first.json()["canvas"]

        stale = self.client.put(
            f"/api/canvases/{canvas['id']}",
            json={
                "title": "Stale title",
                "nodes": [{"id": "stale-node"}],
                "connections": [],
                "base_updated_at": max(1, newer["updated_at"] - 1),
            },
        )

        self.assertEqual(stale.status_code, 409)
        detail = stale.json()["detail"]
        self.assertEqual(detail["message"], "画布已被其他页面更新，已拒绝旧版本覆盖。")
        self.assertEqual(detail["updated_at"], newer["updated_at"])
        self.assertEqual(detail["canvas"]["title"], "Newer title")
        self.assertEqual(detail["canvas"]["nodes"], [{"id": "newer-node"}])
        stored = self.client.get(
            f"/api/canvases/{canvas['id']}"
        ).json()["canvas"]
        self.assertEqual(stored["title"], "Newer title")
        self.assertEqual(stored["nodes"], [{"id": "newer-node"}])

    def test_smart_realtime_contract_omits_local_view_state_and_blocks_snapshot(self):
        canvas = self.create_canvas("smart")
        canvas_path = f"/ws/canvases/{canvas['id']}?client_id=smart-tab-a"
        with self.client.websocket_connect(canvas_path) as socket:
            snapshot = receive_canvas_message(socket, "canvas_snapshot")
            self.assertEqual(snapshot["type"], "canvas_snapshot")
            self.assertEqual(snapshot["revision"], 0)
            self.assertNotIn("viewport", snapshot["canvas"])
            self.assertNotIn("_realtime", snapshot["canvas"])
            for operation_id, changes in (
                ("smart-tab-a:empty-0001", {}),
                (
                    "smart-tab-a:equal-0001",
                    {
                        "canvas_updates": [
                            {"path": ["title"], "value": canvas["title"]}
                        ]
                    },
                ),
            ):
                socket.send_json(
                    {
                        "type": "canvas_mutation",
                        "canvas_id": canvas["id"],
                        "operation": {
                            "operation_id": operation_id,
                            "base_revision": 0,
                            "changes": changes,
                        },
                    }
                )
                acknowledgement = receive_canvas_message(socket, "canvas_mutation")
                self.assertEqual(acknowledgement["type"], "canvas_mutation")
                self.assertEqual(acknowledgement["revision"], 0)
                self.assertTrue(
                    all(
                        not entries
                        for entries in acknowledgement["changes"].values()
                    )
                )

        after_browse = self.client.get(
            f"/api/canvases/{canvas['id']}"
        ).json()["canvas"]
        self.assertEqual(after_browse["updated_at"], canvas["updated_at"])
        self.assertEqual(after_browse["updated_by"], canvas["updated_by"])
        self.assertEqual(after_browse["revision"], canvas["revision"])

        rejected = self.client.put(
            f"/api/canvases/{canvas['id']}",
            json={
                "title": "Old snapshot",
                "nodes": [],
                "connections": [],
                "viewport": {"x": 1, "y": 2, "scale": 3},
            },
        )
        self.assertEqual(rejected.status_code, 409)
        detail = rejected.json()["detail"]
        self.assertEqual(detail["code"], "realtime_mutation_required")
        self.assertEqual(detail["revision"], 0)
        self.assertNotIn("viewport", detail["canvas"])
        self.assertNotIn("_realtime", detail["canvas"])


if __name__ == "__main__":
    unittest.main()
