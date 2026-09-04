import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)

ensure_test_workspace()


class CanvasRealtimeWebSocketTests(unittest.TestCase):
    @staticmethod
    def receive_type(socket, expected_type):
        while True:
            message = socket.receive_json()
            if message.get("type") == expected_type:
                return message

    def test_twenty_clients_are_allowed_and_a_freed_slot_can_reconnect(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            configure_test_workspace(root / "workspace", state)
            previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            try:
                main = importlib.import_module("main")
                main.AUTH_SYSTEM.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                with TestClient(main.app) as client:
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "admin",
                            "password": "admin-password",
                        },
                    )
                    canvas = client.post(
                        "/api/canvases",
                        json={"title": "Realtime", "kind": "smart"},
                    ).json()["canvas"]
                    path = f"/ws/canvases/{canvas['id']}"
                    contexts = []
                    sockets = []
                    try:
                        for index in range(20):
                            context = client.websocket_connect(
                                f"{path}?client_id=tab-{index}"
                            )
                            socket = context.__enter__()
                            contexts.append(context)
                            sockets.append(socket)
                            self.assertEqual(
                                socket.receive_json()["type"],
                                "canvas_snapshot",
                            )

                        with client.websocket_connect(
                            f"{path}?client_id=tab-twenty-one"
                        ) as twenty_first:
                            with self.assertRaises(
                                WebSocketDisconnect
                            ) as rejected:
                                twenty_first.receive_json()
                        self.assertEqual(rejected.exception.code, 4429)
                        self.assertEqual(
                            rejected.exception.reason,
                            "同一 Smart Canvas 最多 20 条实时客户端连接",
                        )

                        first_context = contexts.pop(0)
                        sockets.pop(0)
                        first_context.__exit__(None, None, None)
                        with client.websocket_connect(
                            f"{path}?client_id=tab-reconnected"
                        ) as reconnected:
                            self.assertEqual(
                                reconnected.receive_json()["type"],
                                "canvas_snapshot",
                            )
                    finally:
                        for context in reversed(contexts):
                            context.__exit__(None, None, None)
            finally:
                unload_main()
                if previous_state is None:
                    os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
                else:
                    os.environ["INFINITE_CANVAS_STATE_DIR"] = previous_state
                ensure_test_workspace()

    def test_presence_is_account_aggregated_and_does_not_change_canvas_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            configure_test_workspace(root / "workspace", state)
            previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            try:
                main = importlib.import_module("main")
                admin = main.AUTH_SYSTEM.create_user(
                    username="admin-presence",
                    password="admin-password",
                    role="admin",
                    display_name="Admin Presence",
                )
                designer = main.AUTH_SYSTEM.create_user(
                    username="designer-presence",
                    password="designer-password",
                    role="designer",
                    display_name="Designer Presence",
                )
                guest = main.AUTH_SYSTEM.create_user(
                    username="guest-presence",
                    password="guest-password",
                    role="guest",
                    display_name="Guest Presence",
                )
                with TestClient(main.app) as client:
                    admin_login = client.post(
                        "/api/auth/login",
                        json={"username": admin["username"], "password": "admin-password"},
                    )
                    admin_cookie = admin_login.cookies.get(main.SESSION_COOKIE)
                    designer_login = client.post(
                        "/api/auth/login",
                        json={"username": designer["username"], "password": "designer-password"},
                    )
                    designer_cookie = designer_login.cookies.get(main.SESSION_COOKIE)
                    guest_login = client.post(
                        "/api/auth/login",
                        json={"username": guest["username"], "password": "guest-password"},
                    )
                    guest_cookie = guest_login.cookies.get(main.SESSION_COOKIE)
                    client.cookies.set(main.SESSION_COOKIE, admin_cookie)
                    canvas = client.post(
                        "/api/canvases",
                        json={"title": "Presence", "kind": "smart"},
                    ).json()["canvas"]
                    path = f"/ws/canvases/{canvas['id']}"
                    admin_headers = {"cookie": f"{main.SESSION_COOKIE}={admin_cookie}"}
                    designer_headers = {"cookie": f"{main.SESSION_COOKIE}={designer_cookie}"}
                    guest_headers = {"cookie": f"{main.SESSION_COOKIE}={guest_cookie}"}
                    with self.assertRaises(WebSocketDisconnect) as denied:
                        with client.websocket_connect(
                            f"{path}?client_id=guest-a",
                            headers=guest_headers,
                        ):
                            pass
                    self.assertEqual(denied.exception.code, 4404)
                    with client.websocket_connect(
                        f"{path}?client_id=admin-a",
                        headers=admin_headers,
                    ) as admin_socket:
                        self.assertEqual(admin_socket.receive_json()["type"], "canvas_snapshot")
                        admin_presence = self.receive_type(admin_socket, "presence_snapshot")
                        self.assertEqual(len(admin_presence["members"]), 1)
                        self.assertEqual(
                            admin_presence["members"][0]["avatar_color_slot"],
                            admin["avatar_color_slot"],
                        )
                        self.assertNotIn("role", admin_presence["members"][0])

                        with client.websocket_connect(
                            f"{path}?client_id=designer-a",
                            headers=designer_headers,
                        ) as designer_socket:
                            self.assertEqual(designer_socket.receive_json()["type"], "canvas_snapshot")
                            designer_presence = self.receive_type(designer_socket, "presence_snapshot")
                            self.assertEqual(len(designer_presence["members"]), 2)
                            joined = self.receive_type(admin_socket, "presence_join")
                            self.assertEqual(joined["member"]["display_name"], "Designer Presence")

                            designer_socket.send_json(
                                {
                                    "type": "presence_update",
                                    "seq": 1,
                                    "cursor": {"x": 12.5, "y": -8},
                                }
                            )
                            batch = self.receive_type(admin_socket, "presence_batch")
                            self.assertEqual(batch["updates"][0]["cursor"], {"x": 12.5, "y": -8.0})
                            self.assertNotIn("revision", batch)

                            designer_socket.send_json({"type": "presence_resync"})
                            resynced = self.receive_type(designer_socket, "presence_snapshot")
                            self.assertEqual(
                                resynced["self_participant_id"],
                                designer_presence["self_participant_id"],
                            )
                            self.assertNotIn("revision", resynced)

                            with client.websocket_connect(
                                f"{path}?client_id=admin-b",
                                headers=admin_headers,
                            ) as second_admin:
                                self.assertEqual(second_admin.receive_json()["type"], "canvas_snapshot")
                                second_presence = self.receive_type(second_admin, "presence_snapshot")
                                self.assertEqual(len(second_presence["members"]), 2)
                                self.assertEqual(
                                    second_presence["self_participant_id"],
                                    admin_presence["self_participant_id"],
                                )

                            deleted = client.delete(
                                f"/api/admin/accounts/{designer['id']}",
                                headers=admin_headers,
                            )
                            self.assertEqual(deleted.status_code, 200)
                            designer_socket.send_json(
                                {
                                    "type": "presence_update",
                                    "seq": 2,
                                    "cursor": {"x": 1, "y": 1},
                                }
                            )
                            with self.assertRaises(WebSocketDisconnect) as revoked:
                                designer_socket.receive_json()
                            self.assertEqual(revoked.exception.code, 4403)

                        left = self.receive_type(admin_socket, "presence_leave")
                        self.assertEqual(left["participant_id"], joined["member"]["participant_id"])

                    reopened = client.get(
                        f"/api/canvases/{canvas['id']}",
                        headers=admin_headers,
                    ).json()["canvas"]
                    self.assertEqual(reopened["revision"], canvas["revision"])
                    self.assertEqual(reopened["updated_at"], canvas["updated_at"])
            finally:
                unload_main()
                if previous_state is None:
                    os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
                else:
                    os.environ["INFINITE_CANVAS_STATE_DIR"] = previous_state
                ensure_test_workspace()

    def test_authenticated_clients_share_ordered_idempotent_mutations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            configure_test_workspace(root / "workspace", state)
            previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            try:
                main = importlib.import_module("main")
                main.AUTH_SYSTEM.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                with TestClient(main.app) as client:
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "admin",
                            "password": "admin-password",
                        },
                    )
                    canvas = client.post(
                        "/api/canvases",
                        json={"title": "Realtime", "kind": "smart"},
                    ).json()["canvas"]
                    path = f"/ws/canvases/{canvas['id']}"
                    with client.websocket_connect(
                        f"{path}?client_id=tab-a"
                    ) as first:
                        first_snapshot = first.receive_json()
                        with client.websocket_connect(
                            f"{path}?client_id=tab-b"
                        ) as second:
                            second_snapshot = second.receive_json()
                            self.assertEqual(
                                first_snapshot["type"],
                                "canvas_snapshot",
                            )
                            self.assertEqual(
                                second_snapshot["revision"],
                                0,
                            )
                            create = {
                                "type": "canvas_mutation",
                                "canvas_id": canvas["id"],
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
                            first.send_json(create)
                            first_create = self.receive_type(first, "canvas_mutation")
                            second_create = self.receive_type(second, "canvas_mutation")
                            self.assertEqual(first_create["revision"], 1)
                            self.assertEqual(second_create, first_create)

                            rename = {
                                "type": "canvas_mutation",
                                "canvas_id": canvas["id"],
                                "operation": {
                                    "operation_id": "tab-b:rename-0001",
                                    "base_revision": 0,
                                    "changes": {
                                        "node_updates": [
                                            {
                                                "id": "node-a",
                                                "path": ["title"],
                                                "value": "Shared title",
                                            }
                                        ]
                                    },
                                },
                            }
                            second.send_json(rename)
                            first_rename = self.receive_type(first, "canvas_mutation")
                            second_rename = self.receive_type(second, "canvas_mutation")
                            self.assertEqual(first_rename["revision"], 2)
                            self.assertEqual(second_rename, first_rename)

                            first.send_json(create)
                            duplicate = self.receive_type(first, "canvas_mutation")
                            self.assertTrue(duplicate["duplicate"])
                            self.assertEqual(duplicate["revision"], 1)

                    stored = client.get(
                        f"/api/canvases/{canvas['id']}"
                    ).json()["canvas"]
                    self.assertEqual(stored["revision"], 2)
                    self.assertNotIn("_realtime", stored)
                    self.assertNotIn("viewport", stored)
                    self.assertEqual(
                        stored["nodes"],
                        [
                            {
                                "id": "node-a",
                                "type": "smart-image",
                                "x": 10,
                                "y": 20,
                                "title": "Shared title",
                            }
                        ],
                    )
                    rejected_snapshot = client.put(
                        f"/api/canvases/{canvas['id']}",
                        json={
                            "title": "Old overwrite",
                            "nodes": [],
                            "connections": [],
                        },
                    )
                    self.assertEqual(rejected_snapshot.status_code, 409)
                    self.assertEqual(
                        rejected_snapshot.json()["detail"]["code"],
                        "realtime_mutation_required",
                    )
            finally:
                unload_main()
                if previous_state is None:
                    os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
                else:
                    os.environ["INFINITE_CANVAS_STATE_DIR"] = previous_state
                ensure_test_workspace()


if __name__ == "__main__":
    unittest.main()
