import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from tests.runtime_env import configure_test_workspace, ensure_test_workspace, unload_main


ensure_test_workspace()


class StubManager:
    def __init__(self):
        self.dismissed = []
        self.snapshot_value = {
            "session_id": "test-session",
            "checking": False,
            "items": [{"id": "codex", "state": "update_available", "update_available": True}],
            "notification_items": [{"id": "codex", "state": "update_available", "update_available": True}],
        }

    def snapshot(self):
        return self.snapshot_value

    async def check_all(self, force=False):
        self.force = force
        return self.snapshot_value

    def dismiss(self, cli_ids):
        self.dismissed.append(list(cli_ids))
        return {**self.snapshot_value, "notification_items": []}

class CliUpdateHttpTests(unittest.TestCase):
    def setUp(self):
        self.previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")

    def tearDown(self):
        unload_main()
        if self.previous_state is None:
            os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_STATE_DIR"] = self.previous_state
        ensure_test_workspace()

    def test_cli_update_routes_require_administrator_and_keep_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            configure_test_workspace(root / "workspace", root / "state")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(root / "state")
            unload_main()
            main = importlib.import_module("main")
            main.AUTH_SYSTEM.create_user(username="admin", password="admin-password", role="admin")
            main.AUTH_SYSTEM.create_user(username="designer", password="designer-password", role="designer")
            with mock.patch.object(
                main,
                "load_api_providers",
                return_value=[
                    {"id": "custom-cli", "protocol": "codex", "enabled": True},
                    {"id": "jimeng", "protocol": "jimeng", "enabled": False},
                ],
            ):
                self.assertEqual(main.configured_cli_update_ids(), {"codex"})
            stub = StubManager()
            main.CLI_UPDATE_MANAGER = stub

            with TestClient(main.app) as client:
                self.assertEqual(client.get("/api/admin/cli-updates").status_code, 401)
                client.post("/api/auth/login", json={"username": "designer", "password": "designer-password"})
                self.assertEqual(client.get("/api/admin/cli-updates").status_code, 403)
                client.post("/api/auth/logout")
                client.post("/api/auth/login", json={"username": "admin", "password": "admin-password"})

                self.assertEqual(client.get("/api/admin/cli-updates").json()["session_id"], "test-session")
                checked = client.post("/api/admin/cli-updates/check")
                self.assertEqual(checked.status_code, 200)
                self.assertTrue(stub.force)
                dismissed = client.post("/api/admin/cli-updates/dismiss", json={"cli_ids": ["codex"]})
                self.assertEqual(dismissed.status_code, 200)
                self.assertEqual(stub.dismissed, [["codex"]])
                self.assertEqual(client.post(
                    "/api/admin/cli-updates/codex/update",
                    json={"target_version": "1.2.3", "operation_id": "operation-1"},
                ).status_code, 404)


if __name__ == "__main__":
    unittest.main()
