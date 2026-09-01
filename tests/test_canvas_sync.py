import asyncio
import copy
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.canvas_sync import (
    CREATE_CANVAS,
    DELETE_PROJECT,
    PURGE_CANVAS,
    RESTORE_CANVAS,
    SAVE_SNAPSHOT,
    SET_VISIBILITY,
    TOUCH_CANVAS,
    TRASH_CANVAS,
    UPDATE_METADATA,
    CanvasCommand,
    CanvasSync,
    CanvasSyncError,
)
from infinite_canvas.canvas_store import (
    CanvasIntent,
    CanvasProjection,
    SqliteCanvasStore,
)


ADMIN = {
    "id": "admin-1",
    "username": "admin",
    "role": "admin",
    "status": "active",
}
OTHER_ADMIN = {
    "id": "admin-2",
    "username": "other-admin",
    "role": "admin",
    "status": "active",
}


class FakeContent:
    def __init__(self, directory):
        self.smart_canvases = Path(directory)
        self.projects = self.smart_canvases.parent / "projects.json"

    def smart_canvas(self, canvas_id):
        return self.smart_canvases / f"{canvas_id}.json"


class RecordingNotifier:
    def __init__(self, canvas_path):
        self.canvas_path = Path(canvas_path)
        self.notices = []
        self.persisted_at_notice = []

    async def broadcast_canvas_updated(
        self,
        canvas_id,
        updated_at,
        client_id="",
    ):
        self.persisted_at_notice.append(
            json.loads(self.canvas_path.read_text(encoding="utf-8"))
        )
        self.notices.append(
            {
                "canvas_id": canvas_id,
                "updated_at": updated_at,
                "client_id": client_id,
            }
        )


class RealtimeNotifier(RecordingNotifier):
    def __init__(self, canvas_path):
        super().__init__(canvas_path)
        self.connections = {}
        self.sent = []
        self.broadcasts = []

    async def connect_canvas(self, websocket, canvas_id, client_id):
        self.connections[websocket] = (canvas_id, client_id)
        return True

    def disconnect_canvas(self, websocket, canvas_id):
        del canvas_id
        self.connections.pop(websocket, None)

    async def send_canvas_message(self, websocket, message):
        self.sent.append((websocket, message))
        return True

    async def broadcast_canvas_message(self, canvas_id, message):
        persisted = json.loads(self.canvas_path.read_text(encoding="utf-8"))
        self.broadcasts.append((canvas_id, message, persisted))


class BlockingRealtimeNotifier(RealtimeNotifier):
    def __init__(self, canvas_path):
        super().__init__(canvas_path)
        self.first_broadcast_started = asyncio.Event()
        self.release_first_broadcast = asyncio.Event()

    async def broadcast_canvas_message(self, canvas_id, message):
        if not self.broadcasts:
            self.first_broadcast_started.set()
            await self.release_first_broadcast.wait()
        await super().broadcast_canvas_message(canvas_id, message)


class BlockingSecondConnectNotifier(RealtimeNotifier):
    def __init__(self, canvas_path):
        super().__init__(canvas_path)
        self.connect_count = 0
        self.second_connect_started = asyncio.Event()
        self.release_second_connect = asyncio.Event()

    async def connect_canvas(self, websocket, canvas_id, client_id):
        self.connect_count += 1
        connected = await super().connect_canvas(
            websocket,
            canvas_id,
            client_id,
        )
        if self.connect_count == 2:
            self.second_connect_started.set()
            await self.release_second_connect.wait()
        return connected


class StoreRealtimeNotifier:
    def __init__(self):
        self.connections = {}
        self.sent = []
        self.broadcasts = []
        self.updates = []

    async def broadcast_canvas_updated(
        self,
        canvas_id,
        updated_at,
        client_id="",
    ):
        self.updates.append(
            {
                "canvas_id": canvas_id,
                "updated_at": updated_at,
                "client_id": client_id,
            }
        )

    async def connect_canvas(self, websocket, canvas_id, client_id):
        self.connections[websocket] = (canvas_id, client_id)
        return True

    def disconnect_canvas(self, websocket, canvas_id):
        del canvas_id
        self.connections.pop(websocket, None)

    async def send_canvas_message(self, websocket, message):
        self.sent.append((websocket, copy.deepcopy(message)))
        return True

    async def broadcast_canvas_message(self, canvas_id, message):
        self.broadcasts.append((canvas_id, copy.deepcopy(message)))


class FailingRealtimePresence:
    async def join(self, *args, **kwargs):
        raise RuntimeError("presence unavailable")

    async def leave(self, *args, **kwargs):
        raise RuntimeError("presence unavailable")

    async def touch(self, *args, **kwargs):
        raise RuntimeError("presence unavailable")

    async def receive_update(self, *args, **kwargs):
        raise RuntimeError("presence unavailable")

    async def resync(self, *args, **kwargs):
        raise RuntimeError("presence unavailable")


class RecordingAdministration:
    def __init__(self):
        self.revocations = []
        self.audits = []

    def revoke_canvas_share(self, workspace_id, canvas_id, actor_id):
        self.revocations.append((workspace_id, canvas_id, actor_id))

    def audit(self, event, **values):
        self.audits.append((event, values))


class CanvasSyncClassicTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.path = self.directory / "classic-1.json"
        self.path.write_text(
            json.dumps(
                {
                    "id": "classic-1",
                    "kind": "classic",
                    "title": "Original",
                    "icon": "layers",
                    "owner_id": ADMIN["id"],
                    "owner_username": ADMIN["username"],
                    "visibility": "shared",
                    "created_by": ADMIN["id"],
                    "updated_by": ADMIN["id"],
                    "created_at": 100,
                    "updated_at": 100,
                    "revision": 0,
                    "nodes": [],
                    "connections": [],
                    "viewport": {"x": 4, "y": 5, "scale": 1.5},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.notifier = RecordingNotifier(self.path)
        self.sync = CanvasSync(
            content=lambda: FakeContent(self.directory),
            now_ms=lambda: 200,
            notifier=self.notifier,
        )

    def tearDown(self):
        self.temporary.cleanup()

    async def save(self, **overrides):
        values = {
            "title": "Saved",
            "icon": "sparkles",
            "nodes": [{"id": "node-a"}],
            "connections": [],
            "viewport": {"x": 999, "y": 999, "scale": 0.1},
            "logs": [],
            "settings": {},
            "base_updated_at": 100,
            "client_id": "classic-tab",
        }
        values.update(overrides)
        return await self.sync.submit(
            CanvasCommand(SAVE_SNAPSHOT, "classic-1", values),
            ADMIN,
        )

    async def test_complete_save_persists_before_notifying_and_keeps_viewport(self):
        result = await self.save()

        self.assertEqual(result.canvas["title"], "Saved")
        self.assertEqual(result.canvas["updated_at"], 200)
        self.assertEqual(
            result.canvas["viewport"],
            {"x": 4, "y": 5, "scale": 1.5},
        )
        self.assertEqual(self.notifier.persisted_at_notice, [result.canvas])
        self.assertEqual(
            self.notifier.notices,
            [
                {
                    "canvas_id": "classic-1",
                    "updated_at": 200,
                    "client_id": "classic-tab",
                }
            ],
        )
        self.assertEqual(
            list(self.directory.glob("*.tmp")),
            [],
        )

    async def test_equal_snapshot_is_no_op_without_file_write_or_notice(self):
        before = self.path.read_bytes()

        result = await self.save(
            title="Original",
            icon="layers",
            nodes=[],
            connections=[],
            logs=[],
            settings={},
        )

        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(result.canvas["updated_at"], 100)
        self.assertEqual(result.canvas["updated_by"], ADMIN["id"])
        self.assertEqual(result.canvas["revision"], 0)
        self.assertEqual(self.notifier.notices, [])

    def test_legacy_access_normalization_during_reads_stays_in_memory(self):
        legacy_path = self.directory / "legacy-1.json"
        legacy_path.write_text(
            json.dumps(
                {
                    "id": "legacy-1",
                    "kind": "classic",
                    "title": "Legacy",
                    "created_at": 50,
                    "updated_at": 50,
                    "revision": 0,
                    "nodes": [],
                    "connections": [],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        recovery = self.directory / "recovery"
        sync = CanvasSync(
            content=lambda: FakeContent(self.directory),
            now_ms=lambda: 200,
            initial_admin=lambda: ADMIN,
            user_by_id=lambda user_id: ADMIN if user_id == ADMIN["id"] else None,
            recovery_directory=lambda: recovery,
        )
        before = legacy_path.read_bytes()

        opened = sync.read("legacy-1", ADMIN)
        listed = sync.read_list_document("legacy-1")
        documents = sync.list_documents(
            ADMIN,
            deleted=False,
            trash_retention_ms=1000,
        )

        listed_legacy = next(
            canvas for canvas in documents if canvas["id"] == "legacy-1"
        )
        for canvas in (opened, listed, listed_legacy):
            self.assertEqual(canvas["owner_id"], ADMIN["id"])
            self.assertEqual(canvas["owner_username"], ADMIN["username"])
            self.assertEqual(canvas["visibility"], "shared")
            self.assertEqual(canvas["created_by"], ADMIN["id"])
            self.assertEqual(canvas["updated_by"], ADMIN["id"])
        self.assertEqual(legacy_path.read_bytes(), before)
        self.assertFalse(recovery.exists())

    async def test_stale_save_returns_authoritative_canvas_without_writing(self):
        before = self.path.read_bytes()

        with self.assertRaises(CanvasSyncError) as rejected:
            await self.save(base_updated_at=99)

        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(
            rejected.exception.detail["message"],
            "画布已被其他页面更新，已拒绝旧版本覆盖。",
        )
        self.assertEqual(rejected.exception.detail["canvas"]["title"], "Original")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.notifier.notices, [])

    async def test_permission_is_rechecked_from_the_freshly_read_document(self):
        private = json.loads(self.path.read_text(encoding="utf-8"))
        private["visibility"] = "private"
        private["owner_id"] = "another-admin"
        private["owner_username"] = "another"
        self.path.write_text(json.dumps(private), encoding="utf-8")

        with self.assertRaises(CanvasSyncError) as rejected:
            await self.save()

        self.assertEqual(rejected.exception.status_code, 404)
        self.assertEqual(rejected.exception.detail, "画布不存在")
        self.assertEqual(self.notifier.notices, [])


class CanvasSyncRealtimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.path = self.directory / "smart-1.json"
        self.path.write_text(
            json.dumps(
                {
                    "id": "smart-1",
                    "kind": "smart",
                    "title": "Smart",
                    "owner_id": ADMIN["id"],
                    "owner_username": ADMIN["username"],
                    "visibility": "shared",
                    "created_by": ADMIN["id"],
                    "updated_by": ADMIN["id"],
                    "created_at": 100,
                    "updated_at": 100,
                    "revision": 0,
                    "nodes": [],
                    "connections": [],
                    "viewport": {"x": 4, "y": 5, "scale": 1.5},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.notifier = RealtimeNotifier(self.path)
        self.sync = CanvasSync(
            content=lambda: FakeContent(self.directory),
            now_ms=lambda: 300,
            notifier=self.notifier,
        )
        self.websocket = object()

    def tearDown(self):
        self.temporary.cleanup()

    async def test_realtime_open_and_mutation_persist_before_ordered_delivery(self):
        before_open = self.path.read_bytes()
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )

        self.assertIsNotNone(session)
        snapshot = self.notifier.sent[0][1]
        self.assertEqual(snapshot["type"], "canvas_snapshot")
        self.assertNotIn("viewport", snapshot["canvas"])
        self.assertNotIn("_realtime", snapshot["canvas"])
        self.assertEqual(self.path.read_bytes(), before_open)
        opened = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertNotIn("_realtime", opened)
        self.assertEqual(opened["updated_at"], 100)
        self.assertEqual(opened["updated_by"], ADMIN["id"])
        self.assertEqual(opened["revision"], 0)

        mutation = {
            "type": "canvas_mutation",
            "canvas_id": "smart-1",
            "operation": {
                "operation_id": "tab-a:create-0001",
                "base_revision": 0,
                "changes": {
                    "node_creates": [
                        {
                            "id": "node-a",
                            "type": "smart-image",
                            "x": 10,
                            "y": 20,
                        }
                    ]
                },
            },
        }
        await self.sync.receive_realtime(session, ADMIN, mutation)

        self.assertEqual(len(self.notifier.broadcasts), 1)
        _canvas_id, outgoing, persisted = self.notifier.broadcasts[0]
        self.assertEqual(outgoing["revision"], 1)
        self.assertEqual(persisted["revision"], 1)
        self.assertEqual(persisted["updated_at"], 300)
        self.assertEqual(persisted["nodes"][0]["id"], "node-a")

        await self.sync.receive_realtime(session, ADMIN, mutation)
        self.assertEqual(len(self.notifier.broadcasts), 1)
        duplicate = self.notifier.sent[-1][1]
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["revision"], 1)

    async def test_empty_and_equal_realtime_mutations_do_not_write_or_broadcast(self):
        before = self.path.read_bytes()
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )

        for operation_id, changes in (
            ("tab-a:empty-0001", {}),
            (
                "tab-a:equal-0001",
                {
                    "canvas_updates": [
                        {"path": ["title"], "value": "Smart"}
                    ]
                },
            ),
        ):
            await self.sync.receive_realtime(
                session,
                ADMIN,
                {
                    "type": "canvas_mutation",
                    "canvas_id": "smart-1",
                    "operation": {
                        "operation_id": operation_id,
                        "base_revision": 0,
                        "changes": changes,
                    },
                },
            )

        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.notifier.broadcasts, [])
        acknowledgements = [message for _socket, message in self.notifier.sent[1:]]
        self.assertEqual([message["revision"] for message in acknowledgements], [0, 0])
        self.assertTrue(
            all(
                not entries
                for message in acknowledgements
                for entries in message["changes"].values()
            )
        )

    async def test_realtime_open_queues_snapshot_before_concurrent_mutation(self):
        self.notifier = BlockingSecondConnectNotifier(self.path)
        self.sync = CanvasSync(
            content=lambda: FakeContent(self.directory),
            now_ms=lambda: 300,
            notifier=self.notifier,
        )
        first_session = await self.sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )
        second_websocket = object()
        second_open = asyncio.create_task(
            self.sync.open_realtime(
                second_websocket,
                "smart-1",
                ADMIN,
                "tab-b",
            )
        )
        await asyncio.wait_for(
            self.notifier.second_connect_started.wait(),
            timeout=0.5,
        )
        mutation = asyncio.create_task(
            self.sync.receive_realtime(
                first_session,
                ADMIN,
                {
                    "type": "canvas_mutation",
                    "canvas_id": "smart-1",
                    "operation": {
                        "operation_id": "tab-a:while-tab-b-opens",
                        "base_revision": 0,
                        "changes": {
                            "canvas_updates": [
                                {
                                    "path": ["title"],
                                    "value": "After snapshot",
                                }
                            ]
                        },
                    },
                },
            )
        )
        await asyncio.sleep(0)
        self.assertFalse(mutation.done())

        self.notifier.release_second_connect.set()
        second_session = await second_open
        await mutation

        self.assertIsNotNone(second_session)
        second_messages = [
            message
            for websocket, message in self.notifier.sent
            if websocket is second_websocket
        ]
        self.assertEqual(second_messages[0]["type"], "canvas_snapshot")
        self.assertEqual(second_messages[0]["revision"], 0)
        self.assertEqual(self.notifier.broadcasts[0][1]["revision"], 1)

    async def test_realtime_mutation_rechecks_current_permission(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )
        changed = json.loads(self.path.read_text(encoding="utf-8"))
        changed["visibility"] = "private"
        changed["owner_id"] = "another-admin"
        changed["owner_username"] = "another"
        self.path.write_text(json.dumps(changed), encoding="utf-8")

        with self.assertRaises(CanvasSyncError) as rejected:
            await self.sync.receive_realtime(
                session,
                ADMIN,
                {
                    "type": "canvas_mutation",
                    "operation": {
                        "operation_id": "tab-a:create-denied",
                        "base_revision": 0,
                        "changes": {
                            "node_creates": [{"id": "denied-node"}],
                        },
                    },
                },
            )

        self.assertEqual(rejected.exception.status_code, 404)
        self.assertEqual(len(self.notifier.sent), 1)

    async def test_realtime_ping_uses_session_epoch_without_reading_canvas(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )

        with patch.object(
            self.sync,
            "_read_locked",
            side_effect=AssertionError("heartbeat must not read Canvas"),
        ):
            await self.sync.receive_realtime(
                session,
                ADMIN,
                {"type": "ping", "canvas_id": "smart-1"},
            )

        self.assertEqual(
            self.notifier.sent[-1][1],
            {"type": "pong", "revision": 0},
        )

    async def test_realtime_store_work_does_not_block_the_event_loop(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )
        mutation = {
            "type": "canvas_mutation",
            "operation": {
                "operation_id": "tab-a:executor-check",
                "base_revision": 0,
                "changes": {
                    "node_updates": [
                        {"id": "missing-node", "path": ["x"], "value": 1}
                    ]
                },
            },
        }
        original = self.sync._commit_realtime_message

        def delayed_commit(*args):
            time.sleep(0.05)
            return original(*args)

        with patch.object(
            self.sync,
            "_commit_realtime_message",
            side_effect=delayed_commit,
        ):
            task = asyncio.create_task(
                self.sync.receive_realtime(session, ADMIN, mutation)
            )
            await asyncio.sleep(0.005)
            self.assertFalse(task.done())
            await task

        self.assertEqual(self.notifier.sent[-1][1]["code"], "node_deleted")

    async def test_access_epoch_invalidates_existing_realtime_session(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )
        self.sync._bump_access_epoch("smart-1")

        with self.assertRaises(CanvasSyncError) as rejected:
            await self.sync.receive_realtime(
                session,
                ADMIN,
                {"type": "ping"},
            )

        self.assertEqual(rejected.exception.status_code, 404)

    async def test_persist_and_broadcast_remain_in_one_per_canvas_order(self):
        notifier = BlockingRealtimeNotifier(self.path)
        sync = CanvasSync(
            content=lambda: FakeContent(self.directory),
            now_ms=lambda: 300,
            notifier=notifier,
        )
        session = await sync.open_realtime(
            self.websocket,
            "smart-1",
            ADMIN,
            "tab-a",
        )

        def create_message(operation_id, node_id, base_revision):
            return {
                "type": "canvas_mutation",
                "operation": {
                    "operation_id": operation_id,
                    "base_revision": base_revision,
                    "changes": {
                        "node_creates": [
                            {
                                "id": node_id,
                                "type": "smart-image",
                                "x": 1,
                                "y": 2,
                            }
                        ]
                    },
                },
            }

        first = asyncio.create_task(
            sync.receive_realtime(
                session,
                ADMIN,
                create_message("tab-a:create-first", "node-a", 0),
            )
        )
        await notifier.first_broadcast_started.wait()
        second = asyncio.create_task(
            sync.receive_realtime(
                session,
                ADMIN,
                create_message("tab-b:create-second", "node-b", 1),
            )
        )
        await asyncio.sleep(0)
        self.assertFalse(second.done())

        notifier.release_first_broadcast.set()
        await asyncio.gather(first, second)

        self.assertEqual(
            [message["revision"] for _canvas, message, _stored in notifier.broadcasts],
            [1, 2],
        )
        self.assertEqual(
            [stored["revision"] for _canvas, _message, stored in notifier.broadcasts],
            [1, 2],
        )
        stored = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(
            [node["id"] for node in stored["nodes"]],
            ["node-a", "node-b"],
        )


class CanvasSyncSqliteRealtimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.store = SqliteCanvasStore(
            self.directory / "canvas-content.sqlite3",
            workspace_id="workspace-a",
            now_ms=lambda: 300,
        )
        self.canvas = {
            "id": "smart-sqlite",
            "kind": "smart",
            "title": "SQLite Smart",
            "icon": "sparkles",
            "owner_id": ADMIN["id"],
            "owner_username": ADMIN["username"],
            "visibility": "shared",
            "created_by": ADMIN["id"],
            "updated_by": ADMIN["id"],
            "owner": "",
            "color": "",
            "pinned": False,
            "project": "default",
            "created_at": 100,
            "updated_at": 100,
            "revision": 0,
            "nodes": [],
            "connections": [],
            "settings": {},
        }
        self.store.commit(
            "smart-sqlite",
            ADMIN,
            CanvasIntent.import_canvas(
                self.canvas,
                operation_id="migration:smart-sqlite",
            ),
        )
        self.notifier = StoreRealtimeNotifier()
        self.sync = CanvasSync(
            content=lambda: FakeContent(self.directory / "legacy-empty"),
            now_ms=lambda: 300,
            notifier=self.notifier,
            canvas_store=lambda: self.store,
        )
        self.websocket = object()

    def tearDown(self):
        self.temporary.cleanup()

    def snapshot(self):
        return self.store.read(
            "smart-sqlite",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas

    def test_normal_canvas_read_uses_sqlite_authority_without_legacy_file(self):
        canvas = self.sync.read(
            "smart-sqlite",
            ADMIN,
            write=True,
            smart_snapshot=True,
        )

        self.assertEqual("SQLite Smart", canvas["title"])
        self.assertEqual(0, canvas["revision"])
        self.assertFalse(
            (self.directory / "legacy-empty" / "smart-sqlite.json").exists()
        )

    async def test_board_layout_metadata_does_not_revoke_realtime_session(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-sqlite",
            ADMIN,
            "layout-tab",
        )

        await self.sync.submit(
            CanvasCommand(
                UPDATE_METADATA,
                "smart-sqlite",
                {"board_x": 120, "board_y": 80},
            ),
            ADMIN,
        )
        await self.sync.receive_realtime(
            session,
            ADMIN,
            {"type": "ping", "canvas_id": "smart-sqlite"},
        )

        self.assertEqual("pong", self.notifier.sent[-1][1]["type"])

    async def test_project_metadata_revokes_realtime_session(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-sqlite",
            ADMIN,
            "project-tab",
        )

        await self.sync.submit(
            CanvasCommand(
                UPDATE_METADATA,
                "smart-sqlite",
                {"project": "project-b"},
            ),
            ADMIN,
        )

        with self.assertRaises(CanvasSyncError):
            await self.sync.receive_realtime(
                session,
                ADMIN,
                {"type": "ping", "canvas_id": "smart-sqlite"},
            )

    @staticmethod
    def mutation(operation_id, base_revision, changes):
        return {
            "type": "canvas_mutation",
            "canvas_id": "smart-sqlite",
            "operation": {
                "operation_id": operation_id,
                "base_revision": base_revision,
                "changes": changes,
            },
        }

    async def test_sqlite_store_snapshot_commit_event_and_duplicate_delivery(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-sqlite",
            ADMIN,
            "sqlite-tab",
        )

        self.assertIsNotNone(session)
        opened = self.notifier.sent[0][1]
        self.assertEqual(opened["type"], "canvas_snapshot")
        self.assertEqual(opened["revision"], 0)
        self.assertFalse(
            (self.directory / "legacy-empty" / "smart-sqlite.json").exists()
        )
        message = self.mutation(
            "sqlite-tab:create-0001",
            0,
            {
                "node_creates": [
                    {
                        "id": "node-a",
                        "type": "smart-image",
                        "x": 10,
                        "y": 20,
                    }
                ]
            },
        )
        await self.sync.receive_realtime(session, ADMIN, message)

        self.assertEqual(len(self.notifier.broadcasts), 1)
        canvas_id, event = self.notifier.broadcasts[0]
        self.assertEqual(canvas_id, "smart-sqlite")
        self.assertEqual(event["type"], "canvas_mutation")
        self.assertEqual(event["client_id"], "sqlite-tab")
        self.assertEqual(event["revision"], 1)
        self.assertEqual(self.snapshot()["nodes"][0]["id"], "node-a")
        self.assertEqual(self.store.integrity()["counts"]["events"], 1)

        await self.sync.receive_realtime(session, ADMIN, message)

        self.assertEqual(len(self.notifier.broadcasts), 1)
        duplicate = self.notifier.sent[-1][1]
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["revision"], 1)
        self.assertTrue(
            all(not entries for entries in duplicate["changes"].values())
        )
        self.assertEqual(self.store.integrity()["counts"]["events"], 1)

    async def test_presence_failure_never_blocks_canvas_open_or_mutation(self):
        sync = CanvasSync(
            content=lambda: FakeContent(self.directory / "legacy-empty"),
            now_ms=lambda: 300,
            notifier=self.notifier,
            canvas_store=lambda: self.store,
            realtime_presence=FailingRealtimePresence(),
        )
        session = await sync.open_realtime(
            self.websocket,
            "smart-sqlite",
            ADMIN,
            "presence-failure-tab",
        )

        await sync.receive_realtime(
            session,
            ADMIN,
            self.mutation(
                "presence-failure-tab:title",
                0,
                {
                    "canvas_updates": [
                        {"path": ["title"], "value": "Editing still works"}
                    ]
                },
            ),
        )

        self.assertEqual(self.snapshot()["title"], "Editing still works")
        self.assertEqual(self.snapshot()["revision"], 1)

    async def test_sqlite_store_rejection_keeps_revision_and_event_count(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-sqlite",
            ADMIN,
            "sqlite-tab",
        )

        await self.sync.receive_realtime(
            session,
            ADMIN,
            self.mutation(
                "sqlite-tab:missing-node",
                0,
                {
                    "node_updates": [
                        {"id": "missing", "path": ["x"], "value": 1}
                    ]
                },
            ),
        )

        rejected = self.notifier.sent[-1][1]
        self.assertEqual(rejected["type"], "mutation_rejected")
        self.assertEqual(rejected["code"], "node_deleted")
        self.assertEqual(rejected["revision"], 0)
        self.assertEqual(self.snapshot()["revision"], 0)
        self.assertEqual(self.store.integrity()["counts"]["events"], 0)

    async def test_sqlite_empty_and_equal_mutations_are_target_only_no_ops(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-sqlite",
            ADMIN,
            "sqlite-tab",
        )

        await self.sync.receive_realtime(
            session,
            ADMIN,
            self.mutation("sqlite-tab:empty-0001", 0, {}),
        )
        await self.sync.receive_realtime(
            session,
            ADMIN,
            self.mutation(
                "sqlite-tab:equal-0001",
                0,
                {
                    "canvas_updates": [
                        {"path": ["title"], "value": "SQLite Smart"}
                    ]
                },
            ),
        )

        snapshot = self.snapshot()
        self.assertEqual(snapshot["revision"], 0)
        self.assertEqual(snapshot["updated_at"], 100)
        self.assertEqual(snapshot["updated_by"], ADMIN["id"])
        self.assertEqual(self.notifier.broadcasts, [])
        self.assertEqual(self.store.integrity()["counts"]["events"], 0)
        acknowledgements = [message for _socket, message in self.notifier.sent[1:]]
        self.assertEqual([message["revision"] for message in acknowledgements], [0, 0])

    async def test_sqlite_store_commit_stays_off_the_event_loop(self):
        session = await self.sync.open_realtime(
            self.websocket,
            "smart-sqlite",
            ADMIN,
            "sqlite-tab",
        )
        message = self.mutation(
            "sqlite-tab:executor-check",
            0,
            {"canvas_updates": [{"path": ["title"], "value": "New"}]},
        )
        original = self.store.commit

        def delayed_commit(*args, **kwargs):
            time.sleep(0.05)
            return original(*args, **kwargs)

        with patch.object(self.store, "commit", side_effect=delayed_commit):
            task = asyncio.create_task(
                self.sync.receive_realtime(session, ADMIN, message)
            )
            await asyncio.sleep(0.005)
            self.assertFalse(task.done())
            await task

        self.assertEqual(self.snapshot()["title"], "New")


class CanvasSyncManagementTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.directory = root / "canvases"
        self.directory.mkdir()
        self.content = FakeContent(self.directory)
        self.administration = RecordingAdministration()
        self.clock = 500
        self.sync = CanvasSync(
            content=lambda: self.content,
            now_ms=lambda: self.clock,
            administration=self.administration,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def stored(self, canvas_id):
        return json.loads(
            (self.directory / f"{canvas_id}.json").read_text(encoding="utf-8")
        )

    async def create(self, title="Managed", project=None):
        result = await self.sync.submit(
            CanvasCommand(
                CREATE_CANVAS,
                "",
                {
                    "title": title,
                    "kind": "smart",
                    "project": project,
                    "board_x": 12,
                    "board_y": 24,
                },
            ),
            ADMIN,
        )
        return result.canvas

    async def test_identity_edit_advances_time_while_visibility_and_touch_do_not(self):
        canvas = await self.create()
        self.assertEqual(canvas["owner_id"], ADMIN["id"])
        self.assertEqual(canvas["visibility"], "shared")
        self.assertEqual(canvas["project"], "default")
        self.assertEqual(canvas["updated_at"], 500)

        self.clock = 600
        metadata = await self.sync.submit(
            CanvasCommand(
                UPDATE_METADATA,
                canvas["id"],
                {
                    "title": "Renamed",
                    "color": "BLUE",
                    "pinned": True,
                    "project": "project-a",
                    "cover_url": "/assets/cover.png",
                    "cover_node_id": "node-a",
                    "cover_image_index": 2,
                    "viewport": {"x": 999},
                    "selection": ["node-a"],
                },
            ),
            ADMIN,
        )
        self.assertEqual(metadata.canvas["title"], "Renamed")
        self.assertEqual(metadata.canvas["color"], "blue")
        self.assertEqual(metadata.canvas["project"], "project-a")
        self.assertEqual(metadata.canvas["updated_at"], 600)
        self.assertEqual(metadata.canvas["updated_by"], ADMIN["id"])
        self.assertNotIn("selection", metadata.canvas)
        self.assertEqual(
            metadata.canvas["viewport"],
            {"x": 0, "y": 0, "scale": 1},
        )

        self.clock = 650
        private = await self.sync.submit(
            CanvasCommand(
                SET_VISIBILITY,
                canvas["id"],
                {"visibility": "private"},
            ),
            ADMIN,
        )
        self.assertEqual(private.canvas["visibility"], "private")
        self.assertEqual(private.canvas["updated_at"], 600)
        self.assertEqual(private.canvas["updated_by"], ADMIN["id"])
        self.assertEqual(
            self.administration.revocations,
            [("legacy-workspace", canvas["id"], ADMIN["id"])],
        )
        self.assertEqual(
            self.administration.audits[0][0],
            "canvas_visibility_changed",
        )

        self.clock = 700
        touched = await self.sync.submit(
            CanvasCommand(TOUCH_CANVAS, canvas["id"]),
            ADMIN,
        )
        self.assertEqual(touched.canvas["updated_at"], 600)
        self.assertEqual(touched.canvas["updated_by"], ADMIN["id"])
        self.assertEqual(touched.canvas["revision"], 0)

    async def test_trash_restore_and_admin_purge_are_complete_actions(self):
        canvas = await self.create()
        canvas_id = canvas["id"]
        self.clock = 800

        trashed = await self.sync.submit(
            CanvasCommand(TRASH_CANVAS, canvas_id),
            ADMIN,
        )
        self.assertEqual(trashed.value, {"ok": True})
        self.assertEqual(self.stored(canvas_id)["deleted_at"], 800)
        self.assertEqual(self.stored(canvas_id)["updated_at"], 500)
        self.assertEqual(self.stored(canvas_id)["updated_by"], ADMIN["id"])
        self.assertEqual(
            self.administration.revocations,
            [("legacy-workspace", canvas_id, ADMIN["id"])],
        )

        self.clock = 900
        restored = await self.sync.submit(
            CanvasCommand(RESTORE_CANVAS, canvas_id),
            ADMIN,
        )
        self.assertNotIn("deleted_at", restored.canvas)
        self.assertEqual(restored.canvas["updated_at"], 500)
        self.assertEqual(restored.canvas["updated_by"], ADMIN["id"])

        await self.sync.submit(
            CanvasCommand(TRASH_CANVAS, canvas_id),
            ADMIN,
        )
        purged = await self.sync.submit(
            CanvasCommand(PURGE_CANVAS, canvas_id),
            ADMIN,
        )
        self.assertEqual(purged.value, {"ok": True})
        self.assertFalse((self.directory / f"{canvas_id}.json").exists())

    async def test_owner_transfer_preserves_canvas_edit_facts(self):
        canvas = await self.create()
        self.clock = 750

        transferred = self.sync.transfer_owned_canvases(ADMIN, OTHER_ADMIN)

        self.assertEqual(transferred, 1)
        stored = self.stored(canvas["id"])
        self.assertEqual(stored["owner_id"], OTHER_ADMIN["id"])
        self.assertEqual(stored["owner_username"], OTHER_ADMIN["username"])
        self.assertEqual(stored["updated_at"], canvas["updated_at"])
        self.assertEqual(stored["updated_by"], canvas["updated_by"])
        self.assertEqual(stored["revision"], canvas["revision"])

    async def test_project_delete_moves_only_after_every_canvas_is_authorized(self):
        first = await self.create("First", project="project-a")
        second = await self.create("Second", project="project-a")
        self.content.projects.write_text(
            json.dumps(
                {
                    "projects": [
                        {
                            "id": "default",
                            "name": "默认项目",
                            "order": 0,
                        },
                        {
                            "id": "project-a",
                            "name": "A",
                            "order": 1,
                        },
                    ]
                }
            ),
            encoding="utf-8",
        )
        inaccessible = self.stored(second["id"])
        inaccessible["visibility"] = "private"
        inaccessible["owner_id"] = "another-admin"
        inaccessible["owner_username"] = "another"
        (
            self.directory / f"{second['id']}.json"
        ).write_text(json.dumps(inaccessible), encoding="utf-8")
        before_projects = self.content.projects.read_bytes()

        with self.assertRaises(CanvasSyncError) as rejected:
            await self.sync.submit(
                CanvasCommand(DELETE_PROJECT, "project-a"),
                ADMIN,
            )

        self.assertEqual(rejected.exception.status_code, 403)
        self.assertEqual(
            self.stored(first["id"])["project"],
            "project-a",
        )
        self.assertEqual(self.content.projects.read_bytes(), before_projects)

        inaccessible["visibility"] = "shared"
        (
            self.directory / f"{second['id']}.json"
        ).write_text(json.dumps(inaccessible), encoding="utf-8")
        self.clock = 750
        deleted = await self.sync.submit(
            CanvasCommand(DELETE_PROJECT, "project-a"),
            ADMIN,
        )
        self.assertEqual(deleted.value, {"ok": True, "moved": 2})
        self.assertEqual(self.stored(first["id"])["project"], "default")
        self.assertEqual(self.stored(second["id"])["project"], "default")
        for original in (first, second):
            stored = self.stored(original["id"])
            self.assertEqual(stored["updated_at"], original["updated_at"])
            self.assertEqual(stored["updated_by"], original["updated_by"])
            self.assertEqual(stored["revision"], original["revision"])

    async def test_project_delete_rolls_back_every_file_when_a_replace_fails(self):
        first = await self.create("First", project="project-a")
        second = await self.create("Second", project="project-a")
        self.content.projects.write_text(
            json.dumps(
                {
                    "projects": [
                        {"id": "default", "name": "默认项目", "order": 0},
                        {"id": "project-a", "name": "A", "order": 1},
                    ]
                }
            ),
            encoding="utf-8",
        )
        watched = [
            self.content.projects,
            self.directory / f"{first['id']}.json",
            self.directory / f"{second['id']}.json",
        ]
        before = {path: path.read_bytes() for path in watched}
        real_replace = os.replace
        replace_count = 0

        def fail_second_replace(source, destination):
            nonlocal replace_count
            replace_count += 1
            if replace_count == 2:
                raise OSError("injected project write failure")
            return real_replace(source, destination)

        with patch(
            "infinite_canvas.canvas_sync.os.replace",
            side_effect=fail_second_replace,
        ):
            with self.assertRaisesRegex(
                OSError,
                "injected project write failure",
            ):
                await self.sync.submit(
                    CanvasCommand(DELETE_PROJECT, "project-a"),
                    ADMIN,
                )

        self.assertEqual(
            {path: path.read_bytes() for path in watched},
            before,
        )


class CanvasGenerationApplyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.path = self.directory / "smart-generation.json"
        self.path.write_text(
            json.dumps(
                {
                    "id": "smart-generation",
                    "kind": "smart",
                    "title": "Generation",
                    "owner_id": ADMIN["id"],
                    "owner_username": ADMIN["username"],
                    "visibility": "shared",
                    "created_by": ADMIN["id"],
                    "updated_by": ADMIN["id"],
                    "created_at": 100,
                    "updated_at": 100,
                    "revision": 3,
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "smart-image",
                            "generationOperationId": "operation-1",
                            "images": [],
                        }
                    ],
                    "connections": [],
                    "logs": [],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.notifier = RecordingNotifier(self.path)
        self.sync = CanvasSync(
            content=lambda: FakeContent(self.directory),
            now_ms=lambda: 400,
            notifier=self.notifier,
        )

    def tearDown(self):
        self.temporary.cleanup()

    async def test_current_generation_result_applies_atomically_then_notifies(self):
        result = await self.sync.apply_generation_result_if_current(
            "smart-generation",
            ADMIN,
            node_id="node-1",
            operation_id="operation-1",
            request_index=0,
            run_id="run-1",
            node_changes={
                "images": [{"url": "/assets/output/generated.png"}],
                "pending": 0,
            },
            log={"type": "generation", "status": "succeeded"},
        )

        stored = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertTrue(result.applied)
        self.assertEqual(4, result.revision)
        self.assertEqual(
            [{"url": "/assets/output/generated.png"}],
            stored["nodes"][0]["images"],
        )
        self.assertEqual(
            [{"type": "generation", "status": "succeeded"}],
            stored["logs"],
        )
        self.assertEqual(400, stored["updated_at"])
        self.assertEqual([stored], self.notifier.persisted_at_notice)
        duplicate = await self.sync.apply_generation_result_if_current(
            "smart-generation",
            ADMIN,
            node_id="node-1",
            operation_id="operation-1",
            request_index=0,
            run_id="run-1",
            node_changes={"images": [{"url": "duplicate.png"}]},
            log={"type": "generation", "status": "succeeded"},
        )
        self.assertTrue(duplicate.applied)
        self.assertEqual("already_applied", duplicate.reason)
        self.assertEqual(4, duplicate.revision)
        self.assertEqual(1, len(self.notifier.notices))
        self.assertEqual(
            [{"type": "generation", "status": "succeeded"}],
            json.loads(self.path.read_text(encoding="utf-8"))["logs"],
        )

    async def test_concurrent_generation_results_accumulate_on_the_same_node(self):
        canvas = json.loads(self.path.read_text(encoding="utf-8"))
        canvas["nodes"][0].update(
            {
                "generationOutputNode": True,
                "pending": 2,
                "pendingTasks": [
                    {"taskId": "run-1"},
                    {"taskId": "run-2"},
                ],
                "running": True,
            }
        )
        self.path.write_text(
            json.dumps(canvas, ensure_ascii=False),
            encoding="utf-8",
        )

        first = await self.sync.apply_generation_result_if_current(
            "smart-generation",
            ADMIN,
            node_id="node-1",
            operation_id="operation-1",
            request_index=0,
            run_id="run-1",
            node_changes={
                "images": [{"url": "/assets/output/first.png"}],
                "pending": 0,
                "running": False,
            },
        )
        after_first = json.loads(self.path.read_text(encoding="utf-8"))[
            "nodes"
        ][0]

        second = await self.sync.apply_generation_result_if_current(
            "smart-generation",
            ADMIN,
            node_id="node-1",
            operation_id="operation-1",
            request_index=1,
            run_id="run-2",
            node_changes={
                "images": [{"url": "/assets/output/second.png"}],
                "pending": 0,
                "running": False,
            },
        )
        completed = json.loads(self.path.read_text(encoding="utf-8"))[
            "nodes"
        ][0]

        self.assertTrue(first.applied)
        self.assertEqual(
            ["/assets/output/first.png"],
            [item["url"] for item in after_first["images"]],
        )
        self.assertTrue(second.applied)
        self.assertEqual(
            [
                "/assets/output/first.png",
                "/assets/output/second.png",
            ],
            [item["url"] for item in completed["images"]],
        )
        self.assertEqual(1, after_first["pending"])
        self.assertEqual(
            [{"taskId": "run-2"}],
            after_first["pendingTasks"],
        )
        self.assertTrue(after_first["running"])
        self.assertEqual(0, completed["pending"])
        self.assertNotIn("pendingTasks", completed)
        self.assertFalse(completed["running"])

    async def test_generation_batch_results_stay_bound_to_independent_slots(self):
        canvas = json.loads(self.path.read_text(encoding="utf-8"))
        template = canvas["nodes"][0]
        slots = []
        for index in range(4):
            slot = copy.deepcopy(template)
            slot.update(
                {
                    "id": f"slot-{index}",
                    "generationOutputNode": True,
                    "generationBatchId": "batch-1",
                    "generationSlotIndex": index,
                    "generationSlotCount": 4,
                    "generationOperationId": "operation-batch",
                    "images": [],
                    "pending": 1,
                    "pendingTasks": [{"taskId": f"run-{index}"}],
                    "running": True,
                }
            )
            slots.append(slot)
        canvas["nodes"] = slots
        self.path.write_text(
            json.dumps(canvas, ensure_ascii=False),
            encoding="utf-8",
        )

        for index in (2, 0, 3, 1):
            result = await self.sync.apply_generation_result_if_current(
                "smart-generation",
                ADMIN,
                node_id=f"slot-{index}",
                operation_id="operation-batch",
                request_index=index,
                run_id=f"run-{index}",
                node_changes={
                    "images": [{"url": f"/assets/output/{index}.png"}],
                    "pending": 0,
                    "running": False,
                },
            )
            self.assertTrue(result.applied)

        stored = json.loads(self.path.read_text(encoding="utf-8"))
        ordered = sorted(
            stored["nodes"],
            key=lambda node: node["generationSlotIndex"],
        )
        self.assertEqual(
            [[f"/assets/output/{index}.png"] for index in range(4)],
            [[image["url"] for image in node["images"]] for node in ordered],
        )
        self.assertTrue(all(node["pending"] == 0 for node in ordered))
        self.assertTrue(all("pendingTasks" not in node for node in ordered))

    async def test_deleted_or_replaced_node_discards_without_writing(self):
        before = self.path.read_bytes()
        replaced = await self.sync.apply_generation_result_if_current(
            "smart-generation",
            ADMIN,
            node_id="node-1",
            operation_id="operation-newer",
            request_index=0,
            run_id="run-replaced",
            node_changes={"images": [{"url": "late.png"}]},
        )
        deleted = await self.sync.apply_generation_result_if_current(
            "smart-generation",
            ADMIN,
            node_id="deleted-node",
            operation_id="operation-1",
            request_index=0,
            run_id="run-deleted",
            node_changes={"images": [{"url": "late.png"}]},
        )

        self.assertFalse(replaced.applied)
        self.assertEqual("operation_replaced", replaced.reason)
        self.assertFalse(deleted.applied)
        self.assertEqual("node_deleted", deleted.reason)
        self.assertEqual(before, self.path.read_bytes())
        self.assertEqual([], self.notifier.notices)

    async def test_empty_generation_output_does_not_change_canvas(self):
        before = self.path.read_bytes()

        result = await self.sync.apply_generation_result_if_current(
            "smart-generation",
            ADMIN,
            node_id="node-1",
            operation_id="operation-1",
            request_index=0,
            run_id="run-empty",
            node_changes={},
        )

        self.assertTrue(result.applied)
        self.assertEqual("no_changes", result.reason)
        self.assertEqual(3, result.revision)
        self.assertEqual(before, self.path.read_bytes())
        self.assertEqual([], self.notifier.notices)


class CanvasSyncSqliteGenerationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.store = SqliteCanvasStore(
            self.directory / "canvas-content.sqlite3",
            workspace_id="workspace-a",
            now_ms=lambda: 400,
        )
        self.store.commit(
            "smart-generation-sqlite",
            ADMIN,
            CanvasIntent.import_canvas(
                {
                    "id": "smart-generation-sqlite",
                    "kind": "smart",
                    "title": "SQLite Generation",
                    "icon": "sparkles",
                    "owner_id": ADMIN["id"],
                    "owner_username": ADMIN["username"],
                    "visibility": "shared",
                    "created_by": ADMIN["id"],
                    "updated_by": ADMIN["id"],
                    "owner": "",
                    "color": "",
                    "pinned": False,
                    "project": "default",
                    "created_at": 100,
                    "updated_at": 100,
                    "revision": 3,
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "smart-image",
                            "generationOperationId": "operation-1",
                            "images": [],
                            "pending": 1,
                            "pendingTasks": [{"taskId": "run-1"}],
                            "running": True,
                        }
                    ],
                    "connections": [],
                    "settings": {},
                },
                operation_id="migration:smart-generation-sqlite",
            ),
        )
        self.notifier = StoreRealtimeNotifier()
        self.sync = CanvasSync(
            content=lambda: FakeContent(self.directory / "legacy-empty"),
            now_ms=lambda: 400,
            notifier=self.notifier,
            canvas_store=lambda: self.store,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def snapshot(self):
        return self.store.read(
            "smart-generation-sqlite",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas

    async def apply(self, **overrides):
        values = {
            "canvas_id": "smart-generation-sqlite",
            "actor": ADMIN,
            "node_id": "node-1",
            "operation_id": "operation-1",
            "request_index": 0,
            "run_id": "run-1",
            "node_changes": {
                "images": [{"url": "/assets/output/generated.png"}],
                "pending": 0,
                "running": False,
            },
            "log": {
                "id": "generation-log-1",
                "status": "succeeded",
                "outputs": [{"url": "/assets/output/generated.png"}],
            },
        }
        values.update(overrides)
        return await self.sync.apply_generation_result_if_current(**values)

    async def test_sqlite_generation_output_log_event_and_retry(self):
        result = await self.apply()

        self.assertTrue(result.applied)
        self.assertEqual(result.revision, 4)
        node = self.snapshot()["nodes"][0]
        self.assertEqual(
            node["images"],
            [{"url": "/assets/output/generated.png"}],
        )
        self.assertEqual(node["pending"], 0)
        self.assertNotIn("pendingTasks", node)
        self.assertFalse(node["running"])
        detail = self.store.read(
            "smart-generation-sqlite",
            ADMIN,
            CanvasProjection.log_detail("generation-log-1"),
        ).log
        self.assertEqual(detail["status"], "success")
        self.assertEqual(detail["runId"], "run-1")
        self.assertEqual(
            self.notifier.updates,
            [
                {
                    "canvas_id": "smart-generation-sqlite",
                    "updated_at": 400,
                    "client_id": "",
                }
            ],
        )

        duplicate = await self.apply()

        self.assertTrue(duplicate.applied)
        self.assertEqual(duplicate.reason, "already_applied")
        self.assertEqual(duplicate.revision, 4)
        self.assertEqual(len(self.notifier.updates), 2)
        counts = self.store.integrity()["counts"]
        self.assertEqual(counts["generation_effects"], 1)
        self.assertEqual(counts["logs"], 1)
        self.assertEqual(counts["events"], 1)

    async def test_generation_history_interface_writes_sqlite_and_deduplicates_run(self):
        first = await self.sync.append_generation_log(
            "smart-generation-sqlite",
            ADMIN,
            {
                "id": "client-log-1",
                "generationRunId": "client-run-1",
                "nodeId": "node-1",
                "status": "failed",
                "runMs": 250,
                "prompt": "persist immediate failure",
                "error": "provider timeout",
            },
        )
        duplicate = await self.sync.append_generation_log(
            "smart-generation-sqlite",
            ADMIN,
            {
                "id": "different-local-id",
                "generationRunId": "client-run-1",
                "nodeId": "node-1",
                "status": "failed",
                "prompt": "persist immediate failure",
                "error": "provider timeout",
            },
        )

        self.assertEqual(first, "client-log-1")
        self.assertEqual(duplicate, "client-log-1")
        self.assertEqual(self.store.integrity()["counts"]["logs"], 1)
        detail = self.store.read(
            "smart-generation-sqlite",
            ADMIN,
            CanvasProjection.log_detail("client-log-1"),
        ).log
        self.assertEqual(detail["runId"], "client-run-1")
        self.assertEqual(detail["durationMs"], 250)
        self.assertEqual(detail["prompt"], "persist immediate failure")

    async def test_sqlite_generation_validates_explicit_outbox_effect_id(self):
        with self.assertRaises(CanvasSyncError) as rejected:
            await self.apply(
                effect_id="short",
                log=None,
            )

        self.assertEqual(rejected.exception.status_code, 400)
        self.assertIn("operation_id", str(rejected.exception.detail))
        self.assertEqual(self.snapshot()["revision"], 3)
        self.assertEqual(
            self.store.integrity()["counts"]["generation_effects"],
            0,
        )

    async def test_sqlite_generation_store_work_stays_off_event_loop(self):
        original = self.store.commit

        def delayed_commit(*args, **kwargs):
            time.sleep(0.05)
            return original(*args, **kwargs)

        with patch.object(self.store, "commit", side_effect=delayed_commit):
            task = asyncio.create_task(self.apply(log=None))
            await asyncio.sleep(0.005)
            self.assertFalse(task.done())
            await task

        self.assertEqual(self.snapshot()["revision"], 4)

    async def test_sqlite_generation_target_guard_does_not_notify(self):
        discarded = await self.apply(
            operation_id="operation-replaced",
            run_id="run-replaced",
            log={"id": "must-not-log", "status": "succeeded"},
        )

        self.assertFalse(discarded.applied)
        self.assertEqual(discarded.reason, "operation_replaced")
        self.assertEqual(discarded.revision, 3)
        self.assertEqual(self.notifier.updates, [])
        self.assertEqual(self.store.integrity()["counts"]["logs"], 0)

if __name__ == "__main__":
    unittest.main()
