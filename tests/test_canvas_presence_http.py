"""Online card summaries share real room membership and current access rules."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient
from tests.runtime_env import configure_test_workspace, ensure_test_workspace, unload_main

ensure_test_workspace()


class CanvasPresenceHttpTests(unittest.TestCase):
    def test_read_only_summary_filters_resources_and_preserves_canvas(self):
        previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            configure_test_workspace(root / "workspace", root / "state")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(root / "state")
            unload_main()
            try:
                main = importlib.import_module("main")
                main.sync_static_html_versions = lambda: None
                users = {
                    role: main.AUTH_SYSTEM.create_user(username=f"presence-{role}", password="test-password", role=role)
                    for role in ("admin", "designer", "guest")
                }
                with TestClient(main.app) as client:
                    cookies = {}
                    for role, user in users.items():
                        response = client.post("/api/auth/login", json={"username": user["username"], "password": "test-password"})
                        self.assertEqual(response.status_code, 200, response.text)
                        cookies[role] = response.cookies.get(main.SESSION_COOKIE)

                    def act_as(role):
                        client.cookies.clear()
                        if role:
                            client.cookies.set(main.SESSION_COOKIE, cookies[role])

                    act_as("admin")
                    project = client.post("/api/projects", json={"name": "Other"}).json()["project"]

                    def create(kind="smart", **values):
                        response = client.post("/api/canvases", json={"title": "Presence", "kind": kind, **values})
                        self.assertEqual(response.status_code, 200, response.text)
                        return response.json()["canvas"]["id"]

                    shared, private, deleted = create(), create(), create()
                    classic, other = create("classic"), create(project=project["id"])
                    self.assertEqual(client.put(f"/api/canvases/{private}/visibility", json={"visibility": "private"}).status_code, 200)
                    self.assertEqual(client.delete(f"/api/canvases/{deleted}").status_code, 200)
                    main.AUTH_SYSTEM.set_user_project_ids(users["designer"]["id"], main.current_workspace_id(), ["default"], actor_id=users["admin"]["id"])
                    ids = [shared, shared, private, classic, other, deleted, "missing"]
                    before = client.get(f"/api/canvases/{shared}").json()["canvas"]
                    self.assertEqual(client.post("/api/canvases/presence", json={"canvas_ids": ids}).json()["canvases"][shared], [])
                    header = {"cookie": f"{main.SESSION_COOKIE}={cookies['admin']}"}
                    with client.websocket_connect(f"/ws/canvases/{shared}?client_id=first", headers=header) as first:
                        while first.receive_json()["type"] != "presence_snapshot":
                            pass
                        with client.websocket_connect(f"/ws/canvases/{shared}?client_id=second", headers=header) as second:
                            while second.receive_json()["type"] != "presence_snapshot":
                                pass
                            act_as("designer")
                            response = client.post("/api/canvases/presence", json={"canvas_ids": ids})
                            self.assertEqual(response.status_code, 200, response.text)
                            self.assertEqual(response.headers["cache-control"], "no-store")
                            summary = response.json()["canvases"]
                            self.assertEqual(set(summary), {shared})
                            self.assertEqual(len(summary[shared]), 1)
                            self.assertFalse(summary[shared][0]["is_self"])
                            self.assertEqual(set(summary[shared][0]), {"participant_id", "display_name", "username", "avatar_color_slot", "is_self"})
                            main.AUTH_SYSTEM.set_user_project_ids(users["designer"]["id"], main.current_workspace_id(), [], actor_id=users["admin"]["id"])
                            self.assertEqual(client.post("/api/canvases/presence", json={"canvas_ids": ids}).json(), {"canvases": {}})
                            act_as("admin")
                            self.assertTrue(client.post("/api/canvases/presence", json={"canvas_ids": ids}).json()["canvases"][shared][0]["is_self"])
                        self.assertEqual(len(client.post("/api/canvases/presence", json={"canvas_ids": [shared]}).json()["canvases"][shared]), 1)
                    self.assertEqual(client.post("/api/canvases/presence", json={"canvas_ids": [shared]}).json()["canvases"][shared], [])
                    after = client.get(f"/api/canvases/{shared}").json()["canvas"]
                    for field in ("revision", "updated_at", "updated_by", "nodes", "connections"):
                        self.assertEqual(before.get(field), after.get(field), field)
                    self.assertEqual(client.post("/api/canvases/presence", json={"canvas_ids": [shared] * 201}).status_code, 422)
                    for role in ("guest", None):
                        act_as(role)
                        self.assertIn(client.post("/api/canvases/presence", json={"canvas_ids": ids}).status_code, (401, 403))
            finally:
                unload_main()
                if previous_state is None:
                    os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
                else:
                    os.environ["INFINITE_CANVAS_STATE_DIR"] = previous_state
                ensure_test_workspace()
