import importlib
import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient
from tests.runtime_env import configure_test_workspace, ensure_test_workspace, unload_main


class CanvasListQueryHttpTests(unittest.TestCase):
    def test_query_parameters_apply_through_authorized_http_endpoint(self):
        previous = {key: os.environ.get(key) for key in ("INFINITE_CANVAS_STATE_DIR", "INFINITE_CANVAS_CACHE_DIR")}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            configure_test_workspace(root / "workspace", root / "state")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(root / "state")
            unload_main()
            try:
                main = importlib.import_module("main")
                admin = main.AUTH_SYSTEM.create_user(username="list-admin", password="test-password", role="admin")
                designer = main.AUTH_SYSTEM.create_user(username="list-designer", password="test-password", role="designer")
                with TestClient(main.app) as client:
                    login = client.post("/api/auth/login", json={"username":"list-admin", "password":"test-password"})
                    self.assertEqual(login.status_code, 200)
                    created = {}
                    for title in ("Zulu", "Alpha", "Beta", "Straße"):
                        response = client.post("/api/canvases", json={"title":title, "kind":"smart", "project":"default"})
                        self.assertEqual(response.status_code, 200, response.text)
                        created[title] = response.json()["canvas"]["id"]
                    response = client.get("/api/canvases", params={"project":"default", "sort":"title", "direction":"asc", "limit":1})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual([item["title"] for item in response.json()["canvases"]], ["Alpha"])
                    next_page = client.get("/api/canvases", params={"project":"default", "sort":"title", "direction":"asc", "limit":1, "cursor":response.json()["next_cursor"]}).json()
                    self.assertEqual([item["title"] for item in next_page["canvases"]], ["Beta"])
                    search = client.get("/api/canvases", params={"project":"default", "search":"STRASSE"}).json()
                    self.assertEqual([item["id"] for item in search["canvases"]], [created["Straße"]])
                    self.assertEqual(client.put(f"/api/canvases/{created['Beta']}/visibility", json={"visibility":"private"}).status_code, 200)
                    private = client.get("/api/canvases", params={"project":"default", "visibility":"private"}).json()
                    self.assertEqual([item["id"] for item in private["canvases"]], [created["Beta"]])
                    mine = client.get("/api/canvases", params={"project":"default", "mine":"true", "sort":"title", "direction":"asc"}).json()
                    self.assertEqual([item["title"] for item in mine["canvases"]], ["Alpha", "Beta", "Straße", "Zulu"])
                    self.assertTrue(all(item["created_by"] == admin["id"] for item in mine["canvases"]))
                    main.AUTH_SYSTEM.set_user_project_ids(designer["id"], main.current_workspace_id(), ["default"], actor_id=admin["id"])
                    client.post("/api/auth/login", json={"username":"list-designer", "password":"test-password"})
                    hidden = client.get("/api/canvases", params={"project":"default", "visibility":"private", "search":"Beta"}).json()
                    self.assertEqual(hidden["canvases"], [])
                    self.assertEqual(hidden["total"], 0)
                    mine = client.get("/api/canvases", params={"project":"default", "mine":"true"}).json()
                    self.assertEqual(mine["canvases"], [])
                    response = client.post("/api/canvases", json={"title":"Designer canvas", "kind":"smart", "project":"default"})
                    self.assertEqual(response.status_code, 200, response.text)
                    mine = client.get("/api/canvases", params={"project":"default", "mine":"true", "created_by":admin["id"]}).json()
                    self.assertEqual([item["title"] for item in mine["canvases"]], ["Designer canvas"])
                    self.assertEqual(mine["canvases"][0]["created_by"], designer["id"])
                    shared = client.get("/api/canvases", params={"project":"default", "visibility":"shared"}).json()
                    self.assertEqual(shared["total"], 4)
            finally:
                unload_main()
                for key, value in previous.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value
                ensure_test_workspace()


if __name__ == "__main__":
    unittest.main()
