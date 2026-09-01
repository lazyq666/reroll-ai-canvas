import importlib
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from tests.runtime_env import configure_test_workspace, ensure_test_workspace, unload_main


ensure_test_workspace()


class ApiSettingsWorkflowHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")

    def tearDown(self):
        unload_main()
        if self._previous_state is None:
            os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_STATE_DIR"] = self._previous_state
        ensure_test_workspace()

    def test_admin_can_save_and_read_workflow_while_designer_is_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            workspace = root / "workspace"
            configure_test_workspace(workspace, state)
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            main = importlib.import_module("main")
            main.AUTH_SYSTEM.create_user(
                username="admin", password="admin-password", role="admin"
            )
            main.AUTH_SYSTEM.create_user(
                username="designer", password="designer-password", role="designer"
            )

            payload = {
                "workflowId": "workflow-contract-smoke",
                "title": "Workflow Contract Smoke",
                "description": "保存与读取保持一致",
                "fields": [
                    {
                        "id": "prompt",
                        "nodeId": "1",
                        "fieldName": "text",
                        "fieldValue": "hello",
                        "fieldType": "TEXT",
                        "label": "Prompt",
                    }
                ],
                "workflowJson": {"1": {"class_type": "Text"}},
                "optionalImageMode": "keep-empty",
            }

            with TestClient(main.app) as client:
                designer_login = client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-password"},
                )
                self.assertEqual(designer_login.status_code, 200)
                denied = client.put(
                    "/api/runninghub/workflows/workflow-contract-smoke", json=payload
                )
                self.assertEqual(denied.status_code, 403)

                client.post("/api/auth/logout")
                admin_login = client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                self.assertEqual(admin_login.status_code, 200)
                saved = client.put(
                    "/api/runninghub/workflows/workflow-contract-smoke", json=payload
                )
                self.assertEqual(saved.status_code, 200)
                self.assertTrue(saved.json()["success"])

                loaded = client.get(
                    "/api/runninghub/workflows/workflow-contract-smoke"
                )
                self.assertEqual(loaded.status_code, 200)
                workflow = loaded.json()["workflow"]
                self.assertEqual(workflow["title"], "Workflow Contract Smoke")
                self.assertEqual(workflow["fields"][0]["fieldValue"], "hello")
                self.assertEqual(workflow["optionalImageMode"], "keep-empty")


if __name__ == "__main__":
    unittest.main()
