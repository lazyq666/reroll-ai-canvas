import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.bootstrap import create_default_application
from infinite_canvas.instance_state import InstanceState
from infinite_canvas.workspace_storage import WorkspaceStorage
from tests.runtime_env import unload_main


class WorkspaceSessionContinuityTests(unittest.TestCase):
    @staticmethod
    def _wait_ready(client: TestClient) -> dict:
        latest = {}
        for _ in range(300):
            latest = client.get("/api/runtime/status").json()
            if latest.get("stage") in {"ready", "setup_required", "failed"}:
                break
            time.sleep(0.01)
        if latest.get("stage") != "ready":
            raise AssertionError(f"runtime did not become ready: {latest}")
        return latest

    def test_login_survives_controlled_switch_and_process_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "device-state"
            cache = root / "device-cache"
            workspace_a = root / "workspace-a"
            workspace_b = root / "workspace-b"
            for workspace in (workspace_a, workspace_b):
                (workspace / "data" / "canvases").mkdir(parents=True)
                (workspace / "assets").mkdir()

            WorkspaceStorage(root / "installation", state_dir=state).save_parent(
                workspace_a
            )
            instance = InstanceState(state)
            global_auth = AuthSystem(instance.auth_database)
            expected_user = global_auth.create_user(
                username="global-admin",
                password="global-password",
                role="admin",
            )
            target_legacy = AuthSystem(workspace_b / "data" / "auth.db")
            target_legacy.create_user(
                username="workspace-b-owner",
                password="target-password",
                role="guest",
            )

            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_CACHE_DIR": str(cache),
                "INFINITE_CANVAS_INSTANCE_STATE_DIR": "",
                "INFINITE_CANVAS_PROJECT_DIR": str(root / "installation"),
            }
            session_token = ""
            first_canvas_id = ""
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    first_app, _first_runtime, restart_signal = (
                        create_default_application()
                    )
                    with TestClient(first_app) as client:
                        self._wait_ready(client)
                        login = client.post(
                            "/api/auth/login",
                            json={
                                "username": "global-admin",
                                "password": "global-password",
                            },
                        )
                        self.assertEqual(200, login.status_code)
                        login_user = login.json()["user"]
                        self.assertEqual(
                            expected_user,
                            {
                                key: login_user[key]
                                for key in expected_user
                            },
                        )
                        self.assertIsNone(login_user["project_ids"])
                        session_token = client.cookies.get("ic_session") or ""
                        self.assertTrue(session_token)

                        created = client.post(
                            "/api/canvases",
                            json={"title": "Only in A", "kind": "smart"},
                        )
                        self.assertEqual(200, created.status_code)
                        first_canvas_id = created.json()["canvas"]["id"]
                        self.assertTrue(first_canvas_id)

                        opening = client.post(
                            "/api/workspace-storage-settings/open",
                            json={
                                "workspace_directory": str(workspace_b),
                                "cancel_active": False,
                            },
                        )
                        self.assertEqual(200, opening.status_code)
                        self.assertEqual("stopping", opening.json()["stage"])
                        self.assertEqual("continue", opening.json()["next_step"])
                        self.assertTrue(restart_signal.is_set())
            finally:
                unload_main()

            try:
                with patch.dict(os.environ, environment):
                    second_app, _second_runtime, _second_signal = (
                        create_default_application()
                    )
                    with TestClient(second_app) as client:
                        client.cookies.set("ic_session", session_token)
                        self._wait_ready(client)
                        current = client.get("/api/auth/me")
                        self.assertEqual(200, current.status_code)
                        current_user = current.json()["user"]
                        self.assertEqual(
                            expected_user,
                            {
                                key: current_user[key]
                                for key in expected_user
                            },
                        )
                        self.assertIsNone(current_user["project_ids"])
                        self.assertEqual("admin", current_user["role"])

                        accounts = client.get("/api/admin/accounts").json()["users"]
                        self.assertEqual(["global-admin"], [u["username"] for u in accounts])
                        active = client.get(
                            "/api/workspace-storage-settings"
                        ).json()["active"]
                        self.assertEqual(
                            workspace_b.resolve(),
                            Path(active["workspace_directory"]).resolve(),
                        )
                        canvases = client.get("/api/canvases").json()["canvases"]
                        self.assertNotIn(
                            first_canvas_id,
                            {canvas["id"] for canvas in canvases},
                        )
            finally:
                unload_main()

            self.assertTrue(instance.auth_database.is_file())
            self.assertFalse((workspace_a / "data" / "auth.db").exists())
            self.assertFalse((workspace_b / "data" / "auth.db").exists())
            self.assertTrue(list(instance.recovery_directory.glob("legacy-*.db")))


if __name__ == "__main__":
    unittest.main()
